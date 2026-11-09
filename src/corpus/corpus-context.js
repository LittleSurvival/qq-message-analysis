// Retrieval proposes context, not a verdict or an assumption of a shared topic.
export const CONTEXT_VERSION='relations-v3';
const indexes=new WeakMap();
export const viewMessage=m=>({message_id:m.id,speaker:m.member_id,timestamp:m.timestamp,text:m.text,quoted:m.quoted||[],mentions:m.mentions||[],reply_id:m.reply_id,type:m.type,name:m.name});
export const compareTurns=(a,b)=>a.timestamp-b.timestamp||a.message_id.localeCompare(b.message_id);
const pair=(a,b)=>[a,b].sort().join('|');
function indexFor(all,byId){
 if(indexes.has(all))return indexes.get(all);
 const aliases=new Map(),children=new Map(),pairs=new Map();
 for(const m of all)if(m.uin){const uin=String(m.uin);if(!aliases.has(uin))aliases.set(uin,new Set());aliases.get(uin).add(m.member_id);}
 const resolve=a=>a.uid?String(a.uid):aliases.get(String(a.uin))?.size===1?[...aliases.get(String(a.uin))][0]:null;
 const addressed=m=>[...new Set([...(m.mentions||[]).map(resolve),byId.get(m.reply_id)?.member_id].filter(x=>x&&x!=='unknown'&&x!==m.member_id))];
 for(const m of all){if(m.system)continue;if(m.reply_id){if(!children.has(m.reply_id))children.set(m.reply_id,[]);children.get(m.reply_id).push(m);}
  for(const who of addressed(m)){const key=pair(m.member_id,who);if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(m);}
 }
 const index={children,pairs,addressed,resolve};indexes.set(all,index);return index;
}
export const followup=/昨[天晚日]|前天|上次|之前|先前|刚才|剛才|还没回答|還沒回答|满意|滿意|想要的|希望的|又来了|又來了|还在|還在/;

// Exact reply/mention identity gates the earlier thread. Nearby turns and the
// same participant appearing in two places are not enough to establish a link.
export function priorEvent(payload,target){
 const rows=[...payload.context,...payload.targets],byId=new Map(rows.map(m=>[m.message_id,m]));
 const prior=rows.filter(m=>compareTurns(m,target)<0),priorIds=new Set(prior.map(m=>m.message_id));
 const addressed=m=>[...new Set([priorIds.has(m.reply_id)&&byId.get(m.reply_id)?.speaker,...(m.mentions||[]).map(a=>a.member_id)].filter(id=>id&&id!=='unknown'&&id!==m.speaker))];
 const addressees=addressed(target),byAddressee=new Map(addressees.map(who=>[who,prior.filter(m=>m.text?.trim()&&(m.message_id===target.reply_id&&m.speaker===who||m.related_to?.includes(target.message_id)&&m.relation==='related_candidate'&&(
  m.speaker===target.speaker&&addressed(m).includes(who)||m.speaker===who&&addressed(m).includes(target.speaker))))]));
 const extended=followup.test(target.text)&&[...byAddressee.values()].some(rows=>rows.length>=2&&rows.some(m=>target.timestamp-m.timestamp>1800000));
 return {prior,byAddressee,extended};
}
const lowerBound=(rows,time)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].timestamp<time)lo=mid+1;else hi=mid;}return lo;};

export function relatedContext(all,byId,targets,base){
 const index=indexFor(all,byId),targetIds=new Set(targets.map(t=>t.id));
 const contexts=new Map(base.context.map(m=>[m.message_id,{...m,related_to:[],priority:m.relation==='reply_ancestor'?0:3}]));
 const flags=Object.fromEntries(targets.map(t=>[t.id,[]]));
 const add=(m,relation,target,priority)=>{if(!m||m.system||targetIds.has(m.id))return;
  const prior=contexts.get(m.id),links=[...new Set([...(prior?.related_to||[]),target.id])];
  contexts.set(m.id,prior&&prior.priority<=priority?{...prior,related_to:links}:{...viewMessage(m),relation,related_to:links,priority});
 };
 for(const t of targets){
  let ancestor=t.reply_id;const seen=new Set([t.id]);
  for(let depth=0;depth<2&&ancestor&&!seen.has(ancestor);depth++){seen.add(ancestor);const m=byId.get(ancestor);if(!m)break;add(m,'reply_ancestor',t,0);ancestor=m.reply_id;}
  if(t.reply_id&&!byId.has(t.reply_id)||!t.reply_id&&(t.quoted||[]).some(q=>q.kind==='reply_preview'))flags[t.id].push('missing_reply');
  const parent=byId.get(t.reply_id);
  if(parent&&!parent.readable)flags[t.id].push('unreadable_reply');
  if((t.mentions||[]).some(a=>!index.resolve(a)&&a.at_type!==1))flags[t.id].push('unresolved_addressee');
  const replies=(index.children.get(t.id)||[]).filter(m=>Math.abs(m.timestamp-t.timestamp)<=48*3600000);
  for(const m of replies.slice(0,4))add(m,'reply_descendant',t,0);
  if(replies.length>4)flags[t.id].push('replies_limited');
  const long=followup.test(t.text),hours=long?48:2;
  let selected=0;
  for(const who of index.addressed(t).slice(0,3)){
   const history=index.pairs.get(pair(t.member_id,who))||[],start=lowerBound(history,t.timestamp-hours*3600000),end=lowerBound(history,t.timestamp);
   // Bound both CPU work and input size. Keep the beginning and end of recent
   // interaction sessions, rather than only the latest repeated messages.
   const candidates=history.slice(Math.max(start,end-200),end),sessions=[];
   for(const m of candidates){if(!sessions.length||m.timestamp-sessions.at(-1).at(-1).timestamp>30*60000)sessions.push([]);sessions.at(-1).push(m);}
   const chosen=new Map();
   for(const session of sessions.slice(-4))for(const m of [...session.slice(0,2),...session.slice(-2)])chosen.set(m.id,m);
   for(const m of candidates.slice(-4))chosen.set(m.id,m);
   for(const m of [...chosen.values()].slice(-16)){add(m,'related_candidate',t,1);selected++;
    // Adjacent turns provide local meaning for retrieved interaction anchors.
    for(const offset of [-1,1]){const next=all[m.position+offset];if(next&&Math.abs(next.timestamp-m.timestamp)<120000)add(next,'candidate_neighbor',t,2);}
   }
   if(end-start>200||sessions.length>4)flags[t.id].push('history_limited');
  }
  if(long&&!selected)flags[t.id].push('unresolved_reference');
 }
 const enrich=m=>({...m,mentions:(m.mentions||[]).map(a=>({...a,member_id:index.resolve(a)}))});
 return {...base,context_version:CONTEXT_VERSION,context:[...contexts.values()].sort((a,b)=>a.timestamp-b.timestamp||a.message_id.localeCompare(b.message_id)).map(enrich),target_flags:flags,
  targets:base.targets.map(enrich)};
}
