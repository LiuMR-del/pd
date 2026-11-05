import type { RgbaImage } from '@pd/pattern-core';

/**
 * Longest side of the pixels fed to the algorithm. Patterns are at most 200 cells long, so this still
 * gives 5+ pixels per cell, while keeping phone memory and the worker message (base64) small.
 */
export const MAX_DECODE_SIDE = 1024;

/** Let the user pick one photo from the album or take one. Null when they cancel. */
export function pickImage(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    uni.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => resolve(res.tempFiles[0]?.tempFilePath ?? null),
      fail: (err) => {
        if (/cancel/i.test(String(err?.errMsg ?? ''))) resolve(null);
        else reject(new Error('无法打开相册或相机，请检查微信的相册 / 相机权限'));
      },
    });
  });
}

/** Load an image file into an image object of `canvas` (needed to draw it on that canvas). */
export function loadCanvasImage(canvas: MpCanvas, path: string): Promise<MpImage> {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => (img.width && img.height ? resolve(img) : reject(new Error('图片尺寸为 0')));
    img.onerror = () => reject(new Error('这张图片无法读取，可能已损坏或格式不受支持'));
    img.src = path;
  });
}

/**
 * Decode an image file to RGBA pixels, downscaled so the long side is at most `maxSide`.
 * Goes through the same canvas image loading as the on-screen preview, so both see the photo with
 * the same orientation (crop rectangles from the preview map onto these pixels by scaling only).
 */
export async function decodeImage(path: string, maxSide = MAX_DECODE_SIDE): Promise<RgbaImage> {
  const probe = await loadCanvasImage(wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 }), path);
  const k = Math.min(1, maxSide / Math.max(probe.width, probe.height));
  const width = Math.max(1, Math.round(probe.width * k));
  const height = Math.max(1, Math.round(probe.height * k));
  const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
  const ctx = canvas.getContext('2d');
  const img = await loadCanvasImage(canvas, path);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { data: data.data, width: data.width, height: data.height };
}
