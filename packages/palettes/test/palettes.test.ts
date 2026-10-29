import { describe, expect, it } from 'vitest';
import { BRANDS, getPalette, getTier, listTiers, paletteData, validatePaletteData, type PaletteData } from '../src/index';
import { crossCheckVendor } from '../scripts/vendor';

const clone = (): PaletteData => JSON.parse(JSON.stringify(paletteData));

describe('palette data', () => {
  it('is valid and matches the vendor files', () => {
    expect(validatePaletteData(paletteData)).toEqual([]);
    expect(crossCheckVendor(paletteData)).toEqual([]);
    expect(paletteData.colors).toHaveLength(291);
    expect(BRANDS).toEqual(['MARD', 'COCO', '漫漫', '盼盼', '咪小窝']);
  });

  it('records CSV alternative codes', () => {
    const p06 = paletteData.colors.find((c) => c.codes.MARD === 'P06')!;
    expect(p06.altCodes).toEqual({ 盼盼: ['70'] });
  });

  it('detects malformed data', () => {
    const bad = clone();
    bad.colors[0].hex = '#XYZ123';
    bad.colors[1].hex = bad.colors[2].hex;
    bad.colors[3].codes.COCO = '';
    bad.colors[5].codes.MARD = bad.colors[4].codes.MARD;
    bad.tiers[0].colorIds[0] = 9999;
    const errs = validatePaletteData(bad).join('\n');
    expect(errs).toMatch(/bad hex/);
    expect(errs).toMatch(/duplicate hex/);
    expect(errs).toMatch(/missing COCO/);
    expect(errs).toMatch(/MARD code/);
    expect(errs).toMatch(/bad id 9999/);
  });

  it('flags stale knownIssues entries', () => {
    const d = clone();
    d.knownIssues.push({ brand: 'MARD', code: 'A01', hexes: [], note: 'x' });
    expect(validatePaletteData(d).join('\n')).toMatch(/no longer applies/);
  });

  it('tiers are nested and marked synthetic', () => {
    const tiers = listTiers();
    expect(tiers.map((t) => t.size)).toEqual([24, 48, 72, 96, 120, 144, 168, 221, 291]);
    expect(tiers.filter((t) => t.id !== 'all').every((t) => t.synthetic)).toBe(true);
    const t72 = new Set(getTier(72).colorIds);
    expect(getTier(24).colorIds.every((id) => t72.has(id))).toBe(true);
    expect(() => getTier(50)).toThrow();
  });

  it('getPalette returns brand codes', () => {
    const mard = getPalette('MARD', 72);
    expect(mard).toHaveLength(72);
    expect(mard.every((c) => /^#[0-9A-F]{6}$/.test(c.hex))).toBe(true);
    const coco = getPalette('COCO');
    expect(coco.find((c) => c.hex === '#FAF4C8')?.key).toBe('E02');
    expect(() => getPalette('Hama')).toThrow();
  });
});
