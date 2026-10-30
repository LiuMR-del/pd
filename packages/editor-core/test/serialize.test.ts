import { describe, expect, it } from 'vitest';
import { EMPTY_CELL, type PatternDoc } from '../src/doc';
import { base64ToBytes, bytesToBase64, decodeCells, docFromDraft, docToDraft, encodeCells } from '../src/serialize';

describe('base64', () => {
  it('round-trips all lengths and matches the standard alphabet', () => {
    for (let n = 0; n < 20; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 73 + n) & 255);
      expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
    }
    expect(bytesToBase64(Uint8Array.of(0xe6, 0x8b, 0xbc, 0xe8, 0xb1, 0x86)) /* UTF-8 of 拼豆 */).toBe('5ou86LGG');
    expect(() => base64ToBytes('a*bc')).toThrow();
  });
});

describe('cell encoding', () => {
  it('round-trips runs, empties and long runs', () => {
    const cells = new Uint16Array(200 * 200).fill(3);
    cells.fill(EMPTY_CELL, 100, 70000);
    cells[5] = 7;
    const enc = encodeCells(cells);
    expect(enc.length).toBeLessThan(40);
    expect(decodeCells(enc, cells.length)).toEqual(cells);
  });

  it('rejects data that does not add up', () => {
    const enc = encodeCells(Uint16Array.of(1, 1, 2));
    expect(() => decodeCells(enc, 4)).toThrow(/corrupt/);
    expect(() => decodeCells(enc, 2)).toThrow(/corrupt/);
  });
});

describe('drafts', () => {
  const doc: PatternDoc = {
    id: 'id1',
    name: '小猫',
    createdAt: 1,
    updatedAt: 2,
    cols: 3,
    rows: 2,
    cells: Uint16Array.of(0, 1, EMPTY_CELL, 1, 1, 0),
    palette: [
      { key: 'A1', hex: '#FFFFFF' },
      { key: 'B2', hex: '#000000' },
    ],
    brand: 'MARD',
    tier: 't24',
    settings: { style: 'cartoon', longSide: 72 },
  };

  it('round-trips through JSON', () => {
    const json = JSON.stringify(docToDraft(doc));
    const back = docFromDraft(JSON.parse(json));
    expect(back).toEqual(doc);
  });

  it('rejects invalid drafts with readable errors', () => {
    const good = docToDraft(doc);
    expect(() => docFromDraft(null)).toThrow(/object/);
    expect(() => docFromDraft({ ...good, format: 'x' })).toThrow(/not a pattern/);
    expect(() => docFromDraft({ ...good, version: 2 })).toThrow(/version/);
    expect(() => docFromDraft({ ...good, cols: 4 })).toThrow(/corrupt/);
    expect(() => docFromDraft({ ...good, palette: [{ key: 'A1', hex: 'red' }] })).toThrow(/palette entry/);
    expect(() => docFromDraft({ ...good, palette: good.palette.slice(0, 1) })).toThrow(/missing color/);
  });
});
