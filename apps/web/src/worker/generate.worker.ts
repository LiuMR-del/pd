import { generatePattern, type PaletteInput, type PatternOptions, type RgbaImage } from '@pd/pattern-core';

export interface GenerateRequest {
  id: number;
  image: RgbaImage;
  palette: PaletteInput[];
  options: PatternOptions;
}

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { id, image, palette, options } = e.data;
  try {
    const result = generatePattern(image, palette, options);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, [result.cells.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
