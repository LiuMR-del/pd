import { describe, expect, it } from 'vitest';
import { fitViewport, keepVisible, MAX_CELL, MIN_CELL, pan, pinchOf, pinchStep, zoomAt } from '../src/lib/viewport';

describe('viewport', () => {
  it('fits the pattern, clamped to the cell size range', () => {
    expect(fitViewport(48, 36, 360, 360, 12)).toEqual({ cell: 7, ox: 12, oy: 54 });
    expect(fitViewport(2, 2, 1000, 1000).cell).toBe(MAX_CELL);
    expect(fitViewport(2000, 2000, 300, 300).cell).toBe(MIN_CELL);
  });

  it('zooms around a fixed point', () => {
    const v = { cell: 10, ox: 0, oy: 0 };
    const z = zoomAt(v, 2, 100, 50);
    expect(z.cell).toBe(20);
    // the cell under (100, 50) before and after is the same: (100 - ox) / cell
    expect((100 - z.ox) / z.cell).toBeCloseTo((100 - v.ox) / v.cell);
    expect((50 - z.oy) / z.cell).toBeCloseTo((50 - v.oy) / v.cell);
  });

  it('does not zoom past the limits', () => {
    const v = { cell: MAX_CELL, ox: 5, oy: 5 };
    expect(zoomAt(v, 2, 0, 0)).toBe(v);
    expect(zoomAt({ cell: 2, ox: 0, oy: 0 }, 0.1, 0, 0).cell).toBe(MIN_CELL);
  });

  it('pinch follows the midpoint and scales by the finger distance', () => {
    const v = { cell: 10, ox: 0, oy: 0 };
    const prev = pinchOf({ x: 90, y: 100 }, { x: 110, y: 100 });
    expect(prev).toEqual({ dist: 20, cx: 100, cy: 100 });
    // fingers spread to twice the distance and the midpoint moves 10px right
    const now = pinchOf({ x: 90, y: 100 }, { x: 130, y: 100 });
    const p = pinchStep(v, prev, now);
    expect(p.cell).toBe(20);
    // the cell that was under the old midpoint is now under the new midpoint
    expect((now.cx - p.ox) / p.cell).toBeCloseTo((prev.cx - v.ox) / v.cell);
  });

  it('pans and keeps part of the pattern on screen', () => {
    expect(pan({ cell: 10, ox: 1, oy: 2 }, 3, -4)).toEqual({ cell: 10, ox: 4, oy: -2 });
    // 50×50 cells of 10px on a 300×300 canvas: at most 500-48 px may leave to the left
    expect(keepVisible({ cell: 10, ox: -10000, oy: 10000 }, 50, 50, 300, 300)).toEqual({ cell: 10, ox: 48 - 500, oy: 300 - 48 });
    const ok = { cell: 10, ox: 0, oy: 0 };
    expect(keepVisible(ok, 50, 50, 300, 300)).toBe(ok);
  });
});
