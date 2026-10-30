import { describe, expect, it } from 'vitest';
import { generatePattern } from '../src/pipeline';
import { BASE_OPTIONS } from '../src/presets';
import { detectStrokes, STROKE_DARK, STROKE_LIGHT, STROKE_NONE } from '../src/sample/stroke';
import { BASIC_PALETTE, makeImage } from './helpers';

const OFF = { ...BASE_OPTIONS.stroke, enabled: false };
const column = (r: ReturnType<typeof generatePattern>, x: number) =>
  Array.from({ length: r.rows }, (_, y) => r.palette[r.cells[y * r.cols + x]].key);

describe('thin-stroke protection', () => {
  // 160x160, 20 cells of 8 px: a 2 px line is 25% of a cell, so the cell mean (and a 3x3 vote,
  // where it covers ~75% of one 2.7 px sub-sample) only sees a grey there and loses it
  const dark = makeImage(160, 160, (x) => (x === 19 || x === 20 ? [0, 0, 0] : [255, 255, 255]));
  const light = makeImage(160, 160, (x) => (x === 19 || x === 20 ? [255, 255, 255] : [0, 0, 0]));
  const opts = { longSide: 20, maxColors: 0, autoCrop: false, isolatedCleanup: false, minRegionSize: 0 };

  it('cell sampling alone loses a 2 px dark line', () => {
    const r = generatePattern(dark, BASIC_PALETTE, { ...opts, stroke: OFF });
    expect(column(r, 2)).not.toContain('K');
  });

  it('keeps a 2 px dark line on white', () => {
    const r = generatePattern(dark, BASIC_PALETTE, opts);
    expect(new Set(column(r, 2))).toEqual(new Set(['K']));
    expect(new Set(column(r, 1))).toEqual(new Set(['W']));
    expect(new Set(column(r, 3))).toEqual(new Set(['W']));
    expect(r.meta.strokeCells).toBe(20);
  });

  it('keeps a 2 px light line on black', () => {
    const r = generatePattern(light, BASIC_PALETTE, opts);
    expect(new Set(column(r, 2))).toEqual(new Set(['W']));
    expect(new Set(column(r, 5))).toEqual(new Set(['K']));
  });

  it('ignores edges of large areas and dense texture', () => {
    const half = makeImage(200, 200, (x) => (x < 103 ? [0, 0, 0] : [255, 255, 255]));
    const s = detectStrokes(half, { x: 0, y: 0, w: 200, h: 200 }, 20, 20, BASE_OPTIONS.stroke, 0.5)!;
    expect(s.kind.every((k) => k === STROKE_NONE)).toBe(true);
    // 2 px dark stripes every 4 px: "lines" everywhere, i.e. a mid-tone texture, not strokes
    const stripes = makeImage(200, 200, (x) => (x % 4 < 2 ? [0, 0, 0] : [255, 255, 255]));
    const t = detectStrokes(stripes, { x: 0, y: 0, w: 200, h: 200 }, 20, 20, BASE_OPTIONS.stroke, 0.5)!;
    expect(t.kind.every((k) => k === STROKE_NONE)).toBe(true);
  });

  it('caps the fine grid on large grids', () => {
    const big = makeImage(2000, 2000, () => [255, 255, 255]);
    const s = detectStrokes(big, { x: 0, y: 0, w: 2000, h: 2000 }, 200, 200, BASE_OPTIONS.stroke, 0.5)!;
    expect(s.fine).toBe(6);
  });

  it('reports kind per cell and skips sources too small for a finer grid', () => {
    const s = detectStrokes(dark, { x: 0, y: 0, w: 160, h: 160 }, 20, 20, BASE_OPTIONS.stroke, 0.5)!;
    expect(s.fine).toBe(8);
    expect(s.kind[5 * 20 + 2]).toBe(STROKE_DARK);
    const l = detectStrokes(light, { x: 0, y: 0, w: 160, h: 160 }, 20, 20, BASE_OPTIONS.stroke, 0.5)!;
    expect(l.kind[5 * 20 + 2]).toBe(STROKE_LIGHT);
    expect(detectStrokes(dark, { x: 0, y: 0, w: 160, h: 160 }, 60, 60, BASE_OPTIONS.stroke, 0.5)).toBeNull();
  });
});

describe('edge snapping', () => {
  // hard-edged disk on white: with a plain area mean the rim cells would be light grey-green blends
  const disk = makeImage(100, 100, (x, y) => ((x - 50.5) ** 2 + (y - 50.5) ** 2 < 900 ? [32, 160, 64] : [255, 255, 255]));
  const opts = { longSide: 20, maxColors: 0, autoCrop: false, isolatedCleanup: false, minRegionSize: 0, stroke: OFF };

  it('snaps anti-aliased rim cells to one side', () => {
    const r = generatePattern(disk, BASIC_PALETTE, opts);
    expect(r.palette.map((p) => p.key).sort()).toEqual(['G', 'W']);
    expect(r.meta.edgeSnapped).toBeGreaterThan(0);
  });

  it('leaves blends alone when disabled, and leaves smooth gradients alone', () => {
    const off = generatePattern(disk, BASIC_PALETTE, { ...opts, edgeSnap: { ...BASE_OPTIONS.edgeSnap, enabled: false } });
    expect(off.palette.length).toBeGreaterThan(2);
    const ramp = makeImage(200, 20, (x) => [Math.round((x / 199) * 255), Math.round((x / 199) * 255), Math.round((x / 199) * 255)]);
    const r = generatePattern(ramp, BASIC_PALETTE, { ...opts, cols: 20, rows: 2 });
    expect(r.meta.edgeSnapped).toBe(0);
  });
});
