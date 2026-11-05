import type { RgbaImage } from '@pd/pattern-core';
import type { Rect } from './crop';

/**
 * Copy a rectangle out of an RGBA image (the algorithm's input after cropping). The rectangle is
 * rounded to whole pixels and clamped to the image; the result is at least 1×1.
 */
export function cropRgba(img: RgbaImage, r: Rect): RgbaImage {
  const x0 = clampInt(Math.round(r.x), 0, img.width - 1);
  const y0 = clampInt(Math.round(r.y), 0, img.height - 1);
  const x1 = clampInt(Math.round(r.x + r.w), x0 + 1, img.width);
  const y1 = clampInt(Math.round(r.y + r.h), y0 + 1, img.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (x0 === 0 && y0 === 0 && w === img.width && h === img.height) return img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
