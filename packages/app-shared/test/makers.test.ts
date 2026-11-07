import { MakerError, type GlyphRasterizer } from '@pd/makers';
import { getPalette, paletteData } from '@pd/palettes';
import { EMPTY_CELL } from '@pd/pattern-core';
import { describe, expect, it } from 'vitest';
import { makePattern, makerName, normalizeQr, normalizeText, qrColors, resolveColor, tierColors } from '../src/makers';

/** Fake rasterizer: every character is a solid block (enough to test the plumbing without a canvas). */
const blockRaster: GlyphRasterizer = (_ch, emPx, boxHeight) => {
  const width = Math.max(1, Math.round(emPx * 0.8));
  const alpha = new Uint8Array(width * boxHeight);
  const top = Math.floor(boxHeight * 0.2);
  const bottom = Math.ceil(boxHeight * 0.8);
  for (let y = top; y < bottom; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = 255;
  return { advance: width, left: 0, width, height: boxHeight, alpha };
};

describe('maker settings (shared)', () => {
  it('normalizes stored text and QR settings', () => {
    const t = normalizeText({ text: 'x'.repeat(500), height: 999, thickness: 'bad' as never, align: 'up' as never, color: 1e9 });
    expect(t.text.length).toBe(200);
    expect(t).toMatchObject({ height: 60, thickness: 'normal', align: 'center', color: null });
    const q = normalizeQr({ ecc: 'Z' as never, quietZone: 0, fillLight: false });
    expect(q).toMatchObject({ ecc: 'M', quietZone: 2, fillLight: false, text: '' });
  });

  it('resolves a bead id to itself in the tier, or to the nearest color of the tier', () => {
    const kit24 = tierColors('MARD', 24);
    expect(kit24.length).toBe(24);
    const inKit = kit24[3];
    expect(resolveColor(inKit.id, 'MARD', 24)).toEqual(inKit);
    const outside = paletteData.colors.findIndex((_, id) => !kit24.some((c) => c.id === id));
    const nearest = resolveColor(outside, 'MARD', 24)!;
    expect(kit24.some((c) => c.id === nearest.id)).toBe(true);
    expect(resolveColor(null, 'MARD', 24)).toBeNull();
  });

  it('makes a QR pattern with the darkest / lightest beads by default', () => {
    const q = normalizeQr({ text: 'https://example.com' });
    const r = makePattern('qr', q, 'MARD', 221, () => blockRaster);
    expect(r.cols).toBe(r.rows);
    expect(r.cols).toBeGreaterThanOrEqual(21 + 2 * 4);
    const { dark, light } = qrColors(q, 'MARD', 221);
    expect(r.palette.map((p) => p.hex).sort()).toEqual([dark.hex, light.hex].sort());
    expect(makerName('qr', q)).toBe('二维码 example.com');
  });

  it('makes a text pattern through the injected rasterizer', () => {
    const t = normalizeText({ text: 'AB', height: 10 });
    const r = makePattern('text', t, 'MARD', 221, () => blockRaster);
    expect(r.rows).toBeGreaterThanOrEqual(10);
    expect(Array.from(r.cells).some((c) => c !== EMPTY_CELL)).toBe(true);
    expect(makerName('text', t)).toBe('AB');
  });

  it('reports empty input as a MakerError', () => {
    expect(() => makePattern('qr', normalizeQr({ text: '' }), 'MARD', 221, () => blockRaster)).toThrow(MakerError);
    expect(getPalette('MARD', 221).length).toBe(221);
  });
});
