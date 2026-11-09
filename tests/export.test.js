import test from 'node:test';
import assert from 'node:assert/strict';
import { safeJSON, interactiveHTML, printDocument } from '../src/report/export.js';
import { demoReport } from '../src/analysis/demo.js';

test('offline HTML safely preserves Unicode and script-like content across byte chunks', async () => {
  const name = '</script><img src=x onerror=alert(1)> 中文🙂';
  assert.deepEqual(JSON.parse(safeJSON({ name })), { name });
  const original = JSON.stringify({ messages: [{ text: name }] });
  const bytes = new TextEncoder().encode(original);
  const file = { name: '中文.json', type: 'application/json', size: bytes.length, stream: () => new ReadableStream({ start(c) { for(let i=0;i<bytes.length;i++) c.enqueue(bytes.slice(i,i+1)); c.close(); } }) };
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => ({ textContent: id === 'offline-runtime' ? 'window.test = "safe";' : 'body{color:white}' }) };
  try {
    const html = await (await interactiveHTML({ report: { name } },file)).text();
    assert.equal((html.match(/<script\b/g)||[]).length,3);
    const source = html.match(/id="embedded-source">([\s\S]*?)<\/script>/)[1];
    assert.deepEqual(JSON.parse(source),JSON.parse(original));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes("connect-src 'none'"));
  } finally { globalThis.document = previous; }
});

test('print document includes all members and four periods with escaped names', () => {
  const report = demoReport();
  report.members[0].name = '<script>unsafe</script>';
  const html = printDocument(report,{},'全部日期',[['total','訊息'],['fileBytes','檔案總大小']]);
  assert.ok(!html.includes('<script>unsafe'));
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.equal((html.match(/<tr>/g)||[]).length,report.members.length*2+Object.keys(report.extensions).length+3);
  assert.ok(html.includes('晚間'));
});
