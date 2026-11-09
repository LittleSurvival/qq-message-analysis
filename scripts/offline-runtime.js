import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function bundleRuntime() {
  const common = { absWorkingDir: root, bundle: true, write: false, minify: true, format: 'iife', target: 'es2022', logLevel: 'silent' };
  const worker = await build({ ...common, entryPoints: ['src/analysis/worker.js'] });
  const result = await build({
    ...common, entryPoints: ['src/report/main.js'], outdir: 'offline',
    define: { 'import.meta.env.BASE_URL': JSON.stringify('./') },
    plugins: [{ name: 'inline-worker', setup(builder) {
      builder.onLoad({ filter: /worker-factory\.js$/ }, () => ({ contents: `export function createAnalysisWorker(){const url=URL.createObjectURL(new Blob([${JSON.stringify(worker.outputFiles[0].text)}],{type:'text/javascript'}));const worker=new Worker(url);setTimeout(()=>URL.revokeObjectURL(url),10000);return worker;}`, loader: 'js' }));
    } }],
  });
  return JSON.stringify({ js: result.outputFiles.find(f => f.path.endsWith('.js')).text, css: result.outputFiles.find(f => f.path.endsWith('.css')).text });
}

export function offlineRuntime() {
  return {
    name: 'offline-report-runtime',
    configureServer(server) {
      server.middlewares.use('/report-runtime.json', async (_req, res, next) => {
        try { const content = await bundleRuntime(); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(content); }
        catch (error) { next(error); }
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'report-runtime.json', source: await bundleRuntime() });
    },
  };
}
