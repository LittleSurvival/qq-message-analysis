import test from 'node:test';
import assert from 'node:assert/strict';
import {planBranches,collectScores,decide,explain,mapLimit} from '../scripts/research/shared-context.mjs';

const payload={targets:[{message_id:'original-1',speaker:'a',text:'謝謝你的幫忙！',quoted:[]}],context:[]};
const make=()=>{
 const plan=planBranches(payload);
 return {plan,decisions:plan.jobs.map(job=>({ok:true,value:{...job,score:job.key==='support'?1:0}}))};
};

test('research aggregation preserves zero and unknown, rejecting missing, duplicate and misattributed decisions',()=>{
 const {plan,decisions}=make();decisions[1].value.score=null;
 const [row]=collectScores(plan,decisions);
 assert.equal(row.scores.respect,null);assert.equal(row.scores.information,0);
 assert.throws(()=>collectScores(plan,decisions.slice(1)),/Incomplete/);
 const duplicate=structuredClone(decisions);duplicate[1]=duplicate[0];
 assert.throws(()=>collectScores(plan,duplicate),/duplicate/);
 const wrong=structuredClone(decisions);wrong[0].value.message_id='context-member';
 assert.throws(()=>collectScores(plan,wrong),/Unexpected/);
 const failed=structuredClone(decisions);failed[0]={ok:false,error:'timeout'};
 assert.throws(()=>collectScores(plan,failed),/Incomplete/);
});

test('research decisions reject truncated context even when the score token is valid',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({content:'0',tokens:[1],truncated:true}));
 await assert.rejects(decide('http://localhost',{}),/truncated the input context/);
});

test('research explanations retain fixed scores and recover original evidence',async t=>{
 const {plan,decisions}=make();const fixed=collectScores(plan,decisions);
 const source=plan.wire.data.targets[0].text_segments[0];
 const row={message_id:fixed[0].message_id,evidence:[source.ref],reason:'發言表達感謝。',uncertainty:[]};
 t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[row]})}}]}));
 const {annotations:[value]}=await explain('http://localhost',plan,fixed);
 assert.equal(value.message_id,'original-1');assert.equal(value.scores.support,1);
 assert.equal(value.evidence[0].quote,payload.targets[0].text);
 row.scores=fixed[0].scores;
 await assert.rejects(explain('http://localhost',plan,fixed),/changed the supplied score contract/);
 delete row.scores;row.uncertainty=['score_evidence_conflict'];
 await assert.rejects(explain('http://localhost',plan,fixed),/Evidence does not support/);
});

test('research explanations preserve validation failures for unknown scores and missing IDs',async t=>{
 const {plan,decisions}=make();decisions[1].value.score=null;
 const fixed=collectScores(plan,decisions);
 const row={message_id:fixed[0].message_id,evidence:[plan.wire.data.targets[0].text_segments[0].ref],reason:'感謝。',uncertainty:[]};
 let results=[row];
 t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results})}}]}));
 await assert.rejects(explain('http://localhost',plan,fixed),/未知分數/);
 row.uncertainty=['上下文不足'];
 assert.equal((await explain('http://localhost',plan,fixed)).annotations[0].scores.respect,null);
 results=[];
 await assert.rejects(explain('http://localhost',plan,fixed));
});

test('research scheduler keeps each job once, bounds concurrency and retains errors',async()=>{
 let active=0,peak=0;const seen=[];
 const results=await mapLimit([0,1,2,3,4,5,6],3,async value=>{
  seen.push(value);peak=Math.max(peak,++active);
  await new Promise(resolve=>setImmediate(resolve));active--;
  if(value===2)throw Error('synthetic failure');return value;
 });
 assert.equal(peak,3);assert.deepEqual(seen.sort(),[0,1,2,3,4,5,6]);
 assert.equal(results.filter(r=>r.ok).length,6);
 assert.equal(results[2].error,'synthetic failure');
 assert.equal(results[6].value,6);
});
