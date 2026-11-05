import type { ComponentPublicInstance } from 'vue';

export interface CanvasHandle {
  canvas: MpCanvas;
  ctx: MpCanvasContext;
  /** CSS size (what touch coordinates and drawing use; the backing store is ×dpr). */
  width: number;
  height: number;
  /** Page position, for touch events that only carry page coordinates. */
  left: number;
  top: number;
  dpr: number;
}

/**
 * Find a `<canvas type="2d" id="...">` in a page and size its backing store for the screen's pixel
 * ratio. Call from onReady (the node does not exist before the first render).
 */
export function queryCanvas(page: ComponentPublicInstance | null | undefined, selector: string): Promise<CanvasHandle> {
  return new Promise((resolve, reject) => {
    const q = page ? uni.createSelectorQuery().in(page) : uni.createSelectorQuery();
    q.select(selector)
      .fields({ node: true, size: true, rect: true }, () => {})
      .exec((res: unknown[]) => {
        const r = res?.[0] as { node?: MpCanvas; width: number; height: number; left: number; top: number } | null;
        if (!r?.node) {
          reject(new Error(`找不到画布 ${selector}`));
          return;
        }
        const dpr = Math.min(3, wx.getWindowInfo().pixelRatio || 1);
        const canvas = r.node;
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        resolve({ canvas, ctx, width: r.width, height: r.height, left: r.left, top: r.top, dpr });
      });
  });
}

/** A touch point in canvas CSS pixels (canvas touch events carry x/y; others only page coordinates). */
export function touchPoint(t: { x?: number; y?: number; clientX?: number; clientY?: number }, handle: CanvasHandle): { x: number; y: number } {
  if (typeof t.x === 'number' && typeof t.y === 'number') return { x: t.x, y: t.y };
  return { x: (t.clientX ?? 0) - handle.left, y: (t.clientY ?? 0) - handle.top };
}
