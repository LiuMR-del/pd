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
}

declare const wx: {
  createOffscreenCanvas(options: { type: '2d'; width: number; height: number }): MpCanvas;
  getWindowInfo(): { pixelRatio: number; windowWidth: number; windowHeight: number };
};
