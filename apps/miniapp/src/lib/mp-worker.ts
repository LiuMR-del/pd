import { WORKER_SCRIPT, type WorkerFactory, type WorkerLike } from './generator';

/**
 * Real worker factory for the mini-program (the Generator takes a factory so tests can fake it).
 * uni.createWorker maps to wx.createWorker on mp-weixin; the returned object also has
 * onProcessKilled, which uni's typings leave out.
 */
export const createMpWorker: WorkerFactory = () => uni.createWorker(WORKER_SCRIPT) as unknown as WorkerLike;
