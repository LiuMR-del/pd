import { EMPTY_CELL, MAX_LONG_SIDE, type PaletteInput, type PatternResult } from '@pd/pattern-core';
import { makeResult, MakerError } from './result';

/**
 * One rasterized character. `alpha` is width × height coverage (0..255), row-major; the pen
 * position is at x = `left` inside the bitmap, and the next character starts `advance` px later.
 */
export interface Glyph {
  advance: number;
  left: number;
  width: number;
  height: number;
  alpha: ArrayLike<number>;
}

/**
 * Draws one character in a `boxHeight`-tall bitmap, vertically centered (canvas
 * textBaseline 'middle' at boxHeight / 2), with the given em size. Supplied by the platform:
 * see createCanvasRasterizer.
 */
export type GlyphRasterizer = (ch: string, emPx: number, boxHeight: number, bold: boolean) => Glyph;

export type TextAlign = 'left' | 'center' | 'right';

export interface TextPatternOptions {
  /** May contain line breaks. */
  text: string;
  /** Font size (em) in cells, 6..60. Default 16. */
  height?: number;
  bold?: boolean;
  /** A cell gets a bead when the glyph covers at least this share of it (0.2..0.8). Lower = thicker strokes. Default 0.45. */
  threshold?: number;
  align?: TextAlign;
  /** Extra cells between characters (0..10). Default 0. */
  letterSpacing?: number;
  /** Extra cells between lines (0..20). Default 1. */
  lineSpacing?: number;
  color: PaletteInput;
  /** One-cell outline around the strokes. */
  outline?: PaletteInput | null;
  /** Fill for the rest of the rectangle; null leaves it empty (no beads). */
  background?: PaletteInput | null;
  /** Cells around the text (0..10; at least 1 with an outline). Default 1. */
  margin?: number;
}

/** Glyphs are drawn at this many pixels per cell, then each cell's coverage is measured. */
export const TEXT_SUPERSAMPLE = 4;
export const TEXT_MIN_HEIGHT = 6;
export const TEXT_MAX_HEIGHT = 60;
/** Below these sizes system fonts get hard to read in beads (UI hint only). */
export const TEXT_READABLE_HEIGHT = { cjk: 12, latin: 7 };

function clamp(v: number | undefined, min: number, max: number, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}

/** True when the text contains CJK characters (for the readable-size hint). */
export function hasCjk(text: string): boolean {
  return /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text);
}

/** Text as a bead pattern. Throws MakerError ('empty' | 'too-large'). */
export function textPattern(o: TextPatternOptions, raster: GlyphRasterizer): PatternResult {
  const t0 = Date.now();
  const S = TEXT_SUPERSAMPLE;
  const height = Math.round(clamp(o.height, TEXT_MIN_HEIGHT, TEXT_MAX_HEIGHT, 16));
  const threshold = clamp(o.threshold, 0.2, 0.8, 0.45);
  const letter = Math.round(clamp(o.letterSpacing, 0, 10, 0)) * S;
  const lineGap = Math.round(clamp(o.lineSpacing, 0, 20, 1)) * S;
  const hasOutline = !!o.outline;
  const margin = Math.max(hasOutline ? 1 : 0, Math.round(clamp(o.margin, 0, 10, 1)));
  const em = height * S;
  // room above / below the em box: some glyphs (accents, descenders) reach outside it
  const pad = Math.ceil(em * 0.2);
  const box = em + 2 * pad;

  // trailing spaces draw nothing but would widen the layout
  const lines = o.text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((l) => l.replace(/\s+$/, ''));
  if (!lines.some((l) => l.trim() !== '')) throw new MakerError('empty', '请输入文字');

  const cache = new Map<string, Glyph>();
  const glyph = (ch: string): Glyph => {
    let g = cache.get(ch);
    if (!g) {
      g = raster(ch, em, box, !!o.bold);
      cache.set(ch, g);
    }
    return g;
  };

  // lay out every line in supersampled pixels
  const laid = lines.map((line) => {
    const chars = Array.from(line);
    let x = 0;
    const placed = chars.map((ch, i) => {
      const g = glyph(ch);
      const at = x;
      x += g.advance + (i < chars.length - 1 ? letter : 0);
      return { g, at };
    });
    return { placed, width: x };
  });
  const textW = Math.max(1, ...laid.map((l) => Math.ceil(l.width)));
  // left / right overhang of glyph bitmaps beyond the pen range
  let overL = 0;
  let overR = 0;
  laid.forEach((l) =>
    l.placed.forEach(({ g, at }) => {
      overL = Math.max(overL, g.left - at);
      overR = Math.max(overR, at - g.left + g.width - textW);
    }),
  );
  const ox = Math.ceil(overL / S) * S;
  const W = ox + textW + Math.ceil(Math.max(0, overR) / S) * S;
  const H = lines.length * em + (lines.length - 1) * lineGap + 2 * pad;
  const maskCols = Math.ceil(W / S);
  const maskRows = Math.ceil(H / S);
  const maskW = maskCols * S;
  const maskH = maskRows * S;
  // a 200-cell limit check before allocating: beyond it the result is refused anyway
  if (maskCols > MAX_LONG_SIDE * 4 || maskRows > MAX_LONG_SIDE * 4) throw new MakerError('too-large', `文字太多，图纸会超过 ${MAX_LONG_SIDE} 格：请调小字高或减少字数、分行`);
  const mask = new Uint8Array(maskW * maskH);

  laid.forEach((l, li) => {
    // keep alignment shifts on whole cells so the same line renders the same way wherever it sits
    const slack = textW - Math.ceil(l.width);
    const shift = o.align === 'center' ? Math.round(slack / 2 / S) * S : o.align === 'right' ? Math.floor(slack / S) * S : 0;
    const top = li * (em + lineGap);
    for (const { g, at } of l.placed) {
      const gx = Math.round(ox + shift + at - g.left);
      for (let y = 0; y < g.height; y++) {
        const my = top + y;
        if (my < 0 || my >= maskH) continue;
        for (let x = 0; x < g.width; x++) {
          const a = g.alpha[y * g.width + x];
          if (!a) continue;
          const mx = gx + x;
          if (mx < 0 || mx >= maskW) continue;
          const k = my * maskW + mx;
          if (a > mask[k]) mask[k] = a;
        }
      }
    }
  });

  // cell coverage -> text cells
  const on = new Uint8Array(maskCols * maskRows);
  const need = threshold * S * S * 255;
  let minX = maskCols;
  let minY = maskRows;
  let maxX = -1;
  let maxY = -1;
  for (let cy = 0; cy < maskRows; cy++)
    for (let cx = 0; cx < maskCols; cx++) {
      let sum = 0;
      for (let y = 0; y < S; y++) {
        const row = (cy * S + y) * maskW + cx * S;
        for (let x = 0; x < S; x++) sum += mask[row + x];
      }
      if (sum >= need) {
        on[cy * maskCols + cx] = 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
    }
  if (maxX < 0) throw new MakerError('empty', '文字太细，画不出豆子：请调大字高或调粗笔画');

  const cols = maxX - minX + 1 + 2 * margin;
  const rows = maxY - minY + 1 + 2 * margin;
  if (cols > MAX_LONG_SIDE || rows > MAX_LONG_SIDE) throw tooLarge(cols, rows);

  const TEXT = 0;
  const OUTLINE = 1;
  const BG = 2;
  const cells = new Uint16Array(cols * rows).fill(o.background ? BG : EMPTY_CELL);
  for (let cy = minY; cy <= maxY; cy++)
    for (let cx = minX; cx <= maxX; cx++) if (on[cy * maskCols + cx]) cells[(cy - minY + margin) * cols + (cx - minX + margin)] = TEXT;
  if (hasOutline) {
    const src = cells.slice();
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (src[y * cols + x] === TEXT) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            near = nx >= 0 && ny >= 0 && nx < cols && ny < rows && src[ny * cols + nx] === TEXT;
          }
        if (near) cells[y * cols + x] = OUTLINE;
      }
  }
  const colors: PaletteInput[] = [o.color, o.outline ?? o.color, o.background ?? o.color];
  return makeResult(cols, rows, cells, colors, { maker: 'text', textHeight: height, lines: lines.length }, Date.now() - t0);
}

function tooLarge(cols: number, rows: number): MakerError {
  return new MakerError('too-large', `图纸会有 ${cols} × ${rows} 格，超过 ${MAX_LONG_SIDE} 格：请调小字高或减少字数、分行`);
}

// --- canvas rasterizer ------------------------------------------------------------------------

/** The bits of a 2D context the rasterizer needs (browser canvas, OffscreenCanvas, wx offscreen canvas). */
export interface RasterCtx {
  font: string;
  fillStyle: unknown;
  textBaseline: string;
  textAlign: string;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

export interface RasterCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

/** Same family list as the exported sheets (@pd/render FONT_FAMILY). */
export const TEXT_FONT_FAMILY = '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/**
 * GlyphRasterizer on top of a platform canvas. `canvas` is reused for every glyph (resizing
 * clears it). Works with a DOM canvas, OffscreenCanvas and wx.createOffscreenCanvas({ type: '2d' }).
 */
export function createCanvasRasterizer(canvas: RasterCanvas, family = TEXT_FONT_FAMILY): GlyphRasterizer {
  return (ch, emPx, boxHeight, bold) => {
    const font = `${bold ? 'bold ' : ''}${emPx}px ${family}`;
    let ctx = canvas.getContext('2d') as RasterCtx;
    ctx.font = font;
    const advance = ctx.measureText(ch).width;
    // side room for strokes that overhang the advance (bold, italic-ish CJK fallbacks)
    const left = Math.ceil(emPx * 0.15);
    const width = Math.max(1, Math.ceil(advance) + 2 * left);
    canvas.width = width;
    canvas.height = boxHeight;
    // resizing resets the context state
    ctx = canvas.getContext('2d') as RasterCtx;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000000';
    if (ch.trim() !== '') ctx.fillText(ch, left, boxHeight / 2);
    const data = ctx.getImageData(0, 0, width, boxHeight).data;
    const alpha = new Uint8Array(width * boxHeight);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return { advance, left, width, height: boxHeight, alpha };
  };
}
