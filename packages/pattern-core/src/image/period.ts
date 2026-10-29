import type { RgbaImage } from '../types';

export interface PixelPeriod {
  /** Source pixels per art pixel (integer, >= 1). */
  period: number;
  /** Phase of the cell boundaries on each axis (0..period-1). */
  offsetX: number;
  offsetY: number;
  /** Share of edge energy that lands on the detected grid lines (0..1). */
  score: number;
}

export interface PeriodOptions {
  minPeriod: number;
  maxPeriod: number;
  /** Per-pixel channel-sum difference that counts as an edge (suppresses compression noise). */
  edgeThreshold: number;
  /** Minimum share of edge energy on grid lines to accept a period. */
  minScore: number;
}

const DEFAULTS: PeriodOptions = { minPeriod: 2, maxPeriod: 64, edgeThreshold: 48, minScore: 0.85 };

function edgeProfiles(img: RgbaImage, threshold: number): { px: Float64Array; py: Float64Array } {
  const { data, width: w, height: h } = img;
  const px = new Float64Array(w);
  const py = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (x > 0) {
        const q = p - 4;
        const d = Math.abs(data[p] - data[q]) + Math.abs(data[p + 1] - data[q + 1]) + Math.abs(data[p + 2] - data[q + 2]) + Math.abs(data[p + 3] - data[q + 3]);
        if (d > threshold) px[x] += 1;
      }
      if (y > 0) {
        const q = p - w * 4;
        const d = Math.abs(data[p] - data[q]) + Math.abs(data[p + 1] - data[q + 1]) + Math.abs(data[p + 2] - data[q + 2]) + Math.abs(data[p + 3] - data[q + 3]);
        if (d > threshold) py[y] += 1;
      }
    }
  }
  return { px, py };
}

function bestPhase(profile: Float64Array, p: number): { phase: number; energy: number } {
  const bins = new Float64Array(p);
  for (let i = 1; i < profile.length; i++) bins[i % p] += profile[i];
  let phase = 0;
  for (let k = 1; k < p; k++) if (bins[k] > bins[phase]) phase = k;
  return { phase, energy: bins[phase] };
}

/**
 * Detect an integer pixel-art upscaling period: edges of upscaled pixel art fall only on lines
 * x ≡ φ (mod p). Returns the largest period whose grid lines carry >= minScore of all edge
 * energy on both axes (divisors of the true period also score high, multiples do not), or null.
 */
export function detectPixelPeriod(img: RgbaImage, options?: Partial<PeriodOptions>): PixelPeriod | null {
  const o = { ...DEFAULTS, ...options };
  const { px, py } = edgeProfiles(img, o.edgeThreshold);
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < px.length; i++) tx += px[i];
  for (let i = 0; i < py.length; i++) ty += py[i];
  if (tx + ty < 8) return null;
  const maxP = Math.min(o.maxPeriod, Math.floor(Math.min(img.width, img.height) / 4));
  let found: PixelPeriod | null = null;
  for (let p = o.minPeriod; p <= maxP; p++) {
    const bx = bestPhase(px, p);
    const by = bestPhase(py, p);
    const score = (bx.energy + by.energy) / (tx + ty);
    if (score >= o.minScore) found = { period: p, offsetX: bx.phase, offsetY: by.phase, score };
  }
  return found;
}
