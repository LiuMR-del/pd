/**
 * Deterministic synthetic test images (written to tools/bench/synthetic/):
 * color blocks, gradients, thin lines, bitmap text, subjects on white / gradient backgrounds
 * (with ground-truth masks for background-removal metrics), and native + upscaled pixel art.
 */
import { join } from 'node:path';
import type { RgbaImage } from '@pd/pattern-core';
import { blank, writePng } from './png';
import { SYNTH_DIR } from './paths';

type RGB = [number, number, number];
type Shape = (x: number, y: number) => boolean;

/** Paint a shape with 4x4 supersampled coverage (anti-aliased edges like real images). */
function paint(img: RgbaImage, shape: Shape, color: RGB, bbox?: [number, number, number, number]): void {
  const [x0, y0, x1, y1] = bbox ?? [0, 0, img.width, img.height];
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) {
      let cov = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (shape(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) cov++;
      if (cov === 0) continue;
      const a = cov / 16;
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(img.data[i + c] * (1 - a) + color[c] * a);
    }
  }
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function fill(img: RgbaImage, fn: (x: number, y: number) => RGB): void {
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const c = fn(x, y);
      const i = (y * img.width + x) * 4;
      img.data[i] = Math.round(c[0]);
      img.data[i + 1] = Math.round(c[1]);
      img.data[i + 2] = Math.round(c[2]);
      img.data[i + 3] = 255;
    }
}

function blocks(): RgbaImage {
  const colors: RGB[] = [
    [230, 30, 40], [250, 140, 30], [250, 220, 40], [60, 180, 75], [30, 120, 220], [130, 60, 180],
    [255, 255, 255], [200, 200, 200], [128, 128, 128], [60, 60, 60], [0, 0, 0], [240, 190, 160],
    [255, 160, 190], [150, 220, 230], [120, 80, 50], [190, 230, 120], [20, 50, 110], [250, 240, 200],
    [200, 40, 120], [0, 150, 140], [170, 140, 90], [100, 160, 255], [255, 100, 70], [90, 100, 40],
  ];
  const img = blank(480, 320);
  colors.forEach((c, i) => paint(img, rect((i % 6) * 80, Math.floor(i / 6) * 80, (i % 6) * 80 + 80, Math.floor(i / 6) * 80 + 80), c));
  return img;
}

function gradient(): RgbaImage {
  const img = blank(640, 320);
  const sunset: RGB[] = [[255, 200, 80], [250, 120, 60], [220, 70, 110], [90, 50, 130]];
  const skin: RGB[] = [[255, 228, 205], [225, 170, 130], [140, 90, 60]];
  fill(img, (x, y) => {
    const t = x / 639;
    const pick = (stops: RGB[]) => {
      const p = t * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(p));
      return lerp(stops[k], stops[k + 1], p - k);
    };
    if (y < 160) return pick(sunset);
    if (y < 240) return [t * 255, t * 255, t * 255];
    return pick(skin);
  });
  return img;
}

function lines(): RgbaImage {
  const img = blank(640, 400);
  for (let w = 1, x = 20; w <= 6; w++, x += 60) paint(img, rect(x, 20, x + w, 380), [0, 0, 0]);
  paint(img, rect(380, 60, 620, 62), [220, 30, 30]);
  paint(img, rect(380, 120, 620, 124), [30, 60, 200]);
  paint(img, rect(380, 180, 620, 183), [40, 40, 40]);
  // diagonal 3px line
  paint(img, (x, y) => Math.abs((y - 220) - (x - 380) * 0.6) < 1.5 * Math.hypot(1, 0.6) && x >= 380 && x <= 620, [0, 0, 0]);
  // ring outline
  paint(img, (x, y) => {
    const r = Math.hypot(x - 500, y - 330);
    return r <= 50 && r >= 46;
  }, [0, 0, 0]);
  return img;
}

const FONT: Record<string, string[]> = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(img: RgbaImage, text: string, x0: number, y0: number, scale: number, color: RGB): void {
  let x = x0;
  for (const ch of text) {
    const g = FONT[ch];
    g.forEach((row, gy) => {
      for (let gx = 0; gx < 5; gx++) if (row[gx] === '1') paint(img, rect(x + gx * scale, y0 + gy * scale, x + (gx + 1) * scale, y0 + (gy + 1) * scale), color);
    });
    x += 6 * scale;
  }
}

function text(): RgbaImage {
  const img = blank(640, 240);
  drawText(img, 'BEAD PD 2026', 20, 20, 4, [0, 0, 0]);
  paint(img, rect(0, 110, 640, 240), [20, 40, 100]);
  drawText(img, 'HELLO', 40, 140, 9, [255, 255, 255]);
  return img;
}

/** Cartoon subject; returns the image and its silhouette mask. */
function subject(width: number, height: number, cx: number, cy: number, r: number, bg: (x: number, y: number) => RGB): { img: RgbaImage; mask: RgbaImage } {
  const img = blank(width, height);
  fill(img, bg);
  const outline: RGB = [30, 25, 25];
  const body = ellipse(cx, cy, r, r * 0.9);
  const inner = ellipse(cx, cy, r - 7, r * 0.9 - 7);
  paint(img, body, outline);
  paint(img, inner, [245, 140, 40]);
  paint(img, ellipse(cx, cy + r * 0.35, r * 0.45, r * 0.32), [255, 255, 255]); // enclosed white belly
  for (const ex of [cx - r * 0.35, cx + r * 0.35]) {
    paint(img, ellipse(ex, cy - r * 0.2, r * 0.1, r * 0.14), [10, 10, 10]);
    paint(img, ellipse(ex + r * 0.03, cy - r * 0.26, r * 0.035, r * 0.035), [255, 255, 255]); // highlight
    paint(img, ellipse(ex + (ex < cx ? -1 : 1) * r * 0.08, cy + r * 0.05, r * 0.08, r * 0.05), [235, 60, 80]); // cheek
  }
  const mask = blank(width, height, [0, 0, 0, 255]);
  paint(mask, body, [255, 255, 255]);
  return { img, mask };
}

/** Procedural 32x32 pixel-art slime (one pixel = one bead) plus its mask. */
function sprite(): { img: RgbaImage; mask: RgbaImage } {
  const S = 32;
  const img = blank(S, S);
  const mask = blank(S, S, [0, 0, 0, 255]);
  const inBody = (x: number, y: number) => ((x - 15.5) / 13) ** 2 + ((y - 19) / 11) ** 2 <= 1 && y <= 29;
  const set = (im: RgbaImage, x: number, y: number, c: RGB) => {
    const i = (y * S + x) * 4;
    im.data[i] = c[0];
    im.data[i + 1] = c[1];
    im.data[i + 2] = c[2];
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!inBody(x, y)) continue;
      set(mask, x, y, [255, 255, 255]);
      const edge = !inBody(x - 1, y) || !inBody(x + 1, y) || !inBody(x, y - 1) || !inBody(x, y + 1);
      set(img, x, y, edge ? [26, 26, 26] : y > 23 ? [46, 139, 58] : [76, 184, 72]);
    }
  for (const ex of [10, 20]) {
    for (let y = 15; y <= 18; y++) for (let x = ex; x <= ex + 1; x++) set(img, x, y, [26, 26, 26]);
    set(img, ex, 15, [255, 255, 255]);
    set(img, ex - 2, 20, [245, 154, 176]);
    set(img, ex + 3, 20, [245, 154, 176]);
  }
  for (let x = 7; x <= 9; x++) set(img, x, 11, [190, 240, 170]);
  return { img, mask };
}

function upscale(src: RgbaImage, factor: number, margin: number, marginColor: [number, number, number, number]): RgbaImage {
  const out = blank(src.width * factor + margin * 2, src.height * factor + margin * 2, marginColor);
  for (let y = 0; y < src.height * factor; y++)
    for (let x = 0; x < src.width * factor; x++) {
      const s = (Math.floor(y / factor) * src.width + Math.floor(x / factor)) * 4;
      const d = ((y + margin) * out.width + x + margin) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = src.data[s + c];
    }
  return out;
}

export interface SynthSpec {
  name: string;
  note: string;
  hasMask: boolean;
  style: 'cartoon' | 'photo' | 'pixel';
}

export function generateAll(dir = SYNTH_DIR): SynthSpec[] {
  const specs: SynthSpec[] = [];
  const save = (name: string, note: string, img: RgbaImage, style: SynthSpec['style'], mask?: RgbaImage) => {
    writePng(join(dir, `${name}.png`), img);
    if (mask) writePng(join(dir, `${name}.mask.png`), mask);
    specs.push({ name, note, hasMask: !!mask, style });
  };
  save('syn_blocks', '24 色块（饱和 + 中性 + 肤色）', blocks(), 'cartoon');
  save('syn_gradient', '日落渐变 / 灰阶 / 肤色渐变（色带测试）', gradient(), 'photo');
  save('syn_lines', '1~6px 黑线、彩色细线、斜线、圆环（描线保护）', lines(), 'cartoon');
  save('syn_text', '点阵字：白底黑字 + 深蓝底白字', text(), 'cartoon');
  const a = subject(600, 600, 300, 300, 200, () => [255, 255, 255]);
  save('syn_subject_white', '白底卡通主体（含封闭白肚皮、眼睛高光，去背景测试）', a.img, 'cartoon', a.mask);
  const b = subject(600, 600, 300, 300, 200, (_x, y) => lerp([255, 255, 255], [215, 232, 250], y / 599));
  save('syn_subject_gradbg', '浅色渐变底卡通主体（去背景容差测试）', b.img, 'cartoon', b.mask);
  const c = subject(600, 450, 300, 330, 220, () => [255, 255, 255]);
  save('syn_subject_touch', '主体触底边的白底图（去背景误删测试）', c.img, 'cartoon', c.mask);
  const sp = sprite();
  save('syn_pixel_native', '32×32 原生像素图（无缩放）', sp.img, 'pixel', sp.mask);
  save('syn_pixel_x6', '同一像素图放大 6 倍 + 3px 偏移（周期检测）', upscale(sp.img, 6, 3, [255, 255, 255, 255]), 'pixel', upscale(sp.mask, 6, 3, [0, 0, 0, 255]));
  return specs;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const specs = generateAll();
  process.stdout.write(`synthetic: ${specs.length} images -> ${SYNTH_DIR}\n`);
}
