import { describe, expect, it } from 'vitest';
import { detectPixelPeriod } from '../src/image/period';
import { generatePattern } from '../src/pipeline';
import { EMPTY_CELL } from '../src/types';
import { BASIC_PALETTE, makeImage } from './helpers';

const count = (r: ReturnType<typeof generatePattern>, key: string) => r.stats.find((s) => s.key === key)?.count ?? 0;

describe('stage-0 leftovers (fixed before the Worker integration)', () => {
  it('keeps a subject that spans the whole bottom edge (half-length portrait)', () => {
    // white background; blue "shoulders" across the full bottom quarter; red head
    const img = makeImage(200, 200, (x, y) =>
      y >= 150 ? [32, 64, 208] : (x - 100) ** 2 + (y - 95) ** 2 < 45 ** 2 ? [224, 32, 32] : [255, 255, 255],
    );
    const r = generatePattern(img, BASIC_PALETTE, { longSide: 40, removeBackground: true, fitSubject: false });
    expect(count(r, 'W')).toBe(0);
    expect(count(r, 'B')).toBeGreaterThanOrEqual(40 * 9);
    expect(count(r, 'R')).toBeGreaterThan(0);
  });

  it('still removes a vertical gradient background flooded from the top', () => {
    const img = makeImage(200, 200, (x, y) =>
      (x - 100) ** 2 + (y - 100) ** 2 < 50 ** 2 ? [224, 32, 32] : [255 - y * 0.3, 255 - y * 0.3, 255 - y * 0.3],
    );
    const r = generatePattern(img, BASIC_PALETTE, { longSide: 40, removeBackground: true, fitSubject: false });
    expect(r.meta.backgroundRemoved).toBeGreaterThan(1200);
    expect(count(r, 'W')).toBe(0);
    // a few anti-aliased rim cells of the disk may stay as grey; that is the subject's edge, not background
    expect(count(r, 'G75') + count(r, 'G50')).toBeLessThanOrEqual(4);
  });

  it('does not treat a 1-row grid as a ring border', () => {
    const img = makeImage(300, 10, (x) => (x < 100 || x >= 200 ? [255, 255, 255] : [224, 32, 32]));
    const r = generatePattern(img, BASIC_PALETTE, { cols: 30, rows: 1, removeBackground: true });
    expect(r.meta.backgroundRemoved).toBe(0);
    expect(r.cols).toBe(30);
  });

  it('does not take a flat logo block for upscaled pixel art', () => {
    const logo = makeImage(1000, 1000, (x, y) => (x >= 200 && x < 800 && y >= 200 && y < 800 ? [224, 32, 32] : [255, 255, 255]));
    expect(detectPixelPeriod(logo)).toBeNull();
    const r = generatePattern(logo, BASIC_PALETTE, { style: 'pixel', longSide: 48, autoCrop: false });
    expect([r.cols, r.rows]).toEqual([48, 48]);
  });

  it('flags empty results with a reason', () => {
    const clear = generatePattern(makeImage(50, 50, () => [0, 0, 0, 0]), BASIC_PALETTE);
    expect([clear.meta.empty, clear.meta.emptyReason]).toEqual([true, 'transparent']);
    const white = generatePattern(makeImage(50, 50, () => [255, 255, 255]), BASIC_PALETTE, { removeBackground: true, autoCrop: false });
    expect(white.cells.every((c) => c === EMPTY_CELL)).toBe(true);
    expect([white.meta.empty, white.meta.emptyReason]).toEqual([true, 'background']);
    const ok = generatePattern(makeImage(50, 50, () => [224, 32, 32]), BASIC_PALETTE);
    expect([ok.meta.empty, ok.meta.emptyReason]).toEqual([false, null]);
  });
});
