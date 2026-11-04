import { loadConfig } from './config';
import { createApp } from './app';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, '127.0.0.1');
console.log(`PD server: http://127.0.0.1:${config.port}/api/health`);
