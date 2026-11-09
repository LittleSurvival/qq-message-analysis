export const TYPE_LABELS = {
  text: '普通文字', image: '一般圖片', sticker: '表情包', face: 'QQ 表情',
  file: '檔案', video: '影片', audio: '語音', reply: '回覆', at: '提及',
  forward: '合併轉發', json: '分享卡片', other: '其他', system: '系統訊息',
};
const DAY = 86400000;
const OFFSET = 8 * 3600000;
export function localTime(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) return null;
  // QCE uses milliseconds. Also accept Unix seconds from older adapters.
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const d = new Date(ms + OFFSET);
  if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() > 9999) return null;
  return { ms, day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: (d.getUTCDay() + 6) % 7 };
}
export function classify(m) {
  const elements = Array.isArray(m.content?.elements) ? m.content.elements : [];
  const counts = {};
  let chars = 0;
  let bytes = 0;
  const extensions = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const d = element.data || {};
    let t = element.type;
    if (t === 'image' && d.subType === 'sticker' || t === 'market_face') t = 'sticker';
    if (!Object.hasOwn(TYPE_LABELS, t) || t === 'system') t = 'other';
    counts[t] = (counts[t] || 0) + 1;
    if (t === 'text') chars += [...String(d.text ?? '')].length;
    if (t === 'file') {
      if (Number.isFinite(Number(d.size)) && Number(d.size) > 0) bytes += Number(d.size);
      const match = String(d.filename || d.fileName || '').match(/\.([a-zA-Z0-9]{1,12})$/);
      extensions.push(match ? match[1].toLowerCase() : '無副檔名');
    }
  }
  if (!elements.length) {
    const t = Object.hasOwn(TYPE_LABELS, m.type) ? m.type : 'other';
    counts[t] = 1;
    if (t === 'text') chars = [...String(m.content?.text ?? '')].length;
  }
  const tags = Object.keys(counts);
  const plain = tags.length === 1 && tags[0] === 'text';
  // A single exclusive primary category makes the distribution sum to the message total.
  const primary = ['file', 'video', 'audio', 'sticker', 'image', 'face', 'forward', 'json', 'reply', 'at', 'text', 'other'].find(t => counts[t]) || 'other';
  return { counts, chars, bytes, extensions, plain, primary };
}

export function createAnalyzer(filters = {}) {
  const members = new Map();
  const days = new Map();
  const types = {};
  const elements = {};
  const extensions = {};
  const hours = Array(24).fill(0);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const quality = { read: 0, invalid: 0, invalidTime: 0, outsideRange: 0, outsideWeekday: 0, excludedSystem: 0, missingIdentity: 0 };
  let total = 0, system = 0, night = 0, plain = 0, chars = 0, fileBytes = 0, recalled = 0;
  let min = Infinity, max = -Infinity;
  function add(m) {
    quality.read++;
    if (!m || typeof m !== 'object' || !m.content || !m.sender) { quality.invalid++; return; }
    const time = localTime(m.timestamp);
    if (!time) { quality.invalidTime++; return; }
    const { day, hour, weekday, ms } = time;
    if (filters.from && day < filters.from || filters.to && day > filters.to) { quality.outsideRange++; return; }
    if (filters.weekdays?.length && !filters.weekdays.includes(weekday)) { quality.outsideWeekday++; return; }
    const isSystem = m.system === true || m.type === 'system';
    if (isSystem && !filters.includeSystem) { quality.excludedSystem++; return; }
    total++;
    if (isSystem) system++;
    min = Math.min(min, ms); max = Math.max(max, ms);
    hours[hour]++; heat[weekday][hour]++;
    if (!days.has(day)) days.set(day, { date: day, count: 0, night: 0, people: new Set() });
    const daily = days.get(day); daily.count++;
    if (hour < 6) { night++; daily.night++; }
    if (m.recalled) recalled++;
    if (isSystem) { types.system = (types.system || 0) + 1; return; }
    const c = classify(m);
    types[c.primary] = (types[c.primary] || 0) + 1;
    for (const [t, count] of Object.entries(c.counts)) elements[t] = (elements[t] || 0) + count;
    for (const ext of c.extensions) extensions[ext] = (extensions[ext] || 0) + 1;
    if (c.plain) plain++;
    chars += c.chars; fileBytes += c.bytes;
    const s = m.sender;
    const id = String(s.uid || (s.uin && s.uin !== '0' ? s.uin : '') || 'unknown');
    if (id === 'unknown') quality.missingIdentity++;
    const name = String(s.name || s.nickname || (id === 'unknown' ? '未知成員' : id));
    if (!members.has(id)) members.set(id, { id, name, total: 0, plain: 0, night: 0, periods: [0, 0, 0, 0], early: 0, weekend: 0, chars: 0, fileBytes: 0, days: new Set(), daily: {}, hours: Array(24).fill(0), heat: Array.from({length:7},()=>Array(24).fill(0)), types: {}, extensions: {}, recalled: 0, elements: {}, first: ms, last: ms });
    const p = members.get(id);
    if (ms >= p.last) p.name = name;
    p.hours[hour]++; p.heat[weekday][hour]++;
    p.daily[day] ||= {date:day,count:0,night:0}; p.daily[day].count++; p.daily[day].night += Number(hour<6);
    p.types[c.primary] = (p.types[c.primary] || 0) + 1;
    for(const ext of c.extensions) p.extensions[ext] = (p.extensions[ext] || 0) + 1;
    p.recalled += Number(!!m.recalled);
    p.total++; p.plain += Number(c.plain); p.night += Number(hour < 6);
    p.periods[Math.floor(hour / 6)]++;
    p.early += Number(hour >= 6 && hour < 9); p.weekend += Number(weekday >= 5);
    p.chars += c.chars; p.fileBytes += c.bytes; p.days.add(day); daily.people.add(id);
    p.first = Math.min(p.first, ms); p.last = Math.max(p.last, ms);
    for (const [t, count] of Object.entries(c.counts)) p.elements[t] = (p.elements[t] || 0) + count;
  }
  function finish() {
    const people = [...members.values()].map(p => {
      let streak = 0, longest = 0, prev = -Infinity;
      for (const day of [...p.days].sort()) {
        const now = Date.parse(day); streak = now - prev === DAY ? streak + 1 : 1;
        longest = Math.max(longest, streak); prev = now;
      }
      return { ...p, daily: Object.values(p.daily).sort((a,b)=>a.date.localeCompare(b.date)), days: p.days.size, streak: longest, nightRate: p.night / p.total, averageChars: p.chars / p.total };
    }).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, people: d.people.size }));
    const span = daily.length ? Math.round((Date.parse(daily.at(-1).date) - Date.parse(daily[0].date)) / DAY) + 1 : 0;
    return { total, system, night, plain, chars, fileBytes, recalled, types, elements, extensions, hours, heat, members: people, daily, activeDays: daily.length, span, average: span ? total / span : 0, min: total ? min : null, max: total ? max : null, quality, filters, timezone: 'UTC+08:00', schemaVersion: 1 };
  }
  return { add, finish, quality };
}
