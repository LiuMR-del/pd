import { EMPTY_CELL, type PaletteEntry, type PatternDoc } from './doc';

/** Brand and color tier of a document (changed by brand conversion). */
export interface DocBrand {
  brand: string;
  tier: string;
}

/** One undoable step: the cells it touched with their values before and after. */
interface Change {
  label: string;
  idx: Int32Array;
  before: Uint16Array;
  after: Uint16Array;
  /** Set when the step also switched the document's brand / tier. */
  brand?: { before: DocBrand; after: DocBrand };
}

/** Cells that changed (indices into doc.cells), or 'all' after whole-grid operations. */
export type ChangeListener = (changed: Int32Array | 'all') => void;

export interface EditorOptions {
  /** Max undo steps kept (oldest dropped first). Default 200. */
  maxHistory?: number;
  /** Clock for doc.updatedAt (defaults to Date.now). */
  now?: () => number;
}

/**
 * Mutable editor over a PatternDoc. Every operation records only the cells it changed, so memory
 * grows with the amount of editing, not with the grid size. Operations that change nothing do
 * not create an undo step. Pen strokes (beginStroke .. endStroke) become a single step.
 */
export class PatternEditor {
  readonly doc: PatternDoc;
  private readonly maxHistory: number;
  private readonly now: () => number;
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private stroke: { label: string; before: Map<number, number> } | null = null;
  private listeners = new Set<ChangeListener>();

  constructor(doc: PatternDoc, options: EditorOptions = {}) {
    if (doc.cells.length !== doc.cols * doc.rows) throw new Error('cells length does not match cols x rows');
    this.doc = doc;
    this.maxHistory = Math.max(1, Math.floor(options.maxHistory ?? 200));
    this.now = options.now ?? Date.now;
  }

  subscribe(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** True between beginStroke() and endStroke(). */
  get stroking(): boolean {
    return this.stroke !== null;
  }

  /** Label of the step undo() would revert (for tooltips), or null. */
  get undoLabel(): string | null {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  inBounds(row: number, col: number): boolean {
    return row >= 0 && col >= 0 && row < this.doc.rows && col < this.doc.cols;
  }

  /** Palette index at a cell (EMPTY_CELL for no bead / out of bounds). */
  cellAt(row: number, col: number): number {
    return this.inBounds(row, col) ? this.doc.cells[row * this.doc.cols + col] : EMPTY_CELL;
  }

  /** Index of a color in the document palette, appending it when missing. Not an undo step. */
  ensureColor(entry: PaletteEntry): number {
    const hex = entry.hex.toUpperCase();
    const found = this.doc.palette.findIndex((p) => p.key === entry.key && p.hex.toUpperCase() === hex);
    if (found >= 0) return found;
    if (this.doc.palette.length >= EMPTY_CELL) throw new Error('palette is full');
    this.doc.palette.push({ key: entry.key, hex });
    return this.doc.palette.length - 1;
  }

  // --- pen / eraser strokes -------------------------------------------------------------------

  beginStroke(label = 'paint'): void {
    if (this.stroke) this.endStroke();
    this.stroke = { label, before: new Map() };
  }

  /** Paint one cell (value EMPTY_CELL erases). Outside a stroke it is its own undo step. */
  paintCell(row: number, col: number, value: number): boolean {
    if (!this.inBounds(row, col)) return false;
    this.checkValue(value);
    const own = !this.stroke;
    if (own) this.beginStroke(value === EMPTY_CELL ? 'erase' : 'paint');
    const i = row * this.doc.cols + col;
    const prev = this.doc.cells[i];
    let changed = false;
    if (prev !== value) {
      if (!this.stroke!.before.has(i)) this.stroke!.before.set(i, prev);
      this.doc.cells[i] = value;
      this.emit(Int32Array.of(i));
      changed = true;
    }
    if (own) this.endStroke();
    return changed;
  }

  /** Paint the straight line between two cells (fills gaps between pointer samples). */
  paintLine(r0: number, c0: number, r1: number, c1: number, value: number): boolean {
    let changed = false;
    let x = c0;
    let y = r0;
    const dx = Math.abs(c1 - c0);
    const dy = -Math.abs(r1 - r0);
    const sx = c0 < c1 ? 1 : -1;
    const sy = r0 < r1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (this.paintCell(y, x, value)) changed = true;
      if (x === c1 && y === r1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return changed;
  }

  /** Close the current stroke; it becomes one undo step if it changed anything. */
  endStroke(): boolean {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.before.size === 0) return false;
    const idx = Int32Array.from(s.before.keys());
    const before = Uint16Array.from(s.before.values());
    const after = new Uint16Array(idx.length);
    for (let k = 0; k < idx.length; k++) after[k] = this.doc.cells[idx[k]];
    this.push({ label: s.label, idx, before, after });
    // cells were already reported while painting; this tells listeners the undo state changed
    this.emit(new Int32Array(0));
    return true;
  }

  // --- whole-region operations ----------------------------------------------------------------

  /** Bucket fill: the 4-connected region of the clicked cell's value (empty included) becomes `value`. */
  fill(row: number, col: number, value: number): boolean {
    if (!this.inBounds(row, col)) return false;
    this.checkValue(value);
    const { cols, rows, cells } = this.doc;
    const start = row * cols + col;
    const target = cells[start];
    if (target === value) return false;
    const seen = new Uint8Array(cols * rows);
    const hits: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      hits.push(i);
      const x = i % cols;
      const y = (i / cols) | 0;
      const visit = (j: number) => {
        if (!seen[j] && cells[j] === target) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < cols - 1) visit(i + 1);
      if (y > 0) visit(i - cols);
      if (y < rows - 1) visit(i + cols);
    }
    return this.commit('fill', Int32Array.from(hits), () => value);
  }

  /** Replace every bead of color `from` with `to` (EMPTY_CELL removes them). */
  replaceColor(from: number, to: number): boolean {
    this.checkValue(to);
    if (from === to || from === EMPTY_CELL) return false;
    const hits: number[] = [];
    for (let i = 0; i < this.doc.cells.length; i++) if (this.doc.cells[i] === from) hits.push(i);
    return this.commit('replace', Int32Array.from(hits), () => to);
  }

  /**
   * Recolor every bead through `map` (old palette index -> new index; indices not in the map
   * stay), optionally switching the document's brand / tier in the same undo step.
   */
  remapColors(map: ReadonlyMap<number, number>, brand?: DocBrand, label = 'remap'): boolean {
    map.forEach((to) => this.checkValue(to));
    const { cells } = this.doc;
    const hits: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      const to = map.get(cells[i]);
      if (to !== undefined && to !== cells[i]) hits.push(i);
    }
    const prev: DocBrand = { brand: this.doc.brand, tier: this.doc.tier };
    const switched = brand && (brand.brand !== prev.brand || brand.tier !== prev.tier) ? { before: prev, after: { ...brand } } : undefined;
    return this.commit(label, Int32Array.from(hits), (i) => map.get(cells[i])!, switched);
  }

  /** Flip the whole pattern left-right. */
  mirrorHorizontal(): boolean {
    const { cols, rows, cells } = this.doc;
    const hits: number[] = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (cells[i] !== cells[y * cols + (cols - 1 - x)]) hits.push(i);
      }
    const src = cells.slice();
    return this.commit('mirror', Int32Array.from(hits), (i) => src[((i / cols) | 0) * cols + (cols - 1 - (i % cols))]);
  }

  // --- history --------------------------------------------------------------------------------

  undo(): boolean {
    if (this.stroke) this.endStroke();
    const c = this.undoStack.pop();
    if (!c) return false;
    this.write(c.idx, c.before, c.brand?.before);
    this.redoStack.push(c);
    return true;
  }

  redo(): boolean {
    const c = this.redoStack.pop();
    if (!c) return false;
    this.write(c.idx, c.after, c.brand?.after);
    this.undoStack.push(c);
    return true;
  }

  /** Drop all history (e.g. after loading or regenerating). */
  clearHistory(): void {
    this.stroke = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  // --- internals ------------------------------------------------------------------------------

  private checkValue(value: number): void {
    if (value !== EMPTY_CELL && (value < 0 || value >= this.doc.palette.length || !Number.isInteger(value))) {
      throw new Error(`color index ${value} is not in the palette`);
    }
  }

  private commit(label: string, idx: Int32Array, next: (i: number) => number, brand?: Change['brand']): boolean {
    if (this.stroke) this.endStroke();
    if (!idx.length && !brand) return false;
    const before = new Uint16Array(idx.length);
    const after = new Uint16Array(idx.length);
    for (let k = 0; k < idx.length; k++) {
      before[k] = this.doc.cells[idx[k]];
      after[k] = next(idx[k]);
    }
    for (let k = 0; k < idx.length; k++) this.doc.cells[idx[k]] = after[k];
    if (brand) this.setBrand(brand.after);
    this.push({ label, idx, before, after, brand });
    this.emit(brand || idx.length > this.doc.cells.length / 4 ? 'all' : idx);
    return true;
  }

  private write(idx: Int32Array, values: Uint16Array, brand?: DocBrand): void {
    for (let k = 0; k < idx.length; k++) this.doc.cells[idx[k]] = values[k];
    if (brand) this.setBrand(brand);
    this.doc.updatedAt = this.now();
    this.emit(brand || idx.length > this.doc.cells.length / 4 ? 'all' : idx);
  }

  private setBrand(b: DocBrand): void {
    this.doc.brand = b.brand;
    this.doc.tier = b.tier;
  }

  private push(c: Change): void {
    this.undoStack.push(c);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
    this.doc.updatedAt = this.now();
  }

  private emit(changed: Int32Array | 'all'): void {
    this.listeners.forEach((fn) => fn(changed));
  }
}
