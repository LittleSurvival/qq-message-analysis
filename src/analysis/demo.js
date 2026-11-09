import { createAnalyzer } from './analysis.js';
export function demoReport(filters = {}) {
  const analyzer = createAnalyzer(filters);
  const names = ['小宇', '月亮不睡', '橘子汽水', '阿澄', '浮游生物', 'Yuki', '週末限定', '一顆栗子', 'Mori', '晚風', '藍色耳機', '拾光'];
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const start = Date.UTC(2026, 8, 1) - 8 * 3600000;
  for (let day = 0; day < 61; day++) {
    const count = Math.floor(150 + rand() * 500 + (day > 40 ? 120 : 0));
    for (let i = 0; i < count; i++) {
      const person = Math.floor(rand() ** 1.5 * names.length);
      let hour = Math.floor(rand() * 24);
      if (hour >= 6 && hour < 15 && rand() < .7) hour = 19 + Math.floor(rand() * 5);
      const pick = rand();
      const type = pick < .62 ? 'text' : pick < .79 ? 'image' : pick < .88 ? 'market_face' : pick < .94 ? 'face' : pick < .97 ? 'file' : 'reply';
      analyzer.add({ id: `${day}-${i}`, timestamp: start + day * 86400000 + hour * 3600000 + i * 1000, sender: { uid: `demo-${person}`, name: names[person] }, type, content: { elements: [{ type, data: { text: '今天也有很多值得分享的小事。', subType: rand() < .4 ? 'sticker' : 'photo', filename: '分享.pdf', size: 204800 } }] } });
    }
  }
  return { ...analyzer.finish(), chat: { name: '日常碎片俱樂部', type: 'group' }, source: '內建合成資料', mode: '示範資料', demo: true, expected: null };
}
