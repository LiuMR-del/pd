import { describe, expect, it } from 'vitest';
import { srgb8ToLinear } from '../src/color/convert';
import { getDistanceFn, pointFromLinear } from '../src/color/distance';
import { createMatcher, preparePalette } from '../src/color/palette';
import { ditherCells } from '../src/dither/errorDiffusion';
import { resampleLinear } from '../src/image/resample';
import { removeBackground } from '../src/post/background';
import { mergeSmallRegions, removeIsolated } from '../src/post/cleanup';
import { autoCrop } from '../src/post/crop';
import { limitColors } from '../src/reduce/limitColors';
import { sampleCells, type CellSampleOptions } from '../src/sample/cell';
import { BASIC_PALETTE, makeImage } from './helpers';

const palette = preparePalette(BASIC_PALETTE);
const idx = (key: string) => palette.colors.findIndex((c) => c.key === key);
const dist = getDistanceFn('ciede2000');
const SAMPLE: CellSampleOptions = {
  k: 3,
  centerWeight: 2,
  mode: 'vote',
  darkLine: { enabled: true, luma: 45, ratio: 0.3 },
  flatThreshold: 6,
  alphaThreshold: 0.5,
};

function gridFrom(rows: string[]): { index: Int32Array; cols: number; rows: number } {
  const r = rows.map((s) => s.split(' '));
  const index = new Int32Array(r.length * r[0].length);
  r.forEach((row, y) => row.forEach((k, x) => (index[y * row.length + x] = k === '.' ? -1 : idx(k))));
  return { index, cols: r[0].length, rows: r.length };
}
function keys(index: Int32Array, cols: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < index.length; i += cols)
    out.push(Array.from(index.slice(i, i + cols), (p) => (p < 0 ? '.' : palette.colors[p].key)).join(' '));
  return out;
}
const targetsOf = (index: Int32Array) => Array.from(index, (p) => (p < 0 ? null : palette.colors[p]));

describe('sampleCells', () => {
  const m = createMatcher(palette, 'ciede2000');

  it('keeps a thin dark line (dark-line protection beats the light majority)', () => {
    // one cell = 9x9 px; a 3px black vertical line at the right edge (1/3 of the area)
    const img = makeImage(9, 9, (x) => (x >= 6 ? [0, 0, 0] : [255, 255, 255]));
    const sub = resampleLinear(img, 3, 3);
    const on = sampleCells(sub, 1, 1, palette, m, SAMPLE);
    expect(palette.colors[on.index[0]].key).toBe('K');
    expect(on.darkLineCount + on.votedCount).toBeGreaterThan(0);
    const off = sampleCells(sub, 1, 1, palette, m, { ...SAMPLE, darkLine: { ...SAMPLE.darkLine, enabled: false } });
    expect(palette.colors[off.index[0]].key).toBe('W');
  });

  it('does not protect dark when the surroundings are dark (light stroke on dark background)', () => {
    // 3x3 cells of 9px on dark blue; a 6px white stroke covers 2/3 of the middle column (dark share 1/3)
    const img = makeImage(27, 27, (x) => (x >= 12 && x < 18 ? [255, 255, 255] : [20, 40, 100]));
    const sub = resampleLinear(img, 9, 9);
    const s = sampleCells(sub, 3, 3, palette, m, SAMPLE);
    expect(palette.colors[s.index[4]].key).toBe('W');
    expect(s.darkLineCount).toBe(0);
  });

  it('still protects a dark line on a light background inside a larger grid', () => {
    // 3x3 cells of 9px, white; 3px black vertical line at the right edge of the middle cell
    const img = makeImage(27, 27, (x) => (x >= 15 && x < 18 ? [0, 0, 0] : [255, 255, 255]));
    const s = sampleCells(resampleLinear(img, 9, 9), 3, 3, palette, m, SAMPLE);
    expect(palette.colors[s.index[4]].key).toBe('K');
    expect(s.darkLineCount).toBeGreaterThan(0);
  });

  it('uses the mean for flat cells and marks transparent cells empty', () => {
    const img = makeImage(6, 3, (x) => (x < 3 ? [128, 128, 128, 255] : [0, 0, 0, 0]));
    const sub = resampleLinear(img, 6, 3);
    const s = sampleCells(sub, 2, 1, palette, m, SAMPLE);
    expect(palette.colors[s.index[0]].key).toBe('G50');
    expect(s.index[1]).toBe(-1);
    expect(s.flatCount).toBe(1);
  });

  it('center mode uses only the central sub-sample', () => {
    const img = makeImage(3, 3, (x, y) => (x === 1 && y === 1 ? [220, 30, 30] : [255, 255, 255]));
    const sub = resampleLinear(img, 3, 3);
    const s = sampleCells(sub, 1, 1, palette, m, { ...SAMPLE, mode: 'center' });
    expect(palette.colors[s.index[0]].key).toBe('R');
  });
});

describe('limitColors', () => {
  it('caps colors and protects a small salient color', () => {
    // big areas of near-greys and a tiny red dot
    const rows: string[] = [];
    for (let y = 0; y < 10; y++) {
      const r: string[] = [];
      for (let x = 0; x < 10; x++) r.push(y === 5 && x === 5 ? 'R' : x < 3 ? 'W' : x < 5 ? 'G75' : x < 7 ? 'G50' : x < 9 ? 'G25' : 'K');
      rows.push(r.join(' '));
    }
    const g = gridFrom(rows);
    const res = limitColors(g.index, targetsOf(g.index), g.cols, g.rows, palette, 'ciede2000', dist, {
      maxColors: 3,
      countExponent: 0.65,
      saliency: { enabled: true, chroma: 45, contrast: 35, maxShare: 0.02, darkL: 22, weight: 6 },
      refine: true,
    });
    expect(res.before).toBe(6);
    expect(res.allowed.length).toBeLessThanOrEqual(3);
    expect(palette.colors[res.index[55]].key).toBe('R');

    const noProt = limitColors(g.index, targetsOf(g.index), g.cols, g.rows, palette, 'ciede2000', dist, {
      maxColors: 3,
      countExponent: 0.65,
      saliency: { enabled: false, chroma: 45, contrast: 35, maxShare: 0.02, darkL: 22, weight: 6 },
      refine: true,
    });
    expect(palette.colors[noProt.index[55]].key).not.toBe('R');
  });

  it('is a no-op under the cap', () => {
    const g = gridFrom(['W K', 'R R']);
    const res = limitColors(g.index, targetsOf(g.index), 2, 2, palette, 'oklab', getDistanceFn('oklab'), {
      maxColors: 5,
      countExponent: 0.65,
      saliency: { enabled: true, chroma: 45, contrast: 35, maxShare: 0.02, darkL: 22, weight: 6 },
      refine: true,
    });
    expect(res.index).toBe(g.index);
  });
});

describe('ditherCells', () => {
  const m = createMatcher(palette, 'ciede2000', [idx('W'), idx('K')]);
  const cols = 16;
  const rows = 4;
  const targets = Array.from({ length: cols * rows }, (_, i) => pointFromLinear(srgb8ToLinear([((i % cols) * 255) / 15, ((i % cols) * 255) / 15, ((i % cols) * 255) / 15])));
  const index = new Int32Array(cols * rows).fill(0);

  it('strength 0 equals nearest-color mapping', () => {
    const out = ditherCells(index, targets, cols, rows, palette, m, 0);
    targets.forEach((t, i) => expect(out[i]).toBe(m.nearest(t)));
  });

  it('strength 1 mixes black and white across a grey ramp', () => {
    const plain = ditherCells(index, targets, cols, rows, palette, m, 0);
    const out = ditherCells(index, targets, cols, rows, palette, m, 1);
    let diff = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== plain[i]) diff++;
    expect(diff).toBeGreaterThan(4);
    // the middle columns contain both colors
    const mid = Array.from({ length: rows }, (_, y) => out[y * cols + 8]).concat(Array.from({ length: rows }, (_, y) => out[y * cols + 7]));
    expect(new Set(mid).size).toBe(2);
  });

  it('skips empty cells', () => {
    const ix = index.slice();
    ix[3] = -1;
    const out = ditherCells(ix, targets, cols, rows, palette, m, 1);
    expect(out[3]).toBe(-1);
  });
});

describe('cleanup', () => {
  it('removes isolated low-contrast cells but keeps high-contrast details', () => {
    const g = gridFrom(['G50 G50 G50 G50 G50', 'G50 G75 G50 G50 G50', 'G50 G50 G50 W G50', 'G50 G50 G50 G50 G50']);
    // G75 (~ΔE 25 from G50) is replaced; W (high contrast) kept with protect=30
    const changed = removeIsolated(g.index, g.cols, g.rows, palette, dist, 30);
    const k = keys(g.index, g.cols);
    expect(k[1]).toBe('G50 G50 G50 G50 G50');
    expect(k[2]).toBe('G50 G50 G50 W G50');
    expect(changed).toBe(1);
  });

  it('merges regions smaller than N into the nearest neighbor color', () => {
    const g = gridFrom(['W W K K', 'W G75 K K', 'W G75 K K', 'W W K K']);
    mergeSmallRegions(g.index, g.cols, g.rows, palette, dist, 3, 100);
    expect(keys(g.index, g.cols)[1]).toBe('W W K K');
  });

  it('respects the contrast protection when merging regions', () => {
    const g = gridFrom(['K K K', 'K W K', 'K K K']);
    expect(mergeSmallRegions(g.index, g.cols, g.rows, palette, dist, 3, 30)).toBe(0);
  });
});

describe('removeBackground', () => {
  it('removes a white border-connected background, keeps the subject and enclosed white', () => {
    const rows: string[] = [];
    for (let y = 0; y < 8; y++) {
      const r: string[] = [];
      for (let x = 0; x < 8; x++) r.push(x >= 2 && x <= 5 && y >= 2 && y <= 5 ? (x >= 3 && x <= 4 && y >= 3 && y <= 4 ? 'W' : 'R') : 'W');
      rows.push(r.join(' '));
    }
    const g = gridFrom(rows);
    const removed = removeBackground(g.index, targetsOf(g.index), g.cols, g.rows, dist, { tolerance: 12, minBorderShare: 0.2, minRunRatio: 0.25 });
    expect(removed).toBe(64 - 16);
    const k = keys(g.index, g.cols);
    expect(k[0]).toBe('. . . . . . . .');
    expect(k[3]).toBe('. . R W W R . .');
  });

  it('handles two background colors along the border', () => {
    const g = gridFrom(['W W W Y Y Y', 'W W R R Y Y', 'W W R R Y Y', 'W W W Y Y Y']);
    removeBackground(g.index, targetsOf(g.index), g.cols, g.rows, dist, { tolerance: 12, minBorderShare: 0.2, minRunRatio: 0.25 });
    expect(keys(g.index, g.cols)[1]).toBe('. . R R . .');
  });

  it('does not treat a small border color as background', () => {
    const g = gridFrom(['W W W W W', 'W W W W W', 'W W R W W', 'W W R W W']);
    removeBackground(g.index, targetsOf(g.index), g.cols, g.rows, dist, { tolerance: 12, minBorderShare: 0.2, minRunRatio: 0.25 });
    expect(keys(g.index, g.cols)[3]).toBe('. . R . .');
  });
});

describe('removeBackground border runs', () => {
  it('keeps a white subject part that touches the frame through a short border run', () => {
    // white bg, red body touching the bottom edge, white belly inside the body also touching the bottom
    const g = gridFrom([
      'W W W W W W W W W W W W',
      'W W W W W W W W W W W W',
      'W W W R R R R R R W W W',
      'W W R R R R R R R R W W',
      'W W R R W W W W R R W W',
      'W W R R W W W W R R W W',
    ]);
    removeBackground(g.index, targetsOf(g.index), g.cols, g.rows, dist, { tolerance: 12, minBorderShare: 0.2, minRunRatio: 0.25 });
    const k = keys(g.index, g.cols);
    expect(k[5]).toBe('. . R R W W W W R R . .');
    expect(k[0]).toBe('. . . . . . . . . . . .');
  });

  it('still removes a background split into two long runs by the subject', () => {
    // red pole = 4 of 24 border cells (< minBorderShare), white split into two long runs
    const g = gridFrom(['W W W W R R W W W W', 'W W W W R R W W W W', 'W W W W R R W W W W', 'W W W W R R W W W W']);
    removeBackground(g.index, targetsOf(g.index), g.cols, g.rows, dist, { tolerance: 12, minBorderShare: 0.2, minRunRatio: 0.25 });
    expect(keys(g.index, g.cols)[2]).toBe('. . . . R R . . . .');
  });
});

describe('autoCrop', () => {
  it('trims empty borders and reports the offset', () => {
    const g = gridFrom(['. . . .', '. R K .', '. . W .', '. . . .']);
    const c = autoCrop(g.index, g.cols, g.rows);
    expect([c.cols, c.rows, c.x, c.y]).toEqual([2, 2, 1, 1]);
    expect(keys(c.index, c.cols)).toEqual(['R K', '. W']);
  });

  it('returns an empty grid when everything is empty', () => {
    const c = autoCrop(new Int32Array(4).fill(-1), 2, 2);
    expect([c.cols, c.rows]).toEqual([0, 0]);
  });
});
