import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  worker: { format: 'es' },
  server: {
    // apps/server (pnpm dev:server); production serves the API under the same origin at /api
    proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } },
  },
  build: {
    // pattern-core targets old mini-program runtimes; the web build only needs evergreen browsers
    target: 'es2020',
  },
});
