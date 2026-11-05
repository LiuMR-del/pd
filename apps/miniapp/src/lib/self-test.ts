import { EMPTY_CELL, type PatternResult, type RgbaImage } from '@pd/pattern-core';

/**
 * A small synthetic picture (white background, red disc with a dark outline, blue bar) used by the
 * home page's developer self-test to exercise image → worker → pattern without picking a photo.
 */
export function makeTestImage(width = 96, height = 72): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = width * 0.4;
  const cy = height * 0.5;
  const r = Math.min(width, height) * 0.32;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      let rgb = [255, 255, 255];
      if (d <= r) rgb = d >= r - 2 ? [30, 30, 30] : [220, 40, 50];
      else if (x >= width * 0.78 && x < width * 0.9 && y >= height * 0.15 && y < height * 0.85) rgb = [40, 90, 200];
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** One-line summary of a generated pattern for the self-test. */
export function describeResult(result: PatternResult, ms: number): string {
  let beads = 0;
  for (let i = 0; i < result.cells.length; i++) if (result.cells[i] !== EMPTY_CELL) beads++;
  const top = result.stats
    .slice(0, 3)
    .map((s) => `${s.key}×${s.count}`)
    .join('、');
  return `${result.cols}×${result.rows} 格，${result.palette.length} 色，${beads} 颗豆，用时 ${Math.round(ms)} 毫秒（${top}）`;
}
