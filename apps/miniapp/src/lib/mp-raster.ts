import { createCanvasRasterizer, type GlyphRasterizer, type RasterCanvas } from '@pd/makers';

let rasterizer: GlyphRasterizer | null = null;

/**
 * Glyph rasterizer for text patterns on a WeChat offscreen canvas (the @pd/makers rasterizer resizes
 * and reuses one canvas for every glyph). Fonts are the phone's system fonts.
 */
export function mpTextRasterizer(): GlyphRasterizer {
  if (!rasterizer) rasterizer = createCanvasRasterizer(wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 }) as unknown as RasterCanvas);
  return rasterizer;
}
