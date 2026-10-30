import type { RgbaImage } from '@pd/pattern-core';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Longest side fed to the algorithm; larger photos only cost time and memory (see stage-1 plan). */
export const MAX_SOURCE_SIDE = 2048;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

/** A decoded upload, downscaled to MAX_SOURCE_SIDE, kept as a canvas for drawing and re-cropping. */
export interface SourceImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  name: string;
}

export async function decodeImage(blob: Blob, name: string): Promise<SourceImage> {
  if (blob.size > MAX_FILE_BYTES) throw new Error('图片超过 30MB，请换一张小一点的图片');
  if (blob.type && !ACCEPTED_TYPES.includes(blob.type)) throw new Error('只支持 JPG、PNG、WebP、GIF、BMP 图片');
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    throw new Error('这张图片无法读取，可能已损坏或格式不受支持');
  }
  if (!w || !h) throw new Error('图片尺寸为 0');
  const k = Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) (source as ImageBitmap).close();
  return { canvas, width: canvas.width, height: canvas.height, name: name.replace(/\.[^.]+$/, '') || '新图纸' };
}

/** RGBA pixels of the (cropped) source, as the algorithm's input. */
export function toRgba(src: SourceImage, crop: Rect | null): RgbaImage {
  const r = crop ?? { x: 0, y: 0, w: src.width, h: src.height };
  const ctx = src.canvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(Math.round(r.x), Math.round(r.y), Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)));
  return { data: data.data, width: data.width, height: data.height };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片导出失败'))), type, quality));
}

/** Small JPEG thumbnail as a data URL (for the works list). */
export function thumbnail(source: CanvasImageSource, sw: number, sh: number, max = 240): string {
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
