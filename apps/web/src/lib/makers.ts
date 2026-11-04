import { createCanvasRasterizer, defaultQrColors, qrPattern, textPattern, type GlyphRasterizer, type QrEcc, type TextAlign } from '@pd/makers';
import { getPalette, getTier, paletteData } from '@pd/palettes';
import { createMatcher, hexToRgb, pointFromLab, preparePalette, srgb8ToLab, type PaletteInput, type PatternResult, type RgbaImage } from '@pd/pattern-core';

/** Where a pattern comes from. Works saved before stage 3 have no kind and are images. */
export type Kind = 'image' | 'text' | 'qr';

export const KIND_LABELS: Record<Kind, string> = { image: '图片', text: '文字', qr: '二维码' };

export type Thickness = 'thin' | 'normal' | 'thick';
export const THICKNESS_LABELS: Record<Thickness, string> = { thin: '细', normal: '标准', thick: '粗' };
const THRESHOLD: Record<Thickness, number> = { thin: 0.6, normal: 0.45, thick: 0.3 };

/**
 * A bead color as an id into the brand table (@pd/palettes `paletteData.colors`), so it stays the
 * same bead when the brand changes (codes mean different colors in different brands).
 */
export type ColorId = number;

/** Text pattern settings. Colors: see ColorId; null = none (text color: the default). */
export interface TextSettings {
  text: string;
  height: number;
  bold: boolean;
  thickness: Thickness;
  align: TextAlign;
  letterSpacing: number;
  lineSpacing: number;
  color: ColorId | null;
  outline: ColorId | null;
  background: ColorId | null;
  margin: number;
}

export interface QrSettings {
  text: string;
  ecc: QrEcc;
  dark: ColorId | null;
  light: ColorId | null;
  quietZone: number;
  fillLight: boolean;
}

export const ECC_LABELS: Record<QrEcc, string> = { L: '低', M: '中', Q: '较高', H: '高' };

export function defaultTextSettings(): TextSettings {
  return { text: '拼豆', height: 16, bold: true, thickness: 'normal', align: 'center', letterSpacing: 1, lineSpacing: 2, color: null, outline: null, background: null, margin: 1 };
}

export function defaultQrSettings(): QrSettings {
  return { text: '', ecc: 'M', dark: null, light: null, quietZone: 4, fillLight: true };
}

function int(v: unknown, min: number, max: number, d: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}

function colorId(v: unknown): ColorId | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < paletteData.colors.length ? v : null;
}

export function normalizeText(s: Partial<TextSettings> | null | undefined): TextSettings {
  const d = defaultTextSettings();
  const o = { ...d, ...(s ?? {}) };
  return {
    text: typeof o.text === 'string' ? o.text.slice(0, 200) : d.text,
    height: int(o.height, 6, 60, d.height),
    bold: o.bold !== false,
    thickness: o.thickness in THRESHOLD ? o.thickness : d.thickness,
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : d.align,
    letterSpacing: int(o.letterSpacing, 0, 10, d.letterSpacing),
    lineSpacing: int(o.lineSpacing, 0, 20, d.lineSpacing),
    color: colorId(o.color),
    outline: colorId(o.outline),
    background: colorId(o.background),
    margin: int(o.margin, 0, 10, d.margin),
  };
}

export function normalizeQr(s: Partial<QrSettings> | null | undefined): QrSettings {
  const d = defaultQrSettings();
  const o = { ...d, ...(s ?? {}) };
  return {
    text: typeof o.text === 'string' ? o.text.slice(0, 3000) : '',
    ecc: ['L', 'M', 'Q', 'H'].includes(o.ecc) ? o.ecc : d.ecc,
    dark: colorId(o.dark),
    light: colorId(o.light),
    quietZone: int(o.quietZone, 2, 4, d.quietZone),
    fillLight: o.fillLight !== false,
  };
}

/** Colors of a brand + tier with their ids. */
export function tierColors(brand: string, tier: number | 'all'): (PaletteInput & { id: ColorId })[] {
  return getTier(tier).colorIds.map((id) => ({ id, key: paletteData.colors[id].codes[brand], hex: paletteData.colors[id].hex }));
}

/** The bead `id` in this brand + tier: itself when the tier has it, else the nearest (CIEDE2000) color of the tier. */
export function resolveColor(id: ColorId | null, brand: string, tier: number | 'all'): (PaletteInput & { id: ColorId }) | null {
  if (id === null || !paletteData.colors[id]) return null;
  const colors = tierColors(brand, tier);
  const hit = colors.find((c) => c.id === id);
  if (hit) return hit;
  const rgb = hexToRgb(paletteData.colors[id].hex)!;
  return colors[createMatcher(preparePalette(colors), 'ciede2000').nearest(pointFromLab(srgb8ToLab(rgb)))];
}

/** Colors the text pattern will use (unset text color: the darkest bead). */
export function textColors(s: TextSettings, brand: string, tier: number | 'all'): { color: PaletteInput; outline: PaletteInput | null; background: PaletteInput | null } {
  return {
    color: resolveColor(s.color, brand, tier) ?? defaultQrColors(getPalette(brand, tier)).dark,
    outline: resolveColor(s.outline, brand, tier),
    background: resolveColor(s.background, brand, tier),
  };
}

/** Unset colors: the darkest and lightest beads. */
export function qrColors(s: QrSettings, brand: string, tier: number | 'all'): { dark: PaletteInput; light: PaletteInput } {
  const d = defaultQrColors(getPalette(brand, tier));
  return { dark: resolveColor(s.dark, brand, tier) ?? d.dark, light: resolveColor(s.light, brand, tier) ?? d.light };
}

let rasterizer: GlyphRasterizer | null = null;
function textRasterizer(): GlyphRasterizer {
  if (!rasterizer) {
    const canvas = document.createElement('canvas');
    // glyphs are read back one by one
    canvas.getContext('2d', { willReadFrequently: true });
    rasterizer = createCanvasRasterizer(canvas);
  }
  return rasterizer;
}

/** Make a text or QR pattern (fast enough for the main thread). Throws MakerError with a user-facing message. */
export function makePattern(kind: Exclude<Kind, 'image'>, s: TextSettings | QrSettings, brand: string, tier: number | 'all'): PatternResult {
  if (kind === 'qr') {
    const q = s as QrSettings;
    return qrPattern({ text: q.text, ecc: q.ecc, ...qrColors(q, brand, tier), quietZone: q.quietZone, fillLight: q.fillLight });
  }
  const t = s as TextSettings;
  return textPattern({ text: t.text, height: t.height, bold: t.bold, threshold: THRESHOLD[t.thickness], align: t.align, letterSpacing: t.letterSpacing, lineSpacing: t.lineSpacing, margin: t.margin, ...textColors(t, brand, tier) }, textRasterizer());
}

/** Document name for a made pattern. */
export function makerName(kind: Exclude<Kind, 'image'>, s: TextSettings | QrSettings): string {
  const first = s.text.trim().split('\n')[0].trim();
  if (kind === 'qr') return `二维码 ${first.replace(/^https?:\/\//, '').slice(0, 16)}`.trim();
  return first.slice(0, 16) || '文字图纸';
}

/** Read the first QR code in an image (jsQR is loaded on first use only). */
export async function scanQrImage(img: RgbaImage): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  // photos of big codes often decode better smaller; try the original, then halves
  let cur = { data: img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  for (let i = 0; i < 3; i++) {
    const hit = jsQR(cur.data, cur.width, cur.height, { inversionAttempts: 'attemptBoth' });
    if (hit && hit.data) return hit.data;
    if (Math.min(cur.width, cur.height) < 200) break;
    cur = half(cur);
  }
  return null;
}

function half(img: { data: Uint8ClampedArray; width: number; height: number }): { data: Uint8ClampedArray; width: number; height: number } {
  const w = Math.floor(img.width / 2);
  const h = Math.floor(img.height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const k = (y * 2 * img.width + x * 2) * 4 + c;
        out[(y * w + x) * 4 + c] = (img.data[k] + img.data[k + 4] + img.data[k + img.width * 4] + img.data[k + img.width * 4 + 4]) >> 2;
      }
  return { data: out, width: w, height: h };
}
