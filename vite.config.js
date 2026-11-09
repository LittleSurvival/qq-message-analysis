import { defineConfig } from 'vite';
import { offlineRuntime } from './scripts/offline-runtime.js';

export default defineConfig({
  base: './',
  plugins: [offlineRuntime()],
  server: { fs: { deny: ['.data/**', '**/.git/**', '**/.env*'] } },
});
