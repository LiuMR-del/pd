/**
 * Palette preparation (precomputed Lab / Oklab, cached) and nearest-color search.
 *
 * Partially derived from perler-beads:
 *   Source:   https://github.com/Zippland/perler-beads
 *   Commit:   2efee730f73dd4eb472ebde443a022d11f98bc21
 *   Original: src/utils/pixelation.ts (PaletteColor, findClosestPaletteColor)
 *   License:  AGPL-3.0
 *   Changes:  Palette colors are precomputed once (Lab + Oklab) and cached by palette signature;
 *             distance is pluggable (Oklab / CIEDE2000); search is pruned by a lightness lower
 *             bound and memoized per quantized query color; empty palette throws instead of
 *             logging to console; can be restricted to a subset of palette indices.
 */
import { hexToRgb, labChroma, srgb8ToLinear, type Vec3 } from './convert';
import { getDistanceFn, lightnessBound, oklabDistance, pointFromLinear, type ColorPoint, type DistanceFn, type DistanceMetric } from './distance';

/** A palette entry as supplied by callers: brand color code + "#RRGGBB". */
export interface PaletteInput {
  key: string;
  hex: string;
}

export interface PreparedColor extends ColorPoint {
  key: string;
  hex: string;
  rgb: Vec3;
  lin: Vec3;
  chroma: number;
}

export interface PreparedPalette {
  signature: string;
  colors: PreparedColor[];
}

const PALETTE_CACHE_LIMIT = 8;
const paletteCache = new Map<string, PreparedPalette>();

export function preparePalette(input: readonly PaletteInput[]): PreparedPalette {
  if (input.length === 0) throw new Error('palette is empty');
  if (input.length >= 0xffff) throw new Error('palette too large');
  const signature = input.map((c) => `${c.key}=${c.hex}`).join('|');
  const cached = paletteCache.get(signature);
  if (cached) return cached;

  const colors = input.map((c): PreparedColor => {
    const rgb = hexToRgb(c.hex);
    if (!rgb) throw new Error(`invalid hex "${c.hex}" for key "${c.key}"`);
    const lin = srgb8ToLinear(rgb);
    const p = pointFromLinear(lin);
    return { key: c.key, hex: c.hex.toUpperCase(), rgb, lin, lab: p.lab, oklab: p.oklab, chroma: labChroma(p.lab) };
  });
  const prepared: PreparedPalette = { signature, colors };
  if (paletteCache.size >= PALETTE_CACHE_LIMIT) {
    const oldest = paletteCache.keys().next().value;
    if (oldest !== undefined) paletteCache.delete(oldest);
  }
  paletteCache.set(signature, prepared);
  return prepared;
}

export interface Matcher {
  metric: DistanceMetric;
  distance: DistanceFn;
  /** Index (into the full palette) of the nearest allowed color. */
  nearest(p: ColorPoint): number;
}

const QUERY_CACHE_LIMIT = 1 << 18;

function quantKey(lab: Vec3): number {
  // 0.25 ΔE steps; L in [0,100] -> [0,400], a/b clamped to [-128,128) -> [0,1024).
  const l = Math.round(lab[0] * 4);
  let a = Math.round(lab[1] * 4) + 512;
  let b = Math.round(lab[2] * 4) + 512;
  a = a < 0 ? 0 : a > 1023 ? 1023 : a;
  b = b < 0 ? 0 : b > 1023 ? 1023 : b;
  return (l * 1024 + a) * 1024 + b;
}

export interface MatcherOptions {
  /**
   * CIEDE2000 only: shortlist the K nearest colors by Oklab distance, then pick the CIEDE2000
   * nearest among them (approximate, much faster). 0 = exact search.
   */
  prefilterK?: number;
}

/**
 * Nearest-color matcher. Candidates are sorted by lightness and the scan stops once the
 * lightness gap alone exceeds the best distance found (exact for both metrics), unless an
 * Oklab prefilter is requested for CIEDE2000. Results are memoized per query color quantized to
 * 0.25 Lab units (a/b clamped to ±128), so near-ties and far out-of-gamut queries are approximate.
 */
export function createMatcher(palette: PreparedPalette, metric: DistanceMetric, subset?: readonly number[], options: MatcherOptions = {}): Matcher {
  const distance = getDistanceFn(metric);
  const { lightness, factor } = lightnessBound(metric);
  const indices = subset ? Array.from(subset) : palette.colors.map((_, i) => i);
  if (indices.length === 0) throw new Error('matcher subset is empty');
  indices.sort((x, y) => lightness(palette.colors[x]) - lightness(palette.colors[y]));
  const sortedL = indices.map((i) => lightness(palette.colors[i]));
  const cache = new Map<number, number>();
  const K = metric === 'ciede2000' ? Math.max(0, Math.floor(options.prefilterK ?? 0)) : 0;
  const shortIdx = new Int32Array(K);
  const shortD = new Float64Array(K);

  function prefiltered(p: ColorPoint): number {
    let n = 0;
    for (const idx of indices) {
      const d = oklabDistance(p, palette.colors[idx]);
      if (n < K) {
        let j = n++;
        while (j > 0 && shortD[j - 1] > d) {
          shortD[j] = shortD[j - 1];
          shortIdx[j] = shortIdx[j - 1];
          j--;
        }
        shortD[j] = d;
        shortIdx[j] = idx;
      } else if (d < shortD[K - 1]) {
        let j = K - 1;
        while (j > 0 && shortD[j - 1] > d) {
          shortD[j] = shortD[j - 1];
          shortIdx[j] = shortIdx[j - 1];
          j--;
        }
        shortD[j] = d;
        shortIdx[j] = idx;
      }
    }
    let best = Infinity;
    let bestIdx = shortIdx[0];
    for (let j = 0; j < n; j++) {
      const d = distance(p, palette.colors[shortIdx[j]]);
      if (d < best || (d === best && shortIdx[j] < bestIdx)) {
        best = d;
        bestIdx = shortIdx[j];
      }
    }
    return bestIdx;
  }

  function search(p: ColorPoint): number {
    if (K > 0 && K < indices.length) return prefiltered(p);
    const L = lightness(p);
    // binary search for first candidate with lightness >= L
    let lo = 0;
    let hi = indices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedL[mid] < L) lo = mid + 1;
      else hi = mid;
    }
    let best = Infinity;
    let bestIdx = indices[Math.min(lo, indices.length - 1)];
    let up = lo;
    let down = lo - 1;
    while (up < indices.length || down >= 0) {
      const upGap = up < indices.length ? (sortedL[up] - L) * factor : Infinity;
      const downGap = down >= 0 ? (L - sortedL[down]) * factor : Infinity;
      if (upGap >= best && downGap >= best) break;
      let k: number;
      if (upGap <= downGap) k = up++;
      else k = down--;
      const idx = indices[k];
      const d = distance(p, palette.colors[idx]);
      if (d < best || (d === best && idx < bestIdx)) {
        best = d;
        bestIdx = idx;
      }
    }
    return bestIdx;
  }

  return {
    metric,
    distance,
    nearest(p: ColorPoint): number {
      const key = quantKey(p.lab);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const idx = search(p);
      if (cache.size >= QUERY_CACHE_LIMIT) cache.clear();
      cache.set(key, idx);
      return idx;
    },
  };
}
