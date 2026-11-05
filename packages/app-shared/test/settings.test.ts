import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings, toPatternOptions, withSize } from '../src/settings';

describe('generation settings', () => {
  it('maps presets and user choices to algorithm options', () => {
    const s = { ...defaultSettings(), style: 'photo' as const, removeBackground: true };
    const o = toPatternOptions(s);
    expect(o.style).toBe('photo');
    expect(o.longSide).toBe(72);
    expect(o.maxColors).toBe(24);
    expect(o.removeBackground).toBe(true);
    expect(o.stroke?.enabled).toBe(true);
    expect(o.dither).toBe(0.25); // photo preset default kept when dither is null
    expect(toPatternOptions({ ...s, strokeProtect: false, dither: 0 })).toMatchObject({ dither: 0, stroke: { enabled: false } });
  });

  it('applies size presets and clamps stored values', () => {
    expect(withSize(defaultSettings(), 'detail')).toMatchObject({ size: 'detail', longSide: 100, maxColors: 36 });
    const n = normalizeSettings({ longSide: 999, maxColors: -3, brand: 'nope', tier: 7, style: 'x' as never, dither: 5 });
    expect(n).toMatchObject({ longSide: 200, maxColors: 2, brand: 'MARD', tier: 221, style: 'cartoon', dither: 1 });
    expect(normalizeSettings({ tier: 168 }).tier).toBe(221); // no such MARD kit
    expect(defaultSettings().tier).toBe(221);
  });
});
