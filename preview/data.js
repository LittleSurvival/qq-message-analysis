import {demoReport} from '../src/analysis/demo.js';

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

// Deliberately invented behavior measurements for UI review, never model output.
// Message totals come from the original dashboard's deterministic synthetic demo.
const rates = [
  [23,39,14,18,12,3,5,2], [37,51,23,20,8,1,2,1],
  [21,34,49,33,9,2,4,2], [42,56,29,41,10,2,1,1],
  [15,27,18,12,31,11,17,8], [31,44,35,28,7,1,2,1],
  [12,25,9,11,37,6,8,4], [49,61,17,30,14,2,3,1],
  [26,36,53,45,11,3,2,1], [17,30,20,15,25,9,13,7],
  [20,33,24,21,20,14,18,12], [35,46,38,35,13,4,5,2],
];
export function previewMembers(filters={}) {
  const report=demoReport(filters);
  return report.members.map(m=>{
    const i=Number(m.id.split('-')[1]);
    const analyzed=Math.floor(m.total*(.82+(i%4)*.04));
    return {...m,analyzed,dimensions:Object.fromEntries(dimensions.map((d,j)=>{
      const valid=Math.floor(analyzed*(.93-((i+j)%5)*.015));
      const count=Math.round(valid*rates[i][j]/100);
      return [d.key,{count,valid,unknown:analyzed-valid,intensity:valid?Math.round((count*(1.35+(i+j)%4*.22)/valid/3)*1000)/10:null}];
    }))};
  });
}
export function measurement(member,key,mode) {
  const d=member.dimensions[key];
  return mode==='count'?d.count:d.valid?d.count/d.valid*100:null;
}
export function ranked(members,key,mode,includeSmall=false) {
  return members.filter(m=>includeSmall||m.dimensions[key].valid>=30)
    .sort((a,b)=>(measurement(b,key,mode)??-1)-(measurement(a,key,mode)??-1)||a.id.localeCompare(b.id));
}

export const examples = [
  {dimension:'support',text:'辛苦了，慢慢來就好，已經比上次進步很多了。',before:'我試了好幾次還是失敗，有點想放棄。',after:'謝謝，我晚點再試試看。',reason:'直接鼓勵對方，並肯定其進步。',score:2},
  {dimension:'respect',text:'我理解你的考量，不過我對這一點有不同看法，可以一起確認嗎？',before:'我覺得目前的方式比較穩定。',after:'可以，你主要擔心哪一部分？',reason:'尊重不同看法，並邀請對方共同確認。',score:2},
  {dimension:'information',text:'我之前也遇過，先確認版本，再清除快取，這兩步做完就恢復了。',before:'更新之後一直讀取失敗，有人遇過嗎？',after:'清掉之後可以了，謝謝。',reason:'提供與問題相關的親身經驗及具體操作步驟，未查證真偽。',score:2},
  {dimension:'constructive',text:'先把錯誤發生的步驟列出來，我們就能確認是哪一段有問題。',before:'大家的結果都不一樣，現在有點混亂。',after:'好，我把流程整理一下。',reason:'提出可執行的釐清方案。',score:2},
  {dimension:'negative',text:'今天真的有夠累，忙了整天結果還是白做。',before:'今天的事情處理得怎麼樣？',after:'先休息一下吧。',reason:'明確表達疲憊與失望，沒有針對他人攻擊。',score:2},
  {dimension:'attack',text:'你根本什麼都不懂，還在這裡裝懂。',before:'我對這個做法還是有疑問。',after:'可以討論問題，不用針對人吧。',reason:'針對對方能力與動機作貶低。',score:2},
  {dimension:'provocation',text:'怎麼，剛剛不是很會講？現在不敢回了？',before:'先停一下，我們都冷靜一點。',after:'你一定要這樣講話嗎？',reason:'在對方提出暫停後，以嘲諷刺激其繼續回應。',score:2},
  {dimension:'escalation',text:'別想就這樣結束，大家都來看他剛才說了什麼。',before:'這件事先到這裡吧，我不想再爭了。',after:'先不要把其他人拉進來。',reason:'延續爭執，並試圖拉其他人參與。',score:2},
];
