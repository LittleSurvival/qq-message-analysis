import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {BrowserCorpus} from '../src/corpus/corpus-engine.js';
import {KEYS,PROMPT,LEGACY_PROMPT,PROMPT_VERSION} from '../src/corpus/corpus-contract.js';
import {evidenceRequest} from '../src/corpus/corpus-evidence.js';
import {normalizeMessage,buildContext,fitContext,validateAnnotations,complete,profileConfig} from '../src/corpus/corpus-model.js';
const base=Date.parse('2026-10-01T00:00:00+08:00');
const message=(i,text='謝謝你的幫忙',extra={})=>({id:String(i),timestamp:base+i*1000,type:'text',sender:{uid:'u1',uin:'123',name:'測試甲'},content:{elements:[{type:'text',data:{text}}]},...extra});
const annotation=t=>({message_id:t.message_id,scores:Object.fromEntries(KEYS.map(k=>[k,0])),evidence:[],reason:'合成測試',uncertainty:[]});
const file=messages=>new File([JSON.stringify({messages})],'聊天.json',{type:'application/json'});
const config={evidence_mode:'quotes',name:'測試',base_url:'https://fixture.test/v1',model:'mock'};
const respond=async(_url,options)=>{const p=JSON.parse(JSON.parse(options.body).messages[1].content);return Response.json({choices:[{message:{content:JSON.stringify({results:p.targets.map(t=>p.context_version?{message_id:t.message_id,reading:{summary:'合成案例判讀',kind:'ordinary',subject:'none',to:[]},scores:Object.fromEntries(KEYS.map(k=>[k,0])),judgments:[],uncertainty:[]}:annotation(t))})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}});};
// Existing reliability fixtures emulate saved legacy runs. New production runs
// always use the latest contract, regardless of an old profile's evidence mode.
const engine=fetcher=>{const e=new BrowserCorpus({dbName:'test-'+crypto.randomUUID(),fetcher}),request=e.request.bind(e);e.request=async(path,options)=>{const result=await request(path,options);if(path==='/runs'&&options?.method==='POST'&&(await e.db.get('profiles',options.body.profile_id)).evidence_mode==='quotes'){const saved=await e.db.get('runs',result.id);saved.config.evidence_mode='quotes';saved.prompt=LEGACY_PROMPT;saved.prompt_version='json-contract-v2';await e.db.put('runs',saved);e.states.delete(result.id);return request('/runs/'+result.id);}return result;};return e;};
async function prepared(fetcher=respond,messages=[message(1),message(2,'',{content:{elements:[{type:'image',data:{}}]}})]){const e=engine(fetcher);const dataset=await e.request('/datasets/upload',{method:'POST',body:{file:file(messages)}});const profile=await e.request('/profiles',{method:'POST',body:{...config,api_key:'secret-test'}});const run=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id,selection:{}}});return {e,dataset,profile,run};}
async function finish(e,id){await e.request(`/runs/${id}/resume`,{method:'POST'});await e.tasks.get(id);return e.request(`/runs/${id}`);}

test('a free parallel slot starts the next batch while an earlier request is still running',async()=>{
 let releaseFirst,enterThird;
 const firstGate=new Promise(resolve=>releaseFirst=resolve);
 const thirdStarted=new Promise(resolve=>enterThird=resolve);
 const started=[];
 const e=engine(async(url,options)=>{
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
  const id=payload.targets[0].message_id;
  started.push(id);
  if(id==='1')await firstGate;
  if(id==='3')enterThird();
  return respond(url,options);
 });
 const messages=[1,2,3].map(id=>message(id,'測試',{timestamp:base+id*3600000}));
 const dataset=await e.request('/datasets/upload',{method:'POST',body:{file:file(messages)}});
 const profile=await e.request('/profiles',{method:'POST',body:{...config,concurrency:2}});
 const run=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id}});
 let timer;
 try{
  await e.request(`/runs/${run.id}/resume`,{method:'POST'});
  await Promise.race([thirdStarted,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Free slot was not refilled')),2000))]);
  assert.deepEqual(started,['1','2','3']);
  assert.equal((await e.request(`/runs/${run.id}/message/1`)).status,'processing');
 }finally{
  clearTimeout(timer);releaseFirst();await e.tasks.get(run.id);
  e.db.close();e.releaseLock?.();
 }
});

test('exact reply ancestors outside the time window remain in context',()=>{
 const reply=(id,original,hour)=>message(id,'',{timestamp:base+hour*3600000,content:{elements:[{type:'text',data:{text:'回覆'}},{type:'reply',data:{referencedMessageId:String(original)}}]}});
 const all=[message(1),reply(2,1,1),reply(3,2,2),message(4,'無關',{timestamp:base+2.25*3600000}),reply(5,3,3),message(6,'附近',{timestamp:base+3.25*3600000})]
  .map((raw,position)=>({...normalizeMessage(raw),position}));
 const context=buildContext(all,new Map(all.map(m=>[m.id,m])),[all[4]]).context;
 assert.deepEqual(context.map(m=>[m.message_id,m.relation]),[['2','reply_ancestor'],['3','reply_ancestor'],['6','neighbor']]);
});

test('browser-only import, dedupe, run, report, review, export and restart',async()=>{
 const {e,dataset,profile,run}=await prepared();assert.equal(dataset.quality.stored,2);assert.equal((await e.request('/datasets/upload',{method:'POST',body:{file:file([message(1),message(2,'',{content:{elements:[{type:'image',data:{}}]}})])}})).id,dataset.id);
 const done=await finish(e,run.id);assert.equal(done.status,'completed');assert.deepEqual(done.counts,{done:1,unknown:1});assert.equal(done.input_tokens,10);
 assert.ok(done.seconds>0);assert.equal(done.output_tokens_per_second,20/done.seconds);
 const members=await e.request(`/runs/${run.id}/members`);assert.equal(members.items[0].dimensions.support.valid,1);assert.equal(members.items[0].dimensions.support.score,0);assert.equal(members.items[0].dimensions.support.unknown,1);
 const scores=Object.fromEntries(KEYS.map(k=>[k,k==='support'?3:0]));await e.request(`/runs/${run.id}/message/1/review`,{method:'POST',body:{scores,note:'人工測試'}});
 const detail=await e.request(`/runs/${run.id}/message/1`);assert.equal(detail.model_scores.support,0);assert.equal(detail.effective_scores.support,3);
 assert.equal((await e.request(`/runs/${run.id}/members`)).items[0].dimensions.support.score,100);
 assert.equal((await e.request(`/runs/${run.id}/results?dimension=support&member=u1`)).total,1);
 assert.equal((await e.request(`/runs/${run.id}/member?member=u1`)).monthly.length,1);
 const jsonl=await(await e.request(`/runs/${run.id}/export/jsonl`)).text();assert.equal(jsonl.trim().split('\n').length,2);assert.ok(!jsonl.includes('secret-test'));
 const anonymous=await(await e.request(`/runs/${run.id}/export/csv?anonymous=1`)).text();assert.ok(!anonymous.includes('測試甲'));assert.ok(!anonymous.includes('u1'));assert.ok(anonymous.includes('成員 1'));
 const saved=await e.db.get('profiles',profile.id);assert.ok(!JSON.stringify(saved).includes('secret-test'));assert.ok(!JSON.stringify(await e.db.get('runs',run.id)).includes('secret-test'));
 e.db.close();e.releaseLock?.();
 const reopened=new BrowserCorpus({dbName:e.dbName,fetcher:respond});
 assert.equal((await reopened.request('/profiles'))[0].has_key,false);
 assert.equal((await reopened.request(`/runs/${run.id}`)).counts.done,1);
 assert.equal((await reopened.request(`/runs/${run.id}/message/1`)).effective_scores.support,3);
 assert.equal((await reopened.request(`/datasets/${dataset.id}/file`)).name,'聊天.json');
 reopened.db.close();reopened.releaseLock?.();
});

test('pause aborts in-flight fetch; another run cannot execute concurrently; resume preserves results',async()=>{
 let entered,release;const start=new Promise(r=>entered=r);const slow=async(_u,o)=>{entered();await new Promise((resolve,reject)=>{release=resolve;o.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});return respond(_u,o);};
 const {e,run,profile}=await prepared(slow,[message(1),message(2)]);await e.request(`/runs/${run.id}/resume`,{method:'POST'});await start;
 const active=await e.request(`/runs/${run.id}`);assert.equal(active.activity.length,1);assert.ok(active.seconds>0);
 const another=await e.request('/runs',{method:'POST',body:{dataset_id:run.dataset_id,profile_id:profile.id}});
 await assert.rejects(e.request(`/runs/${another.id}/resume`,{method:'POST'}),/已有任務/);
 const paused=await e.request(`/runs/${run.id}/pause`,{method:'POST'});assert.equal(paused.status,'paused');assert.equal(paused.counts.pending,2);assert.equal(paused.activity.length,0);
 assert.equal((await e.request(`/runs/${run.id}`)).seconds,paused.seconds);
 e.fetcher=respond;const done=await finish(e,run.id);assert.equal(done.counts.done,2);assert.equal(done.status,'completed');assert.equal((await e.db.index('results','run',run.id)).length,2);
 release();e.db.close();
});

test('restart recovers interrupted work without discarding completed results or reusing a key',async()=>{
 const {e,run}=await prepared(respond,[message(1),message(2)]);await finish(e,run.id);
 const saved=await e.db.get('runs',run.id);saved.status='running';await e.db.put('runs',saved);
 const unfinished=await e.db.get('results',[run.id,'2']);unfinished.status='processing';unfinished.scores=null;await e.db.put('results',unfinished);
 e.db.close();e.releaseLock?.();
 let sent=[];const recovered=new BrowserCorpus({dbName:e.dbName,fetcher:async(u,o)=>{sent=JSON.parse(JSON.parse(o.body).messages[1].content).targets.map(t=>t.message_id);assert.ok(!o.headers.Authorization);return respond(u,o);}});
 const paused=await recovered.request(`/runs/${run.id}`);assert.equal(paused.status,'paused');assert.deepEqual(paused.counts,{done:1,pending:1});
 assert.equal((await finish(recovered,run.id)).counts.done,2);assert.deepEqual(sent,['2']);recovered.db.close();recovered.releaseLock?.();
});

test('date scope and per-dimension null denominators survive human review',async()=>{
 const {e,run,profile,dataset}=await prepared(respond,[message(1),message(2),message(3,'次月',{timestamp:base+32*86400000})]);
 const scoped=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id,selection:{from:'2026-10-01',to:'2026-10-31'}}});assert.equal(scoped.total,2);await finish(e,scoped.id);
 await e.request(`/runs/${scoped.id}/message/1/review`,{method:'POST',body:{scores:Object.fromEntries(KEYS.map(k=>[k,k==='support'?null:0])),note:'缺少上下文'}});
 const d=(await e.request(`/runs/${scoped.id}/members`)).items[0].dimensions.support;assert.equal(d.valid,1);assert.equal(d.score,0);assert.equal(d.unknown_rate,0.5);assert.equal(d.insufficient,true);
 assert.equal((await e.request(`/runs/${scoped.id}/members?start=2026-11-01`)).total,0);e.db.close();e.releaseLock?.();
});

test('isolated invalid output retries then stays failed without zero-filling or stopping later messages',async()=>{
 const {e,run}=await prepared(async()=>Response.json({choices:[{message:{content:'{"results":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:8,completion_tokens:1}}),Array.from({length:25},(_,i)=>message(i)));
 const info=await finish(e,run.id);assert.equal(info.status,'completed_with_errors');assert.equal(info.counts.failed,25);assert.equal(info.counts.pending,undefined);assert.ok(info.input_tokens>=48);const bad=await e.db.get('results',[run.id,'0']);assert.equal(bad.scores,null);assert.equal(bad.error_history.length,3);e.db.close();
});

test('date scope, exact replies, missing IDs, capacity limits and strict evidence',()=>{
 const raw=[message(1,'原文'),message(2,'回覆',{timestamp:base+86400000,content:{elements:[{type:'reply',data:{referencedMessageId:'1'}},{type:'text',data:{text:'回覆'}}]}})];
 const all=raw.map(normalizeMessage);all.forEach((m,i)=>m.position=i);const byId=new Map(all.map(m=>[m.id,m]));const cfg=profileConfig(config),context=fitContext(all,byId,[all[1]],cfg);
 assert.equal(context.payload.context[0].relation,'reply_ancestor');assert.equal(context.payload.context[0].message_id,'1');
 const a=annotation(context.payload.targets[0]);a.scores.support=1;a.evidence=[{message_id:'1',quote:'原文'}];assert.throws(()=>validateAnnotations(JSON.stringify({results:[a]}),context.payload),/目標訊息證據/);
 a.evidence=[{message_id:'2',quote:'不存在'}];assert.throws(()=>validateAnnotations(JSON.stringify({results:[a]}),context.payload),/原文/);
 all[1].text='長'.repeat(30000);assert.ok(fitContext(all,byId,[all[1]],cfg).overflow);
});

test('streamed progress precedes valid completion and never exposes reasoning text',async()=>{
 const payload={targets:[{message_id:'1',text:'你好',quoted:[]}],context:[]},events=[],content=JSON.stringify({results:[annotation(payload.targets[0])]});
 const frames=[{choices:[{delta:{reasoning:'secret-reasoning'}}]},{choices:[{delta:{content},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:1,completion_tokens:2}}].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')+'data: [DONE]\n\n';
 const bytes=new TextEncoder().encode(frames);const fetcher=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=11)c.enqueue(bytes.slice(i,i+11));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 const result=await complete(profileConfig(config),payload,{fetcher,onProgress:e=>events.push(e)});assert.equal(result.usage.output,2);assert.ok(events.some(e=>e.phase==='thinking'));assert.ok(events.some(e=>e.phase==='generating'));assert.ok(!JSON.stringify(events).includes('secret-reasoning'));
});

test('profile destination changes do not reuse secrets; browser errors and truncation are explicit',async()=>{
 const e=engine(respond),p=await e.request('/profiles',{method:'POST',body:{...config,api_key:'private-key'}});
 const next=await e.request('/profiles/'+p.id,{method:'PUT',body:{...config,base_url:'https://other.test/v1'}});assert.equal(next.has_key,false);
 const payload={targets:[],context:[]};await assert.rejects(complete(profileConfig(config),payload,{fetcher:async()=>{throw new TypeError('network');}}),/CORS/);
 await assert.rejects(complete(profileConfig(config),payload,{fetcher:async()=>Response.json({choices:[{finish_reason:'length',message:{content:'',reasoning:'private'}}],usage:{prompt_tokens:3,completion_tokens:4}})}),error=>{
  assert.match(error.message,/截斷/);assert.equal(error.usage.input,3);assert.equal(error.usage.output,4);assert.equal(error.diagnostics.code,'output_truncated');assert.equal(error.diagnostics.answer_chars,0);assert.equal(error.diagnostics.reasoning_chars,7);assert.ok(!JSON.stringify(error).includes('private'));return true;
 });e.db.close();
});

test('connection test sends no-thinking setting and correlates progress without storing draft settings',async()=>{
 const events=[],e=engine(async(u,o)=>{assert.equal(JSON.parse(o.body).reasoning_effort,'none');assert.equal(JSON.parse(o.body).temperature,0);return respond(u,o);});e.onEvent=event=>events.push(event);
 const response=await e.request('/profiles/test',{method:'POST',body:{...config,reasoning_effort:'none',temperature:0,test_id:'draft-test'}});
 assert.equal(response.ok,true);assert.ok(events.length>0);assert.ok(events.every(e=>e.test_id==='draft-test'&&e.type==='connection-progress'));assert.equal((await e.request('/profiles')).length,0);e.db.close();e.releaseLock?.();
});

test('generation settings stay optional and frozen on existing runs',async()=>{
 assert.equal(profileConfig(config).temperature,null);assert.throws(()=>profileConfig({...config,temperature:3}),/隨機程度/);
 const {e,profile,run}=await prepared();await e.request('/profiles/'+profile.id,{method:'PUT',body:{...config,temperature:0,reasoning_effort:'none'}});
 const saved=await e.db.get('runs',run.id);assert.equal(saved.config.temperature,null);assert.equal(saved.config.reasoning_effort,'default');assert.equal(saved.prompt_version,'json-contract-v2');e.db.close();e.releaseLock?.();
});

test('JSONL import keeps stable identities, exact reply IDs, duplicates and invalid counts',async()=>{
 const e=engine(respond),messages=[message(1),message(2,'',{type:'image',sender:{uin:'123',name:'改名'},content:{elements:[{type:'reply',data:{referencedMessageId:'1'}},{type:'image',data:{}}]}}),message(1),{id:'bad'}];
 const d=await e.request('/datasets/upload',{method:'POST',body:{file:new File([messages.map(m=>JSON.stringify(m)).join('\n')],'聊天.jsonl')}});
 assert.equal(d.quality.read,4);assert.equal(d.quality.stored,2);assert.equal(d.quality.duplicates,1);assert.equal(d.quality.invalid,1);assert.equal(d.quality.members,1);assert.equal(d.quality.resolved_replies,1);assert.equal(d.quality.unreadable,1);
 e.data.clear();const data=await e.dataset(d.id);assert.equal(data.messages[1].member_id,'u1');assert.equal(data.messages[1].reply_id,'1');e.db.close();e.releaseLock?.();
});

test('schema fallback validates locally and transient rate limit retries preserve usage',async()=>{
 const modes=[],payload={targets:[{message_id:'1',text:'你好',quoted:[]}],context:[]};
 const response=await complete(profileConfig(config),payload,{fetcher:async(u,o)=>{const b=JSON.parse(o.body);modes.push(b.response_format?.type);if(modes.length===1)return new Response('response_format json_schema unsupported',{status:400});return respond(u,o);}});
 assert.deepEqual(modes,['json_schema','json_object']);assert.equal(response.mode,'json_object');
 let calls=0;const {e,run}=await prepared(async(u,o)=>++calls===1?new Response('rate limit',{status:429}):respond(u,o));const done=await finish(e,run.id);
 assert.equal(calls,2);assert.equal(done.counts.done,1);assert.equal(done.input_tokens,10);assert.equal(done.unmetered_requests,1);assert.equal((await e.db.get('results',[run.id,'1'])).attempts,2);e.db.close();e.releaseLock?.();
});

test('interrupted response streams are retryable and never become successful zero scores',async()=>{
 const fetcher=async()=>new Response(new ReadableStream({start(c){c.error(new TypeError('socket disconnected'));}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(complete(profileConfig(config),{targets:[],context:[]},{fetcher}),e=>e.retryable===true&&e.message==='模型回應傳輸中斷');
});

test('evidence references recover exact original text and reject invented references and context-only attribution',async()=>{
 const payload={targets:[{message_id:'999999999999999999',speaker:'u',text:'原文abc沒有空格😀。第二句',quoted:[]}],context:[{message_id:'neighbor',speaker:'v',text:'旁人的話',quoted:[]}]};
 const wire=evidenceRequest(payload),target=wire.data.targets[0],source=target.text_segments[0];
 assert.equal(Object.keys(wire.data).at(-1),'targets');
 const a={...annotation(target),scores:Object.fromEntries(KEYS.map(k=>[k,k==='support'?1:0])),evidence:[source.ref]};
 const restored=validateAnnotations(wire.decode(JSON.stringify({results:[a]})),payload)[0];assert.equal(restored.message_id,payload.targets[0].message_id);assert.equal(restored.evidence[0].quote,'原文abc沒有空格😀。');
 a.evidence=['invented'];assert.throws(()=>wire.decode(JSON.stringify({results:[a]})),/不存在的證據/);
 a.evidence=[wire.data.context[0].text_segments[0].ref];assert.throws(()=>validateAnnotations(wire.decode(JSON.stringify({results:[a]})),payload),/目標訊息證據/);
});

test('reference protocol end-to-end preserves evidence and records a repaired validation failure',async()=>{
 let calls=0;const e=engine(async(u,o)=>{const b=JSON.parse(o.body),p=JSON.parse(b.messages[1].content);assert.ok(p.targets[0].text_segments);const a=annotation(p.targets[0]);a.scores.support=1;a.evidence=[++calls===1?'invalid':p.targets[0].text_segments[0].ref];if(calls===2)assert.match(b.messages[0].content,/上次驗證失敗/);return Response.json({choices:[{message:{content:JSON.stringify({results:[a]})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}});});
 const d=await e.request('/datasets/upload',{method:'POST',body:{file:file([message(1,'原文ABC保持相同')])}}),p=await e.request('/profiles',{method:'POST',body:{...config,evidence_mode:'references'}}),run=await e.request('/runs',{method:'POST',body:{dataset_id:d.id,profile_id:p.id}});
 // Simulate a saved v3 run: resuming it must retain its frozen wire contract.
 const saved=await e.db.get('runs',run.id);saved.config.evidence_mode='references';saved.prompt=PROMPT;saved.prompt_version=PROMPT_VERSION;await e.db.put('runs',saved);e.states.delete(run.id);
 const done=await finish(e,run.id);assert.equal(done.status,'completed');assert.equal(done.counts.done,1);assert.equal(done.input_tokens,20);
 const r=await e.db.get('results',[run.id,'1']);assert.equal(r.evidence[0].quote,'原文ABC保持相同');assert.equal(r.error_history.length,1);assert.equal(r.attempts,2);e.db.close();e.releaseLock?.();
});

test('one persistent bad message is isolated; remaining messages finish and retry does not double-count',async()=>{
 const {e,run}=await prepared(async(u,o)=>{const p=JSON.parse(JSON.parse(o.body).messages[1].content);if(p.targets[0].message_id==='1')return Response.json({choices:[{message:{content:'{"results":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});return respond(u,o);},Array.from({length:6},(_,i)=>message(i+1,'測試',{timestamp:base+i*3600000})));
 const done=await finish(e,run.id);assert.equal(done.status,'completed_with_errors');assert.equal(done.counts.done,5);assert.equal(done.counts.failed,1);assert.equal((await e.db.get('results',[run.id,'1'])).scores,null);
 e.fetcher=respond;await e.request(`/runs/${run.id}/retry`,{method:'POST'});await e.tasks.get(run.id);const retried=await e.request(`/runs/${run.id}`);assert.equal(retried.counts.done,6);assert.equal(retried.counts.failed,undefined);assert.equal((await e.db.index('results','run',run.id)).length,6);e.db.close();e.releaseLock?.();
});

test('five consecutive invalid batches trip circuit breaker; authentication failure pauses immediately',async()=>{
 const messages=Array.from({length:6},(_,i)=>message(i,'測試',{timestamp:base+i*3600000}));
 const {e,run}=await prepared(async()=>Response.json({choices:[{message:{content:'{"results":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}),messages);
 const bad=await finish(e,run.id);assert.equal(bad.status,'paused');assert.equal(bad.counts.failed,5);assert.equal(bad.counts.pending,1);assert.equal(bad.input_tokens,15);e.db.close();e.releaseLock?.();
 let calls=0;const auth=await prepared(async()=>{calls++;return new Response('unauthorized',{status:401});},messages);const stopped=await finish(auth.e,auth.run.id);assert.equal(stopped.status,'paused');assert.equal(stopped.counts.pending,5);assert.equal(calls,1);auth.e.db.close();auth.e.releaseLock?.();
});

test('new runs upgrade old saved profile defaults while existing run protocol remains frozen',async()=>{
 const {e,profile,run,dataset}=await prepared();const old=await e.db.get('profiles',profile.id);delete old.evidence_mode;await e.db.put('profiles',old);
 const fresh=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id}});
 assert.equal(fresh.config.evidence_mode,'behavior-v4');assert.equal(fresh.prompt_version,'behavior-evidence-v4.7');assert.equal((await e.request('/runs/'+run.id)).config.evidence_mode,'quotes');e.db.close();e.releaseLock?.();
});

test('batch shrinking with interleaved unreadable media never skips pending messages',async()=>{
 const messages=Array.from({length:28},(_,i)=>i%2?message(i,'',{type:'image',content:{elements:[{type:'image',data:{}}]}}):message(i));
 const {e,profile,dataset}=await prepared(respond,messages);await e.request('/profiles/'+profile.id,{method:'PUT',body:{...config,context_tokens:8192,max_output_tokens:2048}});
 const run=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id}});let timer;
 try{const done=await Promise.race([finish(e,run.id),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('pending messages stranded after batch shrink')),3000))]);assert.equal(done.status,'completed');assert.equal(done.counts.done,14);assert.equal(done.counts.unknown,14);assert.equal(done.counts.pending,undefined);}
 finally{clearTimeout(timer);if(e.tasks.has(run.id))await e.request(`/runs/${run.id}/pause`,{method:'POST'});e.db.close();e.releaseLock?.();}
});
