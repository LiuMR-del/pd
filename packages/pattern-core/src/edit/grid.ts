import { EMPTY_CELL } from '../types';

/** Editable pattern grid: row-major palette indices, EMPTY_CELL for no bead. */
export interface CellGrid {
  cols: number;
  rows: number;
  cells: Uint16Array;
}

export interface CellPos {
  row: number;
  col: number;
}

export { EMPTY_CELL };
