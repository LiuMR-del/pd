import { handleGenerateMessage } from '../src/lib/generate-handler';

/**
 * WeChat mini-program Worker entry. Bundled by scripts/build-worker.ts into one ES2015 file at
 * src/static/workers/generate.js (manifest.json `mp-weixin.workers` = "static/workers").
 */
interface MpWorkerScope {
  onMessage(callback: (message: unknown) => void): void;
  postMessage(message: unknown): void;
}

declare const worker: MpWorkerScope;

worker.onMessage((message) => {
  worker.postMessage(handleGenerateMessage(message));
});
