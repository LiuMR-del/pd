/**
 * Crop-box math for the editor page. Rectangles are in source-image pixels; the page converts
 * touch movement from screen pixels by dividing by the display scale.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** What a touch grabbed: the whole box or one of its corners. */
export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export function fullRect(size: Size): Rect {
  return { x: 0, y: 0, w: size.w, h: size.h };
}

/** True when the box covers the whole image (i.e. no crop). */
export function isFull(r: Rect, size: Size): boolean {
  return r.x <= 0 && r.y <= 0 && r.x + r.w >= size.w && r.y + r.h >= size.h;
}

/** Smallest box side, so a box can always still be grabbed and resized. */
export function minCropSide(size: Size): number {
  return Math.max(8, Math.round(Math.max(size.w, size.h) * 0.05));
}

/**
 * The box after dragging `handle` by (dx, dy) image pixels, starting from `start`.
 * Moving keeps the size and stays inside the image; corners keep the opposite corner fixed.
 */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, size: Size, minSide = minCropSide(size)): Rect {
  if (handle === 'move') {
    return { x: clamp(start.x + dx, 0, size.w - start.w), y: clamp(start.y + dy, 0, size.h - start.h), w: start.w, h: start.h };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const min = Math.min(minSide, size.w, size.h);
  if (handle === 'nw' || handle === 'sw') left = clamp(left + dx, 0, right - min);
  else right = clamp(right + dx, left + min, size.w);
  if (handle === 'nw' || handle === 'ne') top = clamp(top + dy, 0, bottom - min);
  else bottom = clamp(bottom + dy, top + min, size.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Which part of a box (given in screen pixels) a touch at (x, y) grabs. Corners win within `tolerance`
 * pixels (fingertip-sized), then the inside of the box; null when the touch misses it.
 */
export function hitHandle(box: Rect, x: number, y: number, tolerance: number): Handle | null {
  const corners: [Handle, number, number][] = [
    ['nw', box.x, box.y],
    ['ne', box.x + box.w, box.y],
    ['sw', box.x, box.y + box.h],
    ['se', box.x + box.w, box.y + box.h],
  ];
  let best: Handle | null = null;
  let bestDist = tolerance;
  for (const [h, cx, cy] of corners) {
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    if (d <= bestDist) {
      best = h;
      bestDist = d;
    }
  }
  if (best) return best;
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h ? 'move' : null;
}

/** Scale a rectangle (e.g. from display-image pixels to decoded-image pixels). */
export function scaleRect(r: Rect, k: number): Rect {
  return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
