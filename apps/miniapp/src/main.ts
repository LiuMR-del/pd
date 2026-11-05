import { createSSRApp } from 'vue';
import App from './App.vue';

// uni-app entry: must export createApp (the mini-program runtime calls it).
export function createApp() {
  const app = createSSRApp(App);
  return { app };
}
