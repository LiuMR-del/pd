/** RGBA8 image, row-major, 4 bytes per pixel (same layout as ImageData / wx Canvas getImageData). */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Marker for an empty cell (no bead) in `PatternResult.cells`. */
export const EMPTY_CELL = 0xffff;

export interface ColorStat {
  key: string;
  hex: string;
  count: number;
}

export interface PatternResult {
  cols: number;
  rows: number;
  /** Row-major indices into `palette`; EMPTY_CELL for empty cells. */
  cells: Uint16Array;
  /** Colors used by this pattern, ordered by count (desc). */
  palette: { key: string; hex: string }[];
  /** Same order as `palette`. */
  stats: ColorStat[];
  /** Grid size before auto-crop, and the crop offset inside it. */
  sourceGrid: { cols: number; rows: number };
  offset: { x: number; y: number };
  /** Source-image rectangle (pixels) covered by the uncropped grid. */
  sourceRegion: { x: number; y: number; w: number; h: number };
  /** Milliseconds per stage. */
  timings: Record<string, number>;
  /** Diagnostics (detected pixel period, merges, cleanup counts, ...). */
  meta: Record<string, number | string | boolean | null>;
}
