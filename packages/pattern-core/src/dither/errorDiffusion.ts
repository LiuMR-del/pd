import { pointFromLab, type ColorPoint } from '../color/distance';
import type { Matcher, PreparedPalette } from '../color/palette';

/**
 * Floyd–Steinberg error diffusion in Lab space over the cell grid (serpentine scan).
 * `strength` 0..1 scales the diffused error; 0 reproduces plain nearest-color assignment.
 * Empty cells neither receive nor pass error.
 */
export function ditherCells(
  index: Int32Array,
  targets: (ColorPoint | null)[],
  cols: number,
  rows: number,
  palette: PreparedPalette,
  matcher: Matcher,
  strength: number,
): Int32Array {
  const s = Math.max(0, Math.min(1, strength));
  const out = new Int32Array(index.length);
  const err = new Float64Array(index.length * 3);
  const spread = (i: number, e0: number, e1: number, e2: number, w: number) => {
    if (index[i] < 0) return;
    err[i * 3] += e0 * w;
    err[i * 3 + 1] += e1 * w;
    err[i * 3 + 2] += e2 * w;
  };
  for (let y = 0; y < rows; y++) {
    const ltr = (y & 1) === 0;
    for (let step = 0; step < cols; step++) {
      const x = ltr ? step : cols - 1 - step;
      const i = y * cols + x;
      const t = targets[i];
      if (index[i] < 0 || !t) {
        out[i] = index[i];
        continue;
      }
      const L = Math.max(0, Math.min(100, t.lab[0] + err[i * 3]));
      const want: [number, number, number] = [L, t.lab[1] + err[i * 3 + 1], t.lab[2] + err[i * 3 + 2]];
      const idx = matcher.nearest(err[i * 3] === 0 && err[i * 3 + 1] === 0 && err[i * 3 + 2] === 0 ? t : pointFromLab(want));
      out[i] = idx;
      if (s === 0) continue;
      const got = palette.colors[idx].lab;
      const e0 = (want[0] - got[0]) * s;
      const e1 = (want[1] - got[1]) * s;
      const e2 = (want[2] - got[2]) * s;
      const dx = ltr ? 1 : -1;
      const xn = x + dx;
      const xp = x - dx;
      if (xn >= 0 && xn < cols) spread(i + dx, e0, e1, e2, 7 / 16);
      if (y + 1 < rows) {
        const below = i + cols;
        if (xp >= 0 && xp < cols) spread(below - dx, e0, e1, e2, 3 / 16);
        spread(below, e0, e1, e2, 5 / 16);
        if (xn >= 0 && xn < cols) spread(below + dx, e0, e1, e2, 1 / 16);
      }
    }
  }
  return out;
}
