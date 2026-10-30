import { EMPTY_CELL, type PatternResult } from '@pd/pattern-core';

export { EMPTY_CELL };

/** A bead color available in a document: brand color code + "#RRGGBB". */
export interface PaletteEntry {
  key: string;
  hex: string;
}

/**
 * An editable pattern. `cells` holds indices into `palette` (EMPTY_CELL = no bead), row-major.
 * The palette may contain colors no cell uses any more (after edits); stats skip them.
 */
export interface PatternDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  cols: number;
  rows: number;
  cells: Uint16Array;
  palette: PaletteEntry[];
  /** Brand and color tier the pattern was generated / is edited with. */
  brand: string;
  tier: string;
  /** Generation settings, opaque to the editor (kept so the pattern can be regenerated). */
  settings: Record<string, unknown>;
}

export interface ColorUsage {
  index: number;
  key: string;
  hex: string;
  count: number;
}

export interface DocInit {
  id: string;
  name: string;
  brand: string;
  tier: string;
  settings?: Record<string, unknown>;
  now?: number;
}

/** Wrap a generated pattern into a new document (cells are copied). */
export function docFromPattern(r: PatternResult, init: DocInit): PatternDoc {
  const now = init.now ?? Date.now();
  return {
    id: init.id,
    name: init.name,
    createdAt: now,
    updatedAt: now,
    cols: r.cols,
    rows: r.rows,
    cells: r.cells.slice(),
    palette: r.palette.map((p) => ({ key: p.key, hex: p.hex })),
    brand: init.brand,
    tier: init.tier,
    settings: init.settings ? { ...init.settings } : {},
  };
}

/** Bead count per used color, most used first (ties by color code). */
export function colorUsage(doc: PatternDoc): ColorUsage[] {
  const counts = new Array<number>(doc.palette.length).fill(0);
  for (let i = 0; i < doc.cells.length; i++) {
    const c = doc.cells[i];
    if (c !== EMPTY_CELL && c < counts.length) counts[c]++;
  }
  const out: ColorUsage[] = [];
  counts.forEach((count, index) => {
    if (count > 0) out.push({ index, key: doc.palette[index].key, hex: doc.palette[index].hex, count });
  });
  return out.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index));
}

/** Total number of beads. */
export function beadCount(doc: PatternDoc): number {
  let n = 0;
  for (let i = 0; i < doc.cells.length; i++) if (doc.cells[i] !== EMPTY_CELL) n++;
  return n;
}
