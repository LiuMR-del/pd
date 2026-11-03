import { describe, expect, it } from 'vitest';
import { BRANDS, getPalette, getTier, listTiers, paletteData, validatePaletteData, type PaletteData } from '../src/index';
import { kitCodes, normalizeMardCode, readKits, standardCodes } from '../scripts/mard';
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
    const p06 = paletteData.colors.find((c) => c.codes.MARD === 'P6')!;
    expect(p06.altCodes).toEqual({ 盼盼: ['70'] });
  });

  it('detects malformed data', () => {
    const bad = clone();
    bad.colors[0].hex = '#XYZ123';
    delete bad.colors[1].vendorHex;
    delete bad.colors[2].vendorHex;
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

  it('writes MARD codes as printed on the bags (no leading zeros)', () => {
    expect(normalizeMardCode('A01')).toBe('A1');
    expect(normalizeMardCode('H10')).toBe('H10');
    expect(normalizeMardCode('ZG1')).toBe('ZG1');
    expect(paletteData.colors.every((c) => /^[A-Z]+[1-9]\d*$/.test(c.codes.MARD))).toBe(true);
  });

  it('tiers are the real MARD retail kits, nested', () => {
    const tiers = listTiers();
    expect(tiers.map((t) => t.size)).toEqual([24, 48, 72, 96, 120, 144, 221, 291]);
    expect(tiers.every((t) => !t.synthetic)).toBe(true);
    const codesOf = (size: number) => getPalette('MARD', size).map((c) => c.key);
    expect(codesOf(24).sort()).toEqual('A4 A6 A7 B3 B5 B8 C3 C5 C8 D6 D7 D9 E2 E4 F5 G1 G5 G7 H1 H2 H3 H4 H5 H7'.split(' ').sort());
    expect(new Set(codesOf(221))).toEqual(new Set(standardCodes(readKits())));
    expect(codesOf(221).some((k) => /^(P|Q|R|T|Y|ZG)\d/.test(k))).toBe(false);
    for (const [size, codes] of kitCodes(readKits())) expect(new Set(codesOf(size))).toEqual(new Set(codes));
    const t72 = new Set(getTier(72).colorIds);
    expect(getTier(24).colorIds.every((id) => t72.has(id))).toBe(true);
    expect(() => getTier(168)).toThrow();
  });

  it('only replaces colors with locally fetched MARD values, keeping the vendor value', () => {
    for (const c of paletteData.colors) if (c.vendorHex) expect(c.vendorHex).not.toBe(c.hex);
    expect(String(paletteData._source.mardHex)).toMatch(/MARD|perler-beads/);
  });

  it('getPalette returns brand codes', () => {
    const mard = getPalette('MARD', 72);
    expect(mard).toHaveLength(72);
    expect(mard.every((c) => /^#[0-9A-F]{6}$/.test(c.hex))).toBe(true);
    const coco = getPalette('COCO');
    expect(coco[0].key).toBe('E02'); // same color as MARD A1
    expect(() => getPalette('Hama')).toThrow();
  });
});
