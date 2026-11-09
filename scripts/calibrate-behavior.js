import {mkdir,writeFile} from 'node:fs/promises';
import {behaviorCases} from '../tests/fixtures/behavior-cases.js';
import {fitContext,profileConfig,completeReviewed} from '../src/corpus/corpus-model.js';
import {BEHAVIOR_VERSION,BEHAVIOR_PROMPT} from '../src/corpus/corpus-behavior.js';
const args=process.argv.slice(2),option=(name,fallback)=>args[args.indexOf(name)+1]&&args.includes(name)?args[args.indexOf(name)+1]:fallback;
const out=option('--out','.data/behavior-calibration'),cfg=profileConfig({name:'calibration',base_url:option('--url','http://127.0.0.1:8080/v1'),model:option('--model','local-model'),context_tokens:16384,max_output_tokens:2048,concurrency:3,temperature:0,reasoning_effort:'none'});
await mkdir(out,{recursive:true});
const selected=behaviorCases.filter(c=>!args.includes('--dev')||c.split!=='holdout'),results=[];
let cursor=0;const started=performance.now();
await Promise.all(Array.from({length:cfg.concurrency},async()=>{while(cursor<selected.length){const c=selected[cursor++],all=structuredClone(c.messages);all.sort((a,b)=>a.timestamp-b.timestamp);all.forEach((m,i)=>m.position=i);const byId=new Map(all.map(m=>[m.id,m])),fit=fitContext(all,byId,[byId.get(c.target)],cfg),at=performance.now();
 let record={id:c.id,split:c.split||'development',expected:c.expect,overflow:fit.overflow};
 try{if(fit.overflow)throw Error('context overflow');const response=await completeReviewed(cfg,fit.payload);const result=response.annotations[0],mismatches=Object.entries(c.expect).filter(([k,allowed])=>!allowed.includes(result.scores[k])).map(([dimension,allowed])=>({dimension,allowed,actual:result.scores[dimension]}));record={...record,result,usage:response.usage,mismatches,pass:!mismatches.length};}
 catch(e){record={...record,error:e.message,pass:false,diagnostics:e.diagnostics};}
 record.seconds=(performance.now()-at)/1000;results.push(record);await writeFile(`${out}/${c.id}.json`,JSON.stringify({...record,input:fit.payload},null,2));console.log(JSON.stringify({id:c.id,pass:record.pass,review:record.result?.review_flags,error:record.error,mismatches:record.mismatches}));
}}));
const report={version:BEHAVIOR_VERSION,created:new Date().toISOString(),config:cfg,prompt:BEHAVIOR_PROMPT,seconds:(performance.now()-started)/1000,passed:results.filter(r=>r.pass).length,total:results.length,results};await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,total:report.total,seconds:report.seconds,out}));
process.exitCode=results.every(r=>r.pass)?0:1;
