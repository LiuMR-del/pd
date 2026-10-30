import { describe, expect, it } from 'vitest';
import { ciede2000 } from '../src/color/ciede2000';
import {
  hexToRgb,
  labToLinear,
  linearToLab,
  linearToOklab,
  linearToSrgb8,
  oklabToLinear,
  rgbToHex,
  srgb8ToLab,
  srgb8ToLinear,
  srgb8ToOklab,
  type Vec3,
} from '../src/color/convert';
import { getDistanceFn, pointFromLinear } from '../src/color/distance';
import { createMatcher, preparePalette } from '../src/color/palette';

// Sharma, Wu, Dalal (2005) supplementary test data: L1 a1 b1 L2 a2 b2 ΔE00
const SHARMA: number[][] = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
  [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

describe('ciede2000', () => {
  it.each(SHARMA.map((r, i) => [i + 1, r] as const))('Sharma pair %i', (_, r) => {
    const lab1: Vec3 = [r[0], r[1], r[2]];
    const lab2: Vec3 = [r[3], r[4], r[5]];
    expect(ciede2000(lab1, lab2)).toBeCloseTo(r[6], 4);
    expect(ciede2000(lab2, lab1)).toBeCloseTo(r[6], 4);
  });

  it('is zero for identical colors', () => {
    expect(ciede2000([40, 20, -10], [40, 20, -10])).toBe(0);
  });
});

describe('color conversion', () => {
  it('sRGB white/black/red to Lab', () => {
    const white = srgb8ToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 2);
    expect(Math.abs(white[1])).toBeLessThan(0.01);
    expect(Math.abs(white[2])).toBeLessThan(0.01);
    expect(srgb8ToLab([0, 0, 0])[0]).toBeCloseTo(0, 6);
    const red = srgb8ToLab([255, 0, 0]);
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
  });

  it('Oklab of white is (1,0,0)', () => {
    const w = srgb8ToOklab([255, 255, 255]);
    expect(w[0]).toBeCloseTo(1, 4);
    expect(w[1]).toBeCloseTo(0, 4);
    expect(w[2]).toBeCloseTo(0, 4);
  });

  it('round-trips sRGB8 -> linear -> Lab/Oklab -> linear -> sRGB8', () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 85) {
          const lin = srgb8ToLinear([r, g, b]);
          expect(linearToSrgb8(labToLinear(linearToLab(lin)))).toEqual([r, g, b]);
          expect(linearToSrgb8(oklabToLinear(linearToOklab(lin)))).toEqual([r, g, b]);
        }
  });

  it('hex helpers', () => {
    expect(hexToRgb('#FAF4C8')).toEqual([250, 244, 200]);
    expect(hexToRgb('faf4c8')).toEqual([250, 244, 200]);
    expect(hexToRgb('#FAF4C')).toBeNull();
    expect(rgbToHex([250, 244, 200])).toBe('#FAF4C8');
  });
});

describe('matcher', () => {
  // deterministic pseudo-random
  let seed = 42;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const hex = () => rgbToHex([rnd() * 255, rnd() * 255, rnd() * 255]);
  const palette = preparePalette(Array.from({ length: 80 }, (_, i) => ({ key: `C${i}`, hex: hex() })));

  it.each(['oklab', 'ciede2000'] as const)('pruned search equals brute force (%s)', (metric) => {
    const m = createMatcher(palette, metric);
    const dist = getDistanceFn(metric);
    for (let t = 0; t < 2000; t++) {
      const p = pointFromLinear(srgb8ToLinear([rnd() * 255, rnd() * 255, rnd() * 255]));
      const got = m.nearest(p);
      let best = Infinity;
      for (const c of palette.colors) best = Math.min(best, dist(p, c));
      // quantized cache key may pick a near-tie; distance must match best within tolerance
      expect(dist(p, palette.colors[got]) - best).toBeLessThan(0.3);
    }
  });

  it('Oklab prefilter + CIEDE2000 ranking agrees with exact search almost always', () => {
    const exact = createMatcher(palette, 'ciede2000');
    const fast = createMatcher(palette, 'ciede2000', undefined, { prefilterK: 8 });
    let agree = 0;
    const N = 3000;
    for (let t = 0; t < N; t++) {
      const p = pointFromLinear(srgb8ToLinear([rnd() * 255, rnd() * 255, rnd() * 255]));
      if (exact.nearest(p) === fast.nearest(p)) agree++;
    }
    expect(agree / N).toBeGreaterThan(0.97);
    // prefilter is ignored for the oklab metric and when K >= palette size
    const big = createMatcher(palette, 'ciede2000', undefined, { prefilterK: 500 });
    const p = pointFromLinear(srgb8ToLinear([10, 200, 30]));
    expect(big.nearest(p)).toBe(exact.nearest(p));
  });

  it('respects subset', () => {
    const m = createMatcher(palette, 'ciede2000', [3, 7]);
    for (let t = 0; t < 50; t++) {
      const p = pointFromLinear(srgb8ToLinear([rnd() * 255, rnd() * 255, rnd() * 255]));
      expect([3, 7]).toContain(m.nearest(p));
    }
  });

  it('caches prepared palettes by signature', () => {
    const input = [{ key: 'A', hex: '#000000' }, { key: 'B', hex: '#FFFFFF' }];
    expect(preparePalette(input)).toBe(preparePalette([...input]));
    expect(() => preparePalette([])).toThrow();
    expect(() => preparePalette([{ key: 'X', hex: 'nope' }])).toThrow();
  });
});
