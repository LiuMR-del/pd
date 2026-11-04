import { describe, expect, it } from 'vitest';
import { colorUsage, EMPTY_CELL, type PatternDoc } from '../src/doc';
import { applyBrandConversion, planBrandConversion, type BrandColor } from '../src/convert';
import { PatternEditor } from '../src/editor';

const E = EMPTY_CELL;

// a tiny brand table: same beads under two brands' codes; 漫漫 has one code for two colors (like S4)
const TABLE: BrandColor[] = [
  { id: 0, hex: '#FF0000', codes: { MARD: 'F1', COCO: 'R01', 漫漫: 'S4' } },
  { id: 1, hex: '#00AA00', codes: { MARD: 'B5', COCO: 'G02', 漫漫: 'S4' } },
  { id: 2, hex: '#0000FF', codes: { MARD: 'C3', COCO: 'U03', 漫漫: 'L1' } },
  { id: 3, hex: '#EE1111', codes: { MARD: 'F2', COCO: 'R04', 漫漫: 'R9' } },
  { id: 4, hex: '#FFFFFF', codes: { MARD: 'H2', COCO: 'W01', 漫漫: 'W1' } },
];

function doc(brand = 'MARD'): PatternDoc {
  const palette = [
    { key: 'F1', hex: '#FF0000' },
    { key: 'B5', hex: '#00AA00' },
    { key: 'C3', hex: '#0000FF' },
    { key: 'H2', hex: '#FFFFFF' },
  ];
  // F1 ×3, B5 ×2, C3 ×1, H2 unused
  const cells = Uint16Array.from([0, 0, 0, 1, 1, 2, E, E]);
  return { id: 'd', name: 'n', createdAt: 0, updatedAt: 0, cols: 4, rows: 2, cells, palette, brand, tier: 'all', settings: {} };
}

describe('planBrandConversion', () => {
  it('same beads keep their color and only change code', () => {
    const plan = planBrandConversion(doc(), TABLE, { brand: 'COCO', tier: 'all', colorIds: [0, 1, 2, 3, 4] });
    expect(plan.rows.map((r) => [r.from.key, r.to.key, r.count, r.exact, r.deltaE])).toEqual([
      ['F1', 'R01', 3, true, 0],
      ['B5', 'G02', 2, true, 0],
      ['C3', 'U03', 1, true, 0],
    ]);
  });

  it('colors missing from the target tier go to the nearest one, listed first', () => {
    // tier without pure red and blue: red -> the near red #EE1111, blue -> nearest of what is left
    const plan = planBrandConversion(doc(), TABLE, { brand: 'COCO', tier: '3', colorIds: [1, 3, 4] });
    const [first, second, third] = plan.rows;
    expect(first.exact).toBe(false);
    expect(second.exact).toBe(false);
    expect(first.deltaE).toBeGreaterThanOrEqual(second.deltaE);
    const red = plan.rows.find((r) => r.from.key === 'F1')!;
    expect(red.to).toEqual({ key: 'R04', hex: '#EE1111' });
    expect(red.deltaE).toBeGreaterThan(0);
    expect(red.deltaE).toBeLessThan(5);
    expect(third).toMatchObject({ from: { key: 'B5' }, to: { key: 'G02' }, exact: true });
  });

  it('a code shared by two colors is resolved by color value', () => {
    const d = doc('漫漫');
    d.palette = [
      { key: 'S4', hex: '#00AA00' },
      { key: 'S4', hex: '#FF0000' },
      { key: 'L1', hex: '#0000FF' },
      { key: 'W1', hex: '#FFFFFF' },
    ];
    const plan = planBrandConversion(d, TABLE, { brand: 'MARD', tier: 'all', colorIds: [0, 1, 2, 3, 4] });
    const byIndex = new Map(plan.rows.map((r) => [r.index, r.to.key]));
    expect(byIndex.get(0)).toBe('B5');
    expect(byIndex.get(1)).toBe('F1');
    expect(plan.rows.every((r) => r.exact)).toBe(true);
  });

  it('colors not in the table at all are matched by value', () => {
    const d = doc();
    d.palette[2] = { key: 'custom', hex: '#0505F0' };
    const plan = planBrandConversion(d, TABLE, { brand: 'COCO', tier: 'all', colorIds: [0, 1, 2, 3, 4] });
    expect(plan.rows[0]).toMatchObject({ from: { key: 'custom' }, to: { key: 'U03', hex: '#0000FF' }, exact: false });
  });
});

describe('applyBrandConversion', () => {
  it('is one undo step covering colors and brand / tier', () => {
    const d = doc();
    const ed = new PatternEditor(d, { now: () => 7 });
    const seen: Array<Int32Array | 'all'> = [];
    ed.subscribe((c) => seen.push(c));
    const plan = planBrandConversion(d, TABLE, { brand: 'COCO', tier: '3', colorIds: [1, 3, 4] });
    expect(applyBrandConversion(ed, plan)).toBe(true);
    expect([d.brand, d.tier]).toEqual(['COCO', '3']);
    const expected = new Map<string, number>();
    for (const r of plan.rows) expected.set(r.to.key, (expected.get(r.to.key) ?? 0) + r.count);
    expect(new Map(colorUsage(d).map((u) => [u.key, u.count]))).toEqual(expected);
    expect(expected.get('R04')).toBeGreaterThanOrEqual(3);
    expect(seen[seen.length - 1]).toBe('all');
    expect(ed.undoLabel).toBe('brand');

    expect(ed.undo()).toBe(true);
    expect([d.brand, d.tier]).toEqual(['MARD', 'all']);
    expect(colorUsage(d).map((u) => [u.key, u.count])).toEqual([
      ['F1', 3],
      ['B5', 2],
      ['C3', 1],
    ]);
    expect(ed.redo()).toBe(true);
    expect([d.brand, d.tier]).toEqual(['COCO', '3']);
  });

  it('two colors that land on the same bead merge', () => {
    const d = doc();
    const ed = new PatternEditor(d);
    // only red #EE1111 and white: both reds and (nearest) everything else collapse
    applyBrandConversion(ed, planBrandConversion(d, TABLE, { brand: 'MARD', tier: '2', colorIds: [3, 4] }));
    const usage = colorUsage(d);
    expect(usage.find((u) => u.key === 'F2')!.count).toBeGreaterThanOrEqual(3);
    expect(new Set(usage.map((u) => u.key)).size).toBe(usage.length);
  });

  it('a brand switch with identical colors is still an undo step', () => {
    const d = doc();
    d.cells.fill(E);
    const ed = new PatternEditor(d);
    expect(applyBrandConversion(ed, planBrandConversion(d, TABLE, { brand: 'COCO', tier: 'all', colorIds: [0, 1, 2, 3, 4] }))).toBe(true);
    expect(d.brand).toBe('COCO');
    ed.undo();
    expect(d.brand).toBe('MARD');
    // and converting to where it already is changes nothing
    expect(applyBrandConversion(ed, planBrandConversion(d, TABLE, { brand: 'MARD', tier: 'all', colorIds: [0, 1, 2, 3, 4] }))).toBe(false);
  });
});

describe('planBrandConversion lookup', () => {
  it('a code with a different color value is not treated as the same bead', () => {
    const d = doc();
    // a MARD code whose color no longer matches the table (e.g. older color data)
    d.palette[0] = { key: 'F1', hex: '#FA0505' };
    const plan = planBrandConversion(d, TABLE, { brand: 'COCO', tier: 'all', colorIds: [0, 1, 2, 3, 4] });
    const row = plan.rows.find((r) => r.index === 0)!;
    expect(row.exact).toBe(false);
    expect(row.deltaE).toBeGreaterThan(0);
  });
});
