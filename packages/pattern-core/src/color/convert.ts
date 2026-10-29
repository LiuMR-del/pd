/**
 * Color space conversions: sRGB <-> linear RGB <-> XYZ(D65) <-> CIE Lab, and linear RGB <-> Oklab.
 *
 * Partially derived from perler-beads:
 *   Source:   https://github.com/Zippland/perler-beads
 *   Commit:   2efee730f73dd4eb472ebde443a022d11f98bc21
 *   Original: src/utils/pixelation.ts (hexToRgb, srgbChannelToLinear, rgbToOklab)
 *   License:  AGPL-3.0
 *   Changes:  Rewritten to tuple-based pure functions; sRGB->linear via lookup table; added
 *             linear->sRGB, Oklab->linear, XYZ and CIE Lab conversions (D65); removed the
 *             string-keyed cache (callers cache at a higher level).
 */

/** Three-component color vector, meaning depends on the space (rgb / lab / oklab). */
export type Vec3 = [number, number, number];

/** 8-bit sRGB channel (0..255) -> linear light (0..1). */
export function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/** Lookup table for 8-bit sRGB -> linear. */
export const SRGB_TO_LINEAR: Float64Array = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbChannelToLinear(i);
  return lut;
})();

/** Linear light (0..1) -> sRGB channel as float in 0..255 (not rounded, not clamped). */
export function linearChannelToSrgb(v: number): number {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return s * 255;
}

/** Linear light (0..1) -> 8-bit sRGB channel (rounded and clamped). */
export function linearChannelToSrgb8(v: number): number {
  const s = Math.round(linearChannelToSrgb(v < 0 ? 0 : v > 1 ? 1 : v));
  return s < 0 ? 0 : s > 255 ? 255 : s;
}

export function srgb8ToLinear(rgb: Vec3): Vec3 {
  return [SRGB_TO_LINEAR[rgb[0] | 0], SRGB_TO_LINEAR[rgb[1] | 0], SRGB_TO_LINEAR[rgb[2] | 0]];
}

export function linearToSrgb8(lin: Vec3): Vec3 {
  return [linearChannelToSrgb8(lin[0]), linearChannelToSrgb8(lin[1]), linearChannelToSrgb8(lin[2])];
}

// D65 reference white (CIE 1931 2°), Y normalized to 1.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

export function linearToXyz(lin: Vec3): Vec3 {
  const [r, g, b] = lin;
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

export function xyzToLinear(xyz: Vec3): Vec3 {
  const [x, y, z] = xyz;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;

function labF(t: number): number {
  return t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116;
}

function labFInv(t: number): number {
  const t3 = t * t * t;
  return t3 > LAB_E ? t3 : (116 * t - 16) / LAB_K;
}

export function xyzToLab(xyz: Vec3): Vec3 {
  const fx = labF(xyz[0] / XN);
  const fy = labF(xyz[1] / YN);
  const fz = labF(xyz[2] / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz(lab: Vec3): Vec3 {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  return [labFInv(fx) * XN, labFInv(fy) * YN, labFInv(fz) * ZN];
}

export function linearToLab(lin: Vec3): Vec3 {
  return xyzToLab(linearToXyz(lin));
}

export function labToLinear(lab: Vec3): Vec3 {
  return xyzToLinear(labToXyz(lab));
}

export function linearToOklab(lin: Vec3): Vec3 {
  const [r, g, b] = lin;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

export function oklabToLinear(lab: Vec3): Vec3 {
  const [L, a, b] = lab;
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function srgb8ToLab(rgb: Vec3): Vec3 {
  return linearToLab(srgb8ToLinear(rgb));
}

export function srgb8ToOklab(rgb: Vec3): Vec3 {
  return linearToOklab(srgb8ToLinear(rgb));
}

/** "#RRGGBB" or "RRGGBB" -> 8-bit sRGB, or null if malformed. */
export function hexToRgb(hex: string): Vec3 | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : null;
}

export function rgbToHex(rgb: Vec3): string {
  let s = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.max(0, Math.min(255, Math.round(rgb[i])));
    s += (v < 16 ? '0' : '') + v.toString(16);
  }
  return s.toUpperCase();
}

/** Rec.601 luma of 8-bit sRGB, 0..255. Used for the dark-line heuristic. */
export function luma601(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Chroma of a Lab color. */
export function labChroma(lab: Vec3): number {
  return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
}
