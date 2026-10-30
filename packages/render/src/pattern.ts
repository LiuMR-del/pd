import { EMPTY_CELL, type PatternDoc } from '@pd/editor-core';
import { FONT_FAMILY, line, textColorFor, type Ctx2D } from './canvas';

/** How the editor canvas shows a pattern. Coordinates are canvas pixels. */
export interface PatternView {
  /** Pixels per cell. */
  cellSize: number;
  /** Canvas position of the top-left corner of cell (0, 0). */
  offsetX: number;
  offsetY: number;
  /** Canvas size, used to draw only the visible cells. */
  width: number;
  height: number;
  showGrid?: boolean;
  showCodes?: boolean;
  /** Palette index to emphasize; other beads are washed out. */
  highlight?: number | null;
  /** Show the pattern flipped left-right (the side you iron). */
  mirror?: boolean;
}

export const EMPTY_LIGHT = '#F4F6F5';
export const EMPTY_DARK = '#E2E7E4';
/** Below this cell size codes are unreadable and are not drawn. */
export const MIN_CODE_CELL = 16;
/** Below this cell size grid lines would cover the beads and are not drawn. */
export const MIN_GRID_CELL = 6;

export interface CellRange {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

/** Columns / rows (half-open) that intersect the canvas. */
export function visibleRange(doc: PatternDoc, view: PatternView): CellRange {
  const s = view.cellSize;
  return {
    c0: Math.max(0, Math.floor(-view.offsetX / s)),
    c1: Math.min(doc.cols, Math.ceil((view.width - view.offsetX) / s)),
    r0: Math.max(0, Math.floor(-view.offsetY / s)),
    r1: Math.min(doc.rows, Math.ceil((view.height - view.offsetY) / s)),
  };
}

/** Cell under a canvas point (accounts for mirroring), or null outside the pattern. */
export function cellAtPoint(doc: PatternDoc, view: PatternView, x: number, y: number): { row: number; col: number } | null {
  const vc = Math.floor((x - view.offsetX) / view.cellSize);
  const row = Math.floor((y - view.offsetY) / view.cellSize);
  if (vc < 0 || row < 0 || vc >= doc.cols || row >= doc.rows) return null;
  return { row, col: view.mirror ? doc.cols - 1 - vc : vc };
}

/** Draw an empty cell as a 2x2 checkerboard, so it never looks like a white bead. */
export function drawEmptyCell(ctx: Ctx2D, x: number, y: number, s: number): void {
  const h = s / 2;
  ctx.fillStyle = EMPTY_LIGHT;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = EMPTY_DARK;
  ctx.fillRect(x, y, h, h);
  ctx.fillRect(x + h, y + h, s - h, s - h);
}

/** Grid lines: thin every cell, stronger every 5, strongest every 10 (bead-board counting). */
export function drawGridLines(ctx: Ctx2D, x0: number, y0: number, s: number, range: CellRange): void {
  const top = y0 + range.r0 * s;
  const bottom = y0 + range.r1 * s;
  const left = x0 + range.c0 * s;
  const right = x0 + range.c1 * s;
  const style = (k: number): [number, string] => (k % 10 === 0 ? [2, 'rgba(0,0,0,0.55)'] : k % 5 === 0 ? [1, 'rgba(0,0,0,0.38)'] : [1, 'rgba(0,0,0,0.14)']);
  for (let c = range.c0; c <= range.c1; c++) {
    const [w, color] = style(c);
    line(ctx, x0 + c * s, top, x0 + c * s, bottom, w, color);
  }
  for (let r = range.r0; r <= range.r1; r++) {
    const [w, color] = style(r);
    line(ctx, left, y0 + r * s, right, y0 + r * s, w, color);
  }
}

/** Draw the visible part of a pattern for the editor. */
export function drawPattern(ctx: Ctx2D, doc: PatternDoc, view: PatternView): void {
  const s = view.cellSize;
  const range = visibleRange(doc, view);
  if (range.c0 >= range.c1 || range.r0 >= range.r1) return;
  const codes = !!view.showCodes && s >= MIN_CODE_CELL;
  const hl = view.highlight ?? null;
  if (codes) {
    ctx.font = `${Math.max(8, Math.floor(s * 0.36))}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }
  for (let r = range.r0; r < range.r1; r++) {
    for (let vc = range.c0; vc < range.c1; vc++) {
      const col = view.mirror ? doc.cols - 1 - vc : vc;
      const v = doc.cells[r * doc.cols + col];
      const x = view.offsetX + vc * s;
      const y = view.offsetY + r * s;
      if (v === EMPTY_CELL) {
        drawEmptyCell(ctx, x, y, s);
        continue;
      }
      const p = doc.palette[v];
      ctx.fillStyle = p.hex;
      ctx.fillRect(x, y, s, s);
      if (hl !== null && v !== hl) {
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillRect(x, y, s, s);
      } else if (codes) {
        ctx.fillStyle = textColorFor(p.hex);
        ctx.fillText(p.key, x + s / 2, y + s / 2);
      }
    }
  }
  if (view.showGrid !== false && s >= MIN_GRID_CELL) drawGridLines(ctx, view.offsetX, view.offsetY, s, range);
}
