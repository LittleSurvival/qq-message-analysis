import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {KEYS} from '../src/corpus/corpus-contract.js';
import {behaviorRequest} from '../src/corpus/corpus-behavior.js';
import {relatedContext} from '../src/corpus/corpus-context.js';
import {buildContext,fitContext,profileConfig,completeReviewed} from '../src/corpus/corpus-model.js';
import {openStore} from '../src/corpus/corpus-store.js';
import {BrowserCorpus} from '../src/corpus/corpus-engine.js';

const zero=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const base=Date.parse('2026-11-07T00:00:00+08:00');
const msg=(id,hour,member_id,text,extra={})=>({id,member_id,uin:member_id==='a'?'100':member_id==='b'?'200':member_id,name:member_id,timestamp:base+hour*3600000,text,readable:!!text,system:false,type:'text',mentions:[],quoted:[],reply_id:null,...extra});
const prepare=all=>{all.sort((a,b)=>a.timestamp-b.timestamp);all.forEach((m,i)=>m.position=i);return new Map(all.map(m=>[m.id,m]));};
const context=(all,id)=>{const byId=prepare(all),targets=[byId.get(id)];return relatedContext(all,byId,targets,buildContext(all,byId,targets));};
const row=(wire,kind='ordinary',subject='none')=>({message_id:wire.data.targets[0].message_id,reading:{summary:'合成案例判讀',kind,subject,to:[]},scores:zero(),judgments:[],uncertainty:[]});
const decode=(wire,r)=>wire.decode(JSON.stringify({results:[r]}))[0];

test('a negative score cannot pass with a reason that explicitly says there is no negative emotion',()=>{
 const wire=behaviorRequest(context([msg('t',1,'a','這道菜很好吃')],'t'));
 const result=row(wire);
 result.scores.negative=1;
 result.judgments=[{dimension:'negative',refs:[wire.data.targets[0].text_segments[0].ref],reason:'整體為正面評價，無明顯負面情緒，應為 0。'}];
 assert.ok(decode(wire,result).review_flags.includes('negative:reason_conflict'));
});

test('a zero with an insult clue is rechecked, and clean intensity disagreement counts occurrence only',async()=>{
 let calls=0;
 const e=new BrowserCorpus({dbName:'partial-'+crypto.randomUUID(),experimentalBehavior:true,fetcher:async(_url,opts)=>{
  calls++;
  const input=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);
  const results=input.targets.map((target,index)=>{
   if(calls===3)return {message_id:target.message_id,verdict:'attack',target_type:'person',relation:'addressed',target_text:'你',attack_ref:target.text_segments[0].ref,reason:'直接貶低對方'};
   const attack=index===0?calls===1?2:3:calls===1?0:2;
   return {message_id:target.message_id,reading:{summary:'判讀本人稱呼',kind:'hostile',subject:'person',to:[]},
    scores:{...zero(),attack},judgments:attack?[{dimension:'attack',refs:[target.text_segments[0].ref],reason:'直接貶低對方'}]:[],uncertainty:[]};
  });
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results})}}],usage:{prompt_tokens:10,completion_tokens:20}});
 }});
 try{
  const messages=['你是個廢物','你也是個廢物'].map((text,i)=>({id:'t'+i,timestamp:base+i,type:'text',sender:{uid:'a'},content:{text}}));
  const dataset=await e.request('/datasets/upload',{method:'POST',body:{file:new File([JSON.stringify({messages})],'test.json')}});
  const profile=await e.request('/profiles',{method:'POST',body:{name:'test',model:'mock'}});
  const run=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id}});
  const url='/runs/'+run.id;
  await e.request(url+'/resume',{method:'POST'});
  await e.tasks.get(run.id);
  assert.equal(calls,3);
  assert.deepEqual((await e.request(url+'/message/t0')).confirmed_occurrences,['attack']);
  const missed=await e.request(url+'/message/t1');
  assert.deepEqual(missed.confirmed_occurrences,[]);
  assert.ok(missed.review_flags.includes('attack:model_disagreement'));
  const dimensions=(await e.request(url+'/members')).items[0].dimensions;
  const attack=dimensions.attack;
  assert.equal(dimensions.respect.valid,2);
  assert.equal(attack.count,1);
  assert.equal(attack.valid,1);
  assert.equal(attack.intensity_valid,0);
  assert.equal(attack.score,null);
  assert.equal((await e.request(url+'/results?dimension=attack')).total,1);
  await e.request(url+'/message/t0/review',{method:'POST',body:{scores:{...zero(),attack:2},note:'人工確認強度'}});
  const reviewed=(await e.request(url+'/members')).items[0].dimensions.attack;
  assert.equal(reviewed.count,1);
  assert.equal(reviewed.intensity_valid,1);
  assert.equal(reviewed.score,66.67);
 }finally{e.db.close();e.releaseLock?.();}
});

test('exact identities, descendants and separated historical candidates survive wire encoding',()=>{
 const all=[msg('old',1,'b','不要再點名我了',{mentions:[{uin:'100'}]}),msg('unrelated',4,'c','無關話題'),msg('target',9,'a','昨晚你還沒回答我',{mentions:[{uin:'200',name:'改名後'}]}),msg('answer',10,'b','已經說過了',{reply_id:'target'})];
 const payload=context(all,'target'),wire=behaviorRequest(payload);
 assert.equal(payload.context.find(m=>m.message_id==='old').relation,'related_candidate');
 assert.equal(payload.context.find(m=>m.message_id==='answer').relation,'reply_descendant');
 assert.ok(!payload.context.some(m=>m.message_id==='unrelated'));
 assert.equal(wire.data.targets[0].mentions[0].speaker,wire.data.context.find(m=>m.message_id==='c0').speaker);
 assert.equal(wire.data.context[0].mentions[0].speaker,wire.data.targets[0].speaker);
 assert.equal(wire.data.context.at(-1).reply_id,'t0');
});

test('missing reply and ambiguous mentions never resolve by display name',()=>{
 const all=[msg('a',1,'a','甲',{uin:'9'}),msg('b',2,'b','乙',{uin:'9'}),msg('t',9,'c','之前的事情',{reply_id:'missing',mentions:[{uin:'9',name:'a'}]})];
 const payload=context(all,'t');assert.deepEqual(payload.target_flags.t,['missing_reply','unresolved_addressee','unresolved_reference']);
 assert.equal(payload.targets[0].mentions[0].member_id,null);
 assert.equal(payload.context.length,0);
});

test('quoted content cannot supply authored evidence; exact source identity is retained',()=>{
 const payload=context([msg('origin',0,'b','你是廢物'),msg('t',1,'a','請不要這樣講話',{reply_id:'origin',quoted:[{kind:'reply_preview',text:'你是廢物',sender:'乙',reference_id:'origin'}]})],'t');
 const wire=behaviorRequest(payload),r=row(wire,'hostile','person');r.scores.attack=2;r.judgments=[{dimension:'attack',refs:[wire.data.targets[0].quoted[0].text_segments[0].ref],reason:'引用包含辱罵'}];
 const result=decode(wire,r);assert.ok(result.review_flags.includes('attack:missing_authored_evidence'));assert.equal(result.evidence[0].source_kind,'quoted');assert.equal(result.evidence[0].author_id,'b');
 assert.equal(wire.data.targets[0].quoted[0].source_speaker,wire.data.context[0].speaker);
});

test('banter/object contradictions and unsupported event scores are withheld, not zeroed',()=>{
 const wire=behaviorRequest(context([msg('t',1,'a','笨蛋，你又忘記回來聊天')],'t'));
 const r=row(wire,'banter','person');r.scores.attack=2;r.judgments=[{dimension:'attack',refs:[wire.data.targets[0].text_segments[0].ref],reason:'朋友互相調侃，非攻擊他人'}];
 const result=decode(wire,r);assert.equal(result.scores.attack,2);assert.ok(result.review_flags.includes('attack:reading_conflict'));assert.ok(result.review_flags.includes('attack:reason_conflict'));
 r.reading={summary:'合成案例判讀',kind:'indirect_challenge',subject:'person',to:[]};r.scores=zero();r.scores.provocation=2;r.judgments[0]={dimension:'provocation',refs:[wire.data.targets[0].text_segments[0].ref],reason:'延續先前爭執'};
 assert.ok(decode(wire,r).review_flags.includes('provocation:missing_event_evidence'));
});

test('null remains unknown; missing dimensions, fabricated refs and duplicate IDs fail validation',()=>{
 const wire=behaviorRequest(context([msg('t',1,'a','你好壞')],'t')),r=row(wire,'uncertain','unknown');
 r.scores.attack=null;r.judgments=[{dimension:'attack',refs:[],reason:'原圖不可讀'}];r.uncertainty=['缺少圖片'];
 assert.equal(decode(wire,r).scores.attack,null);assert.ok(decode(wire,r).review_flags.includes('uncertain_dimension'));
 const missing=structuredClone(r);missing.judgments=[];assert.throws(()=>decode(wire,missing),/缺少/);
 const bad=structuredClone(r);bad.judgments[0].refs=['invented'];assert.throws(()=>decode(wire,bad),/證據/);
 assert.throws(()=>wire.decode(JSON.stringify({results:[r,r]})),/遺漏/);
 const multi=behaviorRequest({...context([msg('t',1,'a','甲'),msg('u',2,'b','乙')],'t'),targets:[{message_id:'t',speaker:'a',text:'甲'},{message_id:'u',speaker:'b',text:'乙'}]});
 const first=row(multi);assert.throws(()=>multi.decode(JSON.stringify({results:[first,first]})),/重複/);
});

test('per-dimension reasons retain exact sources, while all-zero assessments remain valid',()=>{
 const wire=behaviorRequest(context([msg('t',1,'a','謝謝你，辛苦了')],'t'));
 assert.deepEqual(decode(wire,row(wire)).review_flags,[]);
 const r=row(wire,'support','person');r.scores.support=2;r.scores.respect=1;
 r.judgments=['support','respect'].map(dimension=>({dimension,refs:[wire.data.targets[0].text_segments[0].ref],reason:dimension==='support'?'明確感謝':'體諒付出'}));
 const result=decode(wire,r);assert.equal(result.judgments.length,2);assert.deepEqual(result.review_flags,[]);assert.equal(result.evidence[0].quote,'謝謝你，辛苦了');
});

test('each reply ancestor belongs to its own target, not every target in the batch',()=>{
 const all=[msg('p1',0,'a','先前甲事件'),msg('p2',.1,'b','先前乙事件'),msg('t1',8,'c','追問甲',{reply_id:'p1'}),msg('t2',8.01,'d','追問乙',{reply_id:'p2'})],byId=prepare(all),targets=all.slice(-2);
 const payload=relatedContext(all,byId,targets,buildContext(all,byId,targets));
 assert.deepEqual(payload.context.find(m=>m.message_id==='p1').related_to,['t1']);
 assert.deepEqual(payload.context.find(m=>m.message_id==='p2').related_to,['t2']);
 const wire=behaviorRequest(payload),r=row(wire,'indirect_challenge','person');r.scores.provocation=1;
 r.judgments=[{dimension:'provocation',refs:[wire.data.targets[0].text_segments[0].ref,wire.data.context.find(m=>wire.identifiers[m.message_id]==='p2').text_segments[0].ref],reason:'聲稱延續事件'}];
 const second={...row(wire),message_id:'t1'};
 assert.ok(wire.decode(JSON.stringify({results:[r,second]}))[0].review_flags.includes('provocation:missing_event_evidence'));
});

test('a later reply cannot prove the event was already underway',()=>{
 const payload=context([msg('t',1,'a','你玩夠了嗎'),msg('z',1,'b','別一直挑釁',{reply_id:'t'})],'t');
 const wire=behaviorRequest(payload),t=wire.data.targets[0],z=wire.data.context[0],r=row(wire,'indirect_challenge','person');
 assert.ok(z.order>t.order);
 r.scores.provocation=1;
 r.judgments=[{dimension:'provocation',refs:[t.text_segments[0].ref,z.text_segments[0].ref],reason:'引用後來的抗議'}];
 assert.deepEqual(decode(wire,r).review_flags,['provocation:later_event_evidence','provocation:missing_event_evidence']);
});

test('prior-only review can confirm occurrence from a linked earlier dispute, but cannot promote a reading of banter',async()=>{
 const all=[msg('old',1,'a','你一直想證明我會跟你吵架',{mentions:[{uid:'b'}]}),msg('p',2,'b','吵了一整晚'),msg('t',2.01,'a','這不是你希望的嗎',{reply_id:'p'}),msg('z',2.02,'c','夠了',{reply_id:'t'})];
 const payload=context(all,'t');payload.target_flags.t.push('history_limited');
 const cfg=profileConfig({name:'test',model:'mock'});
 for(const scenario of ['discussion','banter','one-prior','wrong-author']){
  let calls=0;
  const response=await completeReviewed(cfg,payload,{fetcher:async(_u,o)=>{
   const p=JSON.parse(JSON.parse(o.body).messages[1].content),t=p.targets[0];
   let r={results:[row({data:p},scenario==='banter'?'banter':'discussion','person')]};
   if(++calls===2){
    assert.ok(p.context.every(m=>m.order<t.order));
    assert.ok(!JSON.stringify(p).includes('夠了'));
    const who=p.prior_event[0],anchors=p.context.filter(m=>who.messages.includes(m.message_id));
    assert.equal(anchors.length,2);
    r={verdict:'provocation',to:who.speaker,history_id:who.history[0],history_speaker:scenario==='wrong-author'?who.speaker:anchors[0].speaker,link_id:scenario==='one-prior'?who.history[0]:t.reply_id,reason:'再次向同一人追問爭吵結果'};
   }
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(r)}}],usage:{prompt_tokens:10,completion_tokens:20}});
  }});
  assert.equal(calls,2);assert.deepEqual(response.annotations[0].confirmed_occurrences||[],scenario==='discussion'?['provocation']:[]);
  if(['one-prior','wrong-author'].includes(scenario))assert.ok(response.annotations[0].review_flags.includes('semantic_review_failed'));
  assert.equal(response.review_input.input.prior_event.length,1);
 }
});

test('semantic recheck is bounded, preserves both passes, meters tokens and withholds disagreement',async()=>{
 const payload=context([msg('t',1,'a','帶敵意或玩笑的話')],'t'),cfg=profileConfig({name:'test',model:'mock'});let calls=0;
 const response=await completeReviewed(cfg,payload,{attackReview:true,fetcher:async(_u,o)=>{const p=JSON.parse(JSON.parse(o.body).messages[1].content),t=p.targets[0],positive=++calls===1;
  const r=calls===3?{message_id:t.message_id,verdict:'unclear',target_type:'other',relation:null,target_text:null,attack_ref:null,reason:'語氣不確定'}:
   {message_id:t.message_id,reading:{summary:'合成判讀',kind:positive?'hostile':'banter',subject:'person',to:[]},scores:{...zero(),attack:positive?2:0},judgments:positive?[{dimension:'attack',refs:[t.text_segments[0].ref],reason:'合成敵意'}]:[],uncertainty:[]};
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[r]})}}],usage:{prompt_tokens:10,completion_tokens:20}});
 }});
 assert.equal(calls,3);assert.deepEqual(response.usage,{input:30,output:60,measured:true});assert.equal(response.annotations[0].model_passes[0].scores.attack,2);assert.equal(response.annotations[0].accepted_scores.attack,null);assert.ok(response.annotations[0].review_flags.includes('attack:model_disagreement'));
});

test('two light attack scores cannot bypass a direct reply that was not considered',async()=>{
 const payload=context([msg('t',1,'a','你這笨蛋，又把群聊忘了'),msg('z',1.001,'b','我才不是笨蛋',{reply_id:'t'})],'t');
 const cfg=profileConfig({name:'test',model:'mock'});let calls=0;
 const response=await completeReviewed(cfg,payload,{attackReview:true,fetcher:async(_u,o)=>{
  const body=JSON.parse(o.body),p=JSON.parse(body.messages[1].content),t=p.targets[0];
  if(++calls===2)assert.match(body.messages[0].content,/先讀 reply_id/);
  const r=calls===3?{message_id:t.message_id,verdict:'attack',target_type:'person',relation:'addressed',target_text:'你',attack_ref:t.text_segments[0].ref,reason:'直接稱呼'}:row({data:p},'hostile','person');
  if(calls<3){r.reading.to=[p.context[0].speaker];r.scores.attack=1;r.judgments=[{dimension:'attack',refs:[t.text_segments[0].ref],reason:'使用輕微侮辱性稱呼'}];}
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[r]})}}],usage:{prompt_tokens:10,completion_tokens:20}});
 }});
 assert.equal(calls,3);
 assert.ok(response.annotations[0].review_flags.includes('attack:unresolved_reply_tone'));
 assert.deepEqual(response.annotations[0].confirmed_occurrences,[]);
});

test('information review separates actual detail, borrowed context and possible harm',async()=>{
 const cfg=profileConfig({name:'test',model:'mock'});
 const cases=[
  {text:'我沒試過',quote:'我沒試過',information:0},
  {text:'我有問過那家店',quote:'最低 600 日圓',information:null},
  {text:'任意金額都折五百',quote:'任意金額都折五百',information:2},
  {text:'那傢伙只會人身攻擊',verdict:'none',quote:null,signal:'那傢伙只會人身攻擊',information:0},
 ];
 for(const c of cases){
  const payload=context([msg('t',1,'a',c.text),msg('z',1.01,'b','最低 600 日圓')],'t');
  const response=await completeReviewed(cfg,payload,{informationReview:true,fetcher:async(_u,o)=>{
   const body=JSON.parse(o.body),data=JSON.parse(body.messages[1].content),t=data.targets[0];
   const review=Array.isArray(t.authored_text);
   const r=review?{message_id:t.message_id,verdict:c.verdict||'contribution',evidence_ref:c.quote===null?null:c.quote===c.text?t.authored_text[0].ref:'other-message-ref',reason:'資訊覆核理由',
    signals:c.signal?[{dimension:'attack',evidence_ref:t.authored_text[0].ref,reason:'可能有針對他人的貶抑'}]:[]}:
    {message_id:t.message_id,reading:{summary:'模型判為資訊',kind:'ordinary',subject:'none',to:[]},scores:{...zero(),information:2},
     judgments:[{dimension:'information',refs:[t.text_segments[0].ref],reason:'模型判為資訊'}],uncertainty:[]};
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[r]})}}],usage:{prompt_tokens:10,completion_tokens:20}});
  }});
  const row=response.annotations[0];
  assert.equal(row.accepted_scores.information,c.information);
  assert.equal(row.scores.information,2);
  if(c.signal){assert.equal(row.accepted_scores.attack,null);assert.ok(row.review_flags.includes('attack:possible_misclassified_information'));}
  if(c.information===null)assert.ok(row.review_flags.includes('information:contribution_unclear'));
 }
});

test('a third-party insult uses the named subject and keeps unrelated uncertainty local',async()=>{
 const payload=context([msg('p',1,'b','你怎麼看編劇？'),msg('t',1.01,'a','那個編劇就是個混蛋',{reply_id:'p'}),msg('z',1.02,'b','那我們換話題吧',{reply_id:'t'})],'t');
 const cfg=profileConfig({name:'test',model:'mock'});
 for(const targetText of ['那個編劇','虛構名稱','那個編劇就是個混蛋']){
  let calls=0;
  const response=await completeReviewed(cfg,payload,{attackReview:true,fetcher:async(_u,o)=>{
   const p=JSON.parse(JSON.parse(o.body).messages[1].content),t=p.targets[0];
   const r=row({data:p},'hostile','person');
   r.reading.to=[p.context[0].speaker];r.scores.attack=1;
   r.judgments.push({dimension:'attack',refs:[t.text_segments[0].ref],reason:'辱稱'});
   if(++calls===1){r.scores.negative=1;r.judgments.push({dimension:'negative',refs:[t.text_segments[0].ref],reason:'不滿'});}
   const result=calls===3?{message_id:t.message_id,verdict:'attack',target_type:'person',relation:'third_party',target_text:targetText,attack_ref:t.text_segments[0].ref,reason:'稱真人編劇為混蛋'}:r;
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[result]})}}],usage:{prompt_tokens:10,completion_tokens:20}});
  }});
  const result=response.annotations[0];
  assert.equal(calls,3);assert.equal(result.accepted_scores.negative,null);assert.equal(result.accepted_scores.respect,0);
  assert.equal(result.accepted_scores.attack,targetText==='那個編劇'?1:null);
  if(targetText==='那個編劇'){assert.equal(result.attack_review.reply_to,'b');assert.equal(result.attack_review.target_text,targetText);}
 }
});

test('database upgrade adds batch snapshots without changing old saved results',async()=>{
 const name='migration-'+crypto.randomUUID();await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('results',{keyPath:['run_id','message_id']}).put({run_id:1,message_id:'old',scores:zero()});};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});
 const db=await openStore(name);try{assert.equal((await db.get('results',[1,'old'])).scores.attack,0);await db.put('batches',{run_id:2,id:3,input:{targets:[]}});assert.deepEqual((await db.get('batches',[2,3])).input,{targets:[]});}finally{db.close();}
});

test('a failed second opinion cannot release a clean first-pass harmful score',async()=>{
 const payload=context([msg('t',1,'a','不友善的話')],'t'),cfg=profileConfig({name:'test',model:'mock'});let calls=0;
 const result=await completeReviewed(cfg,payload,{fetcher:async()=>{if(++calls===2)return new Response('unavailable',{status:503});const wire=behaviorRequest(payload),r=row(wire,'hostile','person');r.scores.attack=2;r.judgments=[{dimension:'attack',refs:[wire.data.targets[0].text_segments[0].ref],reason:'合成辱罵'}];return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[r]})}}],usage:{prompt_tokens:10,completion_tokens:20}});}});
 assert.equal(calls,2);assert.equal(result.annotations[0].scores.attack,2);assert.ok(result.annotations[0].review_flags.includes('semantic_review_failed'));assert.equal(result.usage.input,10);assert.equal(result.usage.measured,false);
});

test('zero-score explanations are valid counterevidence, not a fabricated positive',()=>{
 const wire=behaviorRequest(context([msg('t',1,'a','自嘲')],'t')),r=row(wire);r.judgments=[{dimension:'attack',refs:[wire.data.targets[0].text_segments[0].ref],reason:'只在說自己'}];
 assert.deepEqual(decode(wire,r).review_flags,[]);assert.equal(decode(wire,r).scores.attack,0);
});

test('new runs upgrade explicit legacy profiles, reject stale v4 execution, and reserve both opinions',async()=>{
 let calls=0;const e=new BrowserCorpus({dbName:'budget-'+crypto.randomUUID(),fetcher:async()=>{calls++;throw Error('must not send');}});
 try{
  const d=await e.request('/datasets/upload',{method:'POST',body:{file:new File([JSON.stringify({messages:[{id:'t',timestamp:base,type:'text',sender:{uid:'a'},content:{text:'hello'}}]})],'test.json')}});
  const p=await e.request('/profiles',{method:'POST',body:{name:'budget',model:'mock',evidence_mode:'quotes',context_tokens:16384,max_output_tokens:2048,input_price:1,output_price:1,budget:.1}});
  const run=await e.request('/runs',{method:'POST',body:{dataset_id:d.id,profile_id:p.id}});assert.equal(run.config.evidence_mode,'behavior-v4');
  const state=await e.state(run.id);state.run.prompt_version='behavior-evidence-v4';
  await assert.rejects(e.request(`/runs/${run.id}/resume`,{method:'POST'}),/較早的評分契約/);assert.equal(calls,0);
  state.run.prompt_version=run.prompt_version;
  await e.request(`/runs/${run.id}/resume`,{method:'POST'});await e.tasks.get(run.id);
  const stopped=await e.request(`/runs/${run.id}`);assert.equal(stopped.status,'paused');assert.equal(stopped.counts.pending,1);assert.match(stopped.error,/預算/);assert.equal(calls,0);
 }finally{e.db.close();e.releaseLock?.();}
});

test('capacity shrinking preserves exact ancestry and records removed candidates',()=>{
 const all=[msg('p',0,'b','前文'),...Array.from({length:10},(_,i)=>msg('n'+i,.5+i/100,'c','很長的鄰近話題'.repeat(100))),msg('t',1,'a','回覆',{reply_id:'p'})],byId=prepare(all);
 const cfg=profileConfig({name:'test',model:'mock',context_tokens:16384,max_output_tokens:2048});
 const fit=fitContext(all,byId,[byId.get('t')],cfg);assert.equal(fit.overflow,false);assert.ok(fit.payload.flags.includes('context_reduced'));assert.ok(fit.payload.context.some(m=>m.message_id==='p'));
 all.at(-1).text='長'.repeat(20000);assert.equal(fitContext(all,byId,[all.at(-1)],cfg).overflow,true);
});

test('review queue excludes raw scores, preserves input, and manual correction survives restart',async()=>{
 const dbName='behavior-'+crypto.randomUUID(),e=new BrowserCorpus({dbName,fetcher:async(_url,o)=>{const p=JSON.parse(JSON.parse(o.body).messages[1].content);const t=p.targets[0];return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[{message_id:t.message_id,reading:{summary:'合成案例判讀',kind:'banter',subject:'person',to:[]},scores:{...zero(),attack:2},judgments:[{dimension:'attack',refs:[t.text_segments[0].ref],reason:'互相玩笑'}],uncertainty:[]}]})}}],usage:{prompt_tokens:10,completion_tokens:20}});}});
 let run;
 try{
  const dataset=await e.request('/datasets/upload',{method:'POST',body:{file:new File([JSON.stringify({messages:[{id:'t',timestamp:base,type:'text',sender:{uid:'a'},content:{text:'笨蛋，你又忘記回來聊天'}}]})],'test.json')}});
  const profile=await e.request('/profiles',{method:'POST',body:{name:'test',model:'mock',api_key:'private-key',context_tokens:16384,max_output_tokens:2048}});
  run=await e.request('/runs',{method:'POST',body:{dataset_id:dataset.id,profile_id:profile.id}});
  await e.request(`/runs/${run.id}/resume`,{method:'POST'});await e.tasks.get(run.id);
  const info=await e.request(`/runs/${run.id}`);assert.equal(info.counts.needs_review,1);assert.equal(info.status,'completed_with_reviews');
  const members=await e.request(`/runs/${run.id}/members`);assert.equal(members.items[0].dimensions.attack.valid,0);assert.equal(members.items[0].needs_review,1);
  assert.equal((await e.request(`/runs/${run.id}/results?dimension=attack`)).total,0);
  const detail=await e.request(`/runs/${run.id}/message/t`);assert.equal(detail.model_scores.attack,2);assert.equal(detail.effective_scores.attack,null);assert.equal(detail.analysis_input.input.targets[0].text_segments[0].text,'笨蛋，你又忘記回來聊天');assert.ok(!JSON.stringify(detail.analysis_input).includes('private-key'));
  await e.request(`/runs/${run.id}/message/t/review`,{method:'POST',body:{scores:zero(),note:'合成案例中的互相調侃'}});
  assert.equal((await e.request(`/runs/${run.id}/results?status=needs_review`)).total,0);
  assert.equal((await e.request(`/runs/${run.id}`)).status,'completed');
 }finally{e.db.close();e.releaseLock?.();}
 const reopened=new BrowserCorpus({dbName});try{const detail=await reopened.request(`/runs/${run.id}/message/t`);assert.equal(detail.model_scores.attack,2);assert.equal(detail.effective_scores.attack,0);assert.equal(detail.model_status,'needs_review');assert.equal(detail.analysis_input.prompt_version,'behavior-evidence-v4.7');assert.equal((await reopened.request(`/runs/${run.id}/members`)).items[0].dimensions.attack.valid,1);}finally{reopened.db.close();reopened.releaseLock?.();}
});
