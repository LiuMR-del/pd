import { Generator, WORKER_SCRIPT, type WorkerFactory, type WorkerLike } from './generator';

/**
 * Real worker factory for the mini-program (the Generator takes a factory so tests can fake it).
 * uni.createWorker maps to wx.createWorker on mp-weixin; the returned object also has
 * onProcessKilled, which uni's typings leave out.
 */
export const createMpWorker: WorkerFactory = () => uni.createWorker(WORKER_SCRIPT) as unknown as WorkerLike;

let shared: Generator | null = null;

/**
 * WeChat allows only one worker at a time, and earlier pages stay alive in the page stack (e.g. an
 * editor page under 「我的作品」 → another editor page). So every page uses this one generator; a page
 * that leaves cancels only the job it started itself.
 */
export function sharedGenerator(): Generator {
  if (!shared) shared = new Generator(createMpWorker);
  return shared;
}
