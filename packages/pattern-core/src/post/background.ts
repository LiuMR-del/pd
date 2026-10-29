import type { ColorPoint } from '../color/distance';

export interface BackgroundOptions {
  /** Max distance from a background seed color (global drift limit is 2x this). */
  tolerance: number;
  /** A border color cluster must cover at least this share of border cells to be background. */
  minBorderShare: number;
  /**
   * Seeds come only from contiguous border runs at least this fraction of the cluster's longest run.
   * A short stretch of background-colored border (e.g. a white part of the subject touching the
   * frame) is then not flooded, while a background split by the subject still is.
   */
  minRunRatio: number;
}

/** Border cells in cyclic order (top L->R, right T->B, bottom R->L, left B->T), without duplicates. */
function perimeter(cols: number, rows: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (i: number) => {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  for (let x = 0; x < cols; x++) add(x);
  for (let y = 1; y < rows; y++) add(y * cols + cols - 1);
  for (let x = cols - 2; x >= 0; x--) add((rows - 1) * cols + x);
  for (let y = rows - 2; y >= 1; y--) add(y * cols);
  return out;
}

/**
 * Background removal: cluster the border cells' colors (with tolerance), treat clusters covering a
 * meaningful share of the border as background, then flood-fill inward (4-connected) through cells
 * that are close to their neighbor (local step <= tolerance) and to the seed cluster color
 * (<= 2 x tolerance). Supports several background colors and soft gradients. Seeds are limited to
 * long contiguous border runs (see minRunRatio).
 * Sets removed cells to -1 and returns how many were removed.
 */
export function removeBackground(
  index: Int32Array,
  targets: (ColorPoint | null)[],
  cols: number,
  rows: number,
  distance: (a: ColorPoint, b: ColorPoint) => number,
  opts: BackgroundOptions,
): number {
  const border = perimeter(cols, rows);
  const clusters: { ref: ColorPoint; members: number[] }[] = [];
  const clusterAt = new Int32Array(border.length).fill(-1);
  let borderFilled = 0;
  border.forEach((i, pos) => {
    const t = targets[i];
    if (index[i] < 0 || !t) return;
    borderFilled++;
    let ci = clusters.findIndex((c) => distance(c.ref, t) <= opts.tolerance);
    if (ci < 0) {
      ci = clusters.length;
      clusters.push({ ref: t, members: [] });
    }
    clusters[ci].members.push(i);
    clusterAt[pos] = ci;
  });
  if (borderFilled === 0) return 0;

  // contiguous runs along the (cyclic) perimeter
  const runs: { ci: number; start: number; len: number }[] = [];
  const P = border.length;
  let first = 0;
  while (first < P && clusterAt[first] === clusterAt[(first + P - 1) % P]) first++;
  if (first === P) first = 0; // the whole perimeter is one run
  for (let k = 0; k < P; ) {
    const pos = (first + k) % P;
    const ci = clusterAt[pos];
    let len = 1;
    while (k + len < P && clusterAt[(first + k + len) % P] === ci) len++;
    if (ci >= 0) runs.push({ ci, start: pos, len });
    k += len;
  }
  const longest = new Map<number, number>();
  for (const r of runs) longest.set(r.ci, Math.max(longest.get(r.ci) ?? 0, r.len));

  const owner = new Int32Array(cols * rows).fill(-1);
  const stack: number[] = [];
  for (const r of runs) {
    if (clusters[r.ci].members.length / borderFilled < opts.minBorderShare) continue;
    if (r.len < Math.max(2, opts.minRunRatio * longest.get(r.ci)!)) continue;
    for (let k = 0; k < r.len; k++) {
      const i = border[(r.start + k) % P];
      if (owner[i] >= 0) continue;
      owner[i] = r.ci;
      stack.push(i);
    }
  }
  let removed = 0;
  while (stack.length) {
    const i = stack.pop()!;
    const ref = clusters[owner[i]].ref;
    const cur = targets[i]!;
    removed++;
    const x = i % cols;
    const y = (i / cols) | 0;
    const visit = (j: number) => {
      if (owner[j] >= 0 || index[j] < 0) return;
      const t = targets[j];
      if (!t) return;
      if (distance(cur, t) > opts.tolerance || distance(ref, t) > opts.tolerance * 2) return;
      owner[j] = owner[i];
      stack.push(j);
    };
    if (x > 0) visit(i - 1);
    if (x < cols - 1) visit(i + 1);
    if (y > 0) visit(i - cols);
    if (y < rows - 1) visit(i + cols);
  }
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0) index[i] = -1;
  return removed;
}
