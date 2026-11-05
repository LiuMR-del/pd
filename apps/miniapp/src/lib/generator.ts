import type { PaletteInput, PatternOptions, PatternResult, RgbaImage } from '@pd/pattern-core';
import { decodeWire, encodeWire, type GenerateReply } from './worker-wire';

/** The parts of a WeChat Worker (wx.createWorker) the generator uses. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  onMessage(callback: (message: unknown) => void): void;
  /** iOS may kill the worker under memory pressure. */
  onProcessKilled?(callback: () => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

/** Path of the bundled worker inside the mini-program package (see manifest.json `workers`). */
export const WORKER_SCRIPT = 'static/workers/generate.js';

/**
 * Runs @pd/pattern-core in a mini-program Worker so the page stays responsive. Same contract as the
 * web app's Generator: `cancel()` terminates the worker (no cooperative cancellation) and rejects the
 * pending call. WeChat allows only one worker at a time, so a new one is created only after the old
 * one is terminated.
 */
export class Generator {
  private worker: WorkerLike | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (r: PatternResult) => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly createWorker: WorkerFactory) {}

  private ensure(): WorkerLike {
    if (!this.worker) {
      const w = this.createWorker();
      w.onMessage((message) => {
        const p = this.pending;
        if (w !== this.worker || !p) return;
        let reply: GenerateReply;
        try {
          reply = decodeWire(message) as GenerateReply;
        } catch {
          this.pending = null;
          this.reset();
          p.reject(new Error('生成结果无法读取'));
          return;
        }
        if (reply.id !== p.id) return;
        this.pending = null;
        if (reply.ok) p.resolve(reply.result);
        else p.reject(new Error(reply.error));
      });
      w.onProcessKilled?.(() => {
        if (w !== this.worker) return;
        const p = this.pending;
        this.pending = null;
        this.worker = null;
        p?.reject(new Error('生成进程被系统结束了（可能是内存不足），请把图纸尺寸调小后重试'));
      });
      this.worker = w;
    }
    return this.worker;
  }

  generate(image: RgbaImage, palette: PaletteInput[], options: PatternOptions): Promise<PatternResult> {
    this.cancel();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      try {
        this.ensure().postMessage(encodeWire({ id, image, palette, options }));
      } catch (e) {
        this.pending = null;
        this.reset();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  cancel(): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.reset();
    p.reject(new CancelledError());
  }

  /** Release the worker (e.g. when the editor page unloads). */
  dispose(): void {
    this.cancel();
    this.reset();
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('已取消');
  }
}
