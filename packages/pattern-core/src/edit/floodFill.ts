/**
 * Connected-region helpers (paint bucket, guided "focus" mode).
 *
 * Derived from perler-beads:
 *   Source:   https://github.com/Zippland/perler-beads
 *   Commit:   2efee730f73dd4eb472ebde443a022d11f98bc21
 *   Original: src/utils/floodFillUtils.ts (getConnectedRegion, getAllConnectedRegions,
 *             isRegionCompleted, isRegionPartiallyCompleted, getRegionCenter,
 *             sortRegionsByDistance, sortRegionsBySize)
 *   License:  AGPL-3.0
 *   Changes:  Operate on CellGrid (palette indices) instead of MappedPixel[][] / hex strings;
 *             visited bitmap instead of nested arrays; sorting helpers return new arrays instead
 *             of sorting in place.
 */
import { EMPTY_CELL, type CellGrid, type CellPos } from './grid';

/** 4-connected region of `targetIndex` containing (startRow, startCol). */
export function getConnectedRegion(grid: CellGrid, startRow: number, startCol: number, targetIndex: number): CellPos[] {
  const { cols, rows, cells } = grid;
  if (startRow < 0 || startRow >= rows || startCol < 0 || startCol >= cols || targetIndex === EMPTY_CELL) return [];
  const visited = new Uint8Array(cols * rows);
  const region: CellPos[] = [];
  const stack = [startRow * cols + startCol];
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (visited[i] || cells[i] !== targetIndex) continue;
    visited[i] = 1;
    const row = (i / cols) | 0;
    const col = i % cols;
    region.push({ row, col });
    if (row > 0) stack.push(i - cols);
    if (row < rows - 1) stack.push(i + cols);
    if (col > 0) stack.push(i - 1);
    if (col < cols - 1) stack.push(i + 1);
  }
  return region;
}

/** All 4-connected regions of `targetIndex`. */
export function getAllConnectedRegions(grid: CellGrid, targetIndex: number): CellPos[][] {
  const { cols, rows, cells } = grid;
  const seen = new Uint8Array(cols * rows);
  const regions: CellPos[][] = [];
  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || cells[i] !== targetIndex || targetIndex === EMPTY_CELL) continue;
    const region = getConnectedRegion(grid, (i / cols) | 0, i % cols, targetIndex);
    for (const p of region) seen[p.row * cols + p.col] = 1;
    regions.push(region);
  }
  return regions;
}

export function isRegionCompleted(region: CellPos[], completedCells: Set<string>): boolean {
  return region.every(({ row, col }) => completedCells.has(`${row},${col}`));
}

export function isRegionPartiallyCompleted(region: CellPos[], completedCells: Set<string>): boolean {
  return region.some(({ row, col }) => completedCells.has(`${row},${col}`));
}

export function getRegionCenter(region: CellPos[]): CellPos {
  if (region.length === 0) return { row: 0, col: 0 };
  let tr = 0;
  let tc = 0;
  for (const p of region) {
    tr += p.row;
    tc += p.col;
  }
  return { row: Math.floor(tr / region.length), col: Math.floor(tc / region.length) };
}

/** Nearest-first (Manhattan distance of region centers). */
export function sortRegionsByDistance(regions: CellPos[][], ref: CellPos): CellPos[][] {
  const d = (r: CellPos[]) => {
    const c = getRegionCenter(r);
    return Math.abs(c.row - ref.row) + Math.abs(c.col - ref.col);
  };
  return regions.slice().sort((a, b) => d(a) - d(b));
}

/** Largest-first. */
export function sortRegionsBySize(regions: CellPos[][]): CellPos[][] {
  return regions.slice().sort((a, b) => b.length - a.length);
}
