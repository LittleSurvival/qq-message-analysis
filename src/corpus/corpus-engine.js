import {JSONParser} from '@streamparser/json';
import {sha256} from '@noble/hashes/sha2.js';
import {BEHAVIOR_PROMPT,INFORMATION_BEHAVIOR_PROMPT,BEHAVIOR_VERSION,LEGACY_BEHAVIOR_VERSION,EXPERIMENTAL_BEHAVIOR_VERSION,BEHAVIOR_RUBRIC,behaviorRequest} from './corpus-behavior.js';
import {CONTEXT_VERSION} from './corpus-context.js';
import {openStore} from './corpus-store.js';
import {KEYS} from './corpus-contract.js';
import {normalizeMessage,inScope,dayOf,messageView,fitContext,buildContext,emptyScores,validateScores,profileConfig,completeReviewed} from './corpus-model.js';
const id=()=>Date.now()*1000+Math.floor(Math.random()*1000);
const stamp=()=>new Date().toISOString().replace('T',' ').slice(0,19);
const pauseError=()=>new DOMException('已暫停','AbortError');
const page=(items,q)=>({total:items.length,items:items.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Math.min(200,Math.max(1,Number(q.get('limit')||30))))});
const effectiveScores=r=>r.reviews?.at(-1)?.scores||r.accepted_scores||(r.status==='needs_review'?emptyScores():r.scores);
const synthetic={targets:[{message_id:'connection-test',speaker:'test',text:'謝謝你的幫忙，辛苦了！',quoted:[],reply_id:null}],context:[],flags:[]};
export class BrowserCorpus {
 constructor({dbName='qq-corpus-browser-v1',fetcher=globalThis.fetch,onEvent=()=>{},experimentalBehavior=false}={}){this.behaviorVersion=experimentalBehavior?EXPERIMENTAL_BEHAVIOR_VERSION:BEHAVIOR_VERSION;this.dbName=dbName;this.fetcher=fetcher;this.onEvent=onEvent;this.data=new Map();this.states=new Map();this.secrets=new Map();this.tasks=new Map();this.imports=new Map();this.controls=new Set();this.ready=this.initialize(dbName);}
 async initialize(name){if(globalThis.navigator?.locks){await new Promise((resolve,reject)=>{navigator.locks.request(name+'-owner',{ifAvailable:true},async lock=>{this.readonly=!lock;resolve();if(lock)await new Promise(done=>this.releaseLock=done);}).catch(reject);});}this.db=await openStore(name);if(this.readonly)return;for(const run of await this.db.all('runs')){if(['running','queued'].includes(run.status)){run.status='paused';run.error='分頁曾關閉或重新整理，已保留結果；請確認金鑰後續跑';await this.db.put('runs',run);await this.log(run.id,'分頁重新開啟，已保留進度並暫停','warning');}}}
 async log(run_id,message,level='info'){await this.db.put('events',{run_id,message,level,created:stamp()});this.onEvent({type:'changed',run_id});}
 async dataset(dataset_id){if(this.data.has(dataset_id))return this.data.get(dataset_id);const task=(async()=>{const meta=await this.db.get('datasets',dataset_id);if(!meta||meta.status!=='ready')throw new Error('資料集尚未準備完成');const blocks=await this.db.index('blocks','dataset',dataset_id),messages=blocks.sort((a,b)=>a.index-b.index).flatMap(b=>b.messages);messages.sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id));messages.forEach((m,i)=>m.position=i);return {meta,messages,byId:new Map(messages.map(m=>[m.id,m]))};})();this.data.set(dataset_id,task);try{return await task;}catch(e){this.data.delete(dataset_id);throw e;}}
 async importFile(file){
  if(!file?.stream)throw new Error('請選擇 JSON 或 JSONL 檔案');
  const hash=sha256.create();let hashed=0;for await(const chunk of file.stream()){hash.update(chunk);hashed+=chunk.length;this.onEvent({type:'import-progress',phase:'核對檔案',bytes:hashed,size:file.size,messages:0});}
  const fingerprint=Array.from(hash.digest(),v=>v.toString(16).padStart(2,'0')).join('');
  if(this.imports.has(fingerprint))return this.imports.get(fingerprint);
  const importing=this.importHashed(file,fingerprint);this.imports.set(fingerprint,importing);try{return await importing;}finally{this.imports.delete(fingerprint);}
 }
 async importHashed(file,fingerprint){
  const existing=(await this.db.index('datasets','fingerprint',fingerprint))[0];if(existing?.status==='ready')return this.publicDataset(existing);
  const dataset_id=existing?.id||id(),meta={id:dataset_id,fingerprint,name:file.name||'聊天記錄',status:'importing',created:stamp(),quality:{},file};await this.db.put('datasets',meta);
  const messages=[],byId=new Map(),aliases=new Map(),quality={read:0,stored:0,invalid:0,duplicates:0,system:0,readable:0,unreadable:0,importer_version:'qce-browser-v1'};let buffer=[],block=0,bytes=0,hasMessages=false;
  const jsonl=/\.(jsonl|ndjson)$/i.test(file.name||''),parser=new JSONParser({paths:jsonl?['$']:['$.messages','$.messages.*'],keepStack:false,...(jsonl?{separator:''}:{})});
  parser.onValue=({value,key,stack,parent})=>{if(jsonl||stack.length===2&&stack[1].key==='messages'){
   if(!jsonl)delete parent[key];quality.read++;let m;try{m=normalizeMessage(value);}catch{quality.invalid++;return;}
   if(byId.has(m.id)){quality.duplicates++;return;}
   byId.set(m.id,m);messages.push(m);buffer.push(m);quality.stored++;if(m.system)quality.system++;else if(m.readable)quality.readable++;else quality.unreadable++;
   if(m.uin&&m.member_id!==m.uin){if(!aliases.has(m.uin))aliases.set(m.uin,new Set());aliases.get(m.uin).add(m.member_id);}
   if(!jsonl)delete parent[key];
  }else if(key==='messages'){if(!Array.isArray(value))throw new Error('messages 必須為陣列');hasMessages=true;}};
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for await(const chunk of file.stream()){bytes+=chunk.length;parser.write(decoder.decode(chunk,{stream:true}));if(buffer.length>=500){await this.db.put('blocks',{dataset_id,index:block++,messages:buffer});buffer=[];}this.onEvent({type:'import-progress',phase:'儲存訊息',bytes,size:file.size,messages:quality.read});}
   const tail=decoder.decode();if(tail)parser.write(tail);if(!parser.isEnded)parser.end();if(!jsonl&&!hasMessages||!quality.stored)throw new Error('找不到訊息；請選擇 QCE 單檔 JSON 或 JSONL，不是 manifest');if(buffer.length)await this.db.put('blocks',{dataset_id,index:block++,messages:buffer});
   let remapped=false;for(const m of messages){const ids=aliases.get(m.member_id);if(ids?.size===1){m.member_id=[...ids][0];remapped=true;}}
   if(remapped){for(let i=0;i<messages.length;i+=1000)await this.db.put('blocks',{dataset_id,index:i/1000,messages:messages.slice(i,i+1000)});for(let i=Math.ceil(messages.length/1000);i<block;i++)await this.db.put('blocks',{dataset_id,index:i,messages:[]});}
   messages.sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id));messages.forEach((m,i)=>m.position=i);quality.members=new Set(messages.filter(m=>!m.system&&m.member_id!=='unknown').map(m=>m.member_id)).size;quality.resolved_replies=messages.filter(m=>m.reply_id&&byId.has(m.reply_id)).length;quality.unresolved_replies=messages.filter(m=>m.reply_id&&!byId.has(m.reply_id)).length;
   meta.quality=quality;meta.status='ready';await this.db.put('datasets',meta);this.data.set(dataset_id,Promise.resolve({meta,messages,byId}));return this.publicDataset(meta);
  }catch(e){meta.status='failed';await this.db.put('datasets',meta).catch(()=>{});if(e.name==='QuotaExceededError')throw new Error('瀏覽器儲存空間不足，請釋放此網站空間或改用較小檔案');throw e;}
 }
 publicDataset(meta){const {file,...value}=meta;return value;}
 async state(run_id){if(this.states.has(run_id))return this.states.get(run_id);const loading=(async()=>{const run=await this.db.get('runs',run_id);if(!run)throw new Error('找不到分析紀錄');const data=await this.dataset(run.dataset_id),targets=data.messages.filter(m=>inScope(m,run.config.selection)),results=new Map((await this.db.index('results','run',run_id)).map(r=>[r.message_id,r]));for(const r of results.values())if(r.status==='processing')r.status='pending';const s={run,data,targets,results,counts:{},cursor:0,active:new Map(),revision:0,aggregate:null};for(const m of targets){const status=this.result(s,m).status;s.counts[status]=(s.counts[status]||0)+1;}return s;})();this.states.set(run_id,loading);try{return await loading;}catch(e){this.states.delete(run_id);throw e;}}
 result(s,m){return s.results.get(m.id)||{run_id:s.run.id,message_id:m.id,status:m.readable?'pending':'unknown',scores:m.readable?null:emptyScores(),evidence:[],reason:m.readable?'':'無可讀內容，未分析媒體本體',uncertainty:m.readable?[]:['unreadable_media'],context_ids:[],attempts:0};}
 info(s){
  const r=s.run,{prompt,...safe}=r,now=performance.now();
  const seconds=r.seconds+(s.measuredAt==null?0:(now-s.measuredAt)/1000);
  const output_tokens_per_second=seconds>0&&(r.input_tokens||r.output_tokens)?r.output_tokens/seconds:null;
  return {...safe,seconds,output_tokens_per_second,counts:{...s.counts},total:s.targets.length,processed:['done','unknown','failed','needs_context','needs_review'].reduce((n,k)=>n+(s.counts[k]||0),0),speed:seconds?(s.counts.done||0)/seconds:null,partial:['running','queued','paused'].includes(r.status)||!!(s.counts.failed||s.counts.needs_context||s.counts.needs_review),cost:r.config.input_price!=null&&r.config.output_price!=null?(r.input_tokens*r.config.input_price+r.output_tokens*r.config.output_price)/1e6:null,activity:[...s.active.values()].map(({started,updated,controller,...a})=>({...a,elapsed:(now-started)/1000,silent_seconds:(now-updated)/1000}))};
 }
 async saveRows(s,rows){await this.db.write([...rows.map(r=>['results',r]),['runs',s.run]]);for(const r of rows){const m=s.data.byId.get(r.message_id),before=this.result(s,m).status;s.counts[before]--;if(!s.counts[before])delete s.counts[before];s.counts[r.status]=(s.counts[r.status]||0)+1;s.results.set(r.message_id,r);}s.revision++;s.aggregate=null;this.onEvent({type:'changed',run_id:s.run.id});}
 key(profile_id,config){return this.secrets.get(`${profile_id}|${config.base_url}`)||'';}
 async runLoop(s){
  const jobs=new Set();
  const cfg=s.run.config;
  let failure=null;
  const launch=job=>{
   s.measuredAt??=performance.now();
   const task=this.analyze(s,job).catch(error=>{failure??=error;}).finally(()=>{
    const now=performance.now();
    s.run.seconds+=(now-s.measuredAt)/1000;
    jobs.delete(task);
    s.measuredAt=jobs.size?now:null;
   });
   jobs.add(task);
  };
  try{
   if(s.run.status==='queued')s.run.status='running';
   await this.db.put('runs',s.run);
   while(s.run.status==='running'){
    while(jobs.size<cfg.concurrency&&s.run.status==='running'&&!failure){
     const candidates=[],candidateIndexes=[];while(s.cursor<s.targets.length&&candidates.length<20){const candidateIndex=s.cursor++,m=s.targets[candidateIndex];if(this.result(s,m).status!=='pending')continue;if(candidates.length&&m.timestamp-candidates.at(-1).timestamp>1800000){s.cursor--;break;}candidates.push(m);candidateIndexes.push(candidateIndex);}
     if(!candidates.length)break;
     const {chosen,payload,overflow}=fitContext(s.data.messages,s.data.byId,candidates,s.run.config,s.run.prompt);if(chosen.length<candidates.length)s.cursor=candidateIndexes[chosen.length];
     if(overflow){await this.saveRows(s,[{...this.result(s,chosen[0]),status:'needs_context',error:'完整目標與必要回覆超過保守輸入預算；請提高服務實際容量及設定後建立新分析',context_ids:payload.context.map(m=>m.message_id),uncertainty:[...payload.flags,'context_overflow']}]);continue;}
     if(cfg.budget!=null){
      const spent=this.info(s).cost||0;
      const requestLimit=cfg.evidence_mode!=='behavior-v4'?4:s.run.prompt_version===LEGACY_BEHAVIOR_VERSION?8:12;
      const reserve=(cfg.context_tokens*cfg.input_price+cfg.max_output_tokens*cfg.output_price)/1e6*requestLimit*(jobs.size+1);
      if(s.run.unmetered_requests||spent+reserve>cfg.budget){
       s.cursor=candidateIndexes[0];
       if(jobs.size)break;
       s.run.status='paused';
       s.run.error=s.run.unmetered_requests?'服務未回報完整用量，無法繼續套用費用上限':'剩餘預算不足以預留下一批與重試';
       await this.log(s.run.id,s.run.error,'warning');
       break;
      }
     }
     await this.saveRows(s,chosen.map(m=>({...this.result(s,m),status:'processing'})));
     launch({chosen,payload});
    }
    if(failure)throw failure;
    if(jobs.size)await Promise.race(jobs);
    else if(s.run.status==='running'){
     s.run.status=s.counts.failed||s.counts.needs_context?'completed_with_errors':s.counts.needs_review?'completed_with_reviews':'completed';
     await this.log(s.run.id,s.run.status==='completed'?'分析完成':s.run.status==='completed_with_reviews'?'分析完成，含待覆核結果':'分析結束，含失敗或容量不足結果',s.run.status==='completed'?'info':'warning');
    }
   }
  }catch{
   s.run.status='paused';s.run.error='瀏覽器工作器或儲存發生錯誤，已保存的結果保留';
   for(const activity of s.active.values())activity.controller.abort();
  }
  finally{
   await Promise.all(jobs);
   await this.db.put('runs',s.run).catch(()=>{});
   this.tasks.delete(s.run.id);this.onEvent({type:'changed',run_id:s.run.id});
  }
 }
 async analyze(s,{chosen,payload}){
  const cfg=s.run.config,controller=new AbortController(),started=performance.now(),activity={targets:chosen.length,context:payload.context.length,phase:'waiting',answer_chars:0,reasoning_chars:0,attempt:1,started,updated:started,controller};s.active.set(chosen[0].id,activity);
  const context_ids=[...new Set([...payload.targets,...payload.context].map(m=>m.message_id))];
  const batch_id=cfg.evidence_mode==='behavior-v4'?crypto.randomUUID():null;
  let usageRecorded=false,feedback='',repairs=0;
  const meter=usage=>{if(!usage||usageRecorded)return;usageRecorded=true;s.run.input_tokens+=usage.input||0;s.run.output_tokens+=usage.output||0;if(!usage.measured)s.run.unmetered_requests++;};
  try{
  if(batch_id){const wire=behaviorRequest(payload);await this.db.put('batches',{run_id:s.run.id,id:batch_id,created:stamp(),prompt_version:s.run.prompt_version,context_version:CONTEXT_VERSION,system_prompt:s.run.prompt,input:wire.data,identifiers:wire.identifiers});}
   await this.log(s.run.id,`送出 ${chosen.length} 則目標，${payload.context.length} 則上下文`);
   for(let attempt=1;attempt<=4;attempt++){if(s.run.status!=='running')throw pauseError();activity.attempt=attempt;usageRecorded=false;
    if(attempt>1&&!feedback){activity.phase='retrying';activity.answer_chars=0;activity.reasoning_chars=0;await this.log(s.run.id,`暫時性失敗，自動重試 ${attempt-1}/3`,'warning');await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(pauseError());},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.min(2**attempt,8)*1000);controller.signal.addEventListener('abort',cancel,{once:true});});}
    await this.saveRows(s,chosen.map(m=>({...this.result(s,m),attempts:(this.result(s,m).attempts||0)+1})));
    try{const response=await completeReviewed(cfg,payload,{key:this.key(s.run.profile_id,cfg),signal:controller.signal,fetcher:this.fetcher,prompt:s.run.prompt,attackReview:s.run.prompt_version===EXPERIMENTAL_BEHAVIOR_VERSION,informationReview:s.run.prompt_version===BEHAVIOR_VERSION,feedback,onProgress:update=>{Object.assign(activity,update,{updated:performance.now()});}});meter(response.usage);s.run.validation_streak=0;if(controller.signal.aborted)throw pauseError();
     if(batch_id&&(response.review_input||response.attack_input||response.information_input)){
      const snapshot=await this.db.get('batches',[s.run.id,batch_id]);
      await this.db.put('batches',{...snapshot,review_input:response.review_input,attack_input:response.attack_input,information_input:response.information_input});
     }
     await this.saveRows(s,response.annotations.map(a=>({...this.result(s,s.data.byId.get(a.message_id)),...a,status:a.review_flags?.length?'needs_review':'done',batch_id,context_ids,uncertainty:[...new Set([...a.uncertainty,...payload.flags,...(payload.target_flags?.[a.message_id]||[])])],error:null})));
     await this.log(s.run.id,`已保存 ${chosen.length} 則結果，${response.annotations.filter(a=>a.review_flags?.length).length} 則待覆核；輸入 ${response.usage.input} / 輸出 ${response.usage.output} tokens`);return;
    }catch(e){if(e.name==='AbortError')throw e;meter(e.usage||{measured:false});
     if(e.scope==='item'){
      await this.saveRows(s,chosen.map(m=>({...this.result(s,m),error_history:[...(this.result(s,m).error_history||[]),{attempt,reason:e.message,created:stamp()}]})));
      if(repairs<2&&attempt<4){repairs++;feedback=e.message;activity.phase='repairing';activity.answer_chars=0;activity.reasoning_chars=0;await this.log(s.run.id,`本批驗證未通過，修正重試 ${repairs}/2：${e.message}`,'warning');continue;}
     }
     if(e.retryable&&attempt<4){feedback='';continue;}
     await this.saveRows(s,chosen.map(m=>({...this.result(s,m),status:'failed',error:e.message,batch_id,context_ids,uncertainty:payload.flags})));await this.log(s.run.id,`${chosen.length} 則失敗：${e.message}`,'error');
     // Isolate bad annotations; stop only persistent validation failures or service configuration errors.
     if(e.scope==='item'){s.run.validation_streak=(s.run.validation_streak||0)+1;await this.log(s.run.id,'本批已標記失敗，保留重試入口並繼續後續訊息','warning');}
     if(e.scope==='item'?s.run.validation_streak>=5:true){s.run.status='paused';s.run.error=e.message;for(const other of s.active.values())if(other!==activity)other.controller.abort();await this.db.put('runs',s.run);await this.log(s.run.id,e.scope==='item'?'連續 5 批修正後仍未通過驗證，已自動暫停':'模型服務或連線設定失敗，已自動暫停','warning');}return;
    }
   }
  }catch(e){if(e.name==='AbortError'){if(!usageRecorded)s.run.unmetered_requests++;await this.saveRows(s,chosen.filter(m=>this.result(s,m).status==='processing').map(m=>({...this.result(s,m),status:'pending'})));}else throw e;}
  finally{s.active.delete(chosen[0].id);}
 }
 async control(run_id,action){const s=await this.state(run_id);if(this.controls.has(run_id))throw new Error('正在更新任務，請稍候');this.controls.add(run_id);
  try{if(action==='pause'){s.run.status='paused';await this.db.put('runs',s.run);for(const a of s.active.values())a.controller.abort();await this.tasks.get(run_id);s.cursor=0;await this.log(run_id,'已暫停；未完成訊息留待續跑，已保存結果不變');return this.info(s);}
   if(this.tasks.size||this.starting)throw new Error('已有任務正在執行，請先暫停後再切換分析');
   const supportedVersion=s.run.prompt_version===this.behaviorVersion||this.behaviorVersion===BEHAVIOR_VERSION&&s.run.prompt_version===LEGACY_BEHAVIOR_VERSION;
   if(s.run.config.evidence_mode==='behavior-v4'&&!supportedVersion)throw new Error('此紀錄使用較早的評分契約，請建立新分析；原結果仍可查看與覆核');
   this.starting=run_id;
   if(action==='retry')await this.saveRows(s,[...s.results.values()].filter(r=>r.status==='failed').map(r=>({...r,status:'pending',error:null})));
   s.cursor=0;s.run.validation_streak=0;s.run.status='queued';s.run.error=null;await this.db.put('runs',s.run);await this.log(run_id,action==='retry'?'失敗訊息已加入重試佇列':'已加入執行佇列');
   // One browser tab owns execution via Web Locks; no duplicated runs across tabs.
   const work=this.runLoop(s).finally(()=>this.tasks.delete(run_id));this.tasks.set(run_id,work);return this.info(s);
  }finally{if(this.starting===run_id)this.starting=null;this.controls.delete(run_id);}
 }
 aggregate(s,{member=null,start=null,end=null,monthly=false}={}){
  if(!member&&!start&&!end&&!monthly&&s.aggregate)return s.aggregate;
  const groups=new Map(),needsDay=monthly||start||end;
  for(const m of s.targets){
   if(member&&m.member_id!==member)continue;
   const day=needsDay?dayOf(m.timestamp):null;
   if(start&&day<start||end&&day>end)continue;
   const bucket=monthly?day.slice(0,7):m.member_id;
   if(!groups.has(bucket))groups.set(bucket,{bucket,member_id:m.member_id,name:m.name,total:0,analyzed:0,reviewed:0,needs_review:0,terminal:0,dimensions:Object.fromEntries(KEYS.map(k=>[k,{sum:0,valid:0,count:0,intensity_valid:0}]))});
   const g=groups.get(bucket),r=s.results.get(m.id);
   g.total++;g.name=m.name;
   if(!r){if(!m.readable)g.terminal++;continue;}
   const review=r.reviews?.at(-1);
   if(r.status==='needs_review'&&!review)g.needs_review++;
   if(r.status!=='done'&&r.status!=='unknown'&&!review&&!r.accepted_scores){
    if(r.status==='needs_review'&&r.confirmed_occurrences?.length){
     g.terminal++;
     for(const key of r.confirmed_occurrences){
      g.dimensions[key].count++;
      g.dimensions[key].valid++;
     }
    }
    continue;
   }
   g.terminal++;
   if(r.status==='done'||review)g.analyzed++;
   if(review)g.reviewed++;
   const scores=effectiveScores(r);
   if(scores)for(const k of KEYS){
    const v=scores[k],d=g.dimensions[k];
    if(v!==null){d.valid++;d.intensity_valid++;d.sum+=v;if(v>0)d.count++;}
    else if(!review&&r.confirmed_occurrences?.includes(k)){d.count++;d.valid++;}
   }
  }
  const rows=[...groups.values()].sort((a,b)=>a.bucket.localeCompare(b.bucket)).map(g=>{g.coverage=g.analyzed/g.total;for(const k of KEYS){const d=g.dimensions[k];Object.assign(d,{score:d.intensity_valid?Math.round(d.sum/d.intensity_valid/3*10000)/100:null,occurrence:d.valid?d.count/d.valid:null,unknown:g.terminal-d.valid,unknown_rate:g.terminal?(g.terminal-d.valid)/g.terminal:null,coverage:d.valid/g.total,insufficient:d.valid<30});delete d.sum;}delete g.terminal;return g;});
  if(!member&&!start&&!end&&!monthly)s.aggregate=rows;return rows;
 }
 decoded(s,m,withContext=true){const r=this.result(s,m),review=r.reviews?.at(-1);return {...m,...r,model_scores:r.scores,effective_scores:effectiveScores(r),review_id:review?.id,reason:review?.note||r.reason,context:withContext?(r.context_ids?.length?r.context_ids.map(id=>s.data.byId.get(id)).filter(Boolean):buildContext(s.data.messages,s.data.byId,[m]).context.map(c=>s.data.byId.get(c.message_id))).map(messageView):undefined,reviews:r.reviews||[]};}
 async request(path,{method='GET',body=null}={}){
  await this.ready;if(this.readonly&&method!=='GET')throw new Error('另一個分頁已開啟語料分析，請在該分頁操作；關閉它後重新整理此頁');const url=new URL(path,'https://browser.invalid'),parts=url.pathname.split('/').filter(Boolean),q=url.searchParams;
  if(typeof body==='string')body=JSON.parse(body);body=body||{};
  if(parts[0]==='profiles'){
   if(parts[1]==='test'||parts[2]==='test'){const cfg=profileConfig({...body,evidence_mode:'behavior-v4'}),key=body.api_key||this.key(body.saved_profile_id,cfg);const response=await completeReviewed(cfg,synthetic,{key,fetcher:this.fetcher,attackReview:this.behaviorVersion===EXPERIMENTAL_BEHAVIOR_VERSION,onProgress:p=>this.onEvent({type:'connection-progress',test_id:body.test_id,...p})});return {ok:true,response_mode:response.mode,usage:response.usage,needs_review:response.annotations.filter(a=>a.review_flags?.length).length,sample:response.annotations};}
   if(method==='GET')return (await this.db.all('profiles')).map(p=>({...p,has_key:!!this.key(p.id,p)}));
   const cfg=profileConfig(body),profile_id=parts[1]?Number(parts[1]):id(),prior=await this.db.get('profiles',profile_id);
   if(body.api_key)this.secrets.set(`${profile_id}|${cfg.base_url}`,body.api_key);if(prior&&prior.base_url!==cfg.base_url)this.secrets.delete(`${profile_id}|${prior.base_url}`);
   const saved={id:profile_id,...cfg};await this.db.put('profiles',saved);return {...saved,has_key:!!this.key(profile_id,cfg)};
  }
  if(parts[0]==='datasets'){
   if(parts[1]==='upload')return this.importFile(body.file);
   if(parts[2]==='file'){const d=await this.db.get('datasets',Number(parts[1]));if(!d?.file)throw new Error('找不到儲存檔案');return {file:d.file,name:d.name};}
   return (await this.db.all('datasets')).filter(d=>d.status==='ready').map(d=>this.publicDataset(d));
  }
  if(parts[0]!=='runs')throw new Error('不支援的瀏覽器操作');
  if(parts.length===1){if(method==='GET'){const rows=await this.db.all('runs');return rows.sort((a,b)=>b.id-a.id).map(({prompt,...r})=>r);}
   const data=await this.dataset(body.dataset_id),profile=await this.db.get('profiles',body.profile_id);if(!profile)throw new Error('請先儲存模型設定');const selection=body.selection||{};if(selection.from&&selection.to&&selection.from>selection.to)throw new Error('起始日期不能晚於結束日期');
   const profile_id=profile.id,cfg=profileConfig(profile),run={id:id(),dataset_id:body.dataset_id,profile_id,config:{...cfg,evidence_mode:'behavior-v4',context_version:CONTEXT_VERSION,selection,dataset_fingerprint:data.meta.fingerprint,importer_version:'qce-browser-v1'},prompt:this.behaviorVersion===BEHAVIOR_VERSION?INFORMATION_BEHAVIOR_PROMPT:BEHAVIOR_PROMPT,rubric_version:BEHAVIOR_RUBRIC,prompt_version:this.behaviorVersion,status:'paused',mode:'full',seed:20261108,created:stamp(),input_tokens:0,output_tokens:0,seconds:0,validation_streak:0,unmetered_requests:0,error:null};await this.db.put('runs',run);await this.log(run.id,'已建立分析，資料、模型與統計日期範圍已固定');return this.info(await this.state(run.id));
  }
  const run_id=Number(parts[1]);if(this.readonly)this.states.delete(run_id);if(['resume','pause','retry'].includes(parts[2]))return this.control(run_id,parts[2]);const s=await this.state(run_id);
  if(parts.length===2)return this.info(s);
  if(parts[2]==='events')return (await this.db.index('events','run',run_id)).filter(e=>e.id>Number(q.get('after')||0)).slice(0,500);
  const filter={member:q.get('member'),start:q.get('start'),end:q.get('end')};
  if(parts[2]==='members'){let rows=this.aggregate(s,filter);if(q.get('search'))rows=rows.filter(r=>(r.name+r.member_id).includes(q.get('search')));return page(rows.slice().sort((a,b)=>b.total-a.total),q);}
  if(parts[2]==='member')return {summary:this.aggregate(s,filter),monthly:this.aggregate(s,{...filter,monthly:true})};
  if(parts[2]==='results'){let rows=s.targets.filter(m=>(!filter.member||m.member_id===filter.member)&&(!filter.start||dayOf(m.timestamp)>=filter.start)&&(!filter.end||dayOf(m.timestamp)<=filter.end));const score=m=>{const r=this.result(s,m);const key=q.get('dimension'),review=r.reviews?.at(-1);return effectiveScores(r)?.[key]||(!review&&r.confirmed_occurrences?.includes(key)?0.5:0);};if(q.get('dimension'))rows=rows.filter(m=>score(m)>0).sort((a,b)=>score(b)-score(a)||a.timestamp-b.timestamp);if(q.get('status'))rows=rows.filter(m=>this.result(s,m).status===q.get('status')&&(q.get('status')!=='needs_review'||!this.result(s,m).reviews?.length));const result=page(rows,q);return {...result,items:result.items.map(m=>this.decoded(s,m,false))};}
  if(parts[2]==='message'){const m=s.data.byId.get(decodeURIComponent(parts[3]));if(!m||!inScope(m,s.run.config.selection))throw new Error('找不到目標訊息');if(parts[4]==='review'){const r=this.result(s,m);if(['pending','processing'].includes(r.status))throw new Error('請等待這則訊息處理完成');validateScores(body.scores);if(typeof body.note!=='string'||!body.note.trim()||body.note.length>3000)throw new Error('請填寫修正原因');const review={id:id(),scores:body.scores,note:body.note,created:stamp()};await this.saveRows(s,[{...r,status:'done',model_status:r.model_status||r.status,reviews:[...(r.reviews||[]),review]}]);if(s.run.status==='completed_with_reviews'&&!s.counts.needs_review){s.run.status='completed';await this.db.put('runs',s.run);}return {id:review.id};}const decoded=this.decoded(s,m);if(decoded.batch_id)decoded.analysis_input=await this.db.get('batches',[run_id,decoded.batch_id]);return decoded;}
  if(parts[2]==='export'){const rows=s.targets.map(m=>this.decoded(s,m,false));if(parts[3]==='jsonl')return new Blob(rows.map(r=>JSON.stringify(r)+'\n'),{type:'application/x-ndjson;charset=utf-8'});const csv=v=>'"'+String(typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?'\''+v:v??'').replaceAll('"','""')+'"';const records=[['成員 ID','名稱','訊息數','成功分析',...KEYS.flatMap(k=>[k+'_score',k+'_occurrence',k+'_valid',k+'_unknown'])],...this.aggregate(s,filter).map((r,i)=>[q.get('anonymous')?'':r.member_id,q.get('anonymous')?'成員 '+(i+1):r.name,r.total,r.analyzed,...KEYS.flatMap(k=>{const d=r.dimensions[k];return [d.score,d.occurrence,d.valid,d.unknown];})])];return new Blob(['\ufeff',records.map(r=>r.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});}
  throw new Error('不支援的瀏覽器操作');
 }
}
