import uni from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

// Only the mp-weixin platform is built (`uni -p mp-weixin`). Output: dist/dev/mp-weixin (dev) or
// dist/build/mp-weixin (build); open that folder in WeChat DevTools.
export default defineConfig({
  plugins: [uni()],
  resolve: {
    // Workspace packages reach each other through per-package node_modules junctions on Windows;
    // without this the bundle got two copies of @pd/makers (so `instanceof MakerError` failed).
    dedupe: ['@pd/app-shared', '@pd/editor-core', '@pd/makers', '@pd/palettes', '@pd/pattern-core', '@pd/render'],
  },
});
