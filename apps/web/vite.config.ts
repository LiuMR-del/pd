import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  worker: { format: 'es' },
  build: {
    // pattern-core targets old mini-program runtimes; the web build only needs evergreen browsers
    target: 'es2020',
  },
});
