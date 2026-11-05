import uni from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

// Only the mp-weixin platform is built (`uni -p mp-weixin`). Output: dist/dev/mp-weixin (dev) or
// dist/build/mp-weixin (build); open that folder in WeChat DevTools.
export default defineConfig({
  plugins: [uni()],
});
