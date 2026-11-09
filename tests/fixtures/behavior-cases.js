// Synthetic expectations fixed before local inference. These are regression
// cases, not human-labelled estimates of accuracy on the user's corpus.
const start=Date.parse('2026-11-01T00:00:00+08:00');
const m=(id,hour,who,text,extra={})=>({id,timestamp:start+hour*3600000,member_id:who,name:who,uin:who,text,readable:!!text,type:text?'text':'image',system:false,mentions:[],quoted:[],reply_id:null,...extra});
const single=(id,text,expect,extra={})=>({id,target:'t',messages:[m('t',1,'A',text,extra)],expect});
export const behaviorCases=[
 single('gratitude','謝謝你陪我熬過這段時間，辛苦了！',{support:[1,2,3],respect:[1,2,3],attack:[0]}),
 single('complaint','等了一小時還沒到，真的好失望。',{negative:[1,2,3],attack:[0],provocation:[0]}),
 single('object-criticism','這本書的紙質很差，摸起來粗糙。',{negative:[1,2],attack:[0],provocation:[0]}),
 single('reporting-swear','我最常說的髒話居然是傻叉。',{attack:[0],provocation:[0]}),
 single('abbreviation','mfy什麼時候養貓了？',{attack:[0],provocation:[0]}),
 single('reasoned-disagreement','我不同意這個結論，樣本只包含週末，應補上平日再比較。',{constructive:[1,2,3],attack:[0],provocation:[0]}),
 {id:'reciprocal-banter',target:'t',messages:[m('p',1,'B','哈哈我們又斷了三百天聊天紀錄'),m('t',1.01,'A','笨蛋，出去玩又忘了水群啦（笑）',{reply_id:'p'}),m('r',1.02,'B','哈哈你也是笨蛋，下次一起補回來',{reply_id:'t'})],expect:{attack:[0],provocation:[0],escalation:[0]}},
 {id:'quoted-insult',target:'t',messages:[m('p',0,'B','你這個廢物'),m('t',1,'A','別這樣罵人，好好說話',{reply_id:'p',quoted:[{kind:'reply_preview',text:'你這個廢物',sender:'B',reference_id:'p'}]})],expect:{constructive:[1,2,3],attack:[0],escalation:[0]}},
 {id:'image-missing',target:'t',messages:[m('p',0,'B',''),m('t',1,'A','你好壞',{reply_id:'p'})],expect:{attack:[null],provocation:[null]}},
 {id:'repeated-challenge',target:'t',messages:[m('p',1,'B','不要再拿昨晚吵架的事情來嘲諷我了',{mentions:[{uid:'A'}]}),m('q',3,'A','你氣成這樣，現在滿意了嗎',{reply_id:'p'}),m('t',9,'A','這不是你希望的嗎',{mentions:[{uid:'B'}],reply_id:'p'})],expect:{provocation:[1,2,3],escalation:[1,2,3]}},
 {id:'same-words-neutral',target:'t',messages:[m('p',1,'B','終於買到我想要的那款鍵盤了'),m('t',1.01,'A','這不是你希望的嗎',{reply_id:'p'})],expect:{attack:[0],provocation:[0],escalation:[0]}},
 single('direct-attack','@小明 你就是個沒用的廢物，腦子有問題。',{attack:[2,3],provocation:[1,2,3]},{mentions:[{uid:'B'}]}),
 // Holdout: do not adjust the expected labels after inspecting model output.
 {...single('fiction','這個反派太壞了，作者真的很會寫。',{attack:[0],provocation:[0]}),split:'holdout'},
 {...single('friendly-correction','可能是我理解錯了，你願意再解釋一下第三步嗎？',{respect:[1,2,3],attack:[0],provocation:[0]}),split:'holdout'},
 {id:'self-deprecation',split:'holdout',target:'t',messages:[m('t',1,'A','你們都不如我'),m('r',1.001,'A','我的假期是負二十二天，哈哈')],expect:{attack:[0],provocation:[0]}},
 {id:'sarcasm',split:'holdout',target:'t',messages:[m('p',1,'B','我故意刪了你的報告，你重寫吧'),m('t',1.01,'A','真是謝謝你了，做這種事還覺得自己很厲害？',{reply_id:'p'})],expect:{support:[0],provocation:[1,2,3]}},
 {id:'defensive-boundary',split:'holdout',target:'t',messages:[m('p',1,'B','你就是沒腦子的廢物'),m('t',1.01,'A','我不同意你，請停止辱罵我，我不再回應。',{reply_id:'p'})],expect:{attack:[0],escalation:[0]}},
 {id:'mobilizing-conflict',split:'holdout',target:'t',messages:[m('p',1,'B','這場爭論到此為止，別再來找我'),m('t',1.01,'A','大家快去圍攻他，讓他知道得罪我們的下場',{reply_id:'p'})],expect:{provocation:[2,3],escalation:[2,3]}},
 {...single('link-only','https://example.org/abc',{information:[0,null],respect:[0],attack:[0]}),split:'holdout'},
 {id:'parents-answer',split:'holdout',target:'t',messages:[m('p',1,'B','你們的父母有人是初戀就結婚的嗎'),m('t',1.01,'A','我媽是',{reply_id:'p'})],expect:{attack:[0],provocation:[0]}},
];
