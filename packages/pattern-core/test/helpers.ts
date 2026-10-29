import type { RgbaImage } from '../src/types';

export type Px = [number, number, number, number?];

export function makeImage(width: number, height: number, fn: (x: number, y: number) => Px): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = p[0];
      data[i + 1] = p[1];
      data[i + 2] = p[2];
      data[i + 3] = p[3] ?? 255;
    }
  return { data, width, height };
}

export const BASIC_PALETTE = [
  { key: 'W', hex: '#FFFFFF' },
  { key: 'K', hex: '#000000' },
  { key: 'R', hex: '#E02020' },
  { key: 'G', hex: '#20A040' },
  { key: 'B', hex: '#2040D0' },
  { key: 'Y', hex: '#F0D020' },
  { key: 'G50', hex: '#808080' },
  { key: 'G75', hex: '#BBBBBB' },
  { key: 'G25', hex: '#404040' },
];

/** Grid helper: cells as palette keys ('.' = empty). */
export function keysOf(result: { cols: number; rows: number; cells: Uint16Array; palette: { key: string }[] }): string[] {
  const rows: string[] = [];
  for (let y = 0; y < result.rows; y++) {
    let s = '';
    for (let x = 0; x < result.cols; x++) {
      const c = result.cells[y * result.cols + x];
      s += (c === 0xffff ? '.' : result.palette[c].key) + ' ';
    }
    rows.push(s.trim());
  }
  return rows;
}
