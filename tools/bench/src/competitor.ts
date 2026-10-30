/**
 * Read a competitor's exported pattern sheet (user-supplied screenshot / export image) back into
 * a PatternResult so it can be scored with the same metrics. Built for 豆格 exports: a square
 * N x N grid of light-grey lines, each bead cell filled with its color and printed with its code;
 * empty cells are plain white. Nothing here talks to any competitor service.
 */
import { createMatcher, EMPTY_CELL, preparePalette, rgbToHex, srgb8ToLinear, pointFromLinear, ciede2000, type PatternResult, type RgbaImage } from '@pd/pattern-core';

export interface ExtractedColor {
  /** Color as shown in the competitor's sheet. */
  hex: string;
  /** Nearest color of our palette and the CIEDE2000 gap to it. */
  nearestKey: string;
  nearestHex: string;
  deltaE: number;
  count: number;
}

export interface Extracted {
  /** Pattern using the competitor's displayed colors (keys are "~" + nearest palette key). */
  result: PatternResult;
  colors: ExtractedColor[];
  gridN: number;
  cellPx: number;
  /** Max CIEDE2000 between a cell's sampled color and the palette color it was snapped to. */
  maxSnapDE: number;
  meanSnapDE: number;
}

const isLineGrey = (d: RgbaImage["data"], i: number) => {
  const r = d[i];
  const g = d[i + 1];
  const b = d[i + 2];
  return Math.max(r, g, b) - Math.min(r, g, b) < 8 && r >= 200 && r <= 242;
};

function peaks(profile: Float64Array, threshold: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] > threshold && profile[i] >= profile[i - 1] && profile[i] >= profile[i + 1]) {
      if (out.length && i - out[out.length - 1] <= 2) continue; // merge 1-2px wide lines
      out.push(i);
    }
  }
  return out;
}

export function extractGrid(img: RgbaImage, palette: { key: string; hex: string }[], gridN = 72): Extracted {
  const { width: W, height: H, data } = img;
  // vertical grid lines: columns with many light-grey pixels in the upper part of the sheet
  const y0 = Math.round(H * 0.06);
  const y1 = Math.round(H * 0.75);
  const colP = new Float64Array(W);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (isLineGrey(data, (y * W + x) * 4)) colP[x]++;
  const cols = peaks(colP, (y1 - y0) * 0.3);
  if (cols.length < 2) throw new Error('grid columns not found');
  const gx0 = cols[0];
  const cell = (cols[cols.length - 1] - gx0) / gridN;
  const rowP = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = gx0; x < gx0 + gridN * cell; x++) if (isLineGrey(data, (y * W + Math.round(x)) * 4)) rowP[y]++;
  const rows = peaks(rowP, gridN * cell * 0.3);
  if (!rows.length) throw new Error('grid rows not found');
  const gy0 = rows[0];

  const pal = preparePalette(palette);
  const exact = new Map(pal.colors.map((c, i) => [c.hex, i]));
  const matcher = createMatcher(pal, 'ciede2000');
  const index = new Int32Array(gridN * gridN).fill(-1);
  // raw displayed colors are interned; index[] holds raw color ids
  const rawIds = new Map<number, number>();
  const raw: { rgb: [number, number, number]; near: number; d: number }[] = [];
  let snapMax = 0;
  let snapSum = 0;
  let snapN = 0;
  const counts = new Map<number, number>();
  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const xa = Math.round(gx0 + (c + 0.2) * cell);
      const xb = Math.round(gx0 + (c + 0.8) * cell);
      const ya = Math.round(gy0 + (r + 0.2) * cell);
      const yb = Math.round(gy0 + (r + 0.8) * cell);
      counts.clear();
      let n = 0;
      for (let y = ya; y < yb; y++)
        for (let x = xa; x < xb; x++) {
          const i = (y * W + x) * 4;
          const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
          n++;
        }
      let mode = 0;
      let modeN = -1;
      counts.forEach((v, k) => {
        if (v > modeN) {
          modeN = v;
          mode = k;
        }
      });
      const mr = mode >> 16;
      const mg = (mode >> 8) & 255;
      const mb = mode & 255;
      // a printed code (contrasting text) marks a bead; plain cells are empty
      let text = 0;
      for (let y = ya; y < yb; y++)
        for (let x = xa; x < xb; x++) {
          const i = (y * W + x) * 4;
          if (Math.abs(data[i] - mr) + Math.abs(data[i + 1] - mg) + Math.abs(data[i + 2] - mb) > 90) text++;
        }
      if (text / n < 0.02) continue;
      let id = rawIds.get(mode);
      if (id === undefined) {
        const hex = rgbToHex([mr, mg, mb]);
        const pt = pointFromLinear(srgb8ToLinear([mr, mg, mb]));
        const near = exact.get(hex) ?? matcher.nearest(pt);
        id = raw.length;
        raw.push({ rgb: [mr, mg, mb], near, d: ciede2000(pt.lab, pal.colors[near].lab) });
        rawIds.set(mode, id);
      }
      snapMax = Math.max(snapMax, raw[id].d);
      snapSum += raw[id].d;
      snapN++;
      index[r * gridN + c] = id;
    }
  }

  // content rows / cols: bounding box of beads (豆格 letterboxes non-square images inside the square grid)
  let minR = gridN;
  let maxR = -1;
  let minC = gridN;
  let maxC = -1;
  for (let r = 0; r < gridN; r++)
    for (let c = 0; c < gridN; c++)
      if (index[r * gridN + c] >= 0) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
  if (maxR < 0) throw new Error('no beads found');
  const cw = maxC - minC + 1;
  const ch = maxR - minR + 1;
  const used = new Map<number, number>();
  const cells = new Uint16Array(cw * ch);
  for (let r = 0; r < ch; r++)
    for (let c = 0; c < cw; c++) {
      const p = index[(r + minR) * gridN + c + minC];
      if (p < 0) {
        cells[r * cw + c] = EMPTY_CELL;
        continue;
      }
      if (!used.has(p)) used.set(p, used.size);
      cells[r * cw + c] = used.get(p)!;
    }
  const order = Array.from(used.keys());
  const stat = order.map(() => 0);
  for (const v of cells) if (v !== EMPTY_CELL) stat[v]++;
  const result: PatternResult = {
    cols: cw,
    rows: ch,
    cells,
    palette: order.map((p) => ({ key: '~' + pal.colors[raw[p].near].key, hex: rgbToHex(raw[p].rgb) })),
    stats: order.map((p, i) => ({ key: '~' + pal.colors[raw[p].near].key, hex: rgbToHex(raw[p].rgb), count: stat[i] })),
    sourceGrid: { cols: cw, rows: ch },
    offset: { x: 0, y: 0 },
    sourceRegion: { x: 0, y: 0, w: 0, h: 0 }, // filled in by the caller (whole source image)
    timings: {},
    meta: { gridN, cellPx: Number(cell.toFixed(2)) },
  };
  const colors: ExtractedColor[] = order
    .map((p, i) => ({ hex: rgbToHex(raw[p].rgb), nearestKey: pal.colors[raw[p].near].key, nearestHex: pal.colors[raw[p].near].hex, deltaE: raw[p].d, count: stat[i] }))
    .sort((a, b) => b.count - a.count);
  return { result, colors, gridN, cellPx: cell, maxSnapDE: snapMax, meanSnapDE: snapN ? snapSum / snapN : 0 };
}

