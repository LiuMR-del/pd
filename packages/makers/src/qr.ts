import { EMPTY_CELL, MAX_LONG_SIDE, type PaletteInput, type PatternResult } from '@pd/pattern-core';
import { contrastRatio, makeResult, MakerError, relativeLuminance, sameColor } from './result';
import { qrcodegen } from './vendor/qrcodegen';

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrPatternOptions {
  /** URL or any text (UTF-8). */
  text: string;
  /** Error correction level; may be raised automatically when it costs no extra size. Default 'M'. */
  ecc?: QrEcc;
  dark: PaletteInput;
  light: PaletteInput;
  /** Blank border in modules, 2..4. The QR spec asks for 4; most phone scanners cope with 2. Default 4. */
  quietZone?: number;
  /**
   * Put beads on light modules and the quiet zone (default). When false those cells stay empty, so
   * the pattern only scans on a light pegboard; contrast is then checked against white.
   */
  fillLight?: boolean;
}

/**
 * Minimum WCAG contrast between dark and light beads. Phone scanners binarize on luminance, so
 * hue alone does not help; 4.5 keeps every pair the decoder tests accept with margin.
 */
export const QR_MIN_CONTRAST = 4.5;
export const QR_DEFAULT_QUIET_ZONE = 4;
const BOARD_WHITE = '#FFFFFF';

const ECC: Record<QrEcc, qrcodegen.QrCode.Ecc> = {
  L: qrcodegen.QrCode.Ecc.LOW,
  M: qrcodegen.QrCode.Ecc.MEDIUM,
  Q: qrcodegen.QrCode.Ecc.QUARTILE,
  H: qrcodegen.QrCode.Ecc.HIGH,
};
const ECC_NAME = ['L', 'M', 'Q', 'H'] as const;

export interface QrCheck {
  ok: boolean;
  /** Contrast actually used for the check (against white when light cells stay empty). */
  contrast: number;
  reason: 'ok' | 'same-color' | 'inverted' | 'low-contrast';
}

/** Whether a dark / light pair will scan. Inverted codes (light on dark) are refused: many scanners miss them. */
export function checkQrColors(dark: PaletteInput, light: PaletteInput, fillLight = true): QrCheck {
  const lightHex = fillLight ? light.hex : BOARD_WHITE;
  if (fillLight && sameColor(dark, light)) return { ok: false, contrast: 1, reason: 'same-color' };
  const contrast = contrastRatio(dark.hex, lightHex);
  if (relativeLuminance(dark.hex) >= relativeLuminance(lightHex)) return { ok: false, contrast, reason: 'inverted' };
  if (contrast < QR_MIN_CONTRAST) return { ok: false, contrast, reason: 'low-contrast' };
  return { ok: true, contrast, reason: 'ok' };
}

/** Darkest and lightest colors of a palette: the default dark / light beads. */
export function defaultQrColors(palette: readonly PaletteInput[]): { dark: PaletteInput; light: PaletteInput } {
  if (palette.length === 0) throw new Error('palette is empty');
  let dark = palette[0];
  let light = palette[0];
  let dl = relativeLuminance(dark.hex);
  let ll = dl;
  for (const c of palette) {
    const l = relativeLuminance(c.hex);
    if (l < dl) [dark, dl] = [c, l];
    if (l > ll) [light, ll] = [c, l];
  }
  return { dark, light };
}

/** Grid side (modules + quiet zone) for a text, or null when it does not fit in a QR code. */
export function qrSize(text: string, ecc: QrEcc = 'M', quietZone = QR_DEFAULT_QUIET_ZONE): number | null {
  try {
    return qrcodegen.QrCode.encodeText(text, ECC[ecc]).size + 2 * clampQuiet(quietZone);
  } catch {
    return null;
  }
}

function clampQuiet(q: number): number {
  return Math.max(2, Math.min(4, Math.round(Number.isFinite(q) ? q : QR_DEFAULT_QUIET_ZONE)));
}

/** QR code as a bead pattern: one module = one bead. Throws MakerError ('empty' | 'too-long' | 'low-contrast'). */
export function qrPattern(o: QrPatternOptions): PatternResult {
  const t0 = Date.now();
  if (!o.text) throw new MakerError('empty', '请输入网址或文字');
  const fillLight = o.fillLight !== false;
  const check = checkQrColors(o.dark, o.light, fillLight);
  if (!check.ok) {
    const msg = check.reason === 'same-color' ? '深色和浅色不能是同一种豆子' : check.reason === 'inverted' ? '深色要比浅色深，反色二维码很多手机扫不出' : `深浅两色对比度不够（${check.contrast.toFixed(1)}，至少 ${QR_MIN_CONTRAST}），扫不出来`;
    throw new MakerError('low-contrast', msg);
  }
  let qr: qrcodegen.QrCode;
  try {
    qr = qrcodegen.QrCode.encodeText(o.text, ECC[o.ecc ?? 'M']);
  } catch {
    throw new MakerError('too-long', '内容太长，放不进二维码，请缩短内容或降低纠错等级');
  }
  const q = clampQuiet(o.quietZone ?? QR_DEFAULT_QUIET_ZONE);
  const n = qr.size + 2 * q;
  // version 40 (177 modules) + 2×4 quiet zone = 185, always within the grid limit
  if (n > MAX_LONG_SIDE) throw new MakerError('too-long', '内容太长，二维码超过 200 格');
  const DARK = 0;
  const LIGHT = 1;
  const cells = new Uint16Array(n * n).fill(fillLight ? LIGHT : EMPTY_CELL);
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) cells[(y + q) * n + (x + q)] = DARK;
  return makeResult(n, n, cells, [o.dark, o.light], { maker: 'qr', qrVersion: qr.version, qrEcc: ECC_NAME[qr.errorCorrectionLevel.ordinal], qrModules: qr.size, quietZone: q, contrast: Number(check.contrast.toFixed(2)) }, Date.now() - t0);
}
