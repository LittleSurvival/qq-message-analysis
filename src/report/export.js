import { formatBytes } from '../shared/format.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');
export function download(content, filename, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function interactiveHTML(payload, file, onProgress = () => {}) {
  let runtime;
  const embedded = document.getElementById('offline-runtime');
  if (embedded) runtime = { js: embedded.textContent, css: document.getElementById('offline-style').textContent };
  else {
    const response = await fetch(`${import.meta.env.BASE_URL}report-runtime.json`);
    if (!response.ok) throw new Error('無法取得離線網頁程式，請確認網站已完整建置。');
    runtime = await response.json();
  }
  const parts = [`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'"><title>QQ 聊天分析報告</title><style id="offline-style">${runtime.css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="app"></div><script type="application/json" id="embedded-report">${safeJSON({ ...payload, sourceFile: file ? { name: file.name, type: file.type } : null })}</script>`];
  if (file) {
    parts.push('<script type="application/json" id="embedded-source">');
    const reader = file.stream().getReader(), decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // A literal '<' can only occur inside strings in valid JSON/JSONL.
        parts.push(decoder.decode(value, { stream: true }).replaceAll('<', '\\u003c'));
        bytes += value.byteLength; onProgress(bytes / file.size);
      }
      parts.push(decoder.decode().replaceAll('<', '\\u003c'));
    } finally { reader.releaseLock(); }
    parts.push('</script>');
  }
  parts.push(`<script id="offline-runtime">${runtime.js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
  return new Blob(parts, { type: 'text/html;charset=utf-8' });
}

export function printDocument(report, images, filterText, columns) {
  const e = escapeHTML, number = v => Number(v || 0).toLocaleString('zh-TW');
  const headings = { 'trend-chart': '訊息數趨勢', 'types-chart': '訊息類型占比', 'hours-chart': '每小時訊息數', 'heat-chart': '星期 × 小時訊息數', 'rank-chart': '成員排行（目前選擇的指標）', 'media-chart': '各類媒體數量' };
  const table = (headers, rows) => `<table><thead><tr>${headers.map(v => `<th>${e(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${e(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>QQ 聊天分析報告</title><style>
    @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:10pt "Microsoft JhengHei","Noto Sans CJK TC",sans-serif;color:#202033;margin:0}h1{font-size:22pt;margin:0 0 4mm}h2{font-size:15pt;margin:6mm 0 3mm}p{line-height:1.6;overflow-wrap:anywhere}.stats{display:flex;gap:5mm;margin:5mm 0}.stats div{flex:1;border:1px solid #dedde8;border-radius:3mm;padding:4mm}.stats b{display:block;font-size:19pt;color:#57429a}.charts{display:grid;grid-template-columns:1fr 1fr;gap:5mm}.chart{break-inside:avoid;border:1px solid #ddd;padding:3mm;margin:0}.chart h2{font-size:12pt;margin:0 0 2mm}.chart img{width:100%;height:68mm;object-fit:contain;background:#141522;print-color-adjust:exact;-webkit-print-color-adjust:exact}.section{break-before:page}.notes{break-inside:avoid}h2{break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8.5pt}th,td{padding:2.4mm;border-bottom:1px solid #ddd;text-align:right;overflow-wrap:anywhere}th{background:#eeeaf7;print-color-adjust:exact}th:first-child,td:first-child{text-align:left;width:47mm}thead{display:table-header-group}tr{break-inside:avoid}.muted{color:#666}dl{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}dt{font-weight:bold}dd{margin:0}
  </style></head><body><h1>${e(report.chat.name || '聊天記錄')} · 統計報告</h1><p>${e(filterText)}<br>來源：${e(report.source)}<br>匯出時間：${e(new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }))}（UTC+8）</p>
  <div class="stats">${[['訊息總數',number(report.total)],['發言成員',number(report.members.length)],['檔案項數',number(report.elements.file)],['檔案總大小',formatBytes(report.fileBytes)]].map(([label,value]) => `<div>${label}<b>${value}</b></div>`).join('')}</div>
  <p class="muted">圖表保留目前的趨勢與排行選擇；下方明細包含目前日期與星期篩選範圍的全部成員，不受搜尋或分頁限制。</p>
  <div class="charts">${Object.entries(images).map(([id,src]) => `<figure class="chart"><h2>${headings[id]}</h2><img src="${src}" alt="${headings[id]}"></figure>`).join('')}</div>
  <section class="section"><h2>完整成員統計（${number(report.members.length)} 人）</h2>${table(['成員',...columns.map(c=>c[1])],report.members.map(p=>[p.name,...columns.map(([key])=>key==='fileBytes'?formatBytes(p.fileBytes):number(p[key]??p.elements[key]))]))}</section>
  <section class="section"><h2>各時段成員訊息數</h2><p>東八區；凌晨 00–06、上午 06–12、下午 12–18、晚間 18–24，均不含結束時間。</p>${table(['成員','凌晨','上午','下午','晚間'], report.members.map(p=>[p.name,...p.periods.map(number)]))}</section>
  <h2>檔案副檔名</h2>${table(['副檔名','項數'],Object.entries(report.extensions).sort((a,b)=>b[1]-a[1]).map(([key,count])=>[`.${key}`,number(count)]))}
  <section class="notes"><h2>資料品質與統計定義</h2><p>讀取 ${number(report.quality.read)} 筆；無效格式 ${number(report.quality.invalid)} 筆；無效時間 ${number(report.quality.invalidTime)} 筆；缺少成員 ID ${number(report.quality.missingIdentity)} 筆。${report.expected == null ? '' : `來源宣告 ${number(report.expected)} 筆。`}</p><p>普通文字只計僅含 text 元素的訊息。媒體與表情按元素項數計算；轉發內容與回覆預覽不展開。不自動去重。檔案大小只加總 file 元素已提供的大小，未提供大小的檔案不計入容量。報告只反映選取檔案與目前篩選範圍。</p></section></body></html>`;
}

let printFrame;
export async function printPDF(html) {
  printFrame?.remove();
  const frame = document.createElement('iframe'); printFrame = frame;
  frame.title = 'PDF 報告列印'; frame.style.cssText = 'position:fixed;left:-10000px;width:1200px;height:800px;border:0';
  const loaded = new Promise(resolve => { frame.onload = resolve; });
  frame.srcdoc = html; document.body.append(frame); await loaded;
  await frame.contentDocument.fonts.ready;
  await Promise.all([...frame.contentDocument.images].map(img => img.decode()));
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  frame.contentWindow.focus(); frame.contentWindow.print();
}
