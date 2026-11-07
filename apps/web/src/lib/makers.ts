import { makePattern as makeWith, type Kind, type QrSettings, type TextSettings } from '@pd/app-shared';
import { createCanvasRasterizer, type GlyphRasterizer } from '@pd/makers';
import type { PatternResult, RgbaImage } from '@pd/pattern-core';

// Text / QR settings and colors live in @pd/app-shared (shared with the mini-program); this file
// keeps the browser parts: the DOM-canvas glyph rasterizer and QR image scanning with jsQR.
export {
  defaultQrSettings,
  defaultTextSettings,
  ECC_LABELS,
  KIND_LABELS,
  makerName,
  normalizeQr,
  normalizeText,
  qrColors,
  resolveColor,
  textColors,
  THICKNESS_LABELS,
  tierColors,
  type ColorId,
  type Kind,
  type QrSettings,
  type TextSettings,
  type Thickness,
} from '@pd/app-shared';

let rasterizer: GlyphRasterizer | null = null;
function textRasterizer(): GlyphRasterizer {
  if (!rasterizer) {
    const canvas = document.createElement('canvas');
    // glyphs are read back one by one
    canvas.getContext('2d', { willReadFrequently: true });
    rasterizer = createCanvasRasterizer(canvas);
  }
  return rasterizer;
}

/** Make a text or QR pattern (fast enough for the main thread). Throws MakerError with a user-facing message. */
export function makePattern(kind: Exclude<Kind, 'image'>, s: TextSettings | QrSettings, brand: string, tier: number | 'all'): PatternResult {
  return makeWith(kind, s, brand, tier, textRasterizer);
}

/** Read the first QR code in an image (jsQR is loaded on first use only). */
export async function scanQrImage(img: RgbaImage): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  // photos of big codes often decode better smaller; try the original, then halves
  let cur = { data: img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  for (let i = 0; i < 3; i++) {
    const hit = jsQR(cur.data, cur.width, cur.height, { inversionAttempts: 'attemptBoth' });
    if (hit && hit.data) return hit.data;
    if (Math.min(cur.width, cur.height) < 200) break;
    cur = half(cur);
  }
  return null;
}

function half(img: { data: Uint8ClampedArray; width: number; height: number }): { data: Uint8ClampedArray; width: number; height: number } {
  const w = Math.floor(img.width / 2);
  const h = Math.floor(img.height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const k = (y * 2 * img.width + x * 2) * 4 + c;
        out[(y * w + x) * 4 + c] = (img.data[k] + img.data[k + 4] + img.data[k + img.width * 4] + img.data[k + img.width * 4 + 4]) >> 2;
      }
  return { data: out, width: w, height: h };
}
