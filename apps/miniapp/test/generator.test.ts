import { getPalette } from '@pd/palettes';
import { generatePattern, presetOptions } from '@pd/pattern-core';
import { describe, expect, it } from 'vitest';
import { handleGenerateMessage } from '../src/lib/generate-handler';
import { CancelledError, Generator, type WorkerLike } from '../src/lib/generator';
import { makeTestImage } from '../src/lib/self-test';

/** In-process stand-in for wx.createWorker: JSON-only messages, async delivery, like the real one. */
class FakeWorker implements WorkerLike {
  terminated = false;
  posted = 0;
  private onMsg: ((m: unknown) => void) | null = null;
  private onKilled: (() => void) | null = null;
  constructor(private readonly respond = true) {}
  postMessage(message: unknown): void {
    this.posted++;
    const wire = JSON.parse(JSON.stringify(message));
    if (!this.respond) return;
    setTimeout(() => {
      if (this.terminated) return;
      const reply = JSON.parse(JSON.stringify(handleGenerateMessage(wire)));
      this.onMsg?.(reply);
    }, 0);
  }
  onMessage(cb: (m: unknown) => void): void {
    this.onMsg = cb;
  }
  onProcessKilled(cb: () => void): void {
    this.onKilled = cb;
  }
  terminate(): void {
    this.terminated = true;
  }
  kill(): void {
    this.onKilled?.();
  }
  deliver(message: unknown): void {
    this.onMsg?.(message);
  }
}

const palette = getPalette('MARD', 221);
const options = { ...presetOptions('cartoon', 'balanced'), longSide: 32 };

describe('Generator (mini-program worker client)', () => {
  it('returns the same pattern as running pattern-core directly', async () => {
    const workers: FakeWorker[] = [];
    const gen = new Generator(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const image = makeTestImage();
    const viaWorker = await gen.generate(image, palette, options);
    const direct = generatePattern(image, palette, options);
    expect(viaWorker.cells).toBeInstanceOf(Uint16Array);
    expect(Array.from(viaWorker.cells)).toEqual(Array.from(direct.cells));
    expect(viaWorker.cols).toBe(direct.cols);
    expect(viaWorker.rows).toBe(direct.rows);
    expect(viaWorker.palette).toEqual(direct.palette);
    expect(viaWorker.stats).toEqual(direct.stats);
    expect(gen.busy).toBe(false);
    // the worker is reused for the next call
    await gen.generate(image, palette, options);
    expect(workers.length).toBe(1);
    expect(workers[0].posted).toBe(2);
  });

  it('cancel() rejects with CancelledError and terminates the worker', async () => {
    const w = new FakeWorker(false);
    const gen = new Generator(() => w);
    const p = gen.generate(makeTestImage(), palette, options);
    expect(gen.busy).toBe(true);
    gen.cancel();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(w.terminated).toBe(true);
    expect(gen.busy).toBe(false);
  });

  it('a new generate() cancels the previous one and uses a fresh worker', async () => {
    const workers: FakeWorker[] = [];
    let first = true;
    const gen = new Generator(() => {
      const w = new FakeWorker(!first);
      first = false;
      workers.push(w);
      return w;
    });
    const p1 = gen.generate(makeTestImage(), palette, options);
    const p2 = gen.generate(makeTestImage(), palette, options);
    await expect(p1).rejects.toBeInstanceOf(CancelledError);
    await expect(p2).resolves.toMatchObject({ cols: 32 });
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
  });

  it('reports pattern-core errors from the worker', async () => {
    const gen = new Generator(() => new FakeWorker());
    await expect(gen.generate({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, palette, options)).rejects.toThrow();
    expect(gen.busy).toBe(false);
  });

  it('ignores replies for an older request id', async () => {
    const w = new FakeWorker(false);
    const gen = new Generator(() => w);
    const p = gen.generate(makeTestImage(), palette, options);
    w.deliver({ id: 999, ok: false, error: 'stale' });
    expect(gen.busy).toBe(true);
    w.deliver({ id: 1, ok: false, error: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('rejects with a readable message when the system kills the worker', async () => {
    const workers: FakeWorker[] = [];
    const gen = new Generator(() => {
      const w = new FakeWorker(workers.length > 0);
      workers.push(w);
      return w;
    });
    const p = gen.generate(makeTestImage(), palette, options);
    workers[0].kill();
    await expect(p).rejects.toThrow(/内存不足/);
    // next call starts a new worker
    await expect(gen.generate(makeTestImage(), palette, options)).resolves.toMatchObject({ cols: 32 });
    expect(workers.length).toBe(2);
  });
});
