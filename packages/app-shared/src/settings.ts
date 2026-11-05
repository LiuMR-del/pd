import { BASE_OPTIONS, presetOptions, SIZE_PRESETS, type PatternOptions } from '@pd/pattern-core';
import { BRANDS, listTiers } from '@pd/palettes';

export type Style = 'cartoon' | 'photo' | 'pixel';
export type SizeChoice = 'save' | 'balanced' | 'detail' | 'custom';

/** User-facing generation settings (persisted in drafts and as the last-used defaults). */
export interface Settings {
  style: Style;
  size: SizeChoice;
  /** Cells on the long side (10..200). */
  longSide: number;
  /** Max colors (2..60). */
  maxColors: number;
  brand: string;
  /** Color tier size, or 'all'. */
  tier: number | 'all';
  removeBackground: boolean;
  /** Thin-line protection (advanced; on by default). */
  strokeProtect: boolean;
  /** Dithering strength 0..1, or null for the style's default. */
  dither: number | null;
}

export const STYLE_LABELS: Record<Style, string> = { cartoon: '卡通', photo: '照片', pixel: '像素图' };
export const SIZE_LABELS: Record<Exclude<SizeChoice, 'custom'>, string> = { save: '省豆', balanced: '均衡', detail: '细节' };

export function defaultSettings(): Settings {
  return {
    style: 'cartoon',
    size: 'balanced',
    longSide: SIZE_PRESETS.balanced.longSide,
    maxColors: SIZE_PRESETS.balanced.maxColors,
    brand: BRANDS[0],
    // the standard MARD kit; 'all' adds special beads (pearl, jelly, transparent ...) most users lack
    tier: 221,
    removeBackground: false,
    strokeProtect: true,
    dither: null,
  };
}

/** Bring stored / user-entered settings back into valid ranges. */
export function normalizeSettings(s: Partial<Settings>): Settings {
  const d = defaultSettings();
  const out: Settings = { ...d, ...s };
  if (!['cartoon', 'photo', 'pixel'].includes(out.style)) out.style = d.style;
  if (!['save', 'balanced', 'detail', 'custom'].includes(out.size)) out.size = d.size;
  out.longSide = clampInt(out.longSide, 10, 200, d.longSide);
  out.maxColors = clampInt(out.maxColors, 2, 60, d.maxColors);
  if (!BRANDS.includes(out.brand)) out.brand = d.brand;
  if (out.tier !== 'all' && !listTiers().some((t) => t.size === out.tier)) out.tier = d.tier;
  out.removeBackground = !!out.removeBackground;
  out.strokeProtect = out.strokeProtect !== false;
  out.dither = out.dither === null || out.dither === undefined ? null : Math.max(0, Math.min(1, Number(out.dither) || 0));
  return out;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** Apply a size preset (long side + max colors). */
export function withSize(s: Settings, size: SizeChoice): Settings {
  if (size === 'custom') return { ...s, size };
  return { ...s, size, longSide: SIZE_PRESETS[size].longSide, maxColors: SIZE_PRESETS[size].maxColors };
}

/** Algorithm options for @pd/pattern-core. */
export function toPatternOptions(s: Settings): PatternOptions {
  const base = presetOptions(s.style, s.size === 'custom' ? 'balanced' : s.size);
  const opts: PatternOptions = {
    ...base,
    longSide: s.longSide,
    maxColors: s.maxColors,
    removeBackground: s.removeBackground,
    stroke: { ...BASE_OPTIONS.stroke, enabled: s.strokeProtect },
  };
  if (s.dither !== null) opts.dither = s.dither;
  return opts;
}

export function tierLabel(tier: number | 'all'): string {
  if (tier === 'all') return `全部 ${listTiers().find((t) => t.id === 'all')?.size ?? ''} 色（含珠光、透明等特殊豆）`;
  return `${tier} 色套装`;
}

export function settingsSummary(s: Settings): string {
  return `${STYLE_LABELS[s.style]} · 长边 ${s.longSide} 格 · 最多 ${s.maxColors} 色 · ${s.brand} ${tierLabel(s.tier)}`;
}
