/**
 * Pattern editing operations (pure functions, return new grids).
 *
 * Derived from perler-beads:
 *   Source:   https://github.com/Zippland/perler-beads
 *   Commit:   2efee730f73dd4eb472ebde443a022d11f98bc21
 *   Original: src/utils/pixelEditingUtils.ts (floodFillErase, replaceColor, paintSinglePixel,
 *             recalculateColorStats)
 *   License:  AGPL-3.0
 *   Changes:  Operate on a compact CellGrid (Uint16Array of palette indices, EMPTY_CELL for erased)
 *             instead of MappedPixel[][] with string keys / isExternal flags; flood fill uses an
 *             index stack and a visited bitmap; colors are compared by palette index.
 */
import { EMPTY_CELL, type CellGrid } from './grid';

/** Erase (set to EMPTY_CELL) the 4-connected region of `targetIndex` containing (startRow, startCol). */
export function floodFillErase(grid: CellGrid, startRow: number, startCol: number, targetIndex: number): CellGrid {
  const { cols, rows } = grid;
  const cells = grid.cells.slice();
  if (startRow < 0 || startRow >= rows || startCol < 0 || startCol >= cols || targetIndex === EMPTY_CELL) return { cols, rows, cells };
  const visited = new Uint8Array(cols * rows);
  const stack = [startRow * cols + startCol];
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (visited[i] || cells[i] !== targetIndex) continue;
    visited[i] = 1;
    cells[i] = EMPTY_CELL;
    const r = (i / cols) | 0;
    const c = i % cols;
    if (r > 0) stack.push(i - cols);
    if (r < rows - 1) stack.push(i + cols);
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
  }
  return { cols, rows, cells };
}

/** Replace every cell of `sourceIndex` with `targetIndex`. */
export function replaceColor(grid: CellGrid, sourceIndex: number, targetIndex: number): { grid: CellGrid; replaceCount: number } {
  const cells = grid.cells.slice();
  let replaceCount = 0;
  if (sourceIndex !== EMPTY_CELL) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === sourceIndex) {
        cells[i] = targetIndex;
        replaceCount++;
      }
    }
  }
  return { grid: { cols: grid.cols, rows: grid.rows, cells }, replaceCount };
}

/** Paint one cell (EMPTY_CELL erases). Returns the original grid object when nothing changes. */
export function paintSinglePixel(
  grid: CellGrid,
  row: number,
  col: number,
  newIndex: number,
): { grid: CellGrid; previous: number | null; hasChange: boolean } {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return { grid, previous: null, hasChange: false };
  const i = row * grid.cols + col;
  const previous = grid.cells[i];
  if (previous === newIndex) return { grid, previous, hasChange: false };
  const cells = grid.cells.slice();
  cells[i] = newIndex;
  return { grid: { cols: grid.cols, rows: grid.rows, cells }, previous, hasChange: true };
}

/** Count beads per palette index (EMPTY_CELL excluded). */
export function recalculateColorStats(grid: CellGrid): { counts: Map<number, number>; totalCount: number } {
  const counts = new Map<number, number>();
  let totalCount = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    const p = grid.cells[i];
    if (p === EMPTY_CELL) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
    totalCount++;
  }
  return { counts, totalCount };
}
