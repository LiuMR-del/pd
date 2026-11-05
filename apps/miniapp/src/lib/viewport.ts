import { fitContain } from './view';

/** How the pattern sits on the canvas: pixels per cell and the canvas position of cell (0, 0). */
export interface Viewport {
  cell: number;
  ox: number;
  oy: number;
}

export const MIN_CELL = 1;
export const MAX_CELL = 80;
/** Below this cell size a finger cannot hit single cells: one-finger touches pan instead of editing. */
export const MIN_TOUCH_EDIT_CELL = 12;

/** Two-finger state: distance between the fingers and their midpoint (canvas pixels). */
export interface Pinch {
  dist: number;
  cx: number;
  cy: number;
}

export function fitViewport(cols: number, rows: number, width: number, height: number, padding = 12): Viewport {
  const f = fitContain(cols, rows, width, height, padding, MIN_CELL, MAX_CELL);
  return { cell: f.scale, ox: f.x, oy: f.y };
}

/** Zoom by `factor` keeping the canvas point (x, y) fixed; the cell size stays within [MIN_CELL, MAX_CELL]. */
export function zoomAt(v: Viewport, factor: number, x: number, y: number): Viewport {
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, v.cell * factor));
  if (cell === v.cell) return v;
  const k = cell / v.cell;
  return { cell, ox: x - (x - v.ox) * k, oy: y - (y - v.oy) * k };
}

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { cell: v.cell, ox: v.ox + dx, oy: v.oy + dy };
}

export function pinchOf(a: { x: number; y: number }, b: { x: number; y: number }): Pinch {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

/** One pinch update: follow the midpoint, then zoom by the change in finger distance around it. */
export function pinchStep(v: Viewport, prev: Pinch, now: Pinch): Viewport {
  return zoomAt(pan(v, now.cx - prev.cx, now.cy - prev.cy), now.dist / Math.max(1, prev.dist), now.cx, now.cy);
}

/**
 * Keep at least `margin` pixels of the pattern on the canvas, so it cannot be dragged out of sight.
 */
export function keepVisible(v: Viewport, cols: number, rows: number, width: number, height: number, margin = 48): Viewport {
  const w = cols * v.cell;
  const h = rows * v.cell;
  const mx = Math.min(margin, w);
  const my = Math.min(margin, h);
  const ox = Math.max(mx - w, Math.min(width - mx, v.ox));
  const oy = Math.max(my - h, Math.min(height - my, v.oy));
  return ox === v.ox && oy === v.oy ? v : { cell: v.cell, ox, oy };
}
