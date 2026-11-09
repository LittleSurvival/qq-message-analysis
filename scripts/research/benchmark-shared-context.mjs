// Run explicitly with local files. No model downloads or application DB writes.
import 'fake-indexeddb/auto';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {BrowserCorpus} from '../../src/corpus/corpus-engine.js';
import {fitContext,complete,profileConfig} from '../../src/corpus/corpus-model.js';
import {RUBRIC} from '../../src/corpus/corpus-contract.js';
import {prepareBranches,decide,mapLimit,collectScores,explain,decisionMetrics,post,PROTOCOL} from './shared-context.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)];}));
for(const key of ['--server','--model','--source','--out'])if(!args[key])throw Error('Required: '+key);
const out=resolve(args['--out']);await mkdir(out,{recursive:true});
const base='http://127.0.0.1:11439',parallel=Number(args['--parallel']||6),ubatch=Number(args['--ubatch']||64);
const engine=new BrowserCorpus({dbName:'isolated-branch-research-'+Date.now()});
const dataStart=performance.now();
const dataset=await engine.request('/datasets/upload',{method:'POST',body:{file:new File([await readFile(args['--source'])],'qa.json')}});
const {messages,byId}=await engine.dataset(dataset.id);
const readable=messages.filter(m=>m.readable);
const selected=Array.from({length:6},(_,i)=>readable.slice(Math.floor(readable.length*(i+1)/7),Math.floor(readable.length*(i+1)/7)+24)).flat();
const config=profileConfig({name:'isolated research',base_url:base+'/v1',model:'corpus-research',context_tokens:16384,
 max_output_tokens:2048,reasoning_effort:'none',temperature:0,concurrency:parallel});
const payloads=[];
for(let i=0;i<selected.length;){
 const {chosen,payload,overflow}=fitContext(messages,byId,selected.slice(i,i+Math.min(8,24-i%24)),config);
 if(overflow)throw Error('Benchmark payload exceeds the existing context contract');
 payloads.push(payload);i+=chosen.length;
}
const importSeconds=(performance.now()-dataStart)/1000;
engine.db.close();engine.releaseLock?.();
console.log(JSON.stringify({event:'dataset',readable:readable.length,selected:selected.length,batches:payloads.length,importSeconds}));
if(await fetch(base+'/health').catch(()=>null))throw Error('Isolated port already occupied');
const log=createWriteStream(resolve(out,'server.log'));
const serverArgs=['-m',resolve(args['--model']),'--host','127.0.0.1','--port','11439','--alias','corpus-research',
 '-c',String(16384*parallel),'-np',String(parallel),'-ngl','99','-fa','on','-b','2048','-ub',String(ubatch),
 '--no-warmup','--reasoning','off','--offline','--cache-ram','1024'];
const server=spawn(resolve(args['--server']),serverArgs,{windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stdout.pipe(log);server.stderr.pipe(log);
const stopped=new Promise(resolve=>server.once('close',resolve));
const startup=performance.now();
const summary={protocol:PROTOCOL,messages:selected.length,batches:payloads.length,parallel,ubatch,import_seconds:importSeconds,
 model_file:resolve(args['--model']).split(/[\\/]/).at(-1),rubric:RUBRIC.map(d=>d.key),results:{}};
try{
 let ready=false;
 for(let i=0;i<180;i++){
  if(server.exitCode!==null)throw Error('Server exited: '+server.exitCode);
  if((await fetch(base+'/health').catch(()=>null))?.ok){ready=true;break;}
  await delay(500);
 }
 if(!ready)throw Error('Server readiness timeout');
 summary.startup_seconds=(performance.now()-startup)/1000;
 // Warm with synthetic text, never with the real evaluation targets.
 await complete(config,{targets:[{message_id:'warm',speaker:'a',text:'謝謝你的幫忙！',quoted:[]}],context:[],flags:[]});
 const phases=(args['--phases']||'baseline,branches').split(',');
 if(phases.includes('diagnostic')){
  const plan=await prepareBranches(base,payloads[0]);
  for(const mode of ['no-cache','answer-prefix','natural']){
   const begin=performance.now();
   const rows=await mapLimit(plan.jobs,parallel,async(job,_,slot)=>{
    const unanchored={...job,prompt:job.prompt.replace(/分數：$/u,'')};
    if(mode==='no-cache')return decide(base,unanchored,{cache:false,slot});
    if(mode==='answer-prefix')return decide(base,job,{cache:true,slot});
    const value=await post(base,'/completion',{prompt:unanchored.prompt,n_predict:32,temperature:0,cache_prompt:true,id_slot:slot,stream:false});
    return {index:job.index,key:job.key,content:value.content,timing:value.timings};
   });
   await writeFile(resolve(out,mode+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n'));
   const good=rows.filter(r=>r.ok).map(r=>r.value);
   summary.results[mode]={seconds:(performance.now()-begin)/1000,valid:good.length,failed:rows.length-good.length,
    unknown:good.filter(r=>r.score===null||r.content?.trim()==='?').length,
    format_counts:mode==='natural'?Object.fromEntries([...new Set(good.map(r=>/^[0-3?]$/.test(r.content?.trim())?r.content.trim():'other'))].map(k=>[k,good.filter(r=>(/^[0-3?]$/.test(r.content?.trim())?r.content.trim():'other')===k).length])):undefined};
   console.log(JSON.stringify({event:'diagnostic',mode,...summary.results[mode]}));
  }
 }
 if(phases.includes('baseline')){
  const begin=performance.now();
  const rows=await mapLimit(payloads,parallel,async payload=>{
   let error;
   for(let attempt=1;attempt<=2;attempt++)try{return {...await complete(config,payload),attempt};}catch(e){error=e;}
   throw error;
  });
  await writeFile(resolve(out,'baseline.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n'));
  const seconds=(performance.now()-begin)/1000,good=rows.filter(r=>r.ok).flatMap(r=>r.value.annotations);
  summary.results.baseline={seconds,valid:good.length,failed:selected.length-good.length,rate:good.length/seconds,
   input_tokens:rows.filter(r=>r.ok).reduce((n,r)=>n+r.value.usage.input,0),
   output_tokens:rows.filter(r=>r.ok).reduce((n,r)=>n+r.value.usage.output,0)};
  console.log(JSON.stringify({event:'baseline',...summary.results.baseline}));
 }
 if(phases.includes('branches')){
  const begin=performance.now(),allDecisions=[],plans=[],scoreBatches=[];
  for(const [index,payload] of payloads.entries()){
   const plan=await prepareBranches(base,payload);plans.push(plan);
   const decisions=await mapLimit(plan.jobs,parallel,(job,_,slot)=>decide(base,job,{slot,cache:true}));
   allDecisions.push(...decisions);scoreBatches.push(collectScores(plan,decisions));
   console.log(JSON.stringify({event:'branch_batch',batch:index+1,total:payloads.length,elapsed:(performance.now()-begin)/1000,...decisionMetrics(decisions)}));
  }
  const scoreSeconds=(performance.now()-begin)/1000;
  await writeFile(resolve(out,'decisions.jsonl'),allDecisions.map(r=>JSON.stringify(r)).join('\n'));
  const detailStart=performance.now();
  const details=await mapLimit(plans,parallel,async(plan,i)=>{
   let error;
   for(let attempt=1;attempt<=2;attempt++)try{return {...await explain(base,plan,scoreBatches[i]),attempt};}catch(e){error=e;}
   throw error;
  });
  await writeFile(resolve(out,'branches.jsonl'),details.map(r=>JSON.stringify(r)).join('\n'));
  const seconds=(performance.now()-begin)/1000,good=details.filter(r=>r.ok).flatMap(r=>r.value.annotations);
  summary.results.branches={seconds,score_seconds:scoreSeconds,score_rate:selected.length/scoreSeconds,
   explanation_seconds:(performance.now()-detailStart)/1000,valid:good.length,failed:selected.length-good.length,rate:good.length/seconds,
   decisions:decisionMetrics(allDecisions),explanation_output_tokens:details.filter(r=>r.ok).reduce((n,r)=>n+(r.value.usage?.completion_tokens||0),0),
   explanation_failures:details.filter(r=>!r.ok).map(r=>r.error)};
  // Invalid batches are failures, not disagreements or zeros.
  const baselineFile=args['--baseline']||resolve(out,'baseline.jsonl');
  try{
   const baseline=(await readFile(baselineFile,'utf8')).trim().split('\n').map(JSON.parse).filter(r=>r.ok).flatMap(r=>r.value.annotations);
   const original=new Map(baseline.map(r=>[r.message_id,r]));
   summary.comparison=Object.fromEntries(RUBRIC.map(d=>{
    let compared=0,equal=0,unknownMismatch=0,absoluteError=0,bothKnown=0;
    for(const row of good){const prior=original.get(row.message_id);if(!prior)continue;
     const a=prior.scores[d.key],b=row.scores[d.key];compared++;if(a===b)equal++;
     if((a===null)!==(b===null))unknownMismatch++;
     if(a!==null&&b!==null){bothKnown++;absoluteError+=Math.abs(a-b);}
    }
    return [d.key,{compared,equal,unknownMismatch,bothKnown,mean_absolute_difference:bothKnown?absoluteError/bothKnown:null}];
   }));
  }catch(error){summary.comparison_error=error.message;}
  console.log(JSON.stringify({event:'branches',...summary.results.branches,comparison:summary.comparison}));
 }
 await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,2));
}finally{server.kill();await stopped;log.end();}
