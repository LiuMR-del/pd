import { pointFromLab, type ColorPoint, type DistanceMetric } from '../color/distance';
import { createMatcher, type PreparedPalette } from '../color/palette';

export interface SaliencyOptions {
  enabled: boolean;
  /** Lab chroma at/above which a small color counts as salient. */
  chroma: number;
  /** Mean ΔE to differing neighbors at/above which a small color counts as salient. */
  contrast: number;
  /** "Small" = share of non-empty cells at/below this. */
  maxShare: number;
  /** Lab L* at/below which a color counts as a dark line color (any share). */
  darkL: number;
  /** Merge-cost multiplier for salient colors. */
  weight: number;
}

export interface LimitOptions {
  maxColors: number;
  /** Passed to createMatcher (CIEDE2000 Oklab shortlist). */
  prefilterK?: number;
  /** Count exponent for cluster weights (<1 lets rare colors compete). */
  countExponent: number;
  saliency: SaliencyOptions;
  refine: boolean;
}

export interface LimitResult {
  index: Int32Array;
  /** Palette indices kept. */
  allowed: number[];
  salient: number[];
  before: number;
}

interface Cluster {
  members: number[]; // palette indices
  counts: number[];
  rep: number;
  count: number;
  salient: boolean;
  alive: boolean;
}

/**
 * Reduce the number of distinct palette colors to `maxColors`:
 * 1) weighted greedy agglomerative merging in perceptual space (Ward-like cost on count^γ,
 *    multiplied for salient colors so small high-chroma / high-contrast / dark-line colors survive);
 * 2) one k-means refinement round restricted to palette colors, then reassignment.
 */
export function limitColors(
  index: Int32Array,
  targets: (ColorPoint | null)[],
  cols: number,
  rows: number,
  palette: PreparedPalette,
  metric: DistanceMetric,
  distance: (a: ColorPoint, b: ColorPoint) => number,
  opts: LimitOptions,
): LimitResult {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < index.length; i++) {
    if (index[i] < 0) continue;
    counts.set(index[i], (counts.get(index[i]) ?? 0) + 1);
    total++;
  }
  const used = Array.from(counts.keys()).sort((a, b) => a - b);
  const maxColors = Math.max(1, Math.round(opts.maxColors));
  if (used.length <= maxColors) return { index, allowed: used, salient: [], before: used.length };

  const colors = palette.colors;
  const salientSet = opts.saliency.enabled
    ? findSalient(index, cols, rows, counts, total, palette, distance, opts.saliency, maxColors)
    : new Set<number>();

  // --- greedy agglomerative merging ---
  const clusters: Cluster[] = used.map((p) => ({
    members: [p],
    counts: [counts.get(p)!],
    rep: p,
    count: counts.get(p)!,
    salient: salientSet.has(p),
    alive: true,
  }));
  const n = clusters.length;
  const cost = new Float64Array(n * n);
  const pairCost = (i: number, j: number) => {
    const a = clusters[i];
    const b = clusters[j];
    const wa = Math.pow(a.count, opts.countExponent);
    const wb = Math.pow(b.count, opts.countExponent);
    const d = distance(colors[a.rep], colors[b.rep]);
    let c = ((wa * wb) / (wa + wb)) * d * d;
    if (a.salient || b.salient) c *= opts.saliency.weight;
    return c;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) cost[i * n + j] = pairCost(i, j);

  let alive = n;
  while (alive > maxColors) {
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!clusters[i].alive) continue;
      for (let j = i + 1; j < n; j++) {
        if (!clusters[j].alive) continue;
        const c = cost[i * n + j];
        if (c < best) {
          best = c;
          bi = i;
          bj = j;
        }
      }
    }
    const a = clusters[bi];
    const b = clusters[bj];
    a.members.push(...b.members);
    a.counts.push(...b.counts);
    a.count += b.count;
    a.salient = a.salient || b.salient;
    a.rep = medoid(a, colors, distance, salientSet);
    b.alive = false;
    alive--;
    for (let k = 0; k < n; k++) {
      if (k === bi || !clusters[k].alive) continue;
      const lo = Math.min(k, bi);
      const hi = Math.max(k, bi);
      cost[lo * n + hi] = pairCost(lo, hi);
    }
  }

  let allowed = clusters.filter((c) => c.alive).map((c) => c.rep);
  const protectedReps = new Set(clusters.filter((c) => c.alive && salientSet.has(c.rep)).map((c) => c.rep));

  // --- assignment + one refinement round ---
  const mopts = { prefilterK: opts.prefilterK ?? 0 };
  let out = assign(index, targets, palette, metric, allowed, mopts);
  if (opts.refine) {
    const sums = new Map<number, [number, number, number, number]>();
    for (let i = 0; i < out.length; i++) {
      const t = targets[i];
      if (out[i] < 0 || !t) continue;
      const s = sums.get(out[i]) ?? [0, 0, 0, 0];
      s[0] += t.lab[0];
      s[1] += t.lab[1];
      s[2] += t.lab[2];
      s[3]++;
      sums.set(out[i], s);
    }
    const full = createMatcher(palette, metric, undefined, mopts);
    const next = new Set<number>();
    for (const rep of allowed) {
      const s = sums.get(rep);
      if (!s || protectedReps.has(rep)) {
        if (s) next.add(rep);
        continue;
      }
      // k-means step restricted to the palette: move the representative to the palette color nearest the cluster mean
      const moved = full.nearest(pointFromLab([s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
      next.add(next.has(moved) ? rep : moved);
    }
    allowed = Array.from(next);
    out = assign(index, targets, palette, metric, allowed, mopts);
  }

  const kept = new Set<number>();
  for (let i = 0; i < out.length; i++) if (out[i] >= 0) kept.add(out[i]);
  return {
    index: out,
    allowed: Array.from(kept).sort((a, b) => a - b),
    salient: Array.from(salientSet).filter((s) => kept.has(s)),
    before: used.length,
  };
}

function assign(
  index: Int32Array,
  targets: (ColorPoint | null)[],
  palette: PreparedPalette,
  metric: DistanceMetric,
  allowed: number[],
  mopts: { prefilterK: number },
): Int32Array {
  const m = createMatcher(palette, metric, allowed, mopts);
  const out = new Int32Array(index.length);
  for (let i = 0; i < index.length; i++) {
    const t = targets[i];
    out[i] = index[i] < 0 ? -1 : m.nearest(t ?? palette.colors[index[i]]);
  }
  return out;
}

function medoid(
  c: Cluster,
  colors: PreparedPalette['colors'],
  distance: (a: ColorPoint, b: ColorPoint) => number,
  salient: Set<number>,
): number {
  // weighted medoid; salient members get a bias so protected colors are not swallowed
  let best = c.rep;
  let bestCost = Infinity;
  for (const cand of c.members) {
    let s = 0;
    for (let i = 0; i < c.members.length; i++) s += c.counts[i] * distance(colors[cand], colors[c.members[i]]);
    if (salient.has(cand)) s *= 0.5;
    if (s < bestCost) {
      bestCost = s;
      best = cand;
    }
  }
  return best;
}

function findSalient(
  index: Int32Array,
  cols: number,
  rows: number,
  counts: Map<number, number>,
  total: number,
  palette: PreparedPalette,
  distance: (a: ColorPoint, b: ColorPoint) => number,
  opts: SaliencyOptions,
  maxColors: number,
): Set<number> {
  const colors = palette.colors;
  // mean contrast against differing 4-neighbors, per palette color
  const contrastSum = new Map<number, number>();
  const contrastN = new Map<number, number>();
  const pairCache = new Map<number, number>();
  const d = (a: number, b: number) => {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    let v = pairCache.get(key);
    if (v === undefined) {
      v = distance(colors[a], colors[b]);
      pairCache.set(key, v);
    }
    return v;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const p = index[i];
      if (p < 0) continue;
      let mx = 0;
      if (x > 0 && index[i - 1] >= 0 && index[i - 1] !== p) mx = Math.max(mx, d(p, index[i - 1]));
      if (x < cols - 1 && index[i + 1] >= 0 && index[i + 1] !== p) mx = Math.max(mx, d(p, index[i + 1]));
      if (y > 0 && index[i - cols] >= 0 && index[i - cols] !== p) mx = Math.max(mx, d(p, index[i - cols]));
      if (y < rows - 1 && index[i + cols] >= 0 && index[i + cols] !== p) mx = Math.max(mx, d(p, index[i + cols]));
      contrastSum.set(p, (contrastSum.get(p) ?? 0) + mx);
      contrastN.set(p, (contrastN.get(p) ?? 0) + 1);
    }
  }
  const scored: { p: number; score: number }[] = [];
  counts.forEach((count, p) => {
    const share = count / total;
    const c = colors[p];
    const contrast = (contrastSum.get(p) ?? 0) / Math.max(1, contrastN.get(p) ?? 0);
    const small = share <= opts.maxShare;
    const isDark = c.lab[0] <= opts.darkL;
    const isChroma = small && c.chroma >= opts.chroma;
    const isContrast = small && contrast >= opts.contrast;
    if (isDark || isChroma || isContrast) {
      scored.push({ p, score: (isDark ? 100 : 0) + contrast + c.chroma });
    }
  });
  // never let protected colors take more than a third of the budget
  scored.sort((a, b) => b.score - a.score);
  const cap = Math.max(1, Math.floor(maxColors / 3));
  return new Set(scored.slice(0, cap).map((s) => s.p));
}
