import type { PaletteEntry, PatternDoc } from './doc';
import { EMPTY_CELL } from './doc';

/** On-disk / on-wire draft format. `cells` is run-length encoded, then base64. */
export interface PatternDraftV1 {
  format: 'pd-pattern';
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  cols: number;
  rows: number;
  palette: PaletteEntry[];
  brand: string;
  tier: string;
  settings: Record<string, unknown>;
  cells: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Base64 without btoa/atob or Buffer (not available in WeChat mini-program Workers). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('invalid base64 length');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    let k = 0;
    for (; k < 4 && i + k < clean.length; k++) {
      const c = clean.charCodeAt(i + k);
      const v = c < 128 ? B64_INDEX[c] : -1;
      if (v < 0) throw new Error('invalid base64 character');
      n |= v << (18 - 6 * k);
    }
    out[o++] = (n >> 16) & 255;
    if (k > 2) out[o++] = (n >> 8) & 255;
    if (k > 3) out[o++] = n & 255;
  }
  return out;
}

/** Run-length encode cells as little-endian uint16 pairs (value, run length 1..65535), then base64. */
export function encodeCells(cells: Uint16Array): string {
  const pairs: number[] = [];
  for (let i = 0; i < cells.length; ) {
    const v = cells[i];
    let run = 1;
    while (i + run < cells.length && cells[i + run] === v && run < 0xffff) run++;
    pairs.push(v, run);
    i += run;
  }
  const bytes = new Uint8Array(pairs.length * 2);
  for (let k = 0; k < pairs.length; k++) {
    bytes[k * 2] = pairs[k] & 255;
    bytes[k * 2 + 1] = pairs[k] >> 8;
  }
  return bytesToBase64(bytes);
}

/** Inverse of encodeCells; throws unless the runs add up to exactly `length` cells. */
export function decodeCells(encoded: string, length: number): Uint16Array {
  const bytes = base64ToBytes(encoded);
  if (bytes.length % 4 !== 0) throw new Error('corrupt cell data');
  const out = new Uint16Array(length);
  let o = 0;
  for (let k = 0; k < bytes.length; k += 4) {
    const v = bytes[k] | (bytes[k + 1] << 8);
    const run = bytes[k + 2] | (bytes[k + 3] << 8);
    if (run === 0 || o + run > length) throw new Error('corrupt cell data');
    out.fill(v, o, o + run);
    o += run;
  }
  if (o !== length) throw new Error('corrupt cell data');
  return out;
}

export function docToDraft(doc: PatternDoc): PatternDraftV1 {
  return {
    format: 'pd-pattern',
    version: 1,
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    cols: doc.cols,
    rows: doc.rows,
    palette: doc.palette.map((p) => ({ key: p.key, hex: p.hex })),
    brand: doc.brand,
    tier: doc.tier,
    settings: { ...doc.settings },
    cells: encodeCells(doc.cells),
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Parse and validate a draft (from storage or a file); throws a readable Error when invalid. */
export function docFromDraft(raw: unknown): PatternDoc {
  if (!raw || typeof raw !== 'object') throw new Error('draft is not an object');
  const d = raw as Record<string, unknown>;
  if (d.format !== 'pd-pattern') throw new Error('not a pattern draft');
  if (d.version !== 1) throw new Error(`unsupported draft version ${String(d.version)}`);
  if (!isStr(d.id) || !isStr(d.name) || !isStr(d.brand) || !isStr(d.tier) || !isStr(d.cells)) throw new Error('draft fields missing');
  if (!isInt(d.cols, 0, 1000) || !isInt(d.rows, 0, 1000)) throw new Error('invalid grid size');
  if (typeof d.createdAt !== 'number' || typeof d.updatedAt !== 'number') throw new Error('invalid timestamps');
  if (!Array.isArray(d.palette) || d.palette.length >= EMPTY_CELL) throw new Error('invalid palette');
  const palette: PaletteEntry[] = d.palette.map((p: unknown) => {
    const e = p as Record<string, unknown>;
    if (!e || !isStr(e.key) || !isStr(e.hex) || !/^#[0-9A-Fa-f]{6}$/.test(e.hex)) throw new Error('invalid palette entry');
    return { key: e.key, hex: e.hex.toUpperCase() };
  });
  const cells = decodeCells(d.cells, d.cols * d.rows);
  for (let i = 0; i < cells.length; i++) if (cells[i] !== EMPTY_CELL && cells[i] >= palette.length) throw new Error('cell refers to a missing color');
  const settings = d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings) ? { ...(d.settings as Record<string, unknown>) } : {};
  return {
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    cols: d.cols,
    rows: d.rows,
    cells,
    palette,
    brand: d.brand,
    tier: d.tier,
    settings,
  };
}
