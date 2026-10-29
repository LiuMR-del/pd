/**
 * Baseline: the original perler-beads conversion pipeline, kept for comparison.
 *
 * Derived from perler-beads:
 *   Source:   https://github.com/Zippland/perler-beads
 *   Commit:   2efee730f73dd4eb472ebde443a022d11f98bc21
 *   Original: src/utils/pixelation.ts (calculateCellRepresentativeColor, calculatePixelGrid,
 *             findClosestPaletteColor) and src/app/page.tsx (global similar-color merging in
 *             pixelateImage, default similarity threshold 30; handleAutoRemoveBackground)
 *   License:  AGPL-3.0
 *   Changes:  Reads an RgbaImage instead of a CanvasRenderingContext2D; returns the shared
 *             PatternResult structure; removed console logging and React state; behaviour of the
 *             dominant / average sampling, Oklab nearest color and frequency-ordered merging is
 *             otherwise unchanged (exact-RGB dominant vote, sRGB-space average).
 */
import { oklabDistance } from '../color/distance';
import { preparePalette, type PaletteInput, type PreparedPalette } from '../color/palette';
import { pointFromLinear } from '../color/distance';
import { srgb8ToLinear, type Vec3 } from '../color/convert';
import { buildResult } from '../pipeline';
import type { PatternResult, RgbaImage } from '../types';

export type BaselineMode = 'dominant' | 'average';

export interface BaselineOptions {
  cols: number;
  rows: number;
  mode: BaselineMode;
  /** Oklab distance x100; perler-beads default is 30. 0 disables merging. */
  similarityThreshold?: number;
  /** Apply perler-beads' one-click background removal (most frequent border color, flood fill). */
  removeBackground?: boolean;
  now?: () => number;
}

/**
 * perler-beads one-click background removal: take the most frequent color on the border and
 * flood-fill (4-connected) from all border cells of exactly that color. Returns removed count.
 */
export function baselineRemoveBackground(index: Int32Array, cols: number, rows: number): number {
  const borderCounts = new Map<number, number>();
  const borderCells: number[] = [];
  for (let x = 0; x < cols; x++) {
    borderCells.push(x);
    if (rows > 1) borderCells.push((rows - 1) * cols + x);
  }
  for (let y = 1; y < rows - 1; y++) {
    borderCells.push(y * cols);
    if (cols > 1) borderCells.push(y * cols + cols - 1);
  }
  for (const i of borderCells) if (index[i] >= 0) borderCounts.set(index[i], (borderCounts.get(index[i]) ?? 0) + 1);
  if (borderCounts.size === 0) return 0;
  let target = -1;
  let maxCount = -1;
  borderCounts.forEach((count, key) => {
    if (count > maxCount) {
      maxCount = count;
      target = key;
    }
  });
  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const push = (i: number) => {
    if (visited[i] || index[i] !== target) return;
    visited[i] = 1;
    stack.push(i);
  };
  for (const i of borderCells) push(i);
  let removed = 0;
  while (stack.length) {
    const i = stack.pop()!;
    index[i] = -1;
    removed++;
    const x = i % cols;
    const y = (i / cols) | 0;
    if (y > 0) push(i - cols);
    if (y < rows - 1) push(i + cols);
    if (x > 0) push(i - 1);
    if (x < cols - 1) push(i + 1);
  }
  return removed;
}

function cellColor(image: RgbaImage, sx: number, sy: number, w: number, h: number, mode: BaselineMode): Vec3 | null {
  const { data, width } = image;
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let n = 0;
  const counts = new Map<number, number>();
  let dominant: Vec3 | null = null;
  let maxCount = 0;
  for (let y = sy; y < sy + h; y++) {
    for (let x = sx; x < sx + w; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      n++;
      if (mode === 'average') {
        rs += r;
        gs += g;
        bs += b;
      } else {
        const key = (r << 16) | (g << 8) | b;
        const c = (counts.get(key) ?? 0) + 1;
        counts.set(key, c);
        if (c > maxCount) {
          maxCount = c;
          dominant = [r, g, b];
        }
      }
    }
  }
  if (n === 0) return null;
  return mode === 'average' ? [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)] : dominant;
}

function closest(rgb: Vec3, palette: PreparedPalette): number {
  const p = pointFromLinear(srgb8ToLinear(rgb));
  let best = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < palette.colors.length; i++) {
    const d = oklabDistance(p, palette.colors[i]);
    if (d < best) {
      best = d;
      bestIdx = i;
    }
    if (d === 0) break;
  }
  return bestIdx;
}

export function baselinePattern(image: RgbaImage, paletteInput: readonly PaletteInput[], opts: BaselineOptions): PatternResult {
  const now = opts.now ?? (() => Date.now());
  const t0 = now();
  const palette = preparePalette(paletteInput);
  const { cols: N, rows: M } = opts;
  const cw = image.width / N;
  const ch = image.height / M;
  const index = new Int32Array(N * M).fill(-1);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const sx = Math.floor(i * cw);
      const sy = Math.floor(j * ch);
      const ex = Math.min(image.width, Math.ceil((i + 1) * cw));
      const ey = Math.min(image.height, Math.ceil((j + 1) * ch));
      const rgb = cellColor(image, sx, sy, Math.max(1, ex - sx), Math.max(1, ey - sy), opts.mode);
      if (rgb) index[j * N + i] = closest(rgb, palette);
    }
  }
  const t1 = now();

  const threshold = opts.similarityThreshold ?? 30;
  let merged = 0;
  if (threshold > 0) {
    const counts = new Map<number, number>();
    for (let i = 0; i < index.length; i++) if (index[i] >= 0) counts.set(index[i], (counts.get(index[i]) ?? 0) + 1);
    // stable sort by frequency, like Object.entries(...).sort in the original
    const byFreq = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const replaced = new Set<number>();
    for (let a = 0; a < byFreq.length; a++) {
      const cur = byFreq[a];
      if (replaced.has(cur)) continue;
      for (let b = a + 1; b < byFreq.length; b++) {
        const low = byFreq[b];
        if (replaced.has(low)) continue;
        if (oklabDistance(palette.colors[cur], palette.colors[low]) < threshold) {
          replaced.add(low);
          merged++;
          for (let i = 0; i < index.length; i++) if (index[i] === low) index[i] = cur;
        }
      }
    }
  }
  let bgRemoved = 0;
  if (opts.removeBackground) bgRemoved = baselineRemoveBackground(index, N, M);
  const t2 = now();
  const result = buildResult(index, N, M, palette, { cols: N, rows: M }, { x: 0, y: 0 }, { x: 0, y: 0, w: image.width, h: image.height }, { baseline: opts.mode, mergedColors: merged, backgroundRemoved: bgRemoved });
  result.timings = { sample: t1 - t0, post: t2 - t1, total: now() - t0 };
  return result;
}
