import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer, classify, localTime } from '../src/analysis/analysis.js';
import { analyzeFile } from '../src/analysis/importer.js';
import { formatBytes } from '../src/shared/format.js';
import { periodRanking } from '../src/analysis/periods.js';

const message = (overrides = {}) => ({ id: '1', timestamp: Date.parse('2026-11-07T16:00:00Z'), sender: { uid: 'a', name: '小明' }, type: 'text', content: { elements: [{ type: 'text', data: { text: '中文🙂' } }] }, ...overrides });
const file = (text, name = 'test.json', bytes = 7) => {
  const data = new TextEncoder().encode(text);
  return { name, size: data.length, stream: () => new ReadableStream({ start(controller) { for (let i=0;i<data.length;i+=bytes) controller.enqueue(data.slice(i,i+bytes)); controller.close(); } }) };
};
test('UTC+8 midnight / 06:00 boundaries, seconds and milliseconds', () => {
  assert.deepEqual(localTime(Date.parse('2026-11-07T16:00:00Z')), { ms: Date.parse('2026-11-07T16:00:00Z'), day: '2026-11-08', hour: 0, weekday: 6 });
  assert.equal(localTime(Date.parse('2026-11-07T22:00:00Z')).hour, 6);
  assert.equal(localTime(Date.parse('2026-11-07T16:00:00Z') / 1000).day, '2026-11-08');
  assert.equal(localTime(null), null);
  assert.equal(localTime(Infinity), null);
});

test('four UTC+8 periods partition messages at exact boundaries and omit systems from members', () => {
  const a = createAnalyzer({ includeSystem: true });
  for (const t of ['00:00:00', '05:59:59', '06:00:00', '11:59:59', '12:00:00', '17:59:59', '18:00:00', '23:59:59']) {
    a.add(message({ timestamp: Date.parse(`2026-11-08T${t}+08:00`) }));
  }
  a.add(message({ system: true }));
  const r = a.finish();
  assert.deepEqual(r.members[0].periods, [2,2,2,2]);
  assert.equal(r.members[0].periods.reduce((a,b)=>a+b), r.total-r.system);
  assert.equal(r.members[0].periods[0], r.members[0].night);
});

test('weekday and date filters intersect using the UTC+8 calendar day', () => {
  const samples = ['2026-11-07T23:30:00', '2026-11-08T00:00:00', '2026-11-08T05:59:59', '2026-11-08T06:00:00', '2026-11-08T22:29:59', '2026-11-08T22:30:00', '2026-11-09T00:01:00'];
  const a = createAnalyzer({ from: '2026-11-08', weekdays: [6] });
  samples.forEach(t=>a.add(message({ timestamp: Date.parse(`${t}+08:00`) })));
  const r = a.finish();
  assert.equal(r.total, 5);
  assert.deepEqual(r.members[0].periods, [2,1,0,2]);
  assert.equal(r.quality.outsideRange, 1); assert.equal(r.quality.outsideWeekday, 1);
  assert.equal(r.quality.read, r.total+r.quality.outsideRange+r.quality.outsideWeekday);
});

test('file totals aggregate multiple files without including image resources and format binary units', () => {
  const a = createAnalyzer();
  for (const size of [1024, 1024**3]) a.add(message({content:{elements:[{type:'file',data:{filename:'test.zip',size}},{type:'image',data:{size:999999}}],resources:[{type:'file',size}]}}));
  const r=a.finish();
  assert.equal(r.members[0].fileBytes,1024+1024**3);
  assert.equal(r.members[0].elements.file,2);
  assert.equal(formatBytes(0),'0 B'); assert.equal(formatBytes(1023),'1,023 B');
  assert.equal(formatBytes(1024),'1 KiB'); assert.equal(formatBytes(1024**2),'1 MiB');
  assert.equal(formatBytes(1.5*1024**3),'1.5 GiB');
});

test('period pagination reaches all members, handles ties, search and page clamping', () => {
  const members = Array.from({length:43}, (_,i)=>({ id: String(i).padStart(2,'0'), name: `成員 ${i}`, periods: [50-i, i%3, 0, 0] }));
  const seen=[];
  for(let page=0;page<9;page++) seen.push(...periodRanking(members,0,{page,size:5}).rows.map(p=>p.id));
  assert.equal(new Set(seen).size,43); assert.equal(seen.length,43);
  assert.equal(periodRanking(members,0,{page:99,size:5}).page,8);
  assert.equal(periodRanking(members,0,{query:'成員 42',page:8}).page,0);
  assert.equal(periodRanking(members,0,{query:'成員 42'}).count,1);
  assert.equal(periodRanking(members,2).count,0);
  const tied = periodRanking([...members].reverse(),1,{size:20}).rows;
  assert.deepEqual(tied,periodRanking(members,1,{size:20}).rows);
});
test('mixed media: message once, multiple elements, no nested reply/forward or resource double counting', () => {
  const m = message({ content: { elements: [{ type: 'image', data: { subType: 'sticker' } }, { type: 'image', data: { subType: 'photo' } }, { type: 'market_face', data: {} }, { type: 'face', data: {} }, { type: 'file', data: { filename: '資料.PDF', size: 42 } }, { type: 'forward', data: { messages: [message()] } }], resources: [{ type: 'file', size: 42 }] } });
  const a = createAnalyzer(); a.add(m); const r = a.finish();
  assert.equal(r.total, 1); assert.equal(r.elements.sticker, 2); assert.equal(r.elements.image, 1); assert.equal(r.elements.face, 1); assert.equal(r.fileBytes, 42); assert.equal(r.extensions.pdf, 1); assert.deepEqual(r.types, { file: 1 }); assert.equal(r.plain, 0);
});
test('plain text and character counts; unknown types cannot become inherited properties', () => {
  assert.equal(classify(message()).plain, true); assert.equal(classify(message()).chars, 3);
  assert.equal(classify(message({ content: { elements: [{ type: '__proto__' }] } })).primary, 'other');
});
test('filtering, systems, quality reconciliation, streak and order-independent naming', () => {
  const a = createAnalyzer({ from: '2026-11-08', to: '2026-11-10' });
  a.add(message());
  a.add(message({ timestamp: Date.parse('2026-11-09T16:00:00Z'), sender: { uid: 'a', name: '新名字' } }));
  a.add(message({ timestamp: Date.parse('2026-11-08T16:00:00Z') }));
  a.add(message({ system: true })); a.add(message({ timestamp: null })); a.add({});
  a.add(message({ timestamp: Date.parse('2026-11-10T16:00:00Z') }));
  const r = a.finish();
  assert.equal(r.total, 3); assert.equal(r.night, 3); assert.equal(r.members[0].streak, 3); assert.equal(r.members[0].name, '新名字'); assert.equal(r.average, 1);
  assert.equal(r.quality.read, r.total+r.quality.invalid+r.quality.invalidTime+r.quality.outsideRange+r.quality.excludedSystem);
  const b = createAnalyzer({ includeSystem: true }); b.add(message({ system: true }));
  assert.equal(b.finish().system, 1); assert.equal(b.finish().members.length, 0);
});
test('UTF-8 streamed JSON with BOM, arbitrary chunks, escaped braces and nested messages', async () => {
  const m = message({ content: { elements: [{ type: 'text', data: { text: '中文🙂 "messages": [ {} ] \\ ' } }, { type: 'forward', data: { messages: [message()] } }] } });
  const data = '\ufeff'+JSON.stringify({ metadata: { version: '0.1' }, chatInfo: { name: '測試' }, statistics: { totalMessages: 2 }, messages: [m, message()] });
  for (const chunkSize of [1, 7, 65536]) {
    const r = await analyzeFile(file(data, 'test.json', chunkSize));
    assert.equal(r.total, 2); assert.equal(r.expected, 2); assert.equal(r.chat.name, '測試');
  }
});
test('JSONL, final line without newline, empty array and invalid/truncated input', async () => {
  const r = await analyzeFile(file(JSON.stringify(message())+'\r\n'+JSON.stringify(message()), 'chunk.jsonl'));
  assert.equal(r.total, 2);
  assert.equal((await analyzeFile(file('{"messages":[]}'))).total, 0);
  for(const invalid of ['{"messages":[', '{"messages":[{}]}garbage', '{"messages":{}}', '{"chunked":{"format":"jsonl"}}', '{"messages":[{},]}']) await assert.rejects(analyzeFile(file(invalid)));
});

test('member profile distributions reconcile to filtered group statistics', () => {
  const a=createAnalyzer({from:'2026-11-08',to:'2026-11-08'});
  a.add(message({timestamp:Date.parse('2026-11-07T16:00:00Z')}));
  a.add(message({id:'2',timestamp:Date.parse('2026-11-08T00:00:00Z'),recalled:true,content:{elements:[{type:'file',data:{filename:'紀錄.pdf',size:2048}},{type:'text',data:{text:'謝謝'}}]}}));
  a.add(message({id:'3',sender:{uid:'b',name:'乙'},timestamp:Date.parse('2026-11-08T12:00:00Z')}));
  a.add(message({id:'4',timestamp:Date.parse('2026-11-08T16:00:00Z')}));
  const r=a.finish(),p=r.members.find(p=>p.id==='a');
  assert.equal(p.total,2);assert.equal(p.hours.reduce((a,b)=>a+b),2);
  assert.equal(p.heat.flat().reduce((a,b)=>a+b),2);assert.equal(p.daily[0].count,2);assert.equal(p.daily[0].night,1);
  assert.equal(p.extensions.pdf,1);assert.equal(p.types.file,1);assert.equal(p.fileBytes,2048);assert.equal(p.recalled,1);
  assert.equal(r.members.reduce((a,p)=>a+p.daily.reduce((a,d)=>a+d.count,0),0),r.total);
});
