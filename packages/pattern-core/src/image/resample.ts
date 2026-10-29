import { SRGB_TO_LINEAR } from '../color/convert';
import type { RgbaImage } from '../types';

/** Area-averaged image in linear light. `lin` is un-premultiplied (3 per pixel), `alpha` in 0..1. */
export interface LinearImage {
  width: number;
  height: number;
  lin: Float32Array;
  alpha: Float32Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AxisWeights {
  start: Int32Array; // first source index per output
  count: Int32Array;
  weight: Float32Array; // flattened, `maxTaps` per output
  maxTaps: number;
}

/** Coverage weights for box-filtering source range [offset, offset+length) into `outSize` bins. */
function axisWeights(srcSize: number, offset: number, length: number, outSize: number): AxisWeights {
  const scale = length / outSize;
  const maxTaps = Math.ceil(scale) + 2;
  const start = new Int32Array(outSize);
  const count = new Int32Array(outSize);
  const weight = new Float32Array(outSize * maxTaps);
  for (let o = 0; o < outSize; o++) {
    const a = offset + o * scale;
    const b = offset + (o + 1) * scale;
    const i0 = Math.max(0, Math.floor(a));
    const i1 = Math.min(srcSize, Math.ceil(b));
    start[o] = i0;
    let n = 0;
    let sum = 0;
    for (let i = i0; i < i1 && n < maxTaps; i++, n++) {
      const w = Math.min(b, i + 1) - Math.max(a, i);
      weight[o * maxTaps + n] = w > 0 ? w : 0;
      sum += w > 0 ? w : 0;
    }
    count[o] = n;
    if (sum > 0) for (let t = 0; t < n; t++) weight[o * maxTaps + t] /= sum;
  }
  return { start, count, weight, maxTaps };
}

/**
 * Resample (box / area average) a region of an RGBA8 image to outW x outH, averaging in
 * linear light with alpha weighting. Separable: horizontal pass then vertical pass.
 */
export function resampleLinear(image: RgbaImage, outW: number, outH: number, region?: Rect): LinearImage {
  const { data, width, height } = image;
  if (data.length < width * height * 4) throw new Error('image data shorter than width*height*4');
  const r = region ?? { x: 0, y: 0, w: width, h: height };
  const y0 = Math.max(0, Math.floor(r.y));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  const rowsIn = y1 - y0;

  const hx = axisWeights(width, r.x, r.w, outW);
  // horizontal pass: premultiplied linear RGB + alpha, rowsIn x outW x 4
  const tmp = new Float32Array(rowsIn * outW * 4);
  for (let y = 0; y < rowsIn; y++) {
    const rowBase = (y + y0) * width * 4;
    for (let o = 0; o < outW; o++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      const s = hx.start[o];
      const n = hx.count[o];
      const wBase = o * hx.maxTaps;
      for (let t = 0; t < n; t++) {
        const w = hx.weight[wBase + t];
        const p = rowBase + (s + t) * 4;
        const a = (data[p + 3] / 255) * w;
        pr += SRGB_TO_LINEAR[data[p]] * a;
        pg += SRGB_TO_LINEAR[data[p + 1]] * a;
        pb += SRGB_TO_LINEAR[data[p + 2]] * a;
        pa += a;
      }
      const q = (y * outW + o) * 4;
      tmp[q] = pr;
      tmp[q + 1] = pg;
      tmp[q + 2] = pb;
      tmp[q + 3] = pa;
    }
  }

  const vy = axisWeights(height, r.y, r.h, outH);
  const lin = new Float32Array(outW * outH * 3);
  const alpha = new Float32Array(outW * outH);
  for (let o = 0; o < outH; o++) {
    const s = vy.start[o] - y0;
    const n = vy.count[o];
    const wBase = o * vy.maxTaps;
    for (let x = 0; x < outW; x++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let t = 0; t < n; t++) {
        const w = vy.weight[wBase + t];
        const q = ((s + t) * outW + x) * 4;
        pr += tmp[q] * w;
        pg += tmp[q + 1] * w;
        pb += tmp[q + 2] * w;
        pa += tmp[q + 3] * w;
      }
      const i = o * outW + x;
      alpha[i] = pa;
      if (pa > 1e-6) {
        lin[i * 3] = pr / pa;
        lin[i * 3 + 1] = pg / pa;
        lin[i * 3 + 2] = pb / pa;
      }
    }
  }
  return { width: outW, height: outH, lin, alpha };
}
