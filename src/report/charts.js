import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { TYPE_LABELS } from '../analysis/analysis.js';
import { formatBytes } from '../shared/format.js';
echarts.use([LineChart, BarChart, PieChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, DataZoomComponent, CanvasRenderer]);
const palette = ['#a28bfa', '#56d8c0', '#7597ff', '#eea4d2', '#e5bd79', '#6998b3', '#cbd5e1'];
const axis = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#8d91a9', fontSize: 11 }, splitLine: { lineStyle: { color: '#262837', type: 'dashed' } } };
const instances = new Map();
export function chartImages() {
  return Object.fromEntries([...instances].map(([id, chart]) => [id, chart.getDataURL({ pixelRatio: 2, backgroundColor: '#141522' })]));
}
const resize = new ResizeObserver(entries => entries.forEach(e => instances.get(e.target.id)?.resize()));
export function clearCharts() {
  resize.disconnect();
  for (const instance of instances.values()) instance.dispose();
  instances.clear();
}
function chart(id, options) {
  const el = document.getElementById(id);
  let instance = instances.get(id);
  if (!instance) { instance = echarts.init(el); instances.set(id, instance); resize.observe(el); }
  instance.setOption({ color: palette, textStyle: { fontFamily: 'Inter, Segoe UI, sans-serif', color: '#cdd0df' }, animationDuration: 450, tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: '#1b1d2d', borderColor: '#3a3d54', textStyle: { color: '#eeefff' }, confine: true }, ...options }, true);
}
export function renderCharts(r, nameOf, rankMetric = 'total', trendMode = 'day') {
  const buckets = new Map();
  if (r.daily.length) {
    const start = Date.parse(r.daily[0].date);
    const lookup = new Map(r.daily.map(d => [d.date, d]));
    // Long histories use observed dates only; normal histories include silent days.
    const dates = r.span <= 20000 ? Array.from({ length: r.span }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10)) : r.daily.map(d => d.date);
    for (const date of dates) {
      const d = lookup.get(date) || { count: 0, night: 0 };
      const key = trendMode === 'month' ? date.slice(0, 7) : date;
      const b = buckets.get(key) || { count: 0, night: 0 }; b.count += d.count; b.night += d.night; buckets.set(key, b);
    }
  }
  chart('trend-chart', {
    grid: { top: 30, left: 52, right: 20, bottom: 65 },
    legend: { top: 0, right: 0, textStyle: { color: '#a8abc2' }, itemWidth: 12, itemHeight: 7 },
    xAxis: { ...axis, type: 'category', data: [...buckets.keys()], boundaryGap: false, axisLabel: { ...axis.axisLabel, formatter: v => v.slice(5) } },
    yAxis: { ...axis, type: 'value', minInterval: 1 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 15, bottom: 6, borderColor: 'transparent', backgroundColor: '#161725', fillerColor: '#a28bfa22', handleStyle: { color: '#a28bfa' }, textStyle: { color: '#8d91a9' } }],
    series: [
      { name: '全部訊息', type: 'line', data: [...buckets.values()].map(d => d.count), showSymbol: false, smooth: .25, lineStyle: { width: 2.5 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#9d80ff55' }, { offset: 1, color: '#9d80ff00' }]) } },
      { name: '凌晨訊息', type: 'line', data: [...buckets.values()].map(d => d.night), showSymbol: false, smooth: .25, lineStyle: { width: 1.5 } },
    ],
  });
  chart('types-chart', {
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
    legend: { bottom: 0, type: 'scroll', textStyle: { color: '#a8abc2' }, itemWidth: 9, itemHeight: 9 },
    series: [{ type: 'pie', radius: ['58%', '80%'], center: ['50%', '44%'], itemStyle: { borderColor: '#141522', borderWidth: 4, borderRadius: 6 }, label: { show: false }, data: Object.entries(r.types).map(([key, value]) => ({ name: TYPE_LABELS[key] || key, value })) }],
  });
  chart('hours-chart', {
    grid: { top: 22, left: 48, right: 12, bottom: 28 },
    xAxis: { ...axis, type: 'category', data: r.hours.map((_, i) => `${i.toString().padStart(2, '0')}:00`), axisLabel: { ...axis.axisLabel, interval: 3 } },
    yAxis: { ...axis, type: 'value', minInterval: 1 },
    series: [{ type: 'bar', barMaxWidth: 17, data: r.hours.map((value, i) => ({ value, itemStyle: { color: i < 6 ? '#a28bfa' : '#56d8c0', borderRadius: [4, 4, 0, 0] } })) }],
  });
  const peak = Math.max(1, ...r.heat.flat());
  chart('heat-chart', {
    grid: { top: 12, bottom: 49, left: 37, right: 12 },
    xAxis: { ...axis, type: 'category', data: Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')), splitArea: { show: false } },
    yAxis: { ...axis, type: 'category', data: ['一', '二', '三', '四', '五', '六', '日'], inverse: true, splitLine: { show: false } },
    visualMap: { min: 0, max: peak, show: false, inRange: { color: ['#202134', '#3e3869', '#7460bb', '#b7a2ff', '#e2d9ff'] } },
    tooltip: { position: 'top', renderMode: 'richText', confine: true, formatter: p => `週${['一', '二', '三', '四', '五', '六', '日'][p.value[1]]} ${p.value[0]}:00–${p.value[0] + 1}:00\n${p.value[2].toLocaleString()} 則訊息` },
    series: [{ type: 'heatmap', data: r.heat.flatMap((row, y) => row.map((v, x) => [x, y, v])), itemStyle: { borderWidth: 4, borderColor: '#141522', borderRadius: 5 }, emphasis: { itemStyle: { borderColor: '#c0adff' } } }],
  });
  const getValue = p => p[rankMetric] ?? p.elements[rankMetric] ?? 0;
  const top = [...r.members].sort((a, b) => getValue(b) - getValue(a)).slice(0, 8).reverse();
  chart('rank-chart', {
    grid: { top: 5, left: 100, right: rankMetric === 'fileBytes' ? 95 : 55, bottom: 10 },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: value => rankMetric === 'fileBytes' ? formatBytes(value) : value.toLocaleString() },
    xAxis: { ...axis, type: 'value', show: false },
    yAxis: { ...axis, type: 'category', data: top.map(nameOf), axisLabel: { color: '#bcc0d5', width: 86, overflow: 'truncate', fontSize: 12 }, splitLine: { show: false } },
    series: [{ type: 'bar', data: top.map(getValue), barMaxWidth: 14, showBackground: true, backgroundStyle: { color: '#212233', borderRadius: 4 }, itemStyle: { borderRadius: 4, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#6551b0' }, { offset: 1, color: '#ae96ff' }]) }, label: { show: true, position: 'right', color: '#cdd0df', formatter: p => rankMetric === 'fileBytes' ? formatBytes(p.value) : p.value.toLocaleString() } }],
  });
  const media = ['image', 'sticker', 'face', 'file', 'video', 'audio'];
  chart('media-chart', {
    grid: { top: 15, left: 54, right: 12, bottom: 32 },
    xAxis: { ...axis, type: 'category', data: media.map(k => TYPE_LABELS[k]), axisLabel: { ...axis.axisLabel, interval: 0 } },
    yAxis: { ...axis, type: 'value', minInterval: 1 },
    series: [{ type: 'bar', barMaxWidth: 33, data: media.map((k, i) => ({ value: r.elements[k] || 0, itemStyle: { color: palette[i], borderRadius: [5, 5, 0, 0] } })) }],
  });
}
