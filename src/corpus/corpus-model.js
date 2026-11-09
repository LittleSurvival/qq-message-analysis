import {KEYS,PROMPT,SCHEMA} from './corpus-contract.js';
import {evidenceRequest} from './corpus-evidence.js';
import {behaviorRequest,BEHAVIOR_PROMPT,PRIOR_EVENT_PROMPT,ATTACK_REVIEW_PROMPT} from './corpus-behavior.js';
import {relatedContext,priorEvent,compareTurns} from './corpus-context.js';
import {INFORMATION_REVIEW_PROMPT} from './corpus-information.js';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const emptyScores=()=>Object.fromEntries(KEYS.map(k=>[k,null]));
export function acceptedScores(result){
 const flags=result.review_flags||[];
 const globallyUnclear=flags.includes('incomplete_interpretation')||flags.includes('uncertain_interpretation')&&
  (result.reading?.kind==='uncertain'||!KEYS.some(key=>result.scores[key]===null));
 const harm=['attack','provocation','escalation'];
 return Object.fromEntries(KEYS.map(key=>{
  if(key==='attack'&&result.attack_review?.confirmed)return [key,result.attack_review.score];
  const blocked=globallyUnclear||flags.some(flag=>flag.startsWith(key+':'))||result.confirmed_occurrences?.includes(key)||
   flags.includes('semantic_review_failed')&&[...harm,'negative'].includes(key)||
   flags.includes('self_as_addressee')&&harm.includes(key)||
   flags.includes('incomplete_event')&&['provocation','escalation'].includes(key);
  return [key,blocked?null:result.scores[key]];
 }));
}
export function finalizeAnnotation(annotation,text){
 let result=annotation;
 const review=annotation.attack_review;
 if(review?.confirmed&&review.verdict==='attack'&&review.relation==='third_party'&&review.target_text===text.trim()){
  result={...annotation,
   attack_review:{...review,confirmed:false,score:null},
   confirmed_occurrences:(annotation.confirmed_occurrences||[]).filter(key=>key!=='attack'),
   review_flags:[...annotation.review_flags.filter(flag=>flag!=='attack:intensity_unconfirmed'),'attack:ungrounded_third_party']};
 }
 return {...result,accepted_scores:acceptedScores(result)};
}
export const dayOf=t=>new Date(t+28800000).toISOString().slice(0,10);
export function inScope(m,s={}){const day=dayOf(m.timestamp);return !m.system&&(!s.from||day>=s.from)&&(!s.to||day<=s.to)&&(!s.weekdays?.length||s.weekdays.includes((new Date(m.timestamp+28800000).getUTCDay()+6)%7));}
function card(value,depth=0){
 if(depth>12)return [];
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{return [];}}
 if(Array.isArray(value))return value.flatMap(v=>card(v,depth+1));
 if(!object(value))return [];
 return [...new Set(Object.entries(value).flatMap(([k,v])=>['title','desc','description','summary','prompt'].includes(k)&&typeof v==='string'?[v]:object(v)||Array.isArray(v)||['content','raw','json'].includes(k)?card(v,depth+1):[]))];
}
export function normalizeMessage(m){
 if(!object(m)||m.id==null||m.id==='')throw new Error('缺少訊息 ID');
 let timestamp=m.timestamp==null?Date.parse(m.time):Number(m.timestamp);
 if(m.timestamp==null&&typeof m.time==='string'&&!/(Z|[+-]\d\d:\d\d)$/i.test(m.time))throw new Error('時間缺少時區');
 if(Math.abs(timestamp)<1e11)timestamp*=1000;
 if(!Number.isFinite(timestamp)||!Number.isFinite(new Date(timestamp).getTime()))throw new Error('時間無效');
 const sender=m.sender||{},content=m.content||{},elements=content.elements||[];
 if(!Array.isArray(elements))throw new Error('elements 必須為陣列');
 const parts=[],quoted=[],mentions=[];let reply_id=null;
 for(const e of elements){const d=e?.data;if(!object(d))continue;
  if(['text','markdown'].includes(e.type))parts.push(String(d.text||d.content||''));
  else if(e.type==='face'&&d.name)parts.push(`[表情：${d.name}]`);
  else if(e.type==='json')parts.push(...card(d).map(t=>`[分享摘要：${t}]`));
  else if(e.type==='reply'){reply_id=[d.referencedMessageId,d.messageId].find(v=>v!=null&&v!==''&&String(v)!=='0');reply_id=reply_id==null?null:String(reply_id);quoted.push({kind:'reply_preview',text:String(d.content||''),sender:String(d.senderName||''),reference_id:reply_id});}
  else if(e.type==='forward')quoted.push({kind:'forward_summary',text:card(d).join('\n')});
  else if(e.type==='at')mentions.push({uid:d.uid,uin:d.uin,name:d.name,at_type:d.atType});
 }
 if(!elements.length&&m.type==='text')parts.push(String(content.text||''));
 const system=!!(m.system||m.type==='system'||elements.some(e=>e?.type==='system')),text=parts.filter(p=>p.trim()).join('\n').trim();
 const usable=v=>v&&!['unknown','未知','0'].includes(String(v).trim())?String(v).trim():'';
 return {id:String(m.id),timestamp,member_id:usable(sender.uid)||usable(sender.uin)||'unknown',uin:usable(sender.uin),name:String(sender.name||sender.groupCard||sender.remark||sender.nickname||'未知成員'),type:String(m.type||'unknown'),system,text,readable:!!text&&!system,reply_id,quoted,mentions};
}
export const messageView=m=>({message_id:m.id,speaker:m.member_id,timestamp:m.timestamp,text:m.text,quoted:m.quoted,mentions:m.mentions,reply_id:m.reply_id,type:m.type,name:m.name});
export function buildContext(all,byId,targets){
 const targetIds=new Set(targets.map(t=>t.id)),first=targets[0],last=targets.at(-1),context=new Map(),flags=[];
 const add=(m,relation)=>{if(!targetIds.has(m.id))context.set(m.id,{...messageView(m),relation});};
 for(let i=first.position-1,n=0;i>=0&&n<20;i--){const m=all[i];if(m.timestamp<first.timestamp-1800000)break;if(!m.system){add(m,'neighbor');n++;}}
 for(let i=last.position+1,n=0;i<all.length&&n<10;i++){const m=all[i];if(m.timestamp>last.timestamp+1800000)break;if(!m.system){add(m,'neighbor');n++;}}
 for(const t of targets){let id=t.reply_id;const seen=new Set([t.id]);if(!id&&t.quoted.some(q=>q.kind==='reply_preview'))flags.push('missing_reply_id');
  for(let depth=0;depth<2&&id&&!seen.has(id);depth++){seen.add(id);const m=byId.get(id);if(!m){flags.push('missing_reply:'+id);break;}add(m,'reply_ancestor');id=m.reply_id;}
 }
 return {targets:targets.map(messageView),context:[...context.values()].sort((a,b)=>a.timestamp-b.timestamp||a.message_id.localeCompare(b.message_id)),flags:[...new Set(flags)]};
}
export function fitContext(all,byId,targets,config,prompt=PROMPT){
 const modern=config.evidence_mode==='behavior-v4';if(modern&&prompt===PROMPT)prompt=BEHAVIOR_PROMPT;
 let chosen=targets.slice(0,Math.min(20,Math.max(1,Math.floor(config.max_output_tokens/(modern?480:256))))),payload;
 const fits=()=>new TextEncoder().encode(prompt+JSON.stringify(modern?behaviorRequest(payload).data:config.evidence_mode==='references'?evidenceRequest(payload).data:payload)).length+256<=config.context_tokens-config.max_output_tokens;
 while(true){payload=buildContext(all,byId,chosen);if(modern){payload=relatedContext(all,byId,chosen,payload);
   // Give the prior-only review its own target, so later targets cannot leak into it.
   const split=chosen.length>1?payload.targets.findIndex(t=>priorEvent(payload,t).extended):-1;
   if(split>=0){chosen=chosen.slice(0,split||1);continue;}
  }if(fits())return {chosen,payload,overflow:false};if(chosen.length>1){chosen=chosen.slice(0,Math.max(1,Math.floor(chosen.length/2)));continue;}
  const neighbors=payload.context.filter(m=>modern?m.priority!==0:m.relation==='neighbor').sort((a,b)=>(modern?(b.priority??3)-(a.priority??3):0)||Math.abs(b.timestamp-chosen[0].timestamp)-Math.abs(a.timestamp-chosen[0].timestamp));
  if(neighbors.length)payload.flags.push('context_reduced');
  for(const m of neighbors){payload.context=payload.context.filter(x=>x!==m);if(modern&&m.related_to?.length)for(const id of m.related_to)payload.target_flags[id]=[...new Set([...(payload.target_flags[id]||[]),'related_context_reduced'])];if(fits())return {chosen,payload,overflow:false};}
  return {chosen,payload,overflow:true};
 }
}
export function validateScores(scores){if(!object(scores)||Object.keys(scores).length!==KEYS.length||KEYS.some(k=>!(k in scores)||scores[k]!==null&&(!Number.isInteger(scores[k])||scores[k]<0||scores[k]>3)))throw new Error('八維分數須完整且為 0–3 整數或 null');}
export function validateAnnotations(content,payload){
 let value;try{value=JSON.parse(content);}catch{throw new Error('模型回傳的內容不是有效 JSON');}
 if(!object(value)||Object.keys(value).join()!=='results'||!Array.isArray(value.results))throw new Error('回傳格式不符合 results 契約');
 const targets=new Set(payload.targets.map(t=>t.message_id)),seen=new Set(),sources=new Map([...payload.targets,...payload.context].map(m=>[m.message_id,m]));
 for(const r of value.results){if(!object(r)||Object.keys(r).sort().join()!==['evidence','message_id','reason','scores','uncertainty'].join()||typeof r.message_id!=='string'||!targets.has(r.message_id)||seen.has(r.message_id))throw new Error('模型結果欄位或目標 ID 不符');seen.add(r.message_id);validateScores(r.scores);
  if(typeof r.reason!=='string'||!r.reason.length||r.reason.length>3000||!Array.isArray(r.evidence)||!Array.isArray(r.uncertainty)||r.uncertainty.some(v=>typeof v!=='string'))throw new Error('模型理由、證據或不確定標記格式錯誤');
  for(const e of r.evidence){if(!object(e)||Object.keys(e).sort().join()!=='message_id,quote'||typeof e.message_id!=='string'||typeof e.quote!=='string'||!e.quote)throw new Error('模型證據格式錯誤');const s=sources.get(e.message_id);if(!s||![s.text,...(s.quoted||[]).map(q=>q.text)].some(t=>t.includes(e.quote)))throw new Error('模型證據不在提供的原文中');}
  if(KEYS.some(k=>r.scores[k]>0)&&!r.evidence.some(e=>e.message_id===r.message_id))throw new Error('正分缺少目標訊息證據');
  if(KEYS.some(k=>r.scores[k]===null)&&!r.uncertainty.length)throw new Error('未知分數需附不確定標記');
 }
 if(seen.size!==targets.size)throw new Error(`模型遺漏目標訊息：預期 ${targets.size} 則，回傳 ${seen.size} 則`);
 return value.results;
}
export function profileConfig(input){
 const defaults={name:'',base_url:'http://127.0.0.1:11434/v1',model:'',context_tokens:32768,max_output_tokens:8192,concurrency:1,timeout:180,response_mode:'auto',output_token_parameter:'max_tokens',input_price:null,output_price:null,budget:null,reasoning_effort:'default',temperature:null,evidence_mode:'behavior-v4'};
 const cfg=Object.fromEntries(Object.keys(defaults).map(k=>[k,input[k]??defaults[k]]));
 let url;try{url=new URL(cfg.base_url);}catch{throw new Error('API 位址無效');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('API 位址須為 HTTP(S)，不可包含帳密或查詢參數');
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol==='http:'&&!loopback)throw new Error('遠端模型 API 請使用 HTTPS；HTTP 僅允許本機位址');
 cfg.base_url=url.href.replace(/\/$/,'');
 if(!String(cfg.name).trim()||!String(cfg.model).trim())throw new Error('請填寫設定名稱與模型名稱');
 for(const [k,min,max] of [['context_tokens',4096,2000000],['max_output_tokens',256,200000],['concurrency',1,8],['timeout',5,1800]])if(!Number.isInteger(cfg[k])||cfg[k]<min||cfg[k]>max)throw new Error('容量、並行或逾時設定超出範圍');
 if(cfg.max_output_tokens>=cfg.context_tokens)throw new Error('輸出上限須小於上下文容量');
 for(const k of ['input_price','output_price','budget'])if(cfg[k]!=null&&(!Number.isFinite(cfg[k])||cfg[k]<0))throw new Error('費用設定無效');
 if(cfg.temperature!=null&&(!Number.isFinite(cfg.temperature)||cfg.temperature<0||cfg.temperature>2))throw new Error('隨機程度須介於 0 與 2');
 if(cfg.budget!=null&&(cfg.input_price==null||cfg.output_price==null))throw new Error('使用費用上限前，請填入輸入與輸出單價');
 if(!['quotes','references','behavior-v4'].includes(cfg.evidence_mode))throw new Error('證據協定設定無效');
 if(!['auto','json_schema','json_object','prompt'].includes(cfg.response_mode)||!['max_tokens','max_completion_tokens'].includes(cfg.output_token_parameter)||!['default','none','low','medium','high'].includes(cfg.reasoning_effort))throw new Error('模型格式設定無效');
 return cfg;
}
export class ModelError extends Error{constructor(message,{retryable=false,usage=null,diagnostics=null,scope='service'}={}){super(message);this.retryable=retryable;this.usage=usage;this.diagnostics=diagnostics;this.scope=scope;}}
// Follow the ordinary second pass with a targeted attack check only when needed.
const derogationCue=/(?:傻[逼比]|[這这]逼|煞筆|廢物|废物|神[經经]病|人渣|智障|混蛋|笨蛋|黑心|卑鄙|[\p{Script=Han}]\s*SB\b)/iu;
const alternateAttackReadings=new Set(['banter','self_deprecation','quotation','fiction']);
const disputeCue=/(?:下三路|人身攻[擊击]|性侮辱|[這这]貨|这货|煽動|煽动|拱火|[帶带]節奏|带节奏|挑[釁衅]|辱[罵骂]|[罵骂]人)/u;
export async function completeReviewed(config,payload,options={}){
 const first=await complete(config,payload,options);
 if(config.evidence_mode!=='behavior-v4')return first;
 const attackEnabled=options.attackReview===true;
 const harm=['attack','provocation','escalation'];
 const checked=[...harm,'negative'];
 const targets=new Map(payload.targets.map(m=>[m.message_id,m]));
 const directReplies=target=>[...payload.targets,...payload.context].filter(m=>m.reply_id===target.message_id&&compareTurns(m,target)>0&&m.speaker!==target.speaker&&m.text?.trim());
 const event=payload.targets.length===1?priorEvent(payload,payload.targets[0]):null;
 const focused=event?.extended===true;
 const candidates=first.annotations.filter(a=>{
  const anchors=payload.context.filter(m=>m.relation==='related_candidate'&&m.related_to?.includes(a.message_id));
  const extendedEvent=anchors.length>=2&&Math.max(...anchors.map(m=>m.timestamp))-Math.min(...anchors.map(m=>m.timestamp))>1800000;
  // These clues only select a second opinion. They never assign a score.
  const target=targets.get(a.message_id);
  const missedHarm=attackEnabled&&derogationCue.test(target?.text||'')||/(?:傻[逼比]|廢物|废物|神[經经]病|閉嘴|闭嘴|滾出去|滚出去|你算[什甚][麼么]|敢不敢|有本事|你滿意了|你满意了|你希望的)/u.test(target?.text||'');
  return focused||(checked.some(k=>a.scores[k]>0)||missedHarm||extendedEvent||a.review_flags.some(f=>/reading_conflict|reason_conflict|missing_authored_evidence|missing_event_evidence|later_event_evidence|self_as_addressee/.test(f)))&&!a.review_flags.some(f=>/incomplete|uncertain/.test(f));
 });
 const finish=response=>attackEnabled?{...response,annotations:response.annotations.map(a=>finalizeAnnotation(a,targets.get(a.message_id).text))}:response;
 const hasInformationReview=options.informationReview&&(first.annotations.some(row=>row.scores.information>0)||payload.targets.some(m=>disputeCue.test(m.text)));
 if(!candidates.length&&!hasInformationReview&&
  (!attackEnabled||!payload.targets.some(t=>derogationCue.test(t.text))))return finish(first);
 const authoredTurns=m=>({...m,quoted:(m.quoted||[]).filter(q=>q.kind!=='reply_preview')});
 const reviewPayload=focused?{...payload,targets:payload.targets.map(authoredTurns),context:[...event.prior].sort(compareTurns).map(authoredTurns),prior_event:event.byAddressee}:payload;
 const wire=behaviorRequest(reviewPayload),localIds=new Map(Object.entries(wire.identifiers).map(([local,id])=>[id,local]));
 const reviewSnapshot=focused?{review_input:{system_prompt:PRIOR_EVENT_PROMPT,input:wire.data,identifiers:wire.identifiers}}:{};
 const toneTargets=candidates.filter(a=>a.scores.attack===1&&directReplies(targets.get(a.message_id)).length);
 const tonePrompt=toneTargets.length?' 對 '+toneTargets.map(a=>localIds.get(a.message_id)).join('、')+'，先讀 reply_id 真正指向該目標的直接回覆，再判是友人調侃還是羞辱。數字較大的回覆只能用來澄清語氣，不能當作目標在回應的前文。若判攻擊正分，逐維證據應包含目標原話及可支持該語氣的直接回覆；粗口或暱稱本身不能分出兩者。群聊用語按實際語意理解，例如「水群」是在群裡閒聊。':'';
 const feedback=focused?'':
  '獨立覆查這些目標：'+candidates.map(a=>`${localIds.get(a.message_id)} ${a.review_flags.join(',')}`).join(';')+'。先逐字讀目標本句。核對有沒有針對真人或群體的貶低、敵對刺激、追擊，以及發言者本句表達的負面感受。分開看行為是否出現和程度。核對同作者後續、自嘲、互相玩笑、制止爭執與跨時段追問。作品討論也可能辱罵真人創作者；作品缺點或別人的抱怨不能替目標的負面情緒作證。缺失證據保留null。'+tonePrompt;
 options.onProgress?.({phase:'reviewing',semantic_review:true});
 const sum=(usage,extra)=>({input:usage.input+(extra?.input||0),output:usage.output+(extra?.output||0),measured:usage.measured&&extra?.measured===true});
 let response=first;
 try{
  if(candidates.length){
  const second=await complete(config,reviewPayload,{...options,...(focused?{prompt:PRIOR_EVENT_PROMPT}:{}),feedback,onProgress:p=>options.onProgress?.({...p,semantic_review:true})});
  const revised=new Map(second.annotations.map(a=>[a.message_id,a])),ids=new Set(candidates.map(a=>a.message_id));
  const annotations=first.annotations.map(a=>{
   if(!ids.has(a.message_id))return a;
   const b=revised.get(a.message_id),flags=new Set(focused?[
    ...a.review_flags.filter(f=>!f.startsWith('provocation:')),...b.review_flags.filter(f=>!f.includes(':')||f.startsWith('provocation:')),
    ...checked.filter(k=>k!=='provocation'&&a.scores[k]>0).map(k=>k+':semantic_review_deferred')
   ]:b.review_flags),confirmedOccurrences=[];
   const blocksDimension=(result,key)=>result.review_flags.some(flag=>!flag.includes(':')||flag.startsWith(key+':'));
   if(!focused&&b.scores.attack>0&&(a.scores.attack===1||b.scores.attack===1)){
    const replies=directReplies(targets.get(a.message_id)).filter(m=>!b.reading.to.length||b.reading.to.includes(m.speaker));
    const toneEvidence=b.judgments.find(j=>j.dimension==='attack')?.evidence||[];
    if(replies.length&&!toneEvidence.some(e=>e.source_kind==='authored'&&replies.some(m=>m.message_id===e.message_id)))flags.add('attack:unresolved_reply_tone');
   }
   const refs=b.judgments.find(j=>j.dimension==='provocation')?.evidence||[];
   const citedIds=new Set(refs.filter(e=>e.source_kind==='authored').map(e=>e.message_id));
   const linkedPrior=event?.byAddressee.get(b.reading.to[0])?.filter(m=>citedIds.has(m.message_id))||[];
   const contextualOccurrence=focused&&b.scores.provocation>0&&linkedPrior.length>=2&&linkedPrior.some(m=>targets.get(a.message_id).timestamp-m.timestamp>1800000)&&
    b.reading.kind==='indirect_challenge'&&b.reading.to.length===1&&
    !['banter','self_deprecation','quotation','fiction','uncertain'].includes(a.reading.kind)&&
    !b.review_flags.some(f=>(!f.includes(':')||f.startsWith('provocation:'))&&!['incomplete_event','provocation:incomplete_event'].includes(f));
   if(contextualOccurrence){
    confirmedOccurrences.push('provocation');
    flags.add('provocation:contextual_occurrence');
   }else if(focused&&b.scores.provocation>0){
    flags.add('provocation:unconfirmed_prior_event');
   }
   for(const key of checked){
    if(focused&&key!=='provocation')continue;
    const before=a.scores[key],after=b.scores[key];
    if(harm.includes(key)&&after>0&&['banter','self_deprecation','quotation','fiction'].includes(a.reading.kind)&&a.reading.kind!==b.reading.kind)flags.add(key+':reading_conflict');
    if(before===after||key==='provocation'&&contextualOccurrence)continue;
    if(harm.includes(key)&&!(focused&&key==='provocation')&&!flags.has(key+':unresolved_reply_tone')&&before>0&&after>0&&!blocksDimension(a,key)&&!blocksDimension(b,key)){
     confirmedOccurrences.push(key);
     flags.add(key+':intensity_disagreement');
    }else if(key!=='negative'||!(before>0&&after>0)){
     flags.add(key+':model_disagreement');
    }
   }
   if(b.scores.negative>0&&a.review_flags.includes('negative:reason_conflict'))flags.add('negative:reason_conflict');
   const judgments=focused?[...a.judgments.filter(j=>j.dimension!=='provocation'),...b.judgments.filter(j=>j.dimension==='provocation')]:b.judgments;
   const base=focused?{...b,scores:{...a.scores,provocation:b.scores.provocation},judgments,evidence:judgments.flatMap(j=>j.evidence),reason:judgments.map(j=>j.reason).join('；')||b.reason,uncertainty:[...new Set([...a.uncertainty,...b.uncertainty])]}:b;
   return {...base,confirmed_occurrences:confirmedOccurrences,review_feedback:feedback,review_flags:[...flags],model_passes:[a,b]};
  });
  response={...first,usage:sum(first.usage,second.usage),annotations,...reviewSnapshot};
  }
 }catch(error){
  if(error.name==='AbortError')throw error;
  response={...first,usage:sum(first.usage,error.usage),annotations:first.annotations.map(a=>candidates.includes(a)?{...a,review_feedback:feedback,review_flags:[...a.review_flags,'semantic_review_failed'],semantic_review_error:error.message}:a),...reviewSnapshot};
 }
 if(options.informationReview)return reviewInformation(config,payload,options,first,response,sum);
 if(focused||!attackEnabled)return finish(response);
 const selected=response.annotations.filter(a=>{
  const target=targets.get(a.message_id);
  return derogationCue.test(target.text)||(a.scores.attack>0||a.model_passes?.[0].scores.attack>0)&&
   (target.reply_id||directReplies(target).length||a.review_flags.some(f=>f==='self_as_addressee'||f.startsWith('attack:')))&&!a.review_flags.includes('semantic_review_failed');
 });
 if(!selected.length)return finish(response);
 const ids=new Set(selected.map(a=>a.message_id));
 const attackPayload={...payload,attack_review:true,targets:payload.targets.filter(t=>ids.has(t.message_id)),
  context:[...payload.context,...payload.targets.filter(t=>!ids.has(t.message_id))].sort(compareTurns)};
 const attackWire=behaviorRequest(attackPayload);
 const attackSnapshot={system_prompt:ATTACK_REVIEW_PROMPT,input:attackWire.data,identifiers:attackWire.identifiers};
 try{
  const attack=await complete(config,attackPayload,{...options,prompt:ATTACK_REVIEW_PROMPT,feedback:'',onProgress:p=>options.onProgress?.({...p,semantic_review:true})});
  const verdicts=new Map(attack.annotations.map(a=>[a.message_id,a]));
  const annotations=response.annotations.map(a=>{
   const verdict=verdicts.get(a.message_id);
   if(!verdict)return a;
   const passes=a.model_passes||[a];
   const flags=new Set(a.review_flags);
   const occurrences=(a.confirmed_occurrences||[]).filter(key=>key!=='attack');
   let score=null,confirmed=false;
   const alternateReading=passes.some(p=>alternateAttackReadings.has(p.reading.kind));
   if(verdict.verdict==='attack'&&!alternateReading&&(verdict.relation==='third_party'||passes.every(p=>p.scores.attack>0)&&!flags.has('attack:unresolved_reply_tone'))){
    confirmed=true;
    if(passes.length===2&&passes.every(p=>p.scores.attack>0&&p.scores.attack===a.scores.attack&&
     !p.review_flags.some(f=>f==='self_as_addressee'||f.startsWith('attack:'))))score=a.scores.attack;
    if(score===null){occurrences.push('attack');flags.add('attack:intensity_unconfirmed');}
   }else if(verdict.verdict==='ordinary'&&(alternateReading||passes.some(p=>p.scores.attack===0))){
    score=0;confirmed=true;
   }else flags.add('attack:target_review_unclear');
   if(confirmed)for(const flag of flags)if(flag.startsWith('attack:')&&flag!=='attack:intensity_unconfirmed')flags.delete(flag);
   const attackReview={...verdict,confirmed,score};
   const judgments=confirmed?[...a.judgments.filter(j=>j.dimension!=='attack'),{dimension:'attack',reason:verdict.reason,evidence:verdict.evidence}]:a.judgments;
   const evidence=[...new Map(judgments.flatMap(j=>j.evidence).map(e=>[`${e.message_id}|${e.source_kind}|${e.quote}`,e])).values()];
   return {...a,judgments,evidence,reason:judgments.map(j=>j.reason).join('；')||a.reason,
    confirmed_occurrences:occurrences,review_flags:[...flags],attack_review:attackReview};
  });
  return finish({...response,annotations,usage:sum(response.usage,attack.usage),attack_input:attackSnapshot});
 }catch(error){
  if(error.name==='AbortError')throw error;
  return finish({...response,usage:sum(response.usage,error.usage),attack_input:attackSnapshot,
   annotations:response.annotations.map(a=>ids.has(a.message_id)?{...a,confirmed_occurrences:(a.confirmed_occurrences||[]).filter(key=>key!=='attack'),
    review_flags:[...a.review_flags,'attack:target_review_failed'],attack_review:{error:error.message}}:a)});
 }
}

async function reviewInformation(config,payload,options,first,response,sum){
 const firstById=new Map(first.annotations.map(row=>[row.message_id,row]));
 const reviewedInformation=new Set(response.annotations.filter(row=>row.scores.information>0||firstById.get(row.message_id).scores.information>0).map(row=>row.message_id));
 const ids=new Set(payload.targets.filter(m=>reviewedInformation.has(m.message_id)||disputeCue.test(m.text)).map(m=>m.message_id));
 if(!ids.size)return response;
 const reviewPayload={...payload,information_review:true,targets:payload.targets.filter(m=>ids.has(m.message_id)),
  context:[...payload.context,...payload.targets.filter(m=>!ids.has(m.message_id))].sort(compareTurns)};
 const wire=behaviorRequest(reviewPayload);
 const information_input={system_prompt:INFORMATION_REVIEW_PROMPT,input:wire.data,identifiers:wire.identifiers};
 try{
  const review=await complete(config,reviewPayload,{...options,prompt:INFORMATION_REVIEW_PROMPT,feedback:'',onProgress:p=>options.onProgress?.({...p,semantic_review:true})});
  const byId=new Map(review.annotations.map(row=>[row.message_id,row]));
  const annotations=response.annotations.map(row=>{
   const check=byId.get(row.message_id);
   if(!check)return row;
   const checkInformation=reviewedInformation.has(row.message_id);
   const flags=row.review_flags.filter(flag=>!checkInformation||!flag.startsWith('information:'));
   const scores=row.review_flags.length?emptyScores():{...row.scores};
   const occurrences=[...(row.confirmed_occurrences||[])];
   const original=row.judgments.find(j=>j.dimension==='information');
   const corroborated=original?.evidence.some(e=>e.message_id===row.message_id&&e.source_kind==='authored'&&e.quote.includes(check.evidence[0]?.quote));
   const firstReading=firstById.get(row.message_id);
   const disputedSubjects=new Set();
   for(const key of ['attack','provocation']){
    const subjectChanged=firstReading.reading.subject!==row.reading.subject;
    if(firstReading.review_flags.includes(key+':reading_conflict')&&subjectChanged)disputedSubjects.add(key);
    if(scores[key]>0&&firstReading.review_flags.includes(key+':reading_conflict')&&
     (subjectChanged||!check.signals.some(s=>s.dimension===key))){
     scores[key]=null;
     flags.push(key+':reading_conflict');
    }
   }
   let judgments=[...row.judgments];
   if(checkInformation){
    if(check.verdict==='contribution')scores.information=corroborated&&scores.information>0?scores.information:1;
    else if(check.verdict==='none')scores.information=0;
    else{scores.information=null;flags.push('information:contribution_unclear');}
    judgments=[...judgments.filter(j=>j.dimension!=='information'),{dimension:'information',reason:check.reason,evidence:check.evidence}];
   }
   for(const signal of check.signals){
    const key=signal.dimension;
    if(scores[key]>0||occurrences.includes(key))continue;
    // A second indication is useful for review. Publish a positive only when an
    // existing pass already grounded that dimension in the same authored text.
    const matchingPass=!disputedSubjects.has(key)&&(row.model_passes||[firstReading]).some(pass=>pass.scores[key]>0&&
     !pass.review_flags.some(flag=>!flag.includes(':')||flag.startsWith(key+':'))&&
     pass.judgments.find(j=>j.dimension===key)?.evidence.some(e=>e.message_id===row.message_id&&e.source_kind==='authored'&&e.quote.includes(signal.evidence[0].quote)));
    if(matchingPass){occurrences.push(key);flags.push(key+':intensity_unconfirmed');}
    else flags.push(key+':possible_misclassified_information');
    scores[key]=null;
    if(!judgments.some(j=>j.dimension===key))judgments.push(signal);
   }
   const evidence=judgments.flatMap(j=>j.evidence);
   return {...row,accepted_scores:scores,confirmed_occurrences:occurrences,review_flags:[...new Set(flags)],judgments,evidence,
    reason:judgments.map(j=>j.reason).join('；')||row.reason,information_review:{...check,original}};
  });
  return {...response,annotations,usage:sum(response.usage,review.usage),information_input};
 }catch(error){
  if(error.name==='AbortError')throw error;
  const annotations=response.annotations.map(row=>reviewedInformation.has(row.message_id)?{...row,
   accepted_scores:{...(row.review_flags.length?emptyScores():row.scores),information:null},
   review_flags:[...row.review_flags,'information:contribution_review_failed'],information_review:{error:error.message}}:row);
  return {...response,annotations,usage:sum(response.usage,error.usage),information_input};
 }
}
export async function complete(config,payload,{key='',signal,onProgress=()=>{},fetcher=fetch,prompt=PROMPT,feedback=''}={}){
 const modern=config.evidence_mode==='behavior-v4';if(modern&&prompt===PROMPT)prompt=BEHAVIOR_PROMPT;
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},config.timeout*1000);
 const usage={input:0,output:0,measured:false};let receivedHeaders=false;
 const wire=modern?behaviorRequest(payload):config.evidence_mode==='references'?evidenceRequest(payload):null;
 try{for(const mode of config.response_mode==='auto'?['json_schema','json_object','prompt']:[config.response_mode]){
  const body={model:config.model,messages:[{role:'system',content:prompt+(feedback?'\n上次驗證失敗：'+feedback+'。重新檢查所有目標、證據編號和未知旗標，只回傳合格 JSON。':'')},{role:'user',content:JSON.stringify(wire?.data||payload)}],[config.output_token_parameter]:config.max_output_tokens,stream:true,stream_options:{include_usage:true}};
  if(config.temperature!=null)body.temperature=config.temperature;
  if(config.reasoning_effort!=='default')body.reasoning_effort=config.reasoning_effort;
  if(mode==='json_schema')body.response_format={type:mode,json_schema:{name:'annotations',strict:true,schema:wire?.schema||SCHEMA}};
  if(mode==='json_object')body.response_format={type:mode};
  onProgress({phase:'connecting'});
  const response=await fetcher(config.base_url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body),signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
  receivedHeaders=true;
  if(!response.ok){const errorText=await response.text();if([400,422].includes(response.status)&&config.response_mode==='auto'&&mode!=='prompt'&&/response_format|json_schema|json_object/i.test(errorText))continue;throw new ModelError(`模型 HTTP ${response.status}；請檢查服務、模型與金鑰`,{retryable:[408,429,500,502,503,504].includes(response.status)});}
  onProgress({phase:'waiting_first_output'});let content='',reasoningChars=0,finish=null;
  const meter=v=>{if(v&&Number.isInteger(v.prompt_tokens)&&Number.isInteger(v.completion_tokens)&&v.prompt_tokens>=0&&v.completion_tokens>=0)Object.assign(usage,{input:v.prompt_tokens,output:v.completion_tokens,measured:true});};
  if(response.headers.get('content-type')?.includes('text/event-stream')){
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',finished=false;
   const frame=frame=>{const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)return;if(data==='[DONE]'){finished=true;return;}let chunk;try{chunk=JSON.parse(data);}catch{throw new ModelError('模型串流格式無效');}if(chunk.error)throw new ModelError('模型串流回報錯誤');meter(chunk.usage);
    for(const c of chunk.choices||[]){if((c.index??0)!==0)continue;const d=c.delta||{},text=d.content||'',reasoning=d.reasoning||d.reasoning_content||'';if(typeof text!=='string'||typeof reasoning!=='string')throw new ModelError('模型串流格式無效');content+=text;reasoningChars+=reasoning.length;finish=c.finish_reason||finish;onProgress({phase:content?'generating':reasoningChars?'thinking':'waiting_first_output',answer_chars:content.length,reasoning_chars:reasoningChars});}
   };
   try{while(!finished){const {value,done}=await reader.read();pending+=(done?decoder.decode():decoder.decode(value,{stream:true}));pending=pending.replace(/\r\n/g,'\n');let end;while((end=pending.indexOf('\n\n'))>=0){frame(pending.slice(0,end));pending=pending.slice(end+2);}if(done){if(pending.trim())frame(pending);break;}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   if(!finish)throw new ModelError('模型串流中斷，尚未收到完整結束訊號',{retryable:true,usage});
  }else{let value;try{value=await response.json();}catch{throw new ModelError('服務回傳格式不是有效 chat completion');}const c=value.choices?.[0];content=c?.message?.content;reasoningChars=(c?.message?.reasoning||c?.message?.reasoning_content||'').length;finish=c?.finish_reason;meter(value.usage);if(typeof content!=='string')throw new ModelError('服務回傳格式不是有效 chat completion');}
  if(finish==='length')throw new ModelError(reasoningChars&&!content.trim()?'模型輸出被截斷：已收到思考輸出，但還沒有正式評分。思考也會消耗輸出與上下文額度。':'模型輸出被截斷，尚未完成評分 JSON。請核對服務實際容量與輸出上限。',{usage,scope:reasoningChars&&!content.trim()?'service':'item',diagnostics:{code:'output_truncated',reasoning_chars:reasoningChars,answer_chars:content.length,output_limit:config.max_output_tokens,context_budget:config.context_tokens}});
  if(finish!=='stop')throw new ModelError('模型未正常完成答案，請檢查服務回應與輸出設定',{usage});
  if(!content.trim())throw new ModelError('模型未回傳正式答案；請檢查思考設定與輸出容量',{usage});
  onProgress({phase:'validating'});let annotations;try{annotations=modern?wire.decode(content):validateAnnotations(wire?wire.decode(content):content,payload);}catch(e){throw new ModelError(e.message,{usage,scope:'item'});}
  return {annotations,usage,mode};
 }
 }catch(error){if(signal?.aborted)throw new DOMException('已暫停','AbortError');if(timedOut)throw new ModelError('模型連線逾時',{retryable:true,usage});if(error instanceof ModelError)throw error;if(receivedHeaders)throw new ModelError('模型回應傳輸中斷',{retryable:true,usage});throw new ModelError('無法連接模型。請確認服務已啟動、允許此網站的 CORS，並允許瀏覽器存取本機網路。',{retryable:false,usage});}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
