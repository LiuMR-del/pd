import { describe, expect, it } from 'vitest';
import { dragRect, fullRect, hitHandle, isFull, minCropSide, scaleRect } from '../src/lib/crop';
import { cropRgba } from '../src/lib/pixels';
import { fitContain } from '../src/lib/view';

const size = { w: 400, h: 300 };

describe('crop box', () => {
  it('starts as the whole image', () => {
    expect(fullRect(size)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(isFull(fullRect(size), size)).toBe(true);
    expect(isFull({ x: 1, y: 0, w: 399, h: 300 }, size)).toBe(false);
  });

  it('moves inside the image without changing size', () => {
    const start = { x: 100, y: 100, w: 200, h: 100 };
    expect(dragRect(start, 'move', 30, -20, size)).toEqual({ x: 130, y: 80, w: 200, h: 100 });
    expect(dragRect(start, 'move', 500, 500, size)).toEqual({ x: 200, y: 200, w: 200, h: 100 });
    expect(dragRect(start, 'move', -500, -500, size)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('resizes from a corner, keeping the opposite corner fixed', () => {
    const start = { x: 100, y: 100, w: 200, h: 100 };
    expect(dragRect(start, 'se', 50, 50, size)).toEqual({ x: 100, y: 100, w: 250, h: 150 });
    expect(dragRect(start, 'nw', -50, -40, size)).toEqual({ x: 50, y: 60, w: 250, h: 140 });
    expect(dragRect(start, 'ne', 20, 10, size)).toEqual({ x: 100, y: 110, w: 220, h: 90 });
    expect(dragRect(start, 'sw', 10, 20, size)).toEqual({ x: 110, y: 100, w: 190, h: 120 });
  });

  it('never leaves the image or shrinks below the minimum side', () => {
    const start = { x: 100, y: 100, w: 200, h: 100 };
    const min = minCropSide(size);
    expect(min).toBe(20);
    expect(dragRect(start, 'se', 1000, 1000, size)).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(dragRect(start, 'nw', -1000, -1000, size)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    // dragging a corner past the opposite one stops at the minimum size
    expect(dragRect(start, 'se', -1000, -1000, size)).toEqual({ x: 100, y: 100, w: min, h: min });
    expect(dragRect(start, 'nw', 1000, 1000, size)).toEqual({ x: 300 - min, y: 200 - min, w: min, h: min });
  });

  it('works on images smaller than the minimum side', () => {
    const tiny = { w: 5, h: 3 };
    const r = dragRect(fullRect(tiny), 'se', -10, -10, tiny);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThanOrEqual(5);
    expect(r.y + r.h).toBeLessThanOrEqual(3);
  });

  it('hit-tests corners first, then the inside', () => {
    const box = { x: 10, y: 20, w: 100, h: 60 };
    expect(hitHandle(box, 12, 22, 16)).toBe('nw');
    expect(hitHandle(box, 108, 18, 16)).toBe('ne');
    expect(hitHandle(box, 5, 85, 16)).toBe('sw');
    expect(hitHandle(box, 120, 90, 16)).toBe('se');
    expect(hitHandle(box, 60, 50, 16)).toBe('move');
    expect(hitHandle(box, 200, 200, 16)).toBeNull();
    // a tiny box: the nearest corner wins, not simply the first one checked
    expect(hitHandle({ x: 0, y: 0, w: 10, h: 10 }, 9, 9, 16)).toBe('se');
  });

  it('scales rectangles between display and decoded pixels', () => {
    expect(scaleRect({ x: 10, y: 20, w: 30, h: 40 }, 0.5)).toEqual({ x: 5, y: 10, w: 15, h: 20 });
  });
});

describe('cropRgba', () => {
  // 4×3 image whose red channel is the pixel index
  const img = { data: new Uint8ClampedArray(4 * 3 * 4), width: 4, height: 3 };
  for (let i = 0; i < 12; i++) img.data[i * 4] = i;

  it('copies the rounded, clamped rectangle', () => {
    const out = cropRgba(img, { x: 0.6, y: 1.2, w: 2.1, h: 5 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.data).filter((_, i) => i % 4 === 0)).toEqual([5, 6, 9, 10]);
  });

  it('returns the input when the rectangle is the whole image', () => {
    expect(cropRgba(img, { x: 0, y: 0, w: 4, h: 3 })).toBe(img);
  });

  it('is at least 1×1', () => {
    const out = cropRgba(img, { x: 10, y: 10, w: 0, h: 0 });
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[0]).toBe(11);
  });
});

describe('fitContain', () => {
  it('centers content at the largest scale that fits', () => {
    expect(fitContain(200, 100, 400, 400)).toEqual({ scale: 2, x: 0, y: 100 });
    expect(fitContain(48, 36, 360, 360, 12)).toEqual({ scale: 7, x: 12, y: 54 });
  });

  it('respects min and max scale', () => {
    expect(fitContain(10, 10, 1000, 1000, 0, 1, 80).scale).toBe(80);
    expect(fitContain(500, 500, 100, 100, 0, 1, 80).scale).toBe(1);
  });
});
