import { describe, expect, it } from 'vitest';
import { EMPTY_CELL, type PatternDoc } from '@pd/editor-core';
import { cellAtPoint, drawPattern, layoutSheet, luminance, sheetTiles, textColorFor, usageText, visibleRange, type Ctx2D } from '../src';

type Call = [string, ...unknown[]];

/** Records drawing calls together with the fill style and translation in effect. */
function recorder() {
  const calls: Call[] = [];
  let tx = 0;
  let ty = 0;
  const stack: [number, number][] = [];
  const ctx: Ctx2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    save: () => stack.push([tx, ty]),
    restore: () => ([tx, ty] = stack.pop()!),
    translate: (x, y) => {
      tx += x;
      ty += y;
    },
    fillRect: (x, y, w, h) => calls.push(['fillRect', ctx.fillStyle, x + tx, y + ty, w, h]),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => calls.push(['stroke']),
    fillText: (t, x, y) => calls.push(['fillText', ctx.fillStyle, t, x + tx, y + ty]),
  };
  return { ctx, calls };
}

const doc: PatternDoc = {
  id: 'd',
  name: '测试',
  createdAt: 0,
  updatedAt: 0,
  cols: 3,
  rows: 2,
  // row 0: A B .   row 1: B B A
  cells: Uint16Array.of(0, 1, EMPTY_CELL, 1, 1, 0),
  palette: [
    { key: 'A1', hex: '#FFFFFF' },
    { key: 'B2', hex: '#101010' },
  ],
  brand: 'MARD',
  tier: 'all',
  settings: {},
};

describe('colors', () => {
  it('picks readable text colors', () => {
    expect(textColorFor('#FFFFFF')).toBe('#000000');
    expect(textColorFor('#101010')).toBe('#FFFFFF');
    expect(textColorFor('#FFD800')).toBe('#000000');
    expect(textColorFor('#1030C0')).toBe('#FFFFFF');
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe('editor canvas', () => {
  const view = { cellSize: 20, offsetX: 10, offsetY: 0, width: 200, height: 100, showCodes: true };

  it('culls to the visible cells and hit-tests points', () => {
    expect(visibleRange(doc, { ...view, offsetX: -25, width: 30 })).toEqual({ c0: 1, c1: 3, r0: 0, r1: 2 });
    expect(cellAtPoint(doc, view, 15, 5)).toEqual({ row: 0, col: 0 });
    expect(cellAtPoint(doc, view, 69, 39)).toEqual({ row: 1, col: 2 });
    expect(cellAtPoint(doc, { ...view, mirror: true }, 15, 5)).toEqual({ row: 0, col: 2 });
    expect(cellAtPoint(doc, view, 5, 5)).toBeNull();
  });

  it('draws beads with codes, empty cells as a checkerboard, and grid lines', () => {
    const { ctx, calls } = recorder();
    drawPattern(ctx, doc, view);
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => [c[2], c[1]]);
    expect(texts).toEqual([['A1', '#000000'], ['B2', '#FFFFFF'], ['B2', '#FFFFFF'], ['B2', '#FFFFFF'], ['A1', '#000000']]);
    expect(calls.some((c) => c[0] === 'fillRect' && c[1] === '#E2E7E4' && c[2] === 50 && c[3] === 0)).toBe(true);
    expect(calls.filter((c) => c[0] === 'stroke').length).toBe(4 + 3);
  });

  it('washes out other colors when one is highlighted and hides codes on small cells', () => {
    const { ctx, calls } = recorder();
    drawPattern(ctx, doc, { ...view, cellSize: 10, highlight: 0 });
    expect(calls.filter((c) => c[0] === 'fillText')).toEqual([]);
    expect(calls.filter((c) => c[0] === 'fillRect' && String(c[1]).startsWith('rgba(255,255,255')).length).toBe(3);
  });
});

describe('export sheet', () => {
  it('lays out header, grid and legend and prints every bead code', () => {
    const sheet = layoutSheet(doc, { cellSize: 20 });
    expect(sheet.usage.map((u) => [u.key, u.count])).toEqual([['B2', 3], ['A1', 2]]);
    expect(sheet.grid.w).toBe(60);
    expect(sheet.width).toBeGreaterThan(sheet.grid.x + sheet.grid.w);
    expect(sheet.height).toBeGreaterThan(sheet.grid.y + sheet.grid.h);
    const { ctx, calls } = recorder();
    sheet.draw(ctx);
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => String(c[2]));
    expect(texts.filter((t) => t === 'A1' || t === 'B2').length).toBe(5);
    expect(texts).toContain('B2 × 3');
    expect(texts.some((t) => t.includes('3 × 2 格') && t.includes('5 颗'))).toBe(true);
  });

  it('mirrors columns', () => {
    const sheet = layoutSheet(doc, { cellSize: 20, mirror: true, showCodes: false });
    const { ctx, calls } = recorder();
    sheet.draw(ctx);
    const firstCell = calls.find((c) => c[0] === 'fillRect' && c[2] === sheet.grid.x && c[3] === sheet.grid.y && c[4] === 20);
    expect(firstCell).toBeUndefined(); // top-left of the mirrored sheet is the empty cell
    const rowStart = calls.find((c) => c[0] === 'fillRect' && c[2] === sheet.grid.x && c[3] === sheet.grid.y + 20);
    expect(rowStart?.[1]).toBe('#FFFFFF'); // row 1 ends with A1, which moves to the left
  });

  it('draws tiles in sheet coordinates', () => {
    const sheet = layoutSheet(doc, { cellSize: 20 });
    const tiles = sheetTiles(sheet, 64);
    expect(tiles.reduce((a, t) => a + t.w * t.h, 0)).toBe(sheet.width * sheet.height);
    const t = tiles[tiles.length - 1];
    const { ctx, calls } = recorder();
    sheet.draw(ctx, t);
    expect(calls[0]).toEqual(['fillRect', '#FFFFFF', 0, 0, t.w, t.h]);
  });

  it('formats a usage list', () => {
    expect(usageText(doc).split('\n')).toEqual(['测试（MARD，3×2 格，共 5 颗）', 'B2\t3', 'A1\t2']);
  });
});
