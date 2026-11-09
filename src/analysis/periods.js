export const PERIODS = [
  { id: 'night', label: '凌晨', from: 0, to: 360, range: '00:00–06:00', icon: 'moon', color: '#b69af7', tint: '#7651a32b' },
  { id: 'morning', label: '上午', from: 360, to: 720, range: '06:00–12:00', icon: 'sunrise', color: '#f2c57a', tint: '#b7863026' },
  { id: 'afternoon', label: '下午', from: 720, to: 1080, range: '12:00–18:00', icon: 'sun', color: '#75d7c6', tint: '#398f8026' },
  { id: 'evening', label: '晚間', from: 1080, to: 1440, range: '18:00–24:00', icon: 'sunset', color: '#efa1b0', tint: '#a64c6826' },
];

export function periodRanking(members, period, { query = '', nameOf = p => p.name, page = 0, size = 5 } = {}) {
  const rows = members.filter(p => p.periods[period] > 0 && nameOf(p).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => b.periods[period] - a.periods[period] || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.max(0, Math.min(page, pages - 1));
  return { rows: rows.slice(current * size, (current + 1) * size), count: rows.length, pages, page: current, offset: current * size, max: rows[0]?.periods[period] || 0 };
}
