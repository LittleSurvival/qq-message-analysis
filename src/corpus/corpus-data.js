export const dimensions = [
  ['support','正向支持','#b79bff','鼓勵、感謝、安慰與肯定'],
  ['respect','友善尊重','#68d6c0','禮貌、同理與尊重不同意見'],
  ['information','資訊貢獻','#7eafff','分享相關資源、經驗與具體解答'],
  ['constructive','建設性討論','#dfc17b','提出理由、釐清問題、提供方案'],
  ['negative','負面情緒','#eda57c','抱怨、失望、憤怒與悲觀'],
  ['attack','攻擊貶抑','#ed87a5','辱罵、羞辱與針對性的貶低'],
  ['provocation','挑釁引戰','#cc91e8','刻意刺激、嘲諷與煽動對立'],
  ['escalation','衝突升級','#8d9cdd','追擊、擴大爭執與拉人圍攻'],
].map(([key,name,color,definition])=>({key,name,color,definition}));


export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number=v=>v==null?'—':v.toLocaleString('zh-TW',{maximumFractionDigits:1});
export const reviewFlagLabel=value=>{const [dimension,code]=value.includes(':')?value.split(':'):['',value],labels={missing_authored_evidence:'缺少本人發言證據',missing_event_evidence:'缺少可連結的事件證據',reading_conflict:'行為判讀與分數矛盾',reason_conflict:'理由與分數矛盾',incomplete_event:'事件上下文不完整',uncertain_dimension:'含未知維度',uncertain_interpretation:'模型無法確定語意',incomplete_interpretation:'缺少判斷語氣所需的原文或媒體',self_as_addressee:'模型混淆發言者與對象',model_disagreement:'兩次模型判斷不一致',intensity_disagreement:'已計入出現次數，強度待覆核',later_event_evidence:'誤用目標之後的發言作證',contextual_occurrence:'前文證據足以計入出現次數，強度待覆核',unconfirmed_prior_event:'前文證據不足以確認引戰',semantic_review_deferred:'本次僅覆查引戰，這一維仍待覆核',intensity_unconfirmed:'已計入出現次數，強度待覆核',contribution_unclear:'本句資訊證據不足',contribution_review_failed:'資訊覆核未完成',possible_misclassified_information:'本句可能有漏判的負面行為，待覆核',ungrounded_third_party:'本句未能指出被罵的第三方',target_review_unclear:'攻擊對象或語氣待覆核',target_review_failed:'攻擊覆核未完成',unresolved_reply_tone:'直接回覆的語氣尚未釐清',semantic_review_failed:'第二次覆查未完成'};return (dimension?(dimensions.find(d=>d.key===dimension)?.name||dimension)+'：':'')+(labels[code]||code);};
export const measurement=(m,key,mode)=>mode==='count'?(m.dimensions[key].valid?m.dimensions[key].count:null):(m.dimensions[key].valid?m.dimensions[key].count/m.dimensions[key].valid*100:null);
export const ranked=(members,key,mode,small)=>members.filter(m=>m.id!=='unknown'&&m.dimensions[key].valid>=(small?1:30)).slice().sort((a,b)=>measurement(b,key,mode)-measurement(a,key,mode)||a.id.localeCompare(b.id));
export const scopeOf=r=>({from:r.filters.from||'',to:r.filters.to||'',weekdays:[...(r.filters.weekdays||[])].sort()});
export const sameScope=(a,b)=>JSON.stringify({from:a?.from||'',to:a?.to||'',weekdays:[...(a?.weekdays||[])].sort()})===JSON.stringify(b);
