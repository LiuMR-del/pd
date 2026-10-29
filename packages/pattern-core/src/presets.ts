import type { DistanceMetric } from './color/distance';
import type { SaliencyOptions } from './reduce/limitColors';
import type { DarkLineOptions } from './sample/cell';
import { clampLongSide, MAX_LONG_SIDE } from './image/grid';

export type Style = 'cartoon' | 'photo' | 'pixel';
export type SizePreset = 'save' | 'balanced' | 'detail';

export interface PatternOptions {
  style?: Style;
  /** Cells on the long side (10..200). Ignored when cols/rows are given or a pixel period is used. */
  longSide?: number;
  /** Explicit grid size (both required). */
  cols?: number;
  rows?: number;
  metric?: DistanceMetric;
  /** CIEDE2000 only: Oklab shortlist size before exact CIEDE2000 ranking (0 = exact search). */
  prefilterK?: number;
  /** Max distinct colors (2..60); 0 = no limit. */
  maxColors?: number;
  /** k for k x k sub-samples per cell (1..5). */
  subSamples?: number;
  centerWeight?: number;
  darkLine?: DarkLineOptions;
  /** ΔE76 spread below which a cell is matched by its mean color. */
  flatThreshold?: number;
  countExponent?: number;
  saliency?: SaliencyOptions;
  refine?: boolean;
  /** Error diffusion strength 0..1 (0 = off). */
  dither?: number;
  isolatedCleanup?: boolean;
  /** Regions smaller than this many cells are merged into the nearest neighbor color (<=1 disables). */
  minRegionSize?: number;
  /** Cleanup never replaces a color that differs this much from its replacement. */
  protectContrast?: number;
  removeBackground?: boolean;
  backgroundTolerance?: number;
  backgroundMinBorderShare?: number;
  /** Background seeds only from border runs >= this fraction of the longest run of that color. */
  backgroundMinRunRatio?: number;
  autoCrop?: boolean;
  /** Mean alpha (0..1) below which a cell is empty. */
  alphaThreshold?: number;
  /** Pixel style: 'auto' detects the upscale period; a number forces it. */
  pixelPeriod?: 'auto' | number;
  /** Clock for timings (defaults to performance.now / Date.now). */
  now?: () => number;
}

export type ResolvedOptions = Required<Omit<PatternOptions, 'cols' | 'rows' | 'now'>> &
  Pick<PatternOptions, 'cols' | 'rows' | 'now'>;

const SALIENCY: SaliencyOptions = { enabled: true, chroma: 45, contrast: 35, maxShare: 0.02, darkL: 22, weight: 6 };

export const BASE_OPTIONS: ResolvedOptions = {
  style: 'cartoon',
  longSide: 72,
  metric: 'ciede2000',
  prefilterK: 8,
  maxColors: 24,
  subSamples: 3,
  centerWeight: 2,
  darkLine: { enabled: true, luma: 45, ratio: 0.3, maxNeighborDark: 0.5 },
  flatThreshold: 6,
  countExponent: 0.65,
  saliency: SALIENCY,
  refine: true,
  dither: 0,
  isolatedCleanup: true,
  minRegionSize: 2,
  protectContrast: 30,
  removeBackground: false,
  backgroundTolerance: 12,
  backgroundMinBorderShare: 0.2,
  backgroundMinRunRatio: 0.25,
  autoCrop: true,
  alphaThreshold: 0.5,
  pixelPeriod: 'auto',
};

/** Style presets: cartoon (strong line protection, no dither) / photo (smoother, light dither) / pixel (grid aligned, no smoothing). */
export const STYLE_PRESETS: Record<Style, Partial<ResolvedOptions>> = {
  cartoon: {},
  photo: {
    darkLine: { enabled: false, luma: 45, ratio: 0.3 },
    flatThreshold: 20,
    centerWeight: 1.5,
    dither: 0.25,
    minRegionSize: 2,
    protectContrast: 25,
  },
  pixel: {
    subSamples: 3,
    darkLine: { enabled: false, luma: 45, ratio: 0.3 },
    dither: 0,
    isolatedCleanup: false,
    minRegionSize: 0,
    saliency: { ...SALIENCY, maxShare: 0.05 },
  },
};

/** Size presets: 省豆 48 格 / 16 色、均衡 72 / 24、细节 100 / 36. */
export const SIZE_PRESETS: Record<SizePreset, { longSide: number; maxColors: number }> = {
  save: { longSide: 48, maxColors: 16 },
  balanced: { longSide: 72, maxColors: 24 },
  detail: { longSide: 100, maxColors: 36 },
};

export function presetOptions(style: Style, size: SizePreset = 'balanced'): PatternOptions {
  return { ...STYLE_PRESETS[style], ...SIZE_PRESETS[size], style };
}

export function resolveOptions(opts: PatternOptions = {}): ResolvedOptions {
  const style = opts.style ?? BASE_OPTIONS.style;
  const merged: ResolvedOptions = { ...BASE_OPTIONS, ...STYLE_PRESETS[style], style };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  const num = (name: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`option ${name} must be a finite number, got ${String(v)}`);
    return v;
  };
  merged.longSide = clampLongSide(num('longSide', merged.longSide));
  if ((merged.cols === undefined) !== (merged.rows === undefined)) throw new Error('cols and rows must be given together');
  if (merged.cols !== undefined && merged.rows !== undefined) {
    const c = Math.round(num('cols', merged.cols));
    const r = Math.round(num('rows', merged.rows));
    if (c < 1 || r < 1 || Math.max(c, r) > MAX_LONG_SIDE) throw new Error(`cols/rows must be 1..${MAX_LONG_SIDE}, got ${c}x${r}`);
    merged.cols = c;
    merged.rows = r;
  }
  const maxColors = Math.round(num('maxColors', merged.maxColors));
  merged.maxColors = maxColors <= 0 ? 0 : Math.max(2, Math.min(60, maxColors));
  merged.subSamples = Math.max(1, Math.min(5, Math.round(num('subSamples', merged.subSamples))));
  merged.dither = Math.max(0, Math.min(1, num('dither', merged.dither)));
  merged.prefilterK = Math.max(0, Math.round(num('prefilterK', merged.prefilterK)));
  merged.darkLine = { ...merged.darkLine, ratio: Math.max(0.01, Math.min(1, num('darkLine.ratio', merged.darkLine.ratio))) };
  if (typeof merged.pixelPeriod === 'number') {
    const p = Math.round(num('pixelPeriod', merged.pixelPeriod));
    if (p < 1) throw new Error(`pixelPeriod must be >= 1, got ${p}`);
    merged.pixelPeriod = p;
  }
  return merged;
}
