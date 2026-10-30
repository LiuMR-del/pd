import { describe, expect, it } from 'vitest';
import { linearChannelToSrgb8 } from '../src/color/convert';
import { gridSize } from '../src/image/grid';
import { detectPixelPeriod } from '../src/image/period';
import { resampleLinear } from '../src/image/resample';
import { makeImage } from './helpers';

describe('gridSize', () => {
  it('follows aspect ratio and clamps long side to 10..200', () => {
    expect(gridSize(1280, 720, 100)).toEqual({ cols: 100, rows: 56 });
    expect(gridSize(405, 720, 72)).toEqual({ cols: 41, rows: 72 });
    expect(gridSize(100, 100, 5)).toEqual({ cols: 10, rows: 10 });
    expect(gridSize(100, 100, 999)).toEqual({ cols: 200, rows: 200 });
    expect(() => gridSize(0, 10, 50)).toThrow();
  });
});

describe('resampleLinear', () => {
  it('averages in linear light (black/white checker -> ~188 sRGB, not 128)', () => {
    const img = makeImage(8, 8, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
    const out = resampleLinear(img, 1, 1);
    expect(out.alpha[0]).toBeCloseTo(1, 5);
    expect(linearChannelToSrgb8(out.lin[0])).toBeGreaterThanOrEqual(187);
    expect(linearChannelToSrgb8(out.lin[0])).toBeLessThanOrEqual(189);
  });

  it('handles fractional cell boundaries and keeps exact colors in uniform areas', () => {
    const img = makeImage(10, 7, (x) => (x < 5 ? [255, 0, 0] : [0, 0, 255]));
    const out = resampleLinear(img, 4, 3);
    expect(linearChannelToSrgb8(out.lin[0])).toBe(255);
    expect(linearChannelToSrgb8(out.lin[2])).toBe(0);
    expect(linearChannelToSrgb8(out.lin[3 * 3 + 2])).toBe(255);
  });

  it('weights color by alpha and averages alpha', () => {
    const img = makeImage(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 0]));
    const out = resampleLinear(img, 1, 1);
    expect(out.alpha[0]).toBeCloseTo(0.5, 5);
    expect(out.lin[0]).toBeCloseTo(1, 5);
    expect(out.lin[1]).toBeCloseTo(0, 5);
  });

  it('upsamples without error', () => {
    const img = makeImage(2, 2, (x, y) => [x * 255, y * 255, 0]);
    const out = resampleLinear(img, 6, 6);
    expect(out.width).toBe(6);
    expect(linearChannelToSrgb8(out.lin[(5 * 6 + 5) * 3])).toBe(255);
  });
});

describe('detectPixelPeriod', () => {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) % 6);
  const art = Array.from({ length: 24 * 20 }, () => rnd());
  const colors: [number, number, number][] = [
    [255, 255, 255],
    [0, 0, 0],
    [220, 30, 30],
    [30, 160, 60],
    [30, 60, 210],
    [240, 210, 30],
  ];

  it('finds integer upscale period and phase', () => {
    const p = 4;
    const off = 2;
    const img = makeImage(24 * p + off, 20 * p + off, (x, y) => {
      const ax = Math.floor((x - off) / p);
      const ay = Math.floor((y - off) / p);
      if (ax < 0 || ay < 0) return [255, 255, 255];
      return colors[art[ay * 24 + ax]];
    });
    const det = detectPixelPeriod(img);
    expect(det?.period).toBe(4);
    expect(det?.offsetX).toBe(2);
    expect(det?.offsetY).toBe(2);
  });

  it('returns null for unscaled art and for smooth images', () => {
    const native = makeImage(24, 20, (x, y) => colors[art[y * 24 + x]]);
    expect(detectPixelPeriod(native)).toBeNull();
    const smooth = makeImage(64, 64, (x, y) => [x * 4, y * 4, 128]);
    expect(detectPixelPeriod(smooth)).toBeNull();
  });
});
