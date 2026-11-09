import { analyzeFile } from './importer.js';
import { demoReport } from './demo.js';
self.onmessage = async ({ data }) => {
  try {
    const report = data.file
      ? await analyzeFile(data.file, data.filters, progress => self.postMessage({ type: 'progress', ...progress }))
      : demoReport(data.filters);
    self.postMessage({ type: 'done', report });
  } catch (error) {
    self.postMessage({ type: 'error', message: `無法讀取檔案：${error.message}` });
  }
};
