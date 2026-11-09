// Export a reproducible manual-review set from this app's normalized JSONL.
// Never calls a model. Keep output outside published assets.
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {buildContext,dayOf} from '../src/corpus/corpus-model.js';
import {relatedContext} from '../src/corpus/corpus-context.js';
const [input,output='.data/calibration-300.jsonl']=process.argv.slice(2);
if(!input)throw Error('Usage: node scripts/sample-corpus.js exported-results.jsonl [.data/sample.jsonl]');
const rows=[];for await(const line of createInterface({input:createReadStream(input),crlfDelay:Infinity})){if(line.trim()){const r=JSON.parse(line);if(!r.system)rows.push(r);}}
rows.sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id));rows.forEach((m,i)=>m.position=i);
const byId=new Map(rows.map(m=>[m.id,m])),activity=new Map(),strata=new Map(),seed='qq-behavior-v4-20261109';
const hash=id=>createHash('sha256').update(seed+'|'+id).digest('hex');
for(const m of rows)activity.set(m.member_id,(activity.get(m.member_id)||0)+1);
for(const m of rows){const n=activity.get(m.member_id),band=n<100?'low':n<1000?'medium':'high',kind=!m.readable?'unreadable':m.reply_id?'reply':m.mentions?.length?'mention':m.type;
 const key=[dayOf(m.timestamp).slice(0,7),band,kind].join('|');if(!strata.has(key))strata.set(key,[]);strata.get(key).push(m);}
const groups=[...strata].sort(([a],[b])=>hash(a).localeCompare(hash(b))).map(([key,values])=>({key,values:values.sort((a,b)=>hash(a.id).localeCompare(hash(b.id))),cursor:0}));
const sample=[];while(sample.length<Math.min(300,rows.length)){for(const g of groups){if(sample.length===300)break;const m=g.values[g.cursor++];if(!m)continue;sample.push({seed,stratum:g.key,split:parseInt(hash('split|'+m.id).slice(0,2),16)%5===0?'holdout':'development',message_id:m.id,source_status:m.status,source_scores:m.model_scores||m.scores||null,human_scores:null,human_note:'',payload:relatedContext(rows,byId,[m],buildContext(rows,byId,[m]))});}}
await mkdir(dirname(output),{recursive:true});await writeFile(output,sample.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify({output,seed,count:sample.length,unique:new Set(sample.map(r=>r.message_id)).size,months:new Set(sample.map(r=>r.stratum.split('|')[0])).size,strata:new Set(sample.map(r=>r.stratum)).size,holdout:sample.filter(r=>r.split==='holdout').length}));
