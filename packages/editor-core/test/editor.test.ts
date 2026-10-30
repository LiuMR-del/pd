import { describe, expect, it } from 'vitest';
import { generatePattern } from '@pd/pattern-core';
import { beadCount, colorUsage, docFromPattern, EMPTY_CELL, type PatternDoc } from '../src/doc';
import { PatternEditor } from '../src/editor';

const E = EMPTY_CELL;

function makeDoc(rows: string[]): PatternDoc {
  // letters map to palette entries A, B, C; '.' is empty
  const palette = [
    { key: 'A', hex: '#FF0000' },
    { key: 'B', hex: '#00FF00' },
    { key: 'C', hex: '#0000FF' },
  ];
  const cols = rows[0].length;
  const cells = new Uint16Array(cols * rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (cells[y * cols + x] = ch === '.' ? E : ch.charCodeAt(0) - 65)));
  return { id: 'd', name: 'n', createdAt: 0, updatedAt: 0, cols, rows: rows.length, cells, palette, brand: 'MARD', tier: 'all', settings: {} };
}

function show(doc: PatternDoc): string[] {
  const out: string[] = [];
  for (let y = 0; y < doc.rows; y++) {
    let s = '';
    for (let x = 0; x < doc.cols; x++) {
      const c = doc.cells[y * doc.cols + x];
      s += c === E ? '.' : String.fromCharCode(65 + c);
    }
    out.push(s);
  }
  return out;
}

describe('PatternEditor', () => {
  it('paints and erases single cells, each its own undo step', () => {
    const doc = makeDoc(['AAA', 'AAA']);
    const ed = new PatternEditor(doc, { now: () => 42 });
    expect(ed.paintCell(0, 1, 1)).toBe(true);
    expect(ed.paintCell(0, 1, 1)).toBe(false); // no change, no step
    expect(ed.paintCell(1, 2, E)).toBe(true);
    expect(show(doc)).toEqual(['ABA', 'AA.']);
    expect(doc.updatedAt).toBe(42);
    expect(ed.undo()).toBe(true);
    expect(show(doc)).toEqual(['ABA', 'AAA']);
    expect(ed.undo()).toBe(true);
    expect(show(doc)).toEqual(['AAA', 'AAA']);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(true);
    expect(show(doc)).toEqual(['ABA', 'AAA']);
  });

  it('merges a stroke into one step and keeps the original value of re-painted cells', () => {
    const doc = makeDoc(['AAAAA', 'AAAAA']);
    const ed = new PatternEditor(doc);
    ed.beginStroke();
    expect(ed.stroking).toBe(true);
    ed.paintLine(0, 0, 0, 4, 1);
    ed.paintCell(0, 2, 2);
    ed.paintLine(0, 4, 1, 4, 2);
    expect(ed.endStroke()).toBe(true);
    expect(ed.stroking).toBe(false);
    expect(show(doc)).toEqual(['BBCBC', 'AAAAC']);
    ed.undo();
    expect(show(doc)).toEqual(['AAAAA', 'AAAAA']);
    expect(ed.canUndo).toBe(false);
    ed.redo();
    expect(show(doc)).toEqual(['BBCBC', 'AAAAC']);
  });

  it('draws gap-free diagonal lines', () => {
    const doc = makeDoc(['....', '....', '....', '....']);
    const ed = new PatternEditor(doc);
    ed.paintLine(0, 0, 3, 3, 0);
    expect(show(doc)).toEqual(['A...', '.A..', '..A.', '...A']);
  });

  it('bucket-fills the 4-connected region, including empty regions', () => {
    const doc = makeDoc(['AAB.', 'ABB.', 'AAB.']);
    const ed = new PatternEditor(doc);
    expect(ed.fill(0, 0, 2)).toBe(true);
    expect(show(doc)).toEqual(['CCB.', 'CBB.', 'CCB.']);
    expect(ed.fill(0, 3, 0)).toBe(true);
    expect(show(doc)).toEqual(['CCBA', 'CBBA', 'CCBA']);
    expect(ed.fill(0, 0, 2)).toBe(false);
    ed.undo();
    ed.undo();
    expect(show(doc)).toEqual(['AAB.', 'ABB.', 'AAB.']);
  });

  it('replaces a color everywhere and mirrors left-right', () => {
    const doc = makeDoc(['AB.', 'BBA']);
    const ed = new PatternEditor(doc);
    expect(ed.replaceColor(1, 2)).toBe(true);
    expect(show(doc)).toEqual(['AC.', 'CCA']);
    expect(ed.replaceColor(1, 0)).toBe(false); // nothing left of B
    expect(ed.mirrorHorizontal()).toBe(true);
    expect(show(doc)).toEqual(['.CA', 'ACC']);
    ed.undo();
    expect(show(doc)).toEqual(['AC.', 'CCA']);
  });

  it('caps history and clears redo on new edits', () => {
    const doc = makeDoc(['AAAA']);
    const ed = new PatternEditor(doc, { maxHistory: 2 });
    ed.paintCell(0, 0, 1);
    ed.paintCell(0, 1, 1);
    ed.paintCell(0, 2, 1);
    expect(ed.undo() && ed.undo()).toBe(true);
    expect(ed.undo()).toBe(false);
    expect(show(doc)).toEqual(['BAAA']);
    ed.paintCell(0, 3, 2);
    expect(ed.canRedo).toBe(false);
  });

  it('notifies listeners with the changed cells', () => {
    const doc = makeDoc(['AAAA', 'AAAA']);
    const ed = new PatternEditor(doc);
    const seen: (number[] | 'all')[] = [];
    const off = ed.subscribe((c) => seen.push(c === 'all' ? 'all' : Array.from(c)));
    ed.paintCell(1, 2, 1);
    ed.replaceColor(0, 2);
    off();
    ed.undo();
    // the empty notification closes the single-cell stroke (undo availability changed)
    expect(seen).toEqual([[6], [], 'all']);
  });

  it('adds colors on demand and rejects unknown indices', () => {
    const doc = makeDoc(['A']);
    const ed = new PatternEditor(doc);
    expect(ed.ensureColor({ key: 'B', hex: '#00ff00' })).toBe(1);
    expect(ed.ensureColor({ key: 'Z', hex: '#123456' })).toBe(3);
    expect(() => ed.paintCell(0, 0, 9)).toThrow(/palette/);
    expect(ed.paintCell(5, 5, 0)).toBe(false);
  });
});

describe('document helpers', () => {
  it('builds a document from a generated pattern and reports usage', () => {
    const img = { width: 40, height: 20, data: new Uint8ClampedArray(40 * 20 * 4) };
    for (let i = 0; i < 40 * 20; i++) {
      const red = i % 40 < 20;
      img.data.set(red ? [224, 32, 32, 255] : [255, 255, 255, 255], i * 4);
    }
    const r = generatePattern(img, [
      { key: 'R1', hex: '#E02020' },
      { key: 'W1', hex: '#FFFFFF' },
    ], { cols: 4, rows: 2 });
    const doc = docFromPattern(r, { id: 'x', name: '测试', brand: 'MARD', tier: 'all', now: 7 });
    expect([doc.cols, doc.rows, doc.createdAt]).toEqual([4, 2, 7]);
    expect(doc.cells).not.toBe(r.cells);
    expect(colorUsage(doc).map((u) => [u.key, u.count])).toEqual([['R1', 4], ['W1', 4]]);
    expect(beadCount(doc)).toBe(8);
  });

  it('skips unused palette colors in usage', () => {
    const doc = makeDoc(['AA.', 'CA.']);
    expect(colorUsage(doc).map((u) => `${u.key}${u.count}`)).toEqual(['A3', 'C1']);
  });
});
