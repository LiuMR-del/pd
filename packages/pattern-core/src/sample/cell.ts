import { SRGB_TO_LINEAR, srgb8ToLab, type Vec3 } from '../color/convert';
import { pointFromLinear, type ColorPoint } from '../color/distance';
import type { Matcher, PreparedPalette } from '../color/palette';
import type { LinearImage } from '../image/resample';

export interface DarkLineOptions {
  enabled: boolean;
  /** sRGB grey level (0..255) below which a sub-sample counts as dark (compared via its L*). */
  luma: number;
  /** Share of dark sub-samples at which the cell prefers a dark color. */
  ratio: number;
  /**
   * Only protect when the 8 neighboring cells are mostly light (their share of dark sub-samples
   * <= this) and at least one 4-neighbor is itself a light cell, i.e. a dark line on a light
   * background. Prevents light strokes on dark backgrounds from being swallowed. Default 0.5.
   */
  maxNeighborDark?: number;
}

export interface CellSampleOptions {
  /** Sub-samples per cell side (k x k). 1 = plain area average. */
  k: number;
  /** Vote weight of the central sub-samples (others weigh 1). */
  centerWeight: number;
  /** 'vote' = k x k matching + weighted vote; 'center' = use only the central sub-sample(s) (pixel art). */
  mode: 'vote' | 'center';
  darkLine: DarkLineOptions;
  /** Max ΔE76 of any sub-sample from the cell mean for the cell to count as flat (matched by mean only). */
  flatThreshold: number;
  /** Cells whose mean alpha is below this are empty. */
  alphaThreshold: number;
}

export interface SampledCells {
  cols: number;
  rows: number;
  /** Palette index per cell, -1 = empty. */
  index: Int32Array;
  /** Color each cell "wants" (cell mean for flat cells, the winning palette color for voted cells). */
  targets: (ColorPoint | null)[];
  /** Cell mean color (null for empty cells). */
  means: (ColorPoint | null)[];
  flatCount: number;
  votedCount: number;
  darkLineCount: number;
}

function lab76(a: Vec3, b: Vec3): number {
  const d0 = a[0] - b[0];
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

/**
 * Pick one palette color per cell from a k-times oversampled linear image (`sub` must be
 * cols*k x rows*k). Flat cells are matched by their mean; others by a center-weighted vote of
 * per-sub-sample matches, with dark-line protection.
 */
export function sampleCells(
  sub: LinearImage,
  cols: number,
  rows: number,
  palette: PreparedPalette,
  matcher: Matcher,
  opts: CellSampleOptions,
): SampledCells {
  const k = Math.max(1, Math.round(opts.k));
  if (sub.width !== cols * k || sub.height !== rows * k) throw new Error('sub-sample image size mismatch');
  const n = cols * rows;
  const index = new Int32Array(n).fill(-1);
  const targets: (ColorPoint | null)[] = new Array(n).fill(null);
  const means: (ColorPoint | null)[] = new Array(n).fill(null);
  const darkL = srgb8ToLab([opts.darkLine.luma, opts.darkLine.luma, opts.darkLine.luma])[0];

  // central sub-sample mask
  const c = (k - 1) / 2;
  const isCenter: boolean[] = [];
  for (let sy = 0; sy < k; sy++)
    for (let sx = 0; sx < k; sx++) isCenter.push(Math.abs(sx - c) < k / 4 + 0.01 && Math.abs(sy - c) < k / 4 + 0.01);

  // pre-pass: dark / valid sub-sample counts per cell (for the dark-line background check)
  const darkY = SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(opts.darkLine.luma)))];
  const cellDark = new Int32Array(n);
  const cellValid = new Int32Array(n);
  if (opts.darkLine.enabled && opts.mode === 'vote') {
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        let d = 0;
        let v = 0;
        for (let sy = 0; sy < k; sy++)
          for (let sx = 0; sx < k; sx++) {
            const si = (cy * k + sy) * sub.width + cx * k + sx;
            if (sub.alpha[si] < opts.alphaThreshold) continue;
            v++;
            if (0.2126729 * sub.lin[si * 3] + 0.7151522 * sub.lin[si * 3 + 1] + 0.072175 * sub.lin[si * 3 + 2] < darkY) d++;
          }
        cellDark[cy * cols + cx] = d;
        cellValid[cy * cols + cx] = v;
      }
  }
  const maxNeighborDark = opts.darkLine.maxNeighborDark ?? 0.5;
  const lightBackground = (cx: number, cy: number): boolean => {
    let d = 0;
    let v = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        d += cellDark[y * cols + x];
        v += cellValid[y * cols + x];
      }
    if (v === 0) return true;
    if (d / v > maxNeighborDark) return false;
    // the dark line must border a genuinely light cell; otherwise the "light" part is itself a thin
    // light stroke split across cells (e.g. white text on a dark background) and must survive
    const light = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < cols && y < rows && cellValid[y * cols + x] > 0 && cellDark[y * cols + x] / cellValid[y * cols + x] < opts.darkLine.ratio;
    return light(cx - 1, cy) || light(cx + 1, cy) || light(cx, cy - 1) || light(cx, cy + 1);
  };

  const subPts: (ColorPoint | null)[] = new Array(k * k);
  const subW = new Float64Array(k * k);
  const votes = new Map<number, number>();
  const darkVotes = new Map<number, number>();
  let flatCount = 0;
  let votedCount = 0;
  let darkLineCount = 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      let sa = 0;
      let mr = 0;
      let mg = 0;
      let mb = 0;
      let centerA = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (let sy = 0; sy < k; sy++) {
        for (let sx = 0; sx < k; sx++) {
          const si = (cy * k + sy) * sub.width + cx * k + sx;
          const a = sub.alpha[si];
          const r = sub.lin[si * 3];
          const g = sub.lin[si * 3 + 1];
          const b = sub.lin[si * 3 + 2];
          sa += a;
          mr += r * a;
          mg += g * a;
          mb += b * a;
          if (isCenter[sy * k + sx]) {
            centerA += a;
            cr += r * a;
            cg += g * a;
            cb += b * a;
          }
        }
      }
      if (sa / (k * k) < opts.alphaThreshold) continue;

      if (opts.mode === 'center') {
        const p = centerA > 1e-6 ? pointFromLinear([cr / centerA, cg / centerA, cb / centerA]) : pointFromLinear([mr / sa, mg / sa, mb / sa]);
        means[cell] = p;
        targets[cell] = p;
        index[cell] = matcher.nearest(p);
        flatCount++;
        continue;
      }

      const mean = pointFromLinear([mr / sa, mg / sa, mb / sa]);
      means[cell] = mean;

      // per-sub-sample colors and flatness test
      let maxDev = 0;
      if (k > 1) {
        for (let s = 0; s < k * k; s++) {
          const sy = (s / k) | 0;
          const sx = s % k;
          const si = (cy * k + sy) * sub.width + cx * k + sx;
          const a = sub.alpha[si];
          if (a < opts.alphaThreshold) {
            subPts[s] = null;
            continue;
          }
          const p = pointFromLinear([sub.lin[si * 3], sub.lin[si * 3 + 1], sub.lin[si * 3 + 2]]);
          subPts[s] = p;
          subW[s] = isCenter[s] ? opts.centerWeight : 1;
          const dev = lab76(p.lab, mean.lab);
          if (dev > maxDev) maxDev = dev;
        }
      }

      if (k === 1 || maxDev <= opts.flatThreshold) {
        index[cell] = matcher.nearest(mean);
        targets[cell] = mean;
        flatCount++;
        continue;
      }

      votes.clear();
      darkVotes.clear();
      let total = 0;
      let dark = 0;
      for (let s = 0; s < k * k; s++) {
        const p = subPts[s];
        if (!p) continue;
        const idx = matcher.nearest(p);
        votes.set(idx, (votes.get(idx) ?? 0) + subW[s]);
        total++;
        if (p.lab[0] < darkL) {
          dark++;
          darkVotes.set(idx, (darkVotes.get(idx) ?? 0) + subW[s]);
        }
      }
      let winner = pickMax(votes);
      if (opts.darkLine.enabled && total > 0 && dark / total >= opts.darkLine.ratio && palette.colors[winner].lab[0] >= darkL && lightBackground(cx, cy)) {
        const darkWinner = pickMax(darkVotes);
        if (darkWinner >= 0) {
          winner = darkWinner;
          darkLineCount++;
        }
      }
      if (winner < 0) winner = matcher.nearest(mean);
      index[cell] = winner;
      targets[cell] = palette.colors[winner];
      votedCount++;
    }
  }
  return { cols, rows, index, targets, means, flatCount, votedCount, darkLineCount };
}

function pickMax(votes: Map<number, number>): number {
  let best = -1;
  let bestW = -Infinity;
  votes.forEach((w, idx) => {
    if (w > bestW || (w === bestW && idx < best)) {
      bestW = w;
      best = idx;
    }
  });
  return best;
}
