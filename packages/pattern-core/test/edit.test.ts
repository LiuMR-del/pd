import { describe, expect, it } from 'vitest';
import { createColorSystem, sortColorsByHue, UNKNOWN_CODE } from '../src/color/colorSystems';
import {
  getAllConnectedRegions,
  getConnectedRegion,
  getRegionCenter,
  isRegionCompleted,
  isRegionPartiallyCompleted,
  sortRegionsByDistance,
  sortRegionsBySize,
} from '../src/edit/floodFill';
import { floodFillErase, paintSinglePixel, recalculateColorStats, replaceColor } from '../src/edit/pixelEditing';
import { EMPTY_CELL, type CellGrid } from '../src/edit/grid';

const E = EMPTY_CELL;
const grid = (rows: number[][]): CellGrid => ({ cols: rows[0].length, rows: rows.length, cells: Uint16Array.from(rows.flat()) });

describe('pixel editing', () => {
  const g = grid([
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
  ]);

  it('floodFillErase erases only the connected region and does not mutate input', () => {
    const out = floodFillErase(g, 0, 0, 0);
    expect(Array.from(out.cells)).toEqual([E, E, 1, 1, E, 1, 0, 1, 1]);
    expect(g.cells[0]).toBe(0);
  });

  it('replaceColor / paintSinglePixel / recalculateColorStats', () => {
    const r = replaceColor(g, 1, 2);
    expect(r.replaceCount).toBe(5);
    const p = paintSinglePixel(g, 1, 1, E);
    expect(p.hasChange).toBe(true);
    expect(p.previous).toBe(0);
    expect(paintSinglePixel(g, 0, 0, 0)).toMatchObject({ grid: g, hasChange: false });
    expect(paintSinglePixel(g, 9, 9, 0).hasChange).toBe(false);
    const s = recalculateColorStats(p.grid);
    expect(s.totalCount).toBe(8);
    expect(s.counts.get(1)).toBe(5);
  });
});

describe('flood fill regions', () => {
  const g = grid([
    [0, 0, 1, 0],
    [1, 1, 1, 0],
    [0, 1, 0, 0],
  ]);
  it('finds connected regions', () => {
    expect(getConnectedRegion(g, 0, 0, 0)).toHaveLength(2);
    const regions = getAllConnectedRegions(g, 0);
    expect(regions.map((r) => r.length).sort()).toEqual([1, 2, 4]);
    expect(sortRegionsBySize(regions)[0]).toHaveLength(4);
    expect(sortRegionsByDistance(regions, { row: 2, col: 0 })[0]).toEqual([{ row: 2, col: 0 }]);
    expect(getRegionCenter([{ row: 0, col: 0 }, { row: 2, col: 3 }])).toEqual({ row: 1, col: 1 });
    const done = new Set(['0,0']);
    expect(isRegionCompleted(regions[0], done)).toBe(false);
    expect(isRegionPartiallyCompleted(getConnectedRegion(g, 0, 0, 0), done)).toBe(true);
  });
});

describe('color systems', () => {
  const cs = createColorSystem({
    brands: ['MARD', 'COCO'],
    colors: [
      { hex: '#FAF4C8', codes: { MARD: 'A01', COCO: 'E02' } },
      { hex: '#000000', codes: { MARD: 'H07', COCO: 'X1' } },
    ],
  });
  it('converts codes and hex', () => {
    expect(cs.getColorKeyByHex('#faf4c8', 'COCO')).toBe('E02');
    expect(cs.getColorKeyByHex('#123456', 'COCO')).toBe(UNKNOWN_CODE);
    expect(cs.convertColorKeyToHex('H07', 'MARD')).toBe('#000000');
    expect(cs.convertColorKeyToHex('#abcdef', 'MARD')).toBe('#ABCDEF');
    expect(cs.isValidColorInSystem('#000000', 'COCO')).toBe(true);
    expect(cs.convertPaletteToColorSystem([{ key: 'A01', hex: '#FAF4C8' }], 'COCO')[0].key).toBe('E02');
    expect(cs.getCodeToHexMapping('MARD').get('A01')).toBe('#FAF4C8');
  });
  it('sorts by hue', () => {
    const sorted = sortColorsByHue([{ hex: '#0000FF' }, { hex: '#FF0000' }, { hex: '#00FF00' }]);
    expect(sorted.map((c) => c.hex)).toEqual(['#FF0000', '#00FF00', '#0000FF']);
  });
});
