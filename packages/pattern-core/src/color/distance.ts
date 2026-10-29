import { ciede2000, CIEDE2000_MAX_SL } from './ciede2000';
import { labToLinear, linearToLab, linearToOklab, type Vec3 } from './convert';

/** Pluggable perceptual distance used for palette matching and color merging. */
export type DistanceMetric = 'oklab' | 'ciede2000';

/** A color carried in both perceptual spaces so either metric can be applied without reconversion. */
export interface ColorPoint {
  lab: Vec3;
  oklab: Vec3;
}

export type DistanceFn = (a: ColorPoint, b: ColorPoint) => number;

/** Oklab distances are scaled by 100 so they sit on roughly the same scale as Lab ΔE. */
export const OKLAB_SCALE = 100;

export function oklabDistance(a: ColorPoint, b: ColorPoint): number {
  const dl = a.oklab[0] - b.oklab[0];
  const da = a.oklab[1] - b.oklab[1];
  const db = a.oklab[2] - b.oklab[2];
  return Math.sqrt(dl * dl + da * da + db * db) * OKLAB_SCALE;
}

export function ciede2000Distance(a: ColorPoint, b: ColorPoint): number {
  return ciede2000(a.lab, b.lab);
}

export function getDistanceFn(metric: DistanceMetric): DistanceFn {
  return metric === 'oklab' ? oklabDistance : ciede2000Distance;
}

/**
 * Lightness used for search pruning and the factor that turns a lightness gap into a lower bound
 * of the full distance: distance >= |ΔL| * factor.
 */
export function lightnessBound(metric: DistanceMetric): { lightness: (p: ColorPoint) => number; factor: number } {
  return metric === 'oklab'
    ? { lightness: (p) => p.oklab[0], factor: OKLAB_SCALE }
    : { lightness: (p) => p.lab[0], factor: 1 / CIEDE2000_MAX_SL };
}

export function pointFromLinear(lin: Vec3): ColorPoint {
  return { lab: linearToLab(lin), oklab: linearToOklab(lin) };
}

export function pointFromLab(lab: Vec3): ColorPoint {
  return { lab, oklab: linearToOklab(labToLinear(lab)) };
}
