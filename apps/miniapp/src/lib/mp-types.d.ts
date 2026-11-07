/**
 * Minimal typings for the WeChat APIs this app calls directly. @dcloudio/types covers `uni.*` but not
 * the `wx` global or the canvas 2D node; only what we use is declared, nothing more.
 */

/** Image object made by a mini-program canvas (`canvas.createImage()`). */
interface MpImage {
  src: string;
  readonly width: number;
  readonly height: number;
  onload: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

interface MpImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** `canvas type="2d"` context: the @pd/render Ctx2D subset plus what the pages use. */
interface MpCanvasContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: MpImage, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, w: number, h: number): MpImageData;
}

interface MpCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): MpCanvasContext;
  createImage(): MpImage;
  /** Only on-screen canvas nodes have it (offscreen canvases do not). */
  requestAnimationFrame?(callback: () => void): number;
  /** Offscreen canvases have it (checked in DevTools, base library 3.17.6). */
  toDataURL?(type?: string): string;
}

interface MpCallback<T> {
  success?: (res: T) => void;
  fail?: (err: { errMsg: string }) => void;
}

/** Synchronous file API (wx.getFileSystemManager()); the methods throw on failure. */
interface MpFileSystemManager {
  readFileSync(path: string, encoding: 'utf8'): string;
  readFileSync(path: string): ArrayBuffer;
  statSync(path: string): { size: number };
  writeFileSync(path: string, data: string, encoding: 'utf8' | 'base64'): void;
  copyFileSync(src: string, dest: string): void;
  unlinkSync(path: string): void;
  accessSync(path: string): void;
  mkdirSync(path: string, recursive?: boolean): void;
}

declare const wx: {
  env: { USER_DATA_PATH: string };
  createOffscreenCanvas(options: { type: '2d'; width: number; height: number }): MpCanvas;
  getWindowInfo(): { pixelRatio: number; windowWidth: number; windowHeight: number };
  getFileSystemManager(): MpFileSystemManager;
  canvasToTempFilePath(options: { canvas: MpCanvas; fileType?: 'png' | 'jpg'; quality?: number } & MpCallback<{ tempFilePath: string }>): void;
};
