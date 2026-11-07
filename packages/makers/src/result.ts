import { EMPTY_CELL, srgb8ToLinear, hexToRgb, type ColorStat, type PaletteInput, type PatternResult } from '@pd/pattern-core';

/** Why a maker could not produce a pattern; `code` lets the UI pick its own wording. */
export type MakerErrorCode = 'empty' | 'too-long' | 'too-large' | 'low-contrast';

export class MakerError extends Error {
  readonly code: MakerErrorCode;
  constructor(code: MakerErrorCode, message: string) {
    super(message);
    // when compiled down to ES5 (WeChat DevTools "ES6 转 ES5"), subclasses of Error lose their
    // prototype and `instanceof MakerError` fails; restore it explicitly
    Object.setPrototypeOf(this, MakerError.prototype);
    this.code = code;
    this.name = 'MakerError';
  }
}

/**
 * Wrap a grid of indices into `colors` as a PatternResult, so made patterns go through the same
 * document / editor / export path as generated ones. Like generatePattern, the palette lists only
 * used colors, most used first.
 */
export function makeResult(cols: number, rows: number, cells: Uint16Array, colors: readonly PaletteInput[], meta: PatternResult['meta'], ms = 0): PatternResult {
  // the same bead may be passed twice (e.g. outline = background): count it as one color
  const first = colors.map((c, i) => {
    for (let j = 0; j < i; j++) if (sameColor(colors[j], c)) return j;
    return i;
  });
  const counts = new Array<number>(colors.length).fill(0);
  for (let i = 0; i < cells.length; i++) if (cells[i] !== EMPTY_CELL) counts[first[cells[i]]]++;
  const order = colors.map((_, i) => i).filter((i) => counts[i] > 0);
  order.sort((a, b) => counts[b] - counts[a] || a - b);
  const remap = new Uint16Array(colors.length).fill(EMPTY_CELL);
  order.forEach((old, i) => (remap[old] = i));
  const out = new Uint16Array(cells.length);
  for (let i = 0; i < cells.length; i++) out[i] = cells[i] === EMPTY_CELL ? EMPTY_CELL : remap[first[cells[i]]];
  const palette = order.map((i) => ({ key: colors[i].key, hex: colors[i].hex.toUpperCase() }));
  const stats: ColorStat[] = order.map((i, k) => ({ key: palette[k].key, hex: palette[k].hex, count: counts[i] }));
  return {
    cols,
    rows,
    cells: out,
    palette,
    stats,
    sourceGrid: { cols, rows },
    offset: { x: 0, y: 0 },
    sourceRegion: { x: 0, y: 0, w: 0, h: 0 },
    timings: { total: ms },
    meta: { ...meta, empty: order.length === 0, emptyReason: order.length === 0 ? 'transparent' : null },
  };
}

/** WCAG relative luminance of "#RRGGBB". */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`invalid hex "${hex}"`);
  const [r, g, b] = srgb8ToLinear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21) between two colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Same color entry (code + color). */
export function sameColor(a: PaletteInput, b: PaletteInput): boolean {
  return a.key === b.key && a.hex.toUpperCase() === b.hex.toUpperCase();
}
