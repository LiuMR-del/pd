/** Placement of content (an image, or a pattern measured in cells) centered inside a box. */
export interface Fit {
  /** Box pixels per content unit (image pixel or pattern cell). */
  scale: number;
  /** Box position of the content's top-left corner. */
  x: number;
  y: number;
}

/**
 * Largest scale at which `content` fits inside `box` minus `padding` on every side, clamped to
 * [minScale, maxScale], centered. Used for the source image (crop view) and the pattern canvas.
 */
export function fitContain(contentW: number, contentH: number, boxW: number, boxH: number, padding = 0, minScale = 0, maxScale = Infinity): Fit {
  const availW = Math.max(1, boxW - padding * 2);
  const availH = Math.max(1, boxH - padding * 2);
  const raw = Math.min(availW / Math.max(1, contentW), availH / Math.max(1, contentH));
  const scale = Math.max(minScale, Math.min(maxScale, raw));
  return { scale, x: Math.round((boxW - contentW * scale) / 2), y: Math.round((boxH - contentH * scale) / 2) };
}
