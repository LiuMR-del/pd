import { describe, expect, it } from 'vitest';
import { EMPTY_CELL, type PatternResult } from '@pd/pattern-core';
import { createCanvasRasterizer, hasCjk, MakerError, textPattern, TEXT_SUPERSAMPLE as S, type GlyphRasterizer } from '../src';

const INK = { key: 'H7', hex: '#000000' };
const RED = { key: 'F5', hex: '#E02020' };
const WHITE = { key: 'H2', hex: '#FFFFFF' };

/**
 * Fake font: every visible character is a solid block exactly one em tall, `wide` em wide
 * (CJK 1, others 0.5); spaces are 0.5 em of nothing. `alphaValue` sets the ink coverage.
 */
function blocks(alphaValue = 255): GlyphRasterizer {
  return (ch, em, box) => {
    const advance = (hasCjk(ch) ? 1 : 0.5) * em;
    const width = Math.ceil(advance);
    const alpha = new Uint8Array(width * box);
    const top = (box - em) / 2;
    if (ch !== ' ') for (let y = top; y < top + em; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = alphaValue;
    return { advance, left: 0, width, height: box, alpha };
  };
}

/** Grid as rows of characters: '#' text, 'o' outline, '.' background, ' ' empty. */
function picture(r: PatternResult): string[] {
  const sym = new Map(r.palette.map((p, i) => [i, p.key === INK.key ? '#' : p.key === RED.key ? 'o' : '.']));
  const out: string[] = [];
  for (let y = 0; y < r.rows; y++) {
    let s = '';
    for (let x = 0; x < r.cols; x++) {
      const c = r.cells[y * r.cols + x];
      s += c === EMPTY_CELL ? ' ' : sym.get(c);
    }
    out.push(s);
  }
  return out;
}

describe('textPattern', () => {
  it('one character: em-tall block plus margin', () => {
    const r = textPattern({ text: '字', height: 8, color: INK }, blocks());
    // 8 × 8 block + 1-cell margin each side
    expect([r.cols, r.rows]).toEqual([10, 10]);
    const pic = picture(r);
    expect(pic[0]).toBe(' '.repeat(10));
    expect(pic[1]).toBe(' ' + '#'.repeat(8) + ' ');
    expect(r.meta).toMatchObject({ maker: 'text', textHeight: 8, lines: 1 });
  });

  it('letter spacing and spaces', () => {
    const tight = textPattern({ text: 'AB', height: 8, color: INK, margin: 0 }, blocks());
    expect(tight.cols).toBe(8);
    const spaced = textPattern({ text: 'AB', height: 8, color: INK, margin: 0, letterSpacing: 2 }, blocks());
    expect(spaced.cols).toBe(10);
    expect(picture(spaced)[0]).toBe('####  ####');
    const word = textPattern({ text: 'A B', height: 8, color: INK, margin: 0 }, blocks());
    expect(picture(word)[0]).toBe('####    ####');
  });

  it('lines, line spacing and alignment', () => {
    const base = { text: 'AAAA\nA', height: 6, color: INK, margin: 0, lineSpacing: 2 };
    const left = textPattern(base, blocks());
    expect([left.cols, left.rows]).toEqual([12, 14]);
    expect(picture(left)[6]).toBe(' '.repeat(12));
    expect(picture(left)[8]).toBe('###         ');
    expect(picture(textPattern({ ...base, align: 'center' }, blocks()))[8]).toBe('     ###    ');
    expect(picture(textPattern({ ...base, align: 'right' }, blocks()))[8]).toBe('         ###');
  });

  it('outline and background', () => {
    const r = textPattern({ text: 'A', height: 6, color: INK, outline: RED, background: WHITE, margin: 2 }, blocks());
    const pic = picture(r);
    expect([r.cols, r.rows]).toEqual([7, 10]);
    expect(pic[0]).toBe('.......');
    expect(pic[1]).toBe('.ooooo.');
    expect(pic[2]).toBe('.o###o.');
    expect(r.stats.map((s) => s.key).sort()).toEqual(['F5', 'H2', 'H7']);
    // an outline needs at least one cell of margin
    const tight = textPattern({ text: 'A', height: 6, color: INK, outline: RED, margin: 0 }, blocks());
    expect(picture(tight)[0]).toBe('ooooo');
  });

  it('coverage threshold sets stroke thickness', () => {
    const half = blocks(128);
    // full cells reach 0.5 coverage; the partly covered top / bottom rows stay below 0.45
    expect(textPattern({ text: 'A', height: 6, color: INK, threshold: 0.45 }, half).stats[0].count).toBe(15);
    expect(() => textPattern({ text: 'A', height: 6, color: INK, threshold: 0.6 }, half)).toThrowError(expect.objectContaining({ code: 'empty' }));
  });

  it('partial cells follow the threshold', () => {
    // 0.5 em advance at em = 7 cells -> 3.5 cells wide: the half-covered last column counts only below 0.5
    expect(textPattern({ text: 'A', height: 7, color: INK, margin: 0, threshold: 0.45 }, blocks()).cols).toBe(4);
    expect(textPattern({ text: 'A', height: 7, color: INK, margin: 0, threshold: 0.6 }, blocks()).cols).toBe(3);
  });

  it('refuses empty and too large text', () => {
    expect(() => textPattern({ text: '  \n\t', color: INK }, blocks())).toThrow(MakerError);
    expect(() => textPattern({ text: '拼豆图纸拼豆图纸拼豆图纸拼豆图纸', height: 20, color: INK }, blocks())).toThrowError(expect.objectContaining({ code: 'too-large' }));
  });

  it('palette only lists used colors, most used first', () => {
    const r = textPattern({ text: 'A', height: 6, color: INK, background: WHITE, margin: 3 }, blocks());
    expect(r.palette.map((p) => p.key)).toEqual(['H2', 'H7']);
    expect(r.stats.reduce((n, s) => n + s.count, 0)).toBe(r.cols * r.rows);
  });

  it('caches glyphs', () => {
    let calls = 0;
    const inner = blocks();
    textPattern({ text: 'AAAA\nAA', height: 6, color: INK }, (...a) => (calls++, inner(...a)));
    expect(calls).toBe(1);
  });
});

describe('createCanvasRasterizer', () => {
  it('draws each glyph middle-aligned into a fresh canvas and reads alpha', () => {
    const calls: string[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    };
    const ctx = {
      font: '',
      fillStyle: '' as unknown,
      textBaseline: '',
      textAlign: '',
      measureText: (t: string) => ({ width: t.length * 10.4 }),
      fillText: (t: string, x: number, y: number) => calls.push(`${ctx.font}|${ctx.textBaseline}|${t}@${x},${y}`),
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        data[3] = 200;
        return { data };
      },
    };
    const raster = createCanvasRasterizer(canvas, 'Test');
    const g = raster('字', 16, 24, true);
    expect(g.advance).toBeCloseTo(10.4);
    expect(g.left).toBe(3);
    expect([g.width, g.height]).toEqual([17, 24]);
    expect([canvas.width, canvas.height]).toEqual([17, 24]);
    expect(g.alpha[0]).toBe(200);
    expect(calls).toEqual(['bold 16px Test|middle|字@3,12']);
    raster(' ', 16, 24, false);
    expect(calls.length).toBe(1);
  });
});

describe('textPattern colors', () => {
  it('the same bead passed twice is one color', () => {
    const r = textPattern({ text: 'A', height: 6, color: INK, outline: WHITE, background: WHITE, margin: 2 }, blocks());
    expect(r.palette.map((p) => p.key)).toEqual(['H2', 'H7']);
    expect(r.stats.reduce((n, s) => n + s.count, 0)).toBe(r.cols * r.rows);
  });

  it('trailing spaces do not widen the pattern', () => {
    const a = textPattern({ text: 'AB', height: 8, color: INK, background: WHITE }, blocks());
    const b = textPattern({ text: 'AB    \nAB   ', height: 8, color: INK, background: WHITE, lineSpacing: 0 }, blocks());
    expect(b.cols).toBe(a.cols);
  });
});
