import { createApp } from 'vue';
import App from './App.vue';
import { initCloud } from './cloud';
import './styles.css';

createApp(App).mount('#app');
void initCloud();
