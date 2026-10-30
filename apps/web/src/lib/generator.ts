import type { PaletteInput, PatternOptions, PatternResult, RgbaImage } from '@pd/pattern-core';

type Reply = { id: number; ok: true; result: PatternResult } | { id: number; ok: false; error: string };

/**
 * Runs @pd/pattern-core in a Web Worker so the page stays responsive. `cancel()` terminates the
 * worker (the algorithm has no cooperative cancellation) and rejects the pending call.
 */
export class Generator {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (r: PatternResult) => void; reject: (e: Error) => void } | null = null;

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../worker/generate.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => {
        const p = this.pending;
        if (!p || e.data.id !== p.id) return;
        this.pending = null;
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      this.worker.onmessageerror = () => {
        const p = this.pending;
        this.pending = null;
        this.reset();
        p?.reject(new Error('生成结果无法读取'));
      };
      this.worker.onerror = (e) => {
        const p = this.pending;
        this.pending = null;
        this.reset();
        p?.reject(new Error(e.message || '生成失败'));
      };
    }
    return this.worker;
  }

  generate(image: RgbaImage, palette: PaletteInput[], options: PatternOptions): Promise<PatternResult> {
    this.cancel();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      // the pixel buffer is copied (structured clone) so the caller's image stays usable
      this.ensure().postMessage({ id, image, palette, options });
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
