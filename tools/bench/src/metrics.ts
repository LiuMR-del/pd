import {
  ciede2000,
  EMPTY_CELL,
  hexToRgb,
  linearToLab,
  linearToOklab,
  resampleLinear,
  srgb8ToLinear,
  type PatternResult,
  type RgbaImage,
  type Vec3,
} from '@pd/pattern-core';
import { cam16UcsDistance, linearToCam16Ucs } from './cam16';

export interface Metrics {
  /** Mean CIEDE2000 between each bead and the area-averaged source cell. */
  meanDE00: number;
  /** Same after a 3x3 box blur of both (credits dithering that is right on average). */
  meanDE00Smooth: number;
  /** Mean Oklab distance x100 (counterpart of meanDE00; favours Oklab matching). */
  meanDEok: number;
  /** Mean CAM16-UCS ΔE' — neutral arbiter between the Oklab and CIEDE2000 groups. */
  meanDEcam: number;
  colors: number;
  filled: number;
  /** Share of filled cells with no same-colored 8-neighbor. */
  isolatedRatio: number;
  /** Among cells whose darkest sub-sample is a dark line (L* < 25), share rendered dark (L* < 35). */
  darkRecall: number | null;
  /** Foreground (mask) cells left empty / foreground cells. */
  bgMisdelete: number | null;
  /** Background cells still filled / background cells. */
  bgResidual: number | null;
  timeMs: number;
}

/** Palette index at a source-grid cell (accounts for auto-crop). */
export function cellAt(r: PatternResult, sx: number, sy: number): number {
  const x = sx - r.offset.x;
  const y = sy - r.offset.y;
  if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return EMPTY_CELL;
  return r.cells[y * r.cols + x];
}

export function computeMetrics(image: RgbaImage, r: PatternResult, mask?: RgbaImage): Metrics {
  const { cols, rows } = r.sourceGrid;
  const region = r.sourceRegion;
  const ref = resampleLinear(image, cols, rows, region);
  const sub = resampleLinear(image, cols * 3, rows * 3, region);
  const palLin = r.palette.map((p) => srgb8ToLinear(hexToRgb(p.hex)!));
  const palLab = palLin.map((l) => linearToLab(l));
  const palOk = palLin.map((l) => linearToOklab(l));
  const palCam = palLin.map((l) => linearToCam16Ucs(l));

  let n = 0;
  let de = 0;
  let deOk = 0;
  let deCam = 0;
  let deSmooth = 0;
  let isolated = 0;
  let darkTotal = 0;
  let darkHit = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cellAt(r, x, y);
      if (c === EMPTY_CELL) continue;
      const i = y * cols + x;
      const refLin: Vec3 = [ref.lin[i * 3], ref.lin[i * 3 + 1], ref.lin[i * 3 + 2]];
      de += ciede2000(palLab[c], linearToLab(refLin));
      const ok = linearToOklab(refLin);
      deOk += Math.hypot(palOk[c][0] - ok[0], palOk[c][1] - ok[1], palOk[c][2] - ok[2]) * 100;
      deCam += cam16UcsDistance(palCam[c], linearToCam16Ucs(refLin));

      // 3x3 smoothed comparison over filled neighbors
      const so: Vec3 = [0, 0, 0];
      const sr: Vec3 = [0, 0, 0];
      let m = 0;
      let same = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          const q = cellAt(r, xx, yy);
          if (q === EMPTY_CELL) continue;
          if ((dx || dy) && q === c) same = true;
          const j = yy * cols + xx;
          for (let k = 0; k < 3; k++) {
            so[k] += palLin[q][k];
            sr[k] += ref.lin[j * 3 + k];
          }
          m++;
        }
      deSmooth += ciede2000(linearToLab([so[0] / m, so[1] / m, so[2] / m]), linearToLab([sr[0] / m, sr[1] / m, sr[2] / m]));
      if (!same) isolated++;

      let minL = Infinity;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const s = (y * 3 + sy) * sub.width + x * 3 + sx;
          if (sub.alpha[s] < 0.5) continue;
          minL = Math.min(minL, linearToLab([sub.lin[s * 3], sub.lin[s * 3 + 1], sub.lin[s * 3 + 2]])[0]);
        }
      if (minL < 25) {
        darkTotal++;
        if (palLab[c][0] < 35) darkHit++;
      }
      n++;
    }
  }

  let bgMisdelete: number | null = null;
  let bgResidual: number | null = null;
  if (mask) {
    const mref = resampleLinear(mask, cols, rows, region);
    let fg = 0;
    let fgEmpty = 0;
    let bg = 0;
    let bgFilled = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const cov = mref.lin[(y * cols + x) * 3];
        const filled = cellAt(r, x, y) !== EMPTY_CELL;
        if (cov >= 0.5) {
          fg++;
          if (!filled) fgEmpty++;
        } else {
          bg++;
          if (filled) bgFilled++;
        }
      }
    bgMisdelete = fg ? fgEmpty / fg : 0;
    bgResidual = bg ? bgFilled / bg : 0;
  }

  return {
    meanDE00: n ? de / n : 0,
    meanDE00Smooth: n ? deSmooth / n : 0,
    meanDEok: n ? deOk / n : 0,
    meanDEcam: n ? deCam / n : 0,
    colors: r.palette.length,
    filled: n,
    isolatedRatio: n ? isolated / n : 0,
    darkRecall: darkTotal >= 5 ? darkHit / darkTotal : null,
    bgMisdelete,
    bgResidual,
    timeMs: r.timings.total ?? 0,
  };
}
