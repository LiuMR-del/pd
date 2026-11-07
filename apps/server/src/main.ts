import { loadConfig } from './config';
import { createApp } from './app';

const config = loadConfig();
const app = await createApp(config);
// only this computer by default; HOST=0.0.0.0 opens it to the local network (phone testing, temporarily)
const host = process.env.HOST || '127.0.0.1';
await app.listen(config.port, host);
console.log(`PD server: http://${host}:${config.port}/api/health`);
if (host !== '127.0.0.1') console.log('注意：后端正在监听局域网地址，测试完请去掉 HOST 重新启动');
