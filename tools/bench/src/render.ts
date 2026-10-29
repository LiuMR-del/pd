import {
  EMPTY_CELL,
  hexToRgb,
  linearChannelToSrgb8,
  resampleLinear,
  type PatternResult,
  type RgbaImage,
} from '@pd/pattern-core';
import { blank } from './png';
import { cellAt } from './metrics';

function fillCell(img: RgbaImage, x0: number, y0: number, size: number, rgb: [number, number, number] | null): void {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      // empty cells: light checkerboard
      const c = rgb ?? (((x >> 2) + (y >> 2)) % 2 ? [236, 236, 236] : [250, 250, 250]);
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
}

/** Render the uncropped source grid (so all groups align), `cellPx` pixels per bead. */
export function renderPattern(r: PatternResult, cellPx: number): RgbaImage {
  const { cols, rows } = r.sourceGrid;
  const img = blank(cols * cellPx, rows * cellPx);
  const pal = r.palette.map((p) => hexToRgb(p.hex)!);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const c = cellAt(r, x, y);
      fillCell(img, x * cellPx, y * cellPx, cellPx, c === EMPTY_CELL ? null : pal[c]);
    }
  return img;
}

/** Area-averaged source at grid resolution, drawn as blocks (what a perfect palette would give). */
export function renderReference(image: RgbaImage, r: PatternResult, cellPx: number): RgbaImage {
  const { cols, rows } = r.sourceGrid;
  const ref = resampleLinear(image, cols, rows, r.sourceRegion);
  const img = blank(cols * cellPx, rows * cellPx);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const rgb: [number, number, number] | null =
        ref.alpha[i] < 0.5 ? null : [linearChannelToSrgb8(ref.lin[i * 3]), linearChannelToSrgb8(ref.lin[i * 3 + 1]), linearChannelToSrgb8(ref.lin[i * 3 + 2])];
      fillCell(img, x * cellPx, y * cellPx, cellPx, rgb);
    }
  return img;
}

/** Area-averaged thumbnail fitting in maxW x maxH. */
export function thumbnail(image: RgbaImage, maxW: number, maxH: number): RgbaImage {
  const s = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = Math.max(1, Math.round(image.width * s));
  const h = Math.max(1, Math.round(image.height * s));
  const lin = resampleLinear(image, w, h);
  const out = blank(w, h);
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = linearChannelToSrgb8(lin.lin[i * 3]);
    out.data[i * 4 + 1] = linearChannelToSrgb8(lin.lin[i * 3 + 1]);
    out.data[i * 4 + 2] = linearChannelToSrgb8(lin.lin[i * 3 + 2]);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Contact sheet: rows of tiles, each tile letterboxed into tileW x tileH. */
export function contactSheet(rowsOfTiles: RgbaImage[][], tileW: number, tileH: number, gap = 4): RgbaImage {
  const ncols = Math.max(...rowsOfTiles.map((r) => r.length));
  const sheet = blank(ncols * (tileW + gap) + gap, rowsOfTiles.length * (tileH + gap) + gap, [40, 40, 40, 255]);
  rowsOfTiles.forEach((tiles, ry) =>
    tiles.forEach((tile, cx) => {
      const t = thumbnail(tile, tileW, tileH);
      const ox = gap + cx * (tileW + gap) + Math.floor((tileW - t.width) / 2);
      const oy = gap + ry * (tileH + gap) + Math.floor((tileH - t.height) / 2);
      for (let y = 0; y < t.height; y++)
        for (let x = 0; x < t.width; x++) {
          const s = (y * t.width + x) * 4;
          const d = ((oy + y) * sheet.width + ox + x) * 4;
          for (let c = 0; c < 4; c++) sheet.data[d + c] = t.data[s + c];
        }
    }),
  );
  return sheet;
}
