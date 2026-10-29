export const MIN_LONG_SIDE = 10;
export const MAX_LONG_SIDE = 200;

export function clampLongSide(longSide: number): number {
  return Math.max(MIN_LONG_SIDE, Math.min(MAX_LONG_SIDE, Math.round(longSide)));
}

/** Grid size following the image aspect ratio; the long side gets `longSide` cells (10..200). */
export function gridSize(width: number, height: number, longSide: number): { cols: number; rows: number } {
  if (width <= 0 || height <= 0) throw new Error('image has no pixels');
  const n = clampLongSide(longSide);
  if (width >= height) return { cols: n, rows: Math.max(1, Math.round((n * height) / width)) };
  return { cols: Math.max(1, Math.round((n * width) / height)), rows: n };
}
