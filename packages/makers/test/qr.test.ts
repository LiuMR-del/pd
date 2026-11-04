import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { EMPTY_CELL, type PatternResult } from '@pd/pattern-core';
import { checkQrColors, defaultQrColors, MakerError, qrPattern, qrSize, QR_MIN_CONTRAST, type QrEcc } from '../src';

const BLACK = { key: 'H7', hex: '#000000' };
const WHITE = { key: 'H2', hex: '#FFFFFF' };

/** Render a pattern like a photo of the finished board: `px` pixels per bead, empty cells as a white board. */
function render(r: PatternResult, px = 4, board = '#FFFFFF'): { data: Uint8ClampedArray; width: number; height: number } {
  // a little extra white around, like the table the board lies on
  const margin = 2 * px;
  const width = r.cols * px + 2 * margin;
  const height = r.rows * px + 2 * margin;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const boardRgb = rgb(board);
  for (let y = 0; y < r.rows; y++)
    for (let x = 0; x < r.cols; x++) {
      const c = r.cells[y * r.cols + x];
      const [cr, cg, cb] = c === EMPTY_CELL ? boardRgb : rgb(r.palette[c].hex);
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const k = ((margin + y * px + dy) * width + margin + x * px + dx) * 4;
          data[k] = cr;
          data[k + 1] = cg;
          data[k + 2] = cb;
        }
    }
  return { data, width, height };
}

function decode(r: PatternResult, board?: string): number[] | null {
  const img = render(r, 4, board);
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return res ? res.binaryData : null;
}

/** UTF-8 bytes (the package targets ES2020 without DOM / Node typings, so no TextEncoder). */
function utf8(s: string): number[] {
  const e = encodeURIComponent(s);
  const out: number[] = [];
  for (let i = 0; i < e.length; i++) {
    if (e[i] === '%') {
      out.push(parseInt(e.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(e.charCodeAt(i));
  }
  return out;
}

describe('qrPattern scans back', () => {
  const texts = ['A', 'https://example.com/', 'https://github.com/LiuMR-del/pd?from=bead&x=1', '拼豆图纸 · 中文内容也能扫 https://例子.cn/路径', '0123456789'.repeat(30), 'x'.repeat(1200)];
  for (const text of texts)
    for (const ecc of ['L', 'M', 'Q', 'H'] as QrEcc[]) {
      const size = qrSize(text, ecc);
      if (size === null) continue;
      it(`${ecc} · ${text.length} chars`, () => {
        const r = qrPattern({ text, ecc, dark: BLACK, light: WHITE });
        expect(r.cols).toBe(size);
        expect(decode(r)).toEqual(utf8(text));
      });
    }

  it('quiet zone 2 and 4', () => {
    for (const quietZone of [2, 3, 4]) {
      const r = qrPattern({ text: 'https://example.com/q', dark: BLACK, light: WHITE, quietZone });
      expect(r.meta.quietZone).toBe(quietZone);
      // the outer ring is light
      for (let x = 0; x < r.cols; x++) expect(r.palette[r.cells[x]].hex).toBe('#FFFFFF');
      expect(decode(r)).toEqual(utf8('https://example.com/q'));
    }
  });

  it('without light beads it scans on a white board', () => {
    const r = qrPattern({ text: 'https://example.com/board', dark: BLACK, light: WHITE, fillLight: false });
    expect(r.palette).toEqual([BLACK]);
    expect(r.cells.includes(EMPTY_CELL)).toBe(true);
    expect(decode(r, '#FFFFFF')).toEqual(utf8('https://example.com/board'));
  });

  it('colored pairs at or above the contrast limit scan', () => {
    const pairs = [
      [{ key: 'navy', hex: '#1B2A6B' }, { key: 'yellow', hex: '#FFE45C' }],
      [{ key: 'brown', hex: '#5A2E14' }, { key: 'cream', hex: '#F6EBD0' }],
      [{ key: 'red', hex: '#B3261E' }, WHITE],
      // contrast 4.54 against white, the weakest pair the check lets through
      [{ key: 'gray', hex: '#767676' }, WHITE],
    ];
    for (const [dark, light] of pairs) {
      expect(checkQrColors(dark, light).ok).toBe(true);
      const r = qrPattern({ text: 'https://example.com/color', ecc: 'M', dark, light });
      expect(decode(r)).toEqual(utf8('https://example.com/color'));
    }
  });
});

describe('qrPattern checks', () => {
  it('refuses weak, inverted and identical colors', () => {
    const gray = { key: 'g', hex: '#999999' };
    expect(checkQrColors(gray, WHITE)).toMatchObject({ ok: false, reason: 'low-contrast' });
    expect(checkQrColors(WHITE, BLACK)).toMatchObject({ ok: false, reason: 'inverted' });
    expect(checkQrColors(BLACK, BLACK)).toMatchObject({ ok: false, reason: 'same-color' });
    // with empty light cells the board (white) is what counts
    expect(checkQrColors(BLACK, BLACK, false).ok).toBe(true);
    expect(checkQrColors(gray, BLACK, false)).toMatchObject({ ok: false, reason: 'low-contrast' });
    expect(QR_MIN_CONTRAST).toBeGreaterThanOrEqual(4.5);
    expect(() => qrPattern({ text: 'x', dark: gray, light: WHITE })).toThrow(MakerError);
  });

  it('empty and too-long content', () => {
    expect(() => qrPattern({ text: '', dark: BLACK, light: WHITE })).toThrowError(expect.objectContaining({ code: 'empty' }));
    expect(() => qrPattern({ text: 'x'.repeat(4000), ecc: 'H', dark: BLACK, light: WHITE })).toThrowError(expect.objectContaining({ code: 'too-long' }));
    expect(qrSize('x'.repeat(4000), 'H')).toBeNull();
  });

  it('largest code still fits the 200-cell grid', () => {
    const r = qrPattern({ text: 'x'.repeat(2900), ecc: 'L', dark: BLACK, light: WHITE });
    expect(r.meta.qrVersion).toBe(40);
    expect(r.cols).toBe(185);
  });

  it('result shape', () => {
    const r = qrPattern({ text: 'hi', dark: BLACK, light: WHITE });
    expect(r.cols).toBe(r.rows);
    expect(r.stats.reduce((n, s) => n + s.count, 0)).toBe(r.cols * r.rows);
    // most used first
    expect(r.stats[0].count).toBeGreaterThanOrEqual(r.stats[1].count);
  });

  it('default colors are the darkest and lightest beads', () => {
    const pal = [{ key: 'A1', hex: '#FAF4C8' }, WHITE, { key: 'H5', hex: '#3A3A3A' }, BLACK, { key: 'B3', hex: '#55AA33' }];
    expect(defaultQrColors(pal)).toEqual({ dark: BLACK, light: WHITE });
  });
});
