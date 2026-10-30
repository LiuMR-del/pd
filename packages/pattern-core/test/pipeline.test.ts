import { describe, expect, it } from 'vitest';
import { baselinePattern } from '../src/baseline/perlerBeads';
import { generatePattern } from '../src/pipeline';
import { presetOptions, resolveOptions } from '../src/presets';
import { EMPTY_CELL } from '../src/types';
import { BASIC_PALETTE, keysOf, makeImage } from './helpers';

function checkResult(r: ReturnType<typeof generatePattern>) {
  expect(r.cells.length).toBe(r.cols * r.rows);
  let filled = 0;
  for (const c of r.cells) {
    if (c === EMPTY_CELL) continue;
    expect(c).toBeLessThan(r.palette.length);
    filled++;
  }
  expect(r.stats.reduce((s, x) => s + x.count, 0)).toBe(filled);
  expect(r.stats.map((s) => s.key)).toEqual(r.palette.map((p) => p.key));
  for (let i = 1; i < r.stats.length; i++) expect(r.stats[i - 1].count).toBeGreaterThanOrEqual(r.stats[i].count);
  expect(r.timings.total).toBeGreaterThanOrEqual(0);
}

describe('generatePattern', () => {
  const flag = makeImage(120, 60, (x) => (x < 40 ? [224, 32, 32] : x < 80 ? [255, 255, 255] : [32, 64, 208]));

  it.each(['oklab', 'ciede2000'] as const)('converts a flat 3-band image exactly (%s)', (metric) => {
    const r = generatePattern(flag, BASIC_PALETTE, { longSide: 12, metric });
    checkResult(r);
    expect([r.cols, r.rows]).toEqual([12, 6]);
    expect(keysOf(r)[0]).toBe('R R R R W W W W B B B B');
    expect(r.stats.map((s) => s.count)).toEqual([24, 24, 24]);
  });

  it('respects maxColors', () => {
    const ramp = makeImage(200, 100, (x, y) => [x, (y * 2) % 256, 255 - x]);
    const r = generatePattern(ramp, BASIC_PALETTE, { longSide: 40, maxColors: 3 });
    checkResult(r);
    expect(r.palette.length).toBeLessThanOrEqual(3);
  });

  it('transparent areas become empty and are cropped', () => {
    const img = makeImage(100, 100, (x, y) => (x >= 30 && x < 70 && y >= 40 && y < 60 ? [224, 32, 32, 255] : [0, 0, 0, 0]));
    const r = generatePattern(img, BASIC_PALETTE, { longSide: 10 });
    checkResult(r);
    expect([r.cols, r.rows]).toEqual([4, 2]);
    expect(r.offset).toEqual({ x: 3, y: 4 });
    expect(r.sourceGrid).toEqual({ cols: 10, rows: 10 });
  });

  it('removes a white background when asked', () => {
    const img = makeImage(100, 100, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 900 ? [32, 160, 64] : [255, 255, 255]));
    const r = generatePattern(img, BASIC_PALETTE, { longSide: 20, removeBackground: true, fitSubject: false });
    checkResult(r);
    expect(r.palette.map((p) => p.key)).not.toContain('W');
    expect(r.cols).toBeLessThanOrEqual(13);
  });

  it('fits the subject to the requested long side after removing the background', () => {
    const img = makeImage(100, 100, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 900 ? [32, 160, 64] : [255, 255, 255]));
    const r = generatePattern(img, BASIC_PALETTE, { longSide: 20, removeBackground: true });
    checkResult(r);
    expect(r.meta.fitSubject).toBe(true);
    expect(r.palette.map((p) => p.key)).toEqual(['G']);
    expect(r.cols).toBeGreaterThanOrEqual(16);
    expect(r.sourceRegion.w).toBeLessThan(100);
    expect(r.timings.firstPass).toBeGreaterThanOrEqual(0);
  });

  it('fits a tall subject in a wide image to the long side', () => {
    // first pass: 100x50 grid, bar 8x48 cells -> already 96% of the rows, but only 48% of the long side
    const img = makeImage(400, 200, (x, y) => (x >= 184 && x < 216 && y >= 4 && y < 196 ? [224, 32, 32] : [255, 255, 255]));
    const r = generatePattern(img, BASIC_PALETTE, { longSide: 100, removeBackground: true });
    checkResult(r);
    expect(r.meta.fitSubject).toBe(true);
    expect(Math.max(r.cols, r.rows)).toBeGreaterThanOrEqual(90);
    expect(r.palette.map((p) => p.key)).toEqual(['R']);
  });

  it('pixel style aligns to the detected period', () => {
    const colors: [number, number, number][] = [[255, 255, 255], [0, 0, 0], [224, 32, 32], [240, 208, 32]];
    let seed = 3;
    const art = Array.from({ length: 16 * 12 }, () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 4));
    const img = makeImage(16 * 5, 12 * 5, (x, y) => colors[art[Math.floor(y / 5) * 16 + Math.floor(x / 5)]]);
    const r = generatePattern(img, BASIC_PALETTE, { ...presetOptions('pixel', 'detail'), maxColors: 0, autoCrop: false });
    checkResult(r);
    expect([r.cols, r.rows]).toEqual([16, 12]);
    expect(r.meta.pixelPeriod).toBe(5);
    const keys = ['W', 'K', 'R', 'Y'];
    for (let i = 0; i < art.length; i++) expect(r.palette[r.cells[i]].key).toBe(keys[art[i]]);
  });

  it('pixel style uses native size for small unscaled art', () => {
    const img = makeImage(30, 20, (x, y) => ((x + y) % 3 ? [255, 255, 255] : [0, 0, 0]));
    const r = generatePattern(img, BASIC_PALETTE, { style: 'pixel', maxColors: 0, autoCrop: false });
    expect([r.cols, r.rows]).toEqual([30, 20]);
  });

  it('uses only zero-dependency globals (no DOM)', () => {
    expect(typeof (globalThis as Record<string, unknown>).document).toBe('undefined');
  });
});

describe('presets', () => {
  it('size presets map to grid/colors', () => {
    expect(presetOptions('cartoon', 'save')).toMatchObject({ longSide: 48, maxColors: 16 });
    expect(presetOptions('photo', 'balanced')).toMatchObject({ longSide: 72, maxColors: 24, dither: 0.25 });
    expect(presetOptions('pixel', 'detail')).toMatchObject({ longSide: 100, maxColors: 36 });
  });
  it('rejects invalid options with readable errors', () => {
    const img = makeImage(10, 10, () => [0, 0, 0]);
    expect(() => generatePattern(img, BASIC_PALETTE, { cols: -3, rows: 5 })).toThrow(/cols\/rows/);
    expect(() => generatePattern(img, BASIC_PALETTE, { cols: 1000, rows: 1000 })).toThrow(/cols\/rows/);
    expect(() => generatePattern(img, BASIC_PALETTE, { cols: 10 })).toThrow(/together/);
    expect(() => generatePattern(img, BASIC_PALETTE, { longSide: NaN })).toThrow(/longSide/);
    expect(() => generatePattern(img, BASIC_PALETTE, { subSamples: NaN })).toThrow(/subSamples/);
    expect(() => generatePattern(img, BASIC_PALETTE, { style: 'pixel', pixelPeriod: 0 })).toThrow(/pixelPeriod/);
    expect(resolveOptions({ longSide: 999 }).longSide).toBe(200);
  });

  it('clamps options', () => {
    const o = resolveOptions({ maxColors: 999, dither: 3, subSamples: 0 });
    expect([o.maxColors, o.dither, o.subSamples]).toEqual([60, 1, 1]);
    expect(resolveOptions({ maxColors: 0 }).maxColors).toBe(0);
    expect(resolveOptions({ maxColors: 1 }).maxColors).toBe(2);
  });
});

describe('baselinePattern (perler-beads)', () => {
  it('dominant picks the most frequent exact RGB, average averages in sRGB', () => {
    // one cell: 6 white px, 3 black px
    const img = makeImage(3, 3, (x) => (x === 2 ? [0, 0, 0] : [255, 255, 255]));
    const dom = baselinePattern(img, BASIC_PALETTE, { cols: 1, rows: 1, mode: 'dominant' });
    expect(dom.palette[0].key).toBe('W');
    const avg = baselinePattern(img, BASIC_PALETTE, { cols: 1, rows: 1, mode: 'average' });
    // sRGB mean 170 -> nearest is #BBBBBB (linear-light mean would be ~212)
    expect(avg.palette[0].key).toBe('G75');
  });

  it('merges similar colors by frequency with threshold 30', () => {
    const img = makeImage(4, 1, (x) => (x < 3 ? [128, 128, 128] : [187, 187, 187]));
    const merged = baselinePattern(img, BASIC_PALETTE, { cols: 4, rows: 1, mode: 'average', similarityThreshold: 30 });
    expect(merged.palette.map((p) => p.key)).toEqual(['G50']);
    const kept = baselinePattern(img, BASIC_PALETTE, { cols: 4, rows: 1, mode: 'average', similarityThreshold: 0 });
    expect(kept.palette.length).toBe(2);
  });
});

describe('baseline background removal', () => {
  it('removes only the single most frequent border color', () => {
    const img = makeImage(60, 60, (x, y) => ((x - 30) ** 2 + (y - 30) ** 2 < 300 ? [224, 32, 32] : y < 30 ? [255, 255, 255] : [240, 208, 32]));
    const r = baselinePattern(img, BASIC_PALETTE, { cols: 6, rows: 6, mode: 'average', similarityThreshold: 0, removeBackground: true });
    const k = keysOf(r);
    expect(k[0]).toBe('. . . . . .');
    expect(k[5]).toBe('Y Y Y Y Y Y');
  });
});
