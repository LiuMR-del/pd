/**
 * The subset of CanvasRenderingContext2D this package draws with. A browser 2D context and a
 * WeChat mini-program `canvas type="2d"` context both satisfy it.
 */
export interface Ctx2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

export const FONT_FAMILY = '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of "#RRGGBB". */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white text, whichever contrasts more with the bead color. */
export function textColorFor(hex: string): '#000000' | '#FFFFFF' {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#FFFFFF';
}

/** Horizontal or vertical line, aligned to the pixel grid for crisp 1px strokes. */
export function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  const off = width % 2 === 1 ? 0.5 : 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  if (x0 === x1) {
    ctx.moveTo(Math.round(x0) + off, y0);
    ctx.lineTo(Math.round(x1) + off, y1);
  } else {
    ctx.moveTo(x0, Math.round(y0) + off);
    ctx.lineTo(x1, Math.round(y1) + off);
  }
  ctx.stroke();
}
