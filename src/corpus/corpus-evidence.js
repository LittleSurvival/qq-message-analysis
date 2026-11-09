import {SCHEMA} from './corpus-contract.js';

// The model selects source references. Only this code creates verbatim quotes.
// Original IDs, source text and quoted-content boundaries remain local and exact.
export function evidenceRequest(payload){
 const sources=new Map(),targets=new Map(),ids=new Map(),speakers=new Map();
 payload.targets.forEach((m,i)=>{ids.set(m.message_id,'t'+i);targets.set('t'+i,m.message_id);});
 payload.context.forEach((m,i)=>{if(!ids.has(m.message_id))ids.set(m.message_id,'c'+i);});
 const segments=(text,id)=>{
  const chunks=[];let chunk='';
  for(const char of String(text||'')){chunk+=char;if(chunk.length>=160||/[。！？\n]/u.test(char)){chunks.push(chunk);chunk='';}}
  if(chunk)chunks.push(chunk);
  return chunks.filter(text=>text.trim()).map(text=>{const ref='e'+sources.size;sources.set(ref,{message_id:id,quote:text});return {ref,text};});
 };
 const view=m=>{
  if(!speakers.has(m.speaker))speakers.set(m.speaker,'u'+speakers.size);
  return {message_id:ids.get(m.message_id),speaker:speakers.get(m.speaker),timestamp:m.timestamp,relation:m.relation,
   text_segments:segments(m.text,m.message_id),quoted:(m.quoted||[]).map(q=>({kind:q.kind,text_segments:segments(q.text,m.message_id)})),
   reply_id:ids.get(m.reply_id)||null};
 };
 const targetViews=payload.targets.map(view),contextViews=payload.context.map(view);
 // Put the actual assignment after background material so small models do not
 // mistake the last neighboring message for the message being scored.
 const data={context:contextViews,flags:payload.flags||[],targets:targetViews};
 const schema=structuredClone(SCHEMA),items=schema.properties.results.items;
 items.properties.message_id={type:'string',enum:[...targets.keys()]};
 items.properties.evidence={type:'array',items:{type:'string',enum:[...sources.keys()]},maxItems:8};
 schema.properties.results.minItems=payload.targets.length;schema.properties.results.maxItems=payload.targets.length;
 return {data,schema,decode(content){
  let value;try{value=JSON.parse(content);}catch{throw new Error('模型回傳的內容不是有效 JSON');}
  if(!value||Object.keys(value).join()!=='results'||!Array.isArray(value.results))throw new Error('回傳格式不符合 results 契約');
  for(const r of value.results){
   if(!r||!targets.has(r.message_id))throw new Error('模型目標 ID 不符');
   if(!Array.isArray(r.evidence))throw new Error('模型證據格式錯誤');
   r.message_id=targets.get(r.message_id);
   r.evidence=r.evidence.map(ref=>{if(typeof ref!=='string'||!sources.has(ref))throw new Error('模型選擇了不存在的證據編號');return {...sources.get(ref)};});
  }
  return JSON.stringify(value);
 }};
}
