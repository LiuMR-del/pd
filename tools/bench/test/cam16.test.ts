import { describe, expect, it } from 'vitest';
import { srgb8ToLinear } from '@pd/pattern-core';
import { cam16UcsDistance, linearToCam16Ucs } from '../src/cam16';

describe('CAM16-UCS', () => {
  it('white has J=100 and no colorfulness; greys are neutral', () => {
    const w = linearToCam16Ucs([1, 1, 1]);
    expect(w[0]).toBeCloseTo((1.7 * 100) / (1 + 0.7), 3);
    expect(Math.hypot(w[1], w[2])).toBeLessThan(1);
    const g = linearToCam16Ucs(srgb8ToLinear([128, 128, 128]));
    expect(Math.hypot(g[1], g[2])).toBeLessThan(1);
  });

  it('lightness is monotonic and red is far from grey', () => {
    let prev = -1;
    for (let v = 0; v <= 255; v += 15) {
      const j = linearToCam16Ucs(srgb8ToLinear([v, v, v]))[0];
      expect(j).toBeGreaterThan(prev);
      prev = j;
    }
    const red = linearToCam16Ucs(srgb8ToLinear([255, 0, 0]));
    const grey = linearToCam16Ucs(srgb8ToLinear([128, 128, 128]));
    expect(cam16UcsDistance(red, grey)).toBeGreaterThan(30);
    expect(cam16UcsDistance(red, red)).toBe(0);
    const black = linearToCam16Ucs([0, 0, 0]);
    expect(black.every(Number.isFinite)).toBe(true);
    expect(black[0]).toBe(0);
  });
});
