import type { ColorPoint } from '../color/distance';
import type { PreparedPalette } from '../color/palette';

type Dist = (a: ColorPoint, b: ColorPoint) => number;

/**
 * Isolated-cell cleanup: a cell with no same-colored cell among its 8 neighbors takes the
 * neighbors' majority color, unless it differs from that color by >= protectContrast (keeps
 * deliberate single-bead details such as eye highlights). Needs >= minNeighbors non-empty neighbors.
 * Returns the number of changed cells; operates on a snapshot (no cascading).
 */
export function removeIsolated(
  index: Int32Array,
  cols: number,
  rows: number,
  palette: PreparedPalette,
  distance: Dist,
  protectContrast: number,
  minNeighbors = 3,
): number {
  const src = index.slice();
  const tally = new Map<number, number>();
  let changed = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const p = src[i];
      if (p < 0) continue;
      tally.clear();
      let same = false;
      let nonEmpty = 0;
      for (let dy = -1; dy <= 1 && !same; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= cols) continue;
          const q = src[yy * cols + xx];
          if (q < 0) continue;
          if (q === p) {
            same = true;
            break;
          }
          nonEmpty++;
          tally.set(q, (tally.get(q) ?? 0) + 1);
        }
      }
      if (same || nonEmpty < minNeighbors) continue;
      let mode = -1;
      let modeN = 0;
      let modeD = Infinity;
      tally.forEach((cnt, q) => {
        const d = distance(palette.colors[p], palette.colors[q]);
        if (cnt > modeN || (cnt === modeN && d < modeD)) {
          mode = q;
          modeN = cnt;
          modeD = d;
        }
      });
      if (mode < 0 || modeD >= protectContrast) continue;
      index[i] = mode;
      changed++;
    }
  }
  return changed;
}

/**
 * Merge 4-connected same-color regions smaller than `minSize` into the perceptually nearest
 * neighboring color. Regions whose nearest neighbor color is >= protectContrast away are kept.
 * Repeats until stable (max `maxPasses`). Returns the number of changed cells.
 */
export function mergeSmallRegions(
  index: Int32Array,
  cols: number,
  rows: number,
  palette: PreparedPalette,
  distance: Dist,
  minSize: number,
  protectContrast: number,
  maxPasses = 3,
): number {
  if (minSize <= 1) return 0;
  const n = cols * rows;
  const label = new Int32Array(n);
  const stack: number[] = [];
  const region: number[] = [];
  let changed = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    label.fill(-1);
    let passChanged = 0;
    let next = 0;
    for (let s = 0; s < n; s++) {
      if (index[s] < 0 || label[s] >= 0) continue;
      const color = index[s];
      const id = next++;
      region.length = 0;
      stack.push(s);
      label[s] = id;
      const border = new Map<number, number>();
      while (stack.length) {
        const i = stack.pop()!;
        region.push(i);
        const x = i % cols;
        const y = (i / cols) | 0;
        const visit = (j: number) => {
          const q = index[j];
          if (q < 0) return;
          if (q === color) {
            if (label[j] < 0) {
              label[j] = id;
              stack.push(j);
            }
          } else {
            border.set(q, (border.get(q) ?? 0) + 1);
          }
        };
        if (x > 0) visit(i - 1);
        if (x < cols - 1) visit(i + 1);
        if (y > 0) visit(i - cols);
        if (y < rows - 1) visit(i + cols);
      }
      if (region.length >= minSize || border.size === 0) continue;
      let target = -1;
      let bestD = Infinity;
      border.forEach((_, q) => {
        const d = distance(palette.colors[color], palette.colors[q]);
        if (d < bestD) {
          bestD = d;
          target = q;
        }
      });
      if (bestD >= protectContrast) continue;
      for (const i of region) index[i] = target;
      passChanged += region.length;
    }
    changed += passChanged;
    if (passChanged === 0) break;
  }
  return changed;
}
