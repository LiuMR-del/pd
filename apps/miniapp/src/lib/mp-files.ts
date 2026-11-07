import type { PatternDoc } from '@pd/editor-core';
import { drawPattern, type Ctx2D } from '@pd/render';
import { fitSheet } from './export-size';
import { session } from './session';
import { WorksStore, type FileStore, type KeyValue } from './works';

// WeChat implementations of the storage interfaces, plus canvas → image file → photo album.

const fsm = () => wx.getFileSystemManager();

export const mpFiles: FileStore = {
  readText(path) {
    try {
      return fsm().readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  writeText(path, text) {
    fsm().writeFileSync(path, text, 'utf8');
  },
  copy(src, dest) {
    fsm().copyFileSync(src, dest);
  },
  remove(path) {
    fsm().unlinkSync(path);
  },
  ensureDir(path) {
    try {
      fsm().accessSync(path);
    } catch {
      fsm().mkdirSync(path, true);
    }
  },
};

export const mpStorage: KeyValue = {
  get: (key) => uni.getStorageSync(key),
  set: (key, value) => uni.setStorageSync(key, value),
};

let store: WorksStore | null = null;
/** The works store in the user data folder (`wx.env.USER_DATA_PATH/works`). */
export function worksStore(): WorksStore {
  if (!store) store = new WorksStore(mpFiles, mpStorage, `${wx.env.USER_DATA_PATH}/works`, Date.now, () => session.uid);
  return store;
}

/** Save a canvas (offscreen or on-screen node) as a temporary image file. */
export function canvasToFile(canvas: MpCanvas, fileType: 'png' | 'jpg' = 'png'): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType,
      quality: 0.9,
      success: (r) => resolve(r.tempFilePath),
      fail: (err) => {
        // fallback: some runtimes only offer toDataURL on offscreen canvases
        try {
          const url = canvas.toDataURL?.(fileType === 'png' ? 'image/png' : 'image/jpeg');
          if (!url) throw new Error(err.errMsg);
          const path = `${wx.env.USER_DATA_PATH}/canvas-${Date.now()}.${fileType}`;
          fsm().writeFileSync(path, url.slice(url.indexOf(',') + 1), 'base64');
          resolve(path);
        } catch {
          reject(new Error('图片生成失败（可能是手机内存不足），请把图纸尺寸调小后重试'));
        }
      },
    });
  });
}

/** Small pattern thumbnail (plain colored cells) as a temporary PNG, for the works list. */
export async function renderThumb(doc: PatternDoc, max = 240): Promise<string> {
  const cell = Math.max(1, Math.floor(max / Math.max(doc.cols, doc.rows)));
  const width = doc.cols * cell;
  const height = doc.rows * cell;
  const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  drawPattern(ctx as unknown as Ctx2D, doc, { cellSize: cell, offsetX: 0, offsetY: 0, width, height, showGrid: false, showCodes: false });
  return canvasToFile(canvas);
}

export interface ExportOptions {
  mirror: boolean;
  showCodes: boolean;
}

/** Image size the export would have (to show before saving). */
export function exportSize(doc: PatternDoc, o: ExportOptions): { width: number; height: number; cell: number } {
  const { sheet, cell } = fitSheet(doc, o);
  return { width: sheet.width, height: sheet.height, cell };
}

/** Draw the printable sheet (title, rulers, codes, usage legend) and return it as a temporary PNG. */
export async function renderSheet(doc: PatternDoc, o: ExportOptions): Promise<string> {
  const { sheet } = fitSheet(doc, o);
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: sheet.width, height: sheet.height });
  sheet.draw(canvas.getContext('2d') as unknown as Ctx2D);
  return canvasToFile(canvas);
}

/**
 * Save an image file to the photo album. 'denied' when the user refused album access (the caller
 * offers to open the settings page), 'cancelled' when they dismissed the system prompt.
 */
export function saveToAlbum(path: string): Promise<'ok' | 'denied' | 'cancelled'> {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath: path,
      success: () => resolve('ok'),
      fail: (err) => {
        const msg = String(err?.errMsg ?? '');
        if (/auth|deny|denied|authorize/i.test(msg)) resolve('denied');
        else if (/cancel/i.test(msg)) resolve('cancelled');
        else reject(new Error(`保存到相册失败：${msg}`));
      },
    });
  });
}

/** After a refused album permission: explain and offer the settings page. */
export function askOpenAlbumSetting(): void {
  uni.showModal({
    title: '需要相册权限',
    content: '保存图纸要用到「添加到相册」权限。可以在设置里打开后再保存。',
    confirmText: '去设置',
    success: (r) => {
      if (r.confirm) uni.openSetting({});
    },
  });
}
