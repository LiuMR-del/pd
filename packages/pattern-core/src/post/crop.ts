/** Trim fully empty rows/columns around the content. Returns the cropped grid and its offset. */
export function autoCrop(
  index: Int32Array,
  cols: number,
  rows: number,
): { index: Int32Array; cols: number; rows: number; x: number; y: number } {
  let minX = cols;
  let minY = rows;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (index[y * cols + x] < 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { index: new Int32Array(0), cols: 0, rows: 0, x: 0, y: 0 };
  if (minX === 0 && minY === 0 && maxX === cols - 1 && maxY === rows - 1) return { index, cols, rows, x: 0, y: 0 };
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = index[(y + minY) * cols + x + minX];
  return { index: out, cols: w, rows: h, x: minX, y: minY };
}
