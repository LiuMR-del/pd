import { labToLinear, linearToLab, type Vec3 } from '../color/convert';
import type { LinearImage } from '../image/resample';
import type { ColorPoint } from '../color/distance';

export interface EdgeSnapOptions {
  enabled: boolean;
  /** Min ΔE76 between the two opposite neighbors for the cell to count as an edge between them. */
  minContrast: number;
  /** Max distance of the cell color from the neighbors' mixing line, as a share of their distance. */
  tolerance: number;
  /**
   * Min spread (max ΔE76 of the cell's 3x3 sub-samples from its mean) for a cell to count as
   * holding an edge. A cell inside a smooth gradient also lies "between" its neighbors, but is
   * uniform inside, so it is left alone.
   */
  minSpread: number;
}

/** Per-cell spread: max ΔE76 of the 3 x 3 sub-samples from the cell mean (sub must be cols*3 x rows*3). */
export function cellSpread(sub: LinearImage, cols: number, rows: number, alphaThreshold: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const labs: Vec3[] = [];
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      labs.length = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const i = (cy * 3 + sy) * sub.width + cx * 3 + sx;
          if (sub.alpha[i] < alphaThreshold) continue;
          const l: Vec3 = [sub.lin[i * 3], sub.lin[i * 3 + 1], sub.lin[i * 3 + 2]];
          r += l[0];
          g += l[1];
          b += l[2];
          labs.push(linearToLab(l));
        }
      if (!labs.length) continue;
      const m = linearToLab([r / labs.length, g / labs.length, b / labs.length]);
      let d = 0;
      for (const p of labs) d = Math.max(d, Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]));
      out[cy * cols + cx] = d;
    }
  return out;
}

const PAIRS: [number, number, number, number][] = [
  [-1, 0, 1, 0],
  [0, -1, 0, 1],
  [-1, -1, 1, 1],
  [1, -1, -1, 1],
];

/**
 * Snap anti-aliased edge cells to one side. With a plain area mean (k = 1), a cell straddling a
 * hard edge gets the blend of both sides, which becomes a ring of in-between beads (e.g. light grey
 * around a subject on white, which background removal then keeps). When a cell's mean lies on the
 * linear-light mixing line between two opposite neighbors that differ strongly, it takes the
 * palette color of the nearer neighbor. Thin lines (both neighbors alike) are left alone.
 * Works on the original means only, so the result does not depend on scan order.
 * Returns the number of cells changed.
 */
export function snapEdges(
  index: Int32Array,
  targets: (ColorPoint | null)[],
  means: (ColorPoint | null)[],
  cols: number,
  rows: number,
  opts: EdgeSnapOptions,
  spread: Float32Array,
): number {
  const lin: (Vec3 | null)[] = means.map((m) => (m ? labToLinear(m.lab) : null));
  const srcIndex = Int32Array.from(index);
  const srcTargets = targets.slice();
  const minC2 = opts.minContrast * opts.minContrast;
  let changed = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x;
      const m = means[c];
      const ml = lin[c];
      if (!m || !ml || srcIndex[c] < 0 || spread[c] < opts.minSpread) continue;
      let best = -1;
      let bestSpan = 0;
      for (const [dx1, dy1, dx2, dy2] of PAIRS) {
        const x1 = x + dx1;
        const y1 = y + dy1;
        const x2 = x + dx2;
        const y2 = y + dy2;
        if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= cols || x2 >= cols || y1 >= rows || y2 >= rows) continue;
        const p = y1 * cols + x1;
        const q = y2 * cols + x2;
        const a = means[p];
        const b = means[q];
        const al = lin[p];
        const bl = lin[q];
        if (!a || !b || !al || !bl || srcIndex[p] < 0 || srcIndex[q] < 0) continue;
        const dl = a.lab[0] - b.lab[0];
        const da = a.lab[1] - b.lab[1];
        const db = a.lab[2] - b.lab[2];
        const span2 = dl * dl + da * da + db * db;
        if (span2 < minC2 || span2 <= bestSpan) continue;
        // projection onto the a-b mixing segment in linear light
        const v0 = bl[0] - al[0];
        const v1 = bl[1] - al[1];
        const v2 = bl[2] - al[2];
        const vv = v0 * v0 + v1 * v1 + v2 * v2;
        if (vv <= 0) continue;
        const t = ((ml[0] - al[0]) * v0 + (ml[1] - al[1]) * v1 + (ml[2] - al[2]) * v2) / vv;
        if (t <= 0.02 || t >= 0.98) continue;
        const r0 = ml[0] - (al[0] + t * v0);
        const r1 = ml[1] - (al[1] + t * v1);
        const r2 = ml[2] - (al[2] + t * v2);
        if (r0 * r0 + r1 * r1 + r2 * r2 > opts.tolerance * opts.tolerance * vv) continue;
        best = t < 0.5 ? p : q;
        bestSpan = span2;
      }
      if (best < 0 || srcIndex[best] === srcIndex[c]) continue;
      index[c] = srcIndex[best];
      targets[c] = srcTargets[best];
      changed++;
    }
  }
  return changed;
}
