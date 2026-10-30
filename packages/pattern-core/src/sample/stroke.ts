import type { Vec3 } from '../color/convert';
import { pointFromLinear, type ColorPoint } from '../color/distance';
import type { Matcher, PreparedPalette } from '../color/palette';
import { resampleLinear, type Rect } from '../image/resample';
import type { RgbaImage } from '../types';

export interface StrokeOptions {
  enabled: boolean;
  /** Detect dark strokes thinner than a cell (outlines, dark text on light). */
  dark: boolean;
  /** Detect light strokes thinner than a cell (light text on dark, highlights). */
  light: boolean;
  /** L* difference between a stroke pixel and its local background (morphological top-hat). */
  contrast: number;
  /** Share of a cell's fine samples that must be stroke pixels. */
  minCoverage: number;
  /** Max share of stroke-toned pixels around the cell (else it is not a thin stroke on a background). */
  maxContext: number;
  /** Max share of stroke (top-hat) pixels around the cell; above it the area is a texture. */
  maxDensity: number;
  /** Context window radius in cells (1 = 3x3, 2 = 5x5). */
  contextRadius: number;
  /** Upper bound of fine samples per cell side (also limited by the source resolution). */
  maxFine: number;
}

/** Upper bound of fine-grid pixels (100x100 cells at f=8 is 640k). */
export const MAX_FINE_PIXELS = 1_500_000;

export const STROKE_NONE = 0;
export const STROKE_DARK = 1;
export const STROKE_LIGHT = 2;

export interface StrokeCells {
  /** Fine samples per cell side actually used. */
  fine: number;
  /** STROKE_NONE / STROKE_DARK / STROKE_LIGHT per cell. */
  kind: Uint8Array;
  /** Linear-light stroke color per cell (3 per cell; valid where kind != NONE). */
  color: Float32Array;
  /** Stroke coverage per cell (0..1). */
  coverage: Float32Array;
}

function lstar(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * Separable square max (dilate) / min (erode) filter with window 2r+1, clipped at the borders.
 * Both passes walk memory row by row (the vertical pass compares whole rows), which keeps it
 * cache friendly; r is small (<= 8), so the direct window beats fancier algorithms here.
 */
function morph(src: Float32Array, w: number, h: number, r: number, max: boolean, tmp: Float32Array, out: Float32Array): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = x - r < 0 ? 0 : x - r;
      const b = x + r >= w ? w - 1 : x + r;
      let v = src[row + a];
      if (max) for (let j = a + 1; j <= b; j++) v = src[row + j] > v ? src[row + j] : v;
      else for (let j = a + 1; j <= b; j++) v = src[row + j] < v ? src[row + j] : v;
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r;
    const b = y + r >= h ? h - 1 : y + r;
    const dst = y * w;
    out.set(tmp.subarray(a * w, a * w + w), dst);
    for (let k = a + 1; k <= b; k++) {
      const s = k * w;
      if (max) for (let x = 0; x < w; x++) out[dst + x] = tmp[s + x] > out[dst + x] ? tmp[s + x] : out[dst + x];
      else for (let x = 0; x < w; x++) out[dst + x] = tmp[s + x] < out[dst + x] ? tmp[s + x] : out[dst + x];
    }
  }
}

/**
 * Find strokes thinner than one cell on a near-native "fine" grid (cols*f x rows*f) via
 * morphological top-hats on L*: black top-hat (closing - L) marks dark lines, white top-hat
 * (L - opening) marks light lines. Large dark/light areas and plain edges score 0, so only thin
 * features are reported. Area averaging to k x k sub-samples dilutes such strokes into mid-tones,
 * which is why the cell vote alone loses outlines and small text.
 * Returns null when the source is too small for a finer grid than the k x k sub-samples.
 */
export function detectStrokes(image: RgbaImage, region: Rect, cols: number, rows: number, opts: StrokeOptions, alphaThreshold: number, minFine = 4): StrokeCells | null {
  if (!opts.enabled || (!opts.dark && !opts.light)) return null;
  let f = Math.min(Math.max(1, Math.floor(opts.maxFine)), Math.floor(Math.min(region.w / cols, region.h / rows)));
  // bound time and memory on large grids (no JIT in WeChat's iOS Worker): 200x200 cells drop to f=6
  while (f > minFine && cols * f * rows * f > MAX_FINE_PIXELS) f--;
  if (f < minFine) return null;
  const w = cols * f;
  const h = rows * f;
  const fine = resampleLinear(image, w, h, region);
  const n = w * h;
  const L = new Float32Array(n);
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    opaque[i] = fine.alpha[i] >= alphaThreshold ? 1 : 0;
    L[i] = lstar(0.2126729 * fine.lin[i * 3] + 0.7151522 * fine.lin[i * 3 + 1] + 0.072175 * fine.lin[i * 3 + 2]);
  }
  const r = Math.max(1, Math.floor(f / 2));
  const tmp = new Float32Array(n);
  const a = new Float32Array(n);
  const closing = opts.dark ? new Float32Array(n) : null;
  const opening = opts.light ? new Float32Array(n) : null;
  if (closing) {
    // transparent pixels are ignored by both passes, so an outline next to transparency still counts
    for (let i = 0; i < n; i++) a[i] = opaque[i] ? L[i] : -Infinity;
    morph(a, w, h, r, true, tmp, closing);
    for (let i = 0; i < n; i++) a[i] = opaque[i] ? closing[i] : Infinity;
    morph(a, w, h, r, false, tmp, closing);
  }
  if (opening) {
    for (let i = 0; i < n; i++) a[i] = opaque[i] ? L[i] : Infinity;
    morph(a, w, h, r, false, tmp, opening);
    for (let i = 0; i < n; i++) a[i] = opaque[i] ? opening[i] : -Infinity;
    morph(a, w, h, r, true, tmp, opening);
  }

  const cells = cols * rows;
  const kind = new Uint8Array(cells);
  const color = new Float32Array(cells * 3);
  const coverage = new Float32Array(cells);
  // pass 1: per-cell counts of opaque / dark-stroke / light-stroke fine pixels (+ top-hat sums)
  const cValid = new Int32Array(cells);
  const cDark = new Int32Array(cells);
  const cLight = new Int32Array(cells);
  const sDark = new Float64Array(cells);
  const sLight = new Float64Array(cells);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      for (let sy = 0; sy < f; sy++) {
        const row = (cy * f + sy) * w + cx * f;
        for (let sx = 0; sx < f; sx++) {
          const i = row + sx;
          if (!opaque[i]) continue;
          cValid[cell]++;
          if (closing) {
            const d = closing[i] - L[i];
            if (d >= opts.contrast) {
              cDark[cell]++;
              sDark[cell] += d;
            }
          }
          if (opening) {
            const d = L[i] - opening[i];
            if (d >= opts.contrast) {
              cLight[cell]++;
              sLight[cell] += d;
            }
          }
        }
      }
    }
  }

  const cr = Math.max(1, Math.round(opts.contextRadius));
  const acc: Vec3 = [0, 0, 0];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      const valid = cValid[cell];
      if (!valid) continue;
      const dc = cDark[cell] / valid;
      const lc = cLight[cell] / valid;
      const darkOk = dc >= opts.minCoverage;
      const lightOk = lc >= opts.minCoverage;
      if (!darkOk && !lightOk) continue;
      // context window in cells
      const gx0 = Math.max(0, cx - cr);
      const gx1 = Math.min(cols - 1, cx + cr);
      const gy0 = Math.max(0, cy - cr);
      const gy1 = Math.min(rows - 1, cy + cr);
      let nearValid = 0;
      let nearDark = 0;
      let nearLight = 0;
      for (let gy = gy0; gy <= gy1; gy++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const g = gy * cols + gx;
          nearValid += cValid[g];
          nearDark += cDark[g];
          nearLight += cLight[g];
        }
      // both present (e.g. light text with dark counters): try the stronger one first
      const order: boolean[] = darkOk && lightOk ? (dc * sDark[cell] >= lc * sLight[cell] ? [true, false] : [false, true]) : [darkOk];
      for (const dark of order) {
        // context (1): a stroke is not part of a texture full of strokes (dense hatching reads as a
        // mid-tone, not as separate lines)
        if ((dark ? nearDark : nearLight) > opts.maxDensity * nearValid) continue;
        const hat = (i: number) => (dark ? closing![i] - L[i] : L[i] - opening![i]);
        // stroke color and levels from the stroke core (top-hat >= 60% of the cell's peak), so
        // anti-aliased rims do not wash the color out
        let peak = 0;
        for (let sy = 0; sy < f; sy++) {
          const row = (cy * f + sy) * w + cx * f;
          for (let sx = 0; sx < f; sx++) if (opaque[row + sx]) peak = Math.max(peak, hat(row + sx));
        }
        const core = Math.max(opts.contrast, 0.6 * peak);
        acc[0] = acc[1] = acc[2] = 0;
        let wsum = 0;
        let strokeL = 0;
        let backL = 0;
        let cnt = 0;
        for (let sy = 0; sy < f; sy++) {
          const row = (cy * f + sy) * w + cx * f;
          for (let sx = 0; sx < f; sx++) {
            const i = row + sx;
            if (!opaque[i]) continue;
            const d = hat(i);
            if (d < core) continue;
            const wt = d * d;
            acc[0] += fine.lin[i * 3] * wt;
            acc[1] += fine.lin[i * 3 + 1] * wt;
            acc[2] += fine.lin[i * 3 + 2] * wt;
            wsum += wt;
            strokeL += L[i];
            backL += L[i] + (dark ? d : -d);
            cnt++;
          }
        }
        // context (2): a stroke sits on its background, i.e. the surrounding cells are mostly
        // background-toned. Gaps between light letters on a dark field look like thin dark lines
        // at the fine scale, but their surroundings are dark, so they are rejected here.
        const mid = (strokeL + backL) / (2 * cnt);
        const limit = opts.maxContext * nearValid;
        let near = 0;
        const x1 = (gx1 + 1) * f;
        const y1 = (gy1 + 1) * f;
        for (let y = gy0 * f; y < y1 && near <= limit; y++)
          for (let x = gx0 * f, i = y * w + x; x < x1; x++, i++) if (opaque[i] && (dark ? L[i] < mid : L[i] > mid)) near++;
        if (near > limit) continue;
        kind[cell] = dark ? STROKE_DARK : STROKE_LIGHT;
        coverage[cell] = dark ? dc : lc;
        color[cell * 3] = acc[0] / wsum;
        color[cell * 3 + 1] = acc[1] / wsum;
        color[cell * 3 + 2] = acc[2] / wsum;
        break;
      }
    }
  }
  return { fine: f, kind, color, coverage };
}

/**
 * Overwrite cells whose chosen color lost a detected stroke: a dark stroke cell that came out at
 * least contrast/2 L* lighter than the stroke's palette match (or a light one that came out darker).
 * Returns the number of cells changed.
 */
export function applyStrokes(
  strokes: StrokeCells,
  index: Int32Array,
  targets: (ColorPoint | null)[],
  palette: PreparedPalette,
  matcher: Matcher,
  contrast: number,
): number {
  let changed = 0;
  for (let cell = 0; cell < index.length; cell++) {
    const kind = strokes.kind[cell];
    const cur = index[cell];
    if (kind === STROKE_NONE || cur < 0) continue;
    const p = pointFromLinear([strokes.color[cell * 3], strokes.color[cell * 3 + 1], strokes.color[cell * 3 + 2]]);
    const idx = matcher.nearest(p);
    const gap = palette.colors[cur].lab[0] - palette.colors[idx].lab[0];
    if (kind === STROKE_DARK ? gap < contrast / 2 : -gap < contrast / 2) continue;
    index[cell] = idx;
    targets[cell] = palette.colors[idx];
    changed++;
  }
  return changed;
}
