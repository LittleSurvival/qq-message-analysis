import {avatarMarkup,installAvatarFallback,anonymousMember} from '../shared/avatars.js';
import './style.css';
import { formatBytes } from '../shared/format.js';
import { PERIODS, periodRanking } from '../analysis/periods.js';
import { renderCharts, clearCharts, chartImages } from './charts.js';
import { createAnalysisWorker } from '../analysis/worker-factory.js';
import { download, interactiveHTML, printDocument, printPDF } from './export.js';
installAvatarFallback(document);
const $ = id => document.getElementById(id);
const n = value => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const MEMBER_COLUMNS = [['total','訊息'],['chars','總字數'],['plain','普通文字'],['file','檔案'],['fileBytes','檔案總大小'],['image','圖片'],['sticker','表情包'],['face','QQ 表情'],['night','凌晨訊息'],['days','活躍天數']];
const pct = value => `${(value * 100).toFixed(1)}%`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, size = 20) => {
  const paths = {
    scope: '<rect x="3" y="3" width="18" height="18" rx="6"/><path d="M8 15v-3m4 3V8m4 7v-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
    media: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 3-3 6 5"/>',
    moon: '<path d="M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z"/>',
    sunrise: '<path d="M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v7m-3-4 3-3 3 3M3 11l2 2m14 0 2-2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    sunset: '<path d="M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v7m-3-3 3 3 3-3M3 11l2 2m14 0 2-2"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    message: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
    text: '<path d="M5 5h14M5 10h14M5 15h14M5 20h9"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
};
document.querySelector('#app').innerHTML = `
<aside class="sidebar">
  <a class="brand" href="#overview"><span class="brand-icon">${icon('scope', 28)}</span><span>QQ 聊天分析</span></a>
  <div class="nav-caption">報告</div>
  <nav aria-label="主要導覽">
    <a class="active" href="#overview">${icon('grid')}總覽儀表板<span class="nav-dot"></span></a>
    <a href="#rhythm">${icon('clock')}發言時間分布</a>
    <a href="#people">${icon('people')}成員統計</a>
    <a href="#media">${icon('media')}媒體與檔案</a>
    <a href="#afterhours">${icon('clock')}時段發言排行</a>
  </nav>
  <div class="sidebar-bottom"><div class="local-card">${icon('shield')}<strong>統計在瀏覽器處理</strong><p>語料分析會送至你設定的模型。</p></div><a class="source-link" href="https://github.com/shuakami/qq-chat-exporter" target="_blank" rel="noreferrer">相容 QQ Chat Exporter ↗</a><span class="version">QQ 聊天分析 <span>v1.0</span></span></div>
</aside>
<main>
  <header class="topbar"><div class="breadcrumb">聊天分析報告</div><span class="timezone">${icon('clock', 14)} UTC +08:00</span><button id="clear" class="text-button">關閉報告</button></header>
  <div class="content">
    <section id="overview" class="intro"><div><h1>QQ 聊天記錄統計</h1></div><div class="intro-actions"><button class="button" id="demo">查看示範</button><button class="button primary" id="import-top">${icon('upload', 17)}匯入聊天記錄</button></div></section>
    <section id="dropzone" class="upload-zone" aria-label="匯入聊天檔案"><div class="upload-icon">${icon('upload', 23)}</div><div class="upload-copy"><strong>拖曳 JSON 檔案至此，或點選「選擇檔案」</strong><p>支援 QQ Chat Exporter 的單檔 .json 或單個 .jsonl 分塊</p></div><button id="choose" class="button subtle">選擇檔案 ${icon('arrow', 16)}</button><input id="file" type="file" accept=".json,.jsonl,.ndjson,application/json" hidden></section>
    <section id="progress-panel" class="progress-panel" hidden><div><span id="progress-text" role="status">正在分析…</span><button class="text-button" id="cancel">取消分析</button></div><progress id="progress" max="100" value="0"></progress></section>
    <div id="notice" class="notice" role="status" hidden></div>
    <div id="report" hidden>
      <section class="dataset-bar"><div class="dataset-name"><span class="dataset-icon">${icon('message', 18)}</span><div><strong id="chat-name">正在載入報告</strong><small id="source-name">本地分析</small></div><span class="badge" id="mode">示範資料</span></div><div class="dataset-actions"><label class="check"><input type="checkbox" id="anonymous">匿名顯示</label><button id="export-json" class="button small">${icon('download', 15)}匯出報告</button></div></section>
      <form id="filters" class="filters">
        <div class="filter-row"><span class="filter-label">統計日期</span><label><span class="sr-only">開始日期</span><input id="from" type="date"></label><span class="date-dash">—</span><label><span class="sr-only">結束日期</span><input id="to" type="date"></label><label class="check system-toggle"><input type="checkbox" id="system">含系統訊息</label></div>
        <div class="filter-row"><label class="filter-field">星期<select id="weekdays"><option value="all">每天</option><option value="workdays">週一至週五</option><option value="weekends">週六、週日</option>${['一','二','三','四','五','六','日'].map((d,i)=>`<option value="${i}">週${d}</option>`).join('')}</select></label><button type="submit" class="button small">套用篩選</button><button type="button" id="reset-filter" class="text-button">重設篩選</button></div>
      </form>
      <p id="applied-filters" class="applied-filters" role="status"></p>
      <div class="stats" id="stats"></div>
      <div class="section-heading"><h2>訊息統計</h2><span class="muted" id="range-label"></span></div>
      <section class="overview-grid"><article class="panel trend-panel"><div class="panel-heading"><div><h3>訊息數趨勢</h3></div><div class="segmented" aria-label="趨勢粒度"><button class="selected" data-trend="day">每日</button><button data-trend="month">每月</button></div></div><div id="trend-chart" class="chart trend" role="img" aria-label="每日或每月訊息數與凌晨訊息數折線圖"></div></article><article class="panel types-panel"><div class="panel-heading"><div><h3>訊息類型占比</h3><p>依主要類型，每則只計一次</p></div></div><div class="donut-wrap"><div id="types-chart" class="chart donut" role="img" aria-label="訊息主要類型圓環圖"></div><div class="donut-center"><strong id="type-count">0</strong><span>種訊息類型</span></div></div></article></section>
      <div id="rhythm" class="section-heading"><h2>發言時間分布</h2><span class="muted">所有時間皆為東八區</span></div>
      <section class="two-grid"><article class="panel"><div class="panel-heading"><div><h3>每小時訊息數</h3></div><span class="legend-dot">凌晨時段</span></div><div id="hours-chart" class="chart medium" role="img" aria-label="0 至 23 點訊息分布長條圖"></div></article><article class="panel"><div class="panel-heading"><div><h3>星期 × 小時訊息數</h3></div><div class="heat-legend">少 <i></i><i></i><i></i><i></i> 多</div></div><div id="heat-chart" class="chart medium" role="img" aria-label="週一至週日每小時訊息數熱力圖"></div></article></section>
      <div id="people" class="section-heading"><h2>成員統計</h2><span class="muted">只統計實際發言的成員</span></div>
      <section class="two-grid people-grid"><article class="panel"><div class="panel-heading"><div><h3>成員排行（前 8 名）</h3></div><label><span class="sr-only">排行指標</span><select id="rank-metric"><option value="total">總訊息數</option><option value="plain">普通文字</option><option value="sticker">表情包項數</option><option value="file">檔案項數</option><option value="fileBytes">檔案總大小</option><option value="night">凌晨訊息</option><option value="chars">總字數</option></select></label></div><div id="rank-chart" class="chart rank" role="img" aria-label="所選指標的前八名成員排行"></div></article><article class="panel awards-panel"><div class="panel-heading"><div><h3>各項統計第一名</h3></div>${icon('spark')}</div><div id="awards" class="awards"></div></article></section>
      <article class="panel table-panel"><div class="panel-heading"><div><h3>成員統計明細 <span id="member-count" class="count-pill"></span></h3><p>點選欄位名稱排序</p></div><div class="table-controls"><label><span class="sr-only">搜尋成員</span><input id="search" type="search" placeholder="搜尋成員…"></label><button class="button small" id="export-csv">${icon('download', 15)} CSV</button></div></div><div class="table-scroll"><table class="member-table"><colgroup><col class="member-name-col">${MEMBER_COLUMNS.map(([key])=>`<col${key === 'fileBytes' ? ' class="file-size-col"' : ''}>`).join('')}</colgroup><thead><tr><th>成員</th>${MEMBER_COLUMNS.map(([k,v]) => `<th><button data-sort="${k}">${v}<span class="sort-arrow" aria-hidden="true"></span></button></th>`).join('')}</tr></thead><tbody id="members"></tbody></table></div><div class="table-footer"><span id="table-info"></span><div><button id="prev" class="button small">上一頁</button><button id="next" class="button small">下一頁</button></div></div></article>
      <div id="media" class="section-heading"><h2>媒體與檔案統計</h2><span class="muted">依元素計數，一則訊息可含多個媒體</span></div>
      <section class="two-grid"><article class="panel"><div class="panel-heading"><div><h3>各類媒體數量</h3></div>${icon('media')}</div><div id="media-chart" class="chart medium" role="img" aria-label="圖片、表情包、QQ 表情、檔案、影片與語音項數比較"></div></article><article class="panel"><div class="panel-heading"><div><h3>檔案數量與副檔名</h3></div></div><div id="file-summary"></div><div id="extensions" class="extensions"></div></article></section>
      <div id="afterhours" class="section-heading"><h2>時段發言排行</h2><span class="muted">套用上方篩選；僅計成員訊息</span></div>
      <section id="period-panel" class="period-panel" aria-label="時段發言排行">
        <div class="period-summary">
          <button id="period-switch" class="period-switch" type="button" aria-describedby="period-switch-help" aria-label="目前凌晨，點擊切換上午">
            <svg class="period-ring" viewBox="0 0 100 100" aria-hidden="true">${[0,90,180,270].map(angle=>`<path class="ring-track" d="M53.66 8.16 A42 42 0 0 1 91.84 46.34" transform="rotate(${angle} 50 50)"/>`).join('')}<g id="period-indicator"><path d="M53.66 8.16 A42 42 0 0 1 91.84 46.34"/></g></svg>
            <span id="period-icon">${icon('moon',32)}</span>
          </button>
          <span id="period-switch-help">點擊圖示切換時段</span>
          <div id="period-description" aria-live="polite" aria-atomic="true"><h3 id="period-title">凌晨發言排行</h3><p id="period-range">00:00–06:00 · UTC+8</p></div>
          <div class="period-total"><strong id="period-total">0</strong><span>則成員訊息</span></div><p id="period-rate"></p>
          <div class="period-sequence" aria-hidden="true">${PERIODS.map((p,i)=>`<span data-period-label="${i}">${p.label}</span>`).join('')}</div>
        </div>
        <div class="period-results"><div class="period-controls"><label><span class="sr-only">搜尋時段排行成員</span><input id="period-search" type="search" placeholder="搜尋成員…"></label><label>每頁<select id="period-size"><option value="5">5 人</option><option value="10">10 人</option><option value="20">20 人</option></select></label></div><div id="period-ranking" class="period-ranking"></div><div class="period-pagination"><span id="period-info" role="status"></span><div><button id="period-prev" class="button small">上一頁</button><label>第 <input id="period-page" type="number" min="1" value="1" aria-label="時段排行頁碼"> 頁</label><button id="period-next" class="button small">下一頁</button></div></div></div>
      </section>
      <details class="method panel"><summary>統計定義與資料品質 <span>展開說明 ＋</span></summary><div id="quality"></div><p>總訊息預設排除系統訊息。普通文字只計僅含 text 元素的訊息；圖文、回覆和提及不列入普通文字。媒體與表情排行榜按元素項數計算；貼圖為 image.subType=sticker 或 market_face，QQ 小表情為 face。未標記 sticker 的圖片保留在一般圖片。</p><p>圓環圖的主要類型優先序：檔案 → 影片 → 語音 → 表情包 → 圖片 → QQ 表情 → 轉發 → 分享 → 回覆 → 提及 → 文字 → 其他。轉發內容與回覆預覽不展開計數；不根據撤回系統提示推測原始訊息。未知類型歸入其他。檔案總大小加總 file 元素中已提供的大小，不重複計入 resources；以 B、KiB、MiB、GiB 顯示，排序使用原始位元組數。</p><p>時間以 timestamp 換算固定 UTC+8。凌晨為 00:00–06:00、上午 06:00–12:00、下午 12:00–18:00、晚間 18:00–24:00，均不含結束時間。早鳥為 06:00–09:00。日期與星期依訊息實際的東八區日期判定。時段排行僅切換目前篩選結果的分組，不會改動全站篩選；個人占比的分母為該成員通過目前篩選的全部訊息。日均以首末日期間的日曆天數計算，包含無訊息日。成員依 uid（其次 uin）合併，顯示所選期間最後的名稱；無 ID 的訊息合併到未知成員。報告反映選取檔案，不代表完整群聊歷史。單次分析一個檔案，不自動去重。</p><p>${document.getElementById('embedded-report')?'此離線檔保存匯出的統計與選擇附帶的原始檔':'原始檔與語料結果保存在此瀏覽器'}，不載入聊天內的 HTML 或外部圖片網址；頭像只讀取匯出檔內嵌的 base64 圖片。匯出的報告可能包含成員名稱，分享前可開啟匿名顯示。JSONL 可單獨分析一個分塊；manifest 或 ZIP 請改匯出單檔 JSON。</p></details>
    </div>
    <footer><span>QQ 聊天分析</span><span>${icon('shield', 13)} 統計在本機，語料送至所選模型</span></footer>
  </div>
</main>
<dialog id="export-panel" aria-labelledby="export-title">
  <form id="export-form">
    <div class="export-heading"><h2 id="export-title">匯出報告</h2><button type="button" id="export-close" class="text-button" aria-label="關閉匯出面板">✕</button></div>
    <div class="export-formats">
      <label><input type="radio" name="format" value="json" checked><span><strong>JSON</strong><small>完整統計資料，供程式讀取。</small></span></label>
      <label><input type="radio" name="format" value="pdf"><span><strong>PDF</strong><small>圖表與全部成員明細；在列印視窗選「另存為 PDF」。</small></span></label>
      <label><input type="radio" name="format" value="csv"><span><strong>CSV</strong><small>全部成員統計，可用 Excel 開啟。</small></span></label>
      <label><input type="radio" name="format" value="html"><span><strong>互動 HTML</strong><small>單一離線網頁，保留圖表、搜尋、排序、分頁與時段切換。</small></span></label>
    </div>
    <div id="html-options" hidden><label class="check"><input type="checkbox" id="include-source">包含原始聊天檔</label><p id="source-option-help"></p></div>
    <p id="export-scope"></p><p id="export-status" role="status" aria-live="polite"></p>
    <div class="export-actions"><button type="button" class="button" id="export-cancel">取消</button><button type="submit" class="button primary" id="export-submit">下載 JSON</button></div>
  </form>
</dialog>`;

let report, currentFile = null, worker, trendMode = 'day', rankMetric = 'total', page = 0, sortKey = 'total', sortDir = -1;
let aliases = new Map();
let snapshotOnly = false;
let periodIndex = 0, periodPage = 0, periodTurns = 0;
const nameOf = p => $('anonymous').checked ? aliases.get(p.id) : p.name;
function notify(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = !message; }
function setBusy(value) {
  $('progress-panel').hidden = !value; $('report').classList.toggle('loading', value);
  $('report').inert = value;
  for (const el of document.querySelectorAll('#filters input, #filters select, #filters button, #export-json, #export-csv')) el.disabled = value || !report || (snapshotOnly && el.closest('#filters'));
}
function filters() {
  const weekday = $('weekdays').value;
  return { from: $('from').value, to: $('to').value, includeSystem: $('system').checked,
    weekdays: weekday === 'all' ? [] : weekday === 'workdays' ? [0,1,2,3,4] : weekday === 'weekends' ? [5,6] : [Number(weekday)],
  };
}
function resetFilters() {
  $('from').value=''; $('to').value=''; $('weekdays').value='all'; $('system').checked=false;
}
function filterDescription(f) {
  const days = f.weekdays?.length ? f.weekdays.map(d=>`週${'一二三四五六日'[d]}`).join('、') : '每天';
  return `已套用：${f.from || '不限起日'} 至 ${f.to || '不限迄日'} · ${days} · ${f.includeSystem ? '含系統訊息' : '排除系統訊息'} · UTC+8`;
}
function start(file = currentFile) {
  if (snapshotOnly && arguments.length === 0) return;
  const f = filters();
  if (f.from && f.to && f.from > f.to) { notify('開始日期不能晚於結束日期。', true); return; }
  worker?.terminate();
  setBusy(true); notify(''); $('progress').value = 0; $('progress-text').textContent = '正在分析聊天記錄…';
  worker = createAnalysisWorker();
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      const percent = data.size ? Math.min(100, data.bytes / data.size * 100) : 0;
      $('progress').value = percent; $('progress-text').textContent = `正在分析 ${percent.toFixed(0)}% · 已讀取 ${n(data.messages)} 則 · ${(data.bytes / 1048576).toFixed(1)} MB`;
    } else if (data.type === 'done') {
      snapshotOnly = false; currentFile = file; report = data.report; aliases = new Map(report.members.map((p, i) => [p.id, `成員 ${String(i + 1).padStart(3, '0')}`]));
      page = 0; periodPage = 0; setBusy(false); render(); worker.terminate();
      if (!report.total) notify('這個區間沒有可分析的訊息，請調整日期或檢查資料品質。');
    } else if (data.type === 'error') { setBusy(false); notify(`${data.message}${report ? ' 原有報告仍保留。' : ''}`, true); worker.terminate(); }
  };
  worker.onerror = () => { setBusy(false); notify('分析程序無法執行，請透過本地 HTTP 伺服器或 GitHub Pages 開啟，並使用支援 Worker 的瀏覽器。', true); worker.terminate(); };
  worker.postMessage({ file, filters: f });
}
export function getAnalysisContext() { return {report, file:currentFile, nameOf}; }
export function openStoredFile(file) { start(file); }
function render() {
  $('report').hidden = false;
  const r = report;
  $('applied-filters').textContent = filterDescription(r.filters);
  $('chat-name').textContent = $('anonymous').checked ? '匿名聊天報告' : r.chat.name || '聊天記錄';
  $('source-name').textContent = $('anonymous').checked ? '本地檔案 · 隱藏來源名稱' : r.source;
  $('mode').textContent = r.mode; $('mode').classList.toggle('real', !r.demo);
  $('range-label').textContent = r.daily.length ? `${r.daily[0].date} — ${r.daily.at(-1).date}` : '無訊息';
  const stats = [
    ['message', '總訊息數', n(r.total), `${r.filters.includeSystem ? `含 ${n(r.system)} 則系統訊息` : '已排除系統訊息'}`, 'violet'],
    ['text', '總字數', n(r.chars), '', 'amber'],
    ['people', '發言成員數', n(r.members.length), `有訊息的日期：${n(r.activeDays)} 天`, 'mint'],
    ['media', '表情包數量', n(r.elements.sticker), '自訂貼圖 + 商城表情 · 項數', 'pink'],
    ['moon', '凌晨訊息數', n(r.night), `占所選訊息 ${pct(r.total ? r.night / r.total : 0)}`, 'blue'],
  ];
  $('stats').innerHTML = stats.map(([ic,label,value,sub,color]) => `<article class="stat ${color}"><div class="stat-label">${label}<span>${icon(ic,18)}</span></div><strong>${value}</strong>${sub?`<p>${sub}</p>`:''}</article>`).join('');
  $('type-count').textContent = Object.keys(r.types).length;
  renderCharts(r, nameOf, rankMetric, trendMode);
  const awards = [['early', '早晨訊息最多（06:00–09:00）', 'clock', '則'], ['streak', '連續發言天數最長', 'spark', '天'], ['chars', '累計文字字數最多', 'message', '字'], ['sticker', '表情包發送數最多', 'media', '項']];
  $('awards').innerHTML = awards.map(([key, title, ic, unit]) => {
    const win = [...r.members].sort((a,b) => metric(b,key)-metric(a,key))[0];
    const value = win ? metric(win,key) : 0;
    return `<div class="award"><span class="award-icon">${icon(ic)}</span><div><small>${title}</small><strong>${value ? avatarMarkup(win,nameOf(win),{anonymous:$('anonymous').checked})+esc(nameOf(win)) : '尚無紀錄'}</strong></div><b>${n(value)}<small>${unit}</small></b></div>`;
  }).join('');
  renderTable();
  $('file-summary').innerHTML = `<div class="file-totals"><div><strong>${n(r.elements.file)}</strong><span>分享檔案 · 項</span></div><div><strong>${formatBytes(r.fileBytes)}</strong><span>檔案宣告大小合計</span></div><div><strong>${n(r.elements.reply)}</strong><span>回覆 · 項</span></div></div>`;
  const ext = Object.entries(r.extensions).sort((a,b)=>b[1]-a[1]);
  $('extensions').innerHTML = ext.length ? ext.slice(0,5).map(([key,v]) => `<div class="extension"><span>.${esc(key)}</span><div><i style="width:${v / ext[0][1] * 100}%"></i></div><b>${n(v)}</b></div>`).join('') : '<p class="empty">所選區間沒有檔案。</p>';
  renderPeriod();
  const q = r.quality;
  $('quality').innerHTML = `<div class="quality-grid"><span>讀取紀錄 <b>${n(q.read)}</b></span><span>格式無效 <b>${n(q.invalid)}</b></span><span>時間無效 <b>${n(q.invalidTime)}</b></span><span>日期外 <b>${n(q.outsideRange)}</b></span><span>星期不符 <b>${n(q.outsideWeekday)}</b></span><span>排除系統 <b>${n(q.excludedSystem)}</b></span><span>缺少成員 ID <b>${n(q.missingIdentity)}</b></span></div><p>${r.expected == null ? '來源沒有提供總筆數，或為 JSONL 分塊。' : `來源宣告 ${n(r.expected)} 則；實際讀取 ${n(q.read)} 則${r.expected === q.read ? '，筆數一致。' : '，筆數不一致，請檢查匯出檔。'}`}</p>`;
  window.dispatchEvent(new CustomEvent("statistics-applied", {detail:getAnalysisContext()}));
}
function renderPeriod(animate = false) {
  const period = PERIODS[periodIndex], next = PERIODS[(periodIndex+1)%PERIODS.length];
  const panel = $('period-panel');
  panel.style.setProperty('--period-color', period.color); panel.style.setProperty('--period-tint', period.tint);
  $('period-switch').setAttribute('aria-label', `目前${period.label}，點擊切換${next.label}`);
  $('period-switch').title = `點擊切換至${next.label}（${next.range}）`;
  $('period-indicator').style.transform = `rotate(${periodTurns*90}deg)`;
  $('period-icon').innerHTML = icon(period.icon,32);
  $('period-title').textContent = `${period.label}發言排行`;
  $('period-range').textContent = `${period.range} · UTC+8`;
  document.querySelectorAll('[data-period-label]').forEach(el=>el.classList.toggle('active', Number(el.dataset.periodLabel)===periodIndex));
  const total = report.members.reduce((sum,p)=>sum+p.periods[periodIndex],0);
  const memberTotal = report.total-report.system;
  $('period-total').textContent = n(total);
  $('period-rate').textContent = `占目前篩選的成員訊息 ${pct(memberTotal ? total/memberTotal : 0)}`;
  const size = Number($('period-size').value);
  const ranking = periodRanking(report.members, periodIndex, { query: $('period-search').value, nameOf, page: periodPage, size });
  periodPage = ranking.page;
  $('period-ranking').innerHTML = ranking.rows.length ? ranking.rows.map((p,i)=>{
    const count = p.periods[periodIndex];
    return `<div class="night-row"><span class="rank-no">${String(ranking.offset+i+1).padStart(2,'0')}</span>${avatarMarkup(p,nameOf(p),{anonymous:$('anonymous').checked,className:`avatar tone-${i%4}`})}<div class="night-person"><strong>${esc(nameOf(p))}</strong><small>占個人篩選後訊息 ${pct(count/p.total)}</small><div class="night-track"><i style="width:${count/ranking.max*100}%"></i></div></div><b>${n(count)}<small>則</small></b></div>`;
  }).join('') : `<p class="empty">${ranking.count === 0 && $('period-search').value ? '沒有符合搜尋條件的成員。' : `目前篩選範圍沒有${period.label}發言成員。`}</p>`;
  $('period-info').textContent = `${n(ranking.count)} 位成員 · 第 ${periodPage+1} / ${ranking.pages} 頁`;
  $('period-page').value = periodPage+1; $('period-page').max = ranking.pages;
  $('period-prev').disabled = periodPage === 0; $('period-next').disabled = periodPage >= ranking.pages-1;
  $('period-icon').getAnimations().forEach(a=>a.cancel());
  $('period-ranking').getAnimations().forEach(a=>a.cancel());
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('period-icon').animate([{ opacity: 0, transform: 'translateY(8px) rotate(-30deg) scale(.7)' }, { opacity: 1, transform: 'translateY(0) rotate(0) scale(1)' }], { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' });
    $('period-ranking').animate([{ opacity: .2, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280 });
  }
}
function metric(p,key) { return p[key] ?? p.elements[key] ?? 0; }
function renderTable() {
  const term = $('search').value.toLocaleLowerCase();
  const rows = report.members.filter(p=>nameOf(p).toLocaleLowerCase().includes(term)).sort((a,b)=>sortDir*(metric(a,sortKey)-metric(b,sortKey)) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(rows.length / 12)); page = Math.min(page,pages-1);
  $('member-count').textContent = n(report.members.length);
  $('members').innerHTML = rows.slice(page*12,page*12+12).map((p,i)=>`<tr><td><button type="button" class="person-cell cp-member" data-open-profile="${esc(p.id)}">${avatarMarkup(p,nameOf(p),{anonymous:$('anonymous').checked,className:`avatar tone-${i%4}`})}<span title="${esc(nameOf(p))}">${esc(nameOf(p))}</span></button></td>${MEMBER_COLUMNS.map(([k])=>`<td${k === 'fileBytes' ? ` title="${n(p.fileBytes)} bytes"` : ''}>${k === 'fileBytes' ? formatBytes(p.fileBytes) : n(metric(p,k))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${MEMBER_COLUMNS.length+1}" class="empty">沒有符合條件的成員</td></tr>`;
  $('table-info').textContent = `${n(rows.length)} 位成員 · 第 ${page+1} / ${pages} 頁 · 媒體以項數計算`;
  $('prev').disabled = page === 0; $('next').disabled = page >= pages-1;
  document.querySelectorAll('[data-sort]').forEach(el => {
    const active = el.dataset.sort === sortKey;
    el.parentElement.setAttribute('aria-sort', active ? sortDir === -1 ? 'descending' : 'ascending' : 'none');
    el.querySelector('.sort-arrow').textContent = active ? sortDir === -1 ? '↓' : '↑' : '';
    el.title = active ? `${sortDir === -1 ? '目前由大到小；點擊改為由小到大' : '目前由小到大；點擊改為由大到小'}` : '點擊由大到小排序';
  });
}
function reportSnapshot() {
  if (!report) return;
  const result = structuredClone(report);
  if ($('anonymous').checked) {
    result.redacted = true; result.chat = { name: '匿名聊天報告' }; result.source = '本地檔案';
    result.members = result.members.map(p=>anonymousMember(p,aliases.get(p.id)));
  }
  result.generatedAt = new Date().toISOString();
  result.periodDefinitions = PERIODS.map(({ id, label, range })=>({ id, label, range }));
  result.definitions = { night: '00:00 <= UTC+8 time < 06:00', media: 'element counts; nested forwarded messages excluded', plain: 'text-only messages', duplicatePolicy: 'no deduplication' };
  return result;
}
function exportCSV() {
  const keys = ['total','plain','file','image','sticker','face','video','audio','reply','night','nightRate','early','weekend','days','streak','chars','fileBytes'];
  const cell = v => `"${String(v).replace(/^[\s]*[=+@-]/, m=>`'${m}`).replaceAll('"','""')}"`;
  const rows = [['成員','訊息','普通文字','檔案項數','圖片項數','表情包項數','QQ表情項數','影片項數','語音項數','回覆項數','凌晨訊息','凌晨占比','早鳥訊息','週末訊息','活躍天數','最長連續天數','文字字數','檔案位元組','上午訊息','下午訊息','晚間訊息'], ...report.members.map(p=>[nameOf(p),...keys.map(k=>metric(p,k)),...p.periods.slice(1)])];
  download('\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'), 'chat-scope-members.csv', 'text/csv;charset=utf-8');
}
for (const id of ['choose','import-top']) $(id).onclick=()=>$('file').click();
$('file').onchange=()=>{ const f=$('file').files[0]; if(f) { resetFilters(); start(f); } $('file').value=''; };
const zone=$('dropzone');
for(const event of ['dragenter','dragover']) zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('dragging');});
zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));
zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');const files=[...e.dataTransfer.files];if(files.length!==1){notify('請一次選擇一個 JSON 或 JSONL 檔案。',true);return;} resetFilters(); start(files[0]);});
$('filters').onsubmit=e=>{e.preventDefault();start();};
$('reset-filter').onclick=()=>{resetFilters();start();};
$('system').onchange=()=>start();
$('demo').onclick=()=>{resetFilters();start(null);};
$('cancel').onclick=()=>{worker?.terminate();setBusy(false);notify(report ? '已取消分析，原有報告保留。' : '已取消分析，請重新選擇檔案。');};
$('clear').onclick=()=>{
  worker?.terminate(); worker=null; clearCharts(); report=null; currentFile=null; snapshotOnly=false; window.dispatchEvent(new CustomEvent('statistics-applied',{detail:getAnalysisContext()})); aliases.clear(); setBusy(false);
  for(const id of ['stats','awards','members','file-summary','extensions','period-ranking','quality','chat-name','source-name','range-label','period-total','period-rate','period-info','applied-filters','member-count','table-info','type-count','mode']) $(id).replaceChildren();
  $('report').hidden=true; $('file').value=''; resetFilters(); $('search').value=''; $('period-search').value=''; periodPage=0;
  notify('已清除本機分析資料。選擇檔案或查看示範，即可重新開始。');
};
$('anonymous').onchange=()=>{periodPage=0;if(report)render();};
$('period-switch').onclick=()=>{periodIndex=(periodIndex+1)%PERIODS.length;periodTurns++;periodPage=0;renderPeriod(true);};
$('period-prev').onclick=()=>{periodPage--;renderPeriod();};
$('period-next').onclick=()=>{periodPage++;renderPeriod();};
$('period-page').onchange=()=>{periodPage=Math.max(0,Math.floor(Number($('period-page').value)||1)-1);renderPeriod();};
$('period-size').onchange=()=>{periodPage=0;renderPeriod();};
$('period-search').oninput=()=>{periodPage=0;renderPeriod();};
$('rank-metric').onchange=e=>{rankMetric=e.target.value;if(report)renderCharts(report,nameOf,rankMetric,trendMode);};
document.querySelectorAll('[data-trend]').forEach(el=>el.onclick=()=>{trendMode=el.dataset.trend;document.querySelectorAll('[data-trend]').forEach(b=>b.classList.toggle('selected',b===el));if(report)renderCharts(report,nameOf,rankMetric,trendMode);});
$('search').oninput=()=>{page=0;if(report)renderTable();};
document.querySelectorAll('[data-sort]').forEach(el=>el.onclick=()=>{sortDir=sortKey===el.dataset.sort?-sortDir:-1;sortKey=el.dataset.sort;page=0;renderTable();});
$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
function updateExportOptions() {
  const format = new FormData($('export-form')).get('format');
  $('html-options').hidden = format !== 'html';
  const anonymous = $('anonymous').checked || report?.redacted;
  $('include-source').disabled = !currentFile || anonymous;
  if ($('include-source').disabled) $('include-source').checked = false;
  $('source-option-help').textContent = anonymous ? '匿名報告不包含原始聊天檔。' : currentFile ? `勾選後可離線重新篩選日期與星期；會包含完整聊天內容，檔案增加約 ${formatBytes(currentFile.size)}。未勾選時只保存目前統計。` : '目前沒有原始聊天檔，將保存目前統計。';
  $('export-scope').textContent = `${anonymous ? '匿名匯出' : '保留成員名稱'} · 包含目前篩選的全部 ${n(report?.members.length)} 位成員。`;
  $('export-submit').textContent = format === 'pdf' ? '開啟列印視窗' : `下載 ${format.toUpperCase()}`;
}
$('export-json').onclick=()=>{ $('export-status').textContent=''; updateExportOptions(); $('export-panel').showModal(); };
$('export-csv').onclick=exportCSV;
$('export-close').onclick=$('export-cancel').onclick=()=>$('export-panel').close();
$('export-form').onchange=updateExportOptions;
$('export-form').onsubmit=async event=>{
  event.preventDefault();
  const format = new FormData($('export-form')).get('format');
  const controls = [...$('export-form').elements];
  controls.forEach(el=>el.disabled=true);
  $('export-status').textContent='正在準備匯出…';
  try {
    const result = reportSnapshot();
    if (format === 'json') download(JSON.stringify(result,null,2),'chat-scope-report.json','application/json;charset=utf-8');
    else if (format === 'csv') exportCSV();
    else if (format === 'pdf') {
      await printPDF(printDocument(result,chartImages(),filterDescription(report.filters),MEMBER_COLUMNS));
    } else {
      const state = { trendMode,rankMetric,page,sortKey,sortDir,periodIndex,periodPage,periodSize:$('period-size').value,search:result.redacted?'':$('search').value,periodSearch:result.redacted?'':$('period-search').value,anonymous:$('anonymous').checked };
      const blob = await interactiveHTML({report:result,state},$('include-source').checked ? currentFile : null, fraction=>{ $('export-status').textContent=`正在打包原始聊天檔… ${(fraction*100).toFixed(0)}%`; });
      download(blob,'chat-scope-report.html');
    }
    $('export-panel').close();
  } catch(error) { $('export-status').textContent=`匯出失敗：${error.message}`; }
  finally { controls.forEach(el=>el.disabled=false); updateExportOptions(); }
};
const navigationItems = () => [...document.querySelectorAll('nav a')].map(link => ({ link, section: $(link.hash.slice(1)) })).filter(item => item.section);
const navDot = document.querySelector('.nav-dot');
let activeSection, navigationFrame = 0;
function syncNavigation() {
  navigationFrame = 0;
  const navigation = navigationItems();
  const visible = navigation.filter(({ section }) => section.getClientRects().length);
  const offset = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + Math.min(120, innerHeight * .2);
  const atBottom = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
  const current = atBottom ? visible.at(-1) : visible.filter(({ section }) => section.getBoundingClientRect().top <= offset).at(-1) || visible[0];
  if (!current || current.section === activeSection) return;
  activeSection = current.section;
  for (const { link, section } of navigation) {
    const active = section === activeSection;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  current.link.append(navDot);
}
function scheduleNavigation() {
  if (!navigationFrame) navigationFrame = requestAnimationFrame(syncNavigation);
}
window.addEventListener('scroll', scheduleNavigation, { passive: true });
window.addEventListener('resize', scheduleNavigation);
window.addEventListener('hashchange', scheduleNavigation);
new ResizeObserver(scheduleNavigation).observe(document.querySelector('main'));
scheduleNavigation();
setBusy(false);

const embeddedReport = document.getElementById('embedded-report');
if (embeddedReport) {
  try {
    const saved = JSON.parse(embeddedReport.textContent), state = saved.state;
    report = saved.report;
    const source = document.getElementById('embedded-source');
    if (source && saved.sourceFile) { currentFile = new File([source.textContent],saved.sourceFile.name,{type:saved.sourceFile.type}); source.remove(); }
    snapshotOnly = !currentFile && !report.demo;
    aliases = new Map(report.members.map((p,i)=>[p.id,report.redacted?p.name:`成員 ${String(i+1).padStart(3,'0')}`]));
    ({trendMode,rankMetric,page,sortKey,sortDir,periodIndex,periodPage}=state);
    periodTurns=periodIndex;
    $('rank-metric').value=rankMetric; $('period-size').value=state.periodSize;
    $('search').value=state.search; $('period-search').value=state.periodSearch; $('anonymous').checked=state.anonymous;
    const f=report.filters;
    $('from').value=f.from||''; $('to').value=f.to||''; $('system').checked=!!f.includeSystem;
    $('weekdays').value=!f.weekdays?.length?'all':f.weekdays.length===5?'workdays':f.weekdays.length===2?'weekends':String(f.weekdays[0]);
    document.querySelectorAll('[data-trend]').forEach(el=>el.classList.toggle('selected',el.dataset.trend===trendMode));
    setBusy(false); render(); embeddedReport.remove();
    if(snapshotOnly) notify('這份離線報告保存匯出時的統計，圖表、搜尋、排序與分頁均可使用。若需重新篩選日期與星期，請匯入原始聊天檔，或匯出時勾選「包含原始聊天檔」。');
  } catch(error) { notify(`無法還原離線報告：${error.message}`,true); }
}
