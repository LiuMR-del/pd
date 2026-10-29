/**
 * CAM16-UCS (Li et al. 2017) — used only as a metric-neutral arbiter between the Oklab and
 * CIEDE2000 matching groups. Viewing conditions: D65 white, L_A = 64/π·0.2 cd/m², Y_b = 20,
 * average surround (F = 1, c = 0.69, Nc = 1), full adaptation D = 1 (self-luminous display,
 * illuminant discounted) so that greys are neutral.
 */
import { linearToXyz, type Vec3 } from '@pd/pattern-core';

const M16 = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127],
];
const WHITE: Vec3 = [95.047, 100, 108.883];
const LA = (64 / Math.PI) * 0.2;
const YB = 20;
const C = 0.69;
const NC = 1;

const mul = (m: number[][], v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const rgbW = mul(M16, WHITE);
const D = 1;
const DRGB = rgbW.map((c) => (D * WHITE[1]) / c + 1 - D) as Vec3;
const k = 1 / (5 * LA + 1);
const FL = 0.2 * k ** 4 * (5 * LA) + 0.1 * (1 - k ** 4) ** 2 * Math.cbrt(5 * LA);
const n = YB / WHITE[1];
const z = 1.48 + Math.sqrt(n);
const NBB = 0.725 * n ** -0.2;
const adapt = (x: number) => {
  const p = (FL * Math.abs(x)) / 100;
  const q = p ** 0.42;
  return (Math.sign(x) * 400 * q) / (q + 27.13);
};
const rgbAW = rgbW.map((c, i) => adapt(c * DRGB[i]));
const AW = (2 * rgbAW[0] + rgbAW[1] + 0.05 * rgbAW[2] - 0.305) * NBB;

/** Linear sRGB (0..1) -> CAM16-UCS [J', a', b']. */
export function linearToCam16Ucs(lin: Vec3): Vec3 {
  const xyz = linearToXyz(lin).map((v) => v * 100) as Vec3;
  const rgb = mul(M16, xyz);
  const [R, G, B] = rgb.map((c, i) => adapt(c * DRGB[i]));
  const a = R - (12 * G) / 11 + B / 11;
  const b = (R + G - 2 * B) / 9;
  const h = Math.atan2(b, a);
  const et = 0.25 * (Math.cos(h + 2) + 3.8);
  const A = (2 * R + G + 0.05 * B - 0.305) * NBB;
  const J = A > 0 ? 100 * (A / AW) ** (C * z) : 0;
  const den = R + G + (21 / 20) * B;
  const t = den > 1e-9 ? Math.max(0, ((50000 / 13) * NC * NBB * et * Math.hypot(a, b)) / den) : 0;
  const chroma = t ** 0.9 * Math.sqrt(J / 100) * (1.64 - 0.29 ** n) ** 0.73;
  const M = chroma * FL ** 0.25;
  const Jp = (1.7 * J) / (1 + 0.007 * J);
  const Mp = Math.log(1 + 0.0228 * M) / 0.0228;
  return [Jp, Mp * Math.cos(h), Mp * Math.sin(h)];
}

export function cam16UcsDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
