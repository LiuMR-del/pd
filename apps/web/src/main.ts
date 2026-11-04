import { createApp } from 'vue';
import { loadServerPalette } from './lib/palette-sync';
import './styles.css';

// the palette must be final before any module reads it (settings defaults, pickers)
void (async () => {
  await loadServerPalette();
  const [{ default: App }, { initCloud }] = await Promise.all([import('./App.vue'), import('./cloud')]);
  createApp(App).mount('#app');
  void initCloud();
})();
