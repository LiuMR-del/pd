import { createMatcher, preparePalette, type PaletteInput, type PreparedPalette } from './color/palette';
import { ditherCells } from './dither/errorDiffusion';
import { gridSize, MAX_LONG_SIDE, MIN_LONG_SIDE } from './image/grid';
import { detectPixelPeriod } from './image/period';
import { resampleLinear, type Rect } from './image/resample';
import { removeBackground } from './post/background';
import { mergeSmallRegions, removeIsolated } from './post/cleanup';
import { autoCrop } from './post/crop';
import { resolveOptions, type PatternOptions } from './presets';
import { limitColors } from './reduce/limitColors';
import { sampleCells } from './sample/cell';
import { cellSpread, snapEdges } from './sample/edgeSnap';
import { applyStrokes, detectStrokes } from './sample/stroke';
import { EMPTY_CELL, type PatternResult, type RgbaImage } from './types';

declare const performance: { now(): number } | undefined;

function defaultNow(): number {
  // `typeof` guard instead of globalThis: older JSCore (WeChat iOS) lacks globalThis
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Plan the grid: explicit size, detected pixel-art period, or aspect-ratio grid. */
function planGrid(image: RgbaImage, o: ReturnType<typeof resolveOptions>, meta: PatternResult['meta'], subject?: Rect): { cols: number; rows: number; region: Rect } {
  if (subject) return { ...gridSize(subject.w, subject.h, o.longSide), region: subject };
  const full: Rect = { x: 0, y: 0, w: image.width, h: image.height };
  if (o.cols && o.rows) return { cols: Math.round(o.cols), rows: Math.round(o.rows), region: full };
  if (o.style === 'pixel') {
    const det = typeof o.pixelPeriod === 'number' ? { period: o.pixelPeriod, offsetX: 0, offsetY: 0, score: 1 } : detectPixelPeriod(image);
    meta.pixelPeriod = det ? det.period : null;
    meta.pixelPeriodScore = det ? Number(det.score.toFixed(3)) : null;
    if (det) {
      const cols = Math.floor((image.width - det.offsetX) / det.period);
      const rows = Math.floor((image.height - det.offsetY) / det.period);
      if (cols >= 1 && rows >= 1 && Math.max(cols, rows) <= MAX_LONG_SIDE && Math.max(cols, rows) >= MIN_LONG_SIDE) {
        return { cols, rows, region: { x: det.offsetX, y: det.offsetY, w: cols * det.period, h: rows * det.period } };
      }
    }
    // already-native small pixel art: one bead per source pixel
    if (!det && Math.max(image.width, image.height) <= MAX_LONG_SIDE && Math.max(image.width, image.height) >= MIN_LONG_SIDE) {
      meta.pixelPeriod = 1;
      return { cols: image.width, rows: image.height, region: full };
    }
  }
  return { ...gridSize(image.width, image.height, o.longSide), region: full };
}

/**
 * Convert an RGBA image into a bead pattern using the given palette (already restricted to the
 * chosen brand + color tier). Pure function; no DOM / Canvas; safe to run in a Worker.
 */
export function generatePattern(image: RgbaImage, paletteInput: readonly PaletteInput[], options: PatternOptions = {}): PatternResult {
  const o = resolveOptions(options);
  const now = options.now ?? defaultNow;
  const first = runPipeline(image, paletteInput, o, now);
  if (!o.fitSubject || !o.removeBackground || (o.cols && o.rows) || o.style === 'pixel') return first;
  const subject = subjectRect(first, image);
  if (!subject) return first;
  // second pass on the subject's bounding box, so the subject gets the whole grid (the first pass
  // spent part of it on background that was removed and cropped away)
  const second = runPipeline(image, paletteInput, o, now, subject);
  const removed = (n: PatternResult) => Number(n.meta.backgroundRemoved ?? 0);
  if (removed(second) === 0 || second.cols * second.rows === 0) return first;
  // the tighter frame puts more subject on its border, so background removal could take a bite
  // out of the subject: fall back when the second pass keeps clearly less subject area
  if (subjectArea(second) < 0.8 * subjectArea(first)) return first;
  second.meta.fitSubject = true;
  second.timings.firstPass = first.timings.total ?? 0;
  second.timings.total = (second.timings.total ?? 0) + (first.timings.total ?? 0);
  return second;
}

/** Source-pixel area covered by filled cells. */
function subjectArea(r: PatternResult): number {
  const filled = r.stats.reduce((s, c) => s + c.count, 0);
  return filled * (r.sourceRegion.w / r.sourceGrid.cols) * (r.sourceRegion.h / r.sourceGrid.rows);
}

/**
 * Source rectangle of the first pass's content (after background removal + crop) plus one cell
 * of margin, or null when the content already fills >= 90% of the grid's long side.
 */
function subjectRect(r: PatternResult, image: RgbaImage): Rect | null {
  if (!r.cols || !r.rows || !Number(r.meta.backgroundRemoved ?? 0)) return null;
  const { cols, rows } = r.sourceGrid;
  if (Math.max(r.cols, r.rows) / Math.max(cols, rows) >= 0.9) return null;
  const reg = r.sourceRegion;
  const cw = reg.w / cols;
  const ch = reg.h / rows;
  const x0 = Math.max(reg.x, reg.x + (r.offset.x - 1) * cw);
  const y0 = Math.max(reg.y, reg.y + (r.offset.y - 1) * ch);
  const x1 = Math.min(reg.x + reg.w, reg.x + (r.offset.x + r.cols + 1) * cw);
  const y1 = Math.min(reg.y + reg.h, reg.y + (r.offset.y + r.rows + 1) * ch);
  const rect = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
  return rect.w >= 1 && rect.h >= 1 && rect.x + rect.w <= image.width && rect.y + rect.h <= image.height ? rect : null;
}

function runPipeline(
  image: RgbaImage,
  paletteInput: readonly PaletteInput[],
  o: ReturnType<typeof resolveOptions>,
  now: () => number,
  subject?: Rect,
): PatternResult {
  const timings: Record<string, number> = {};
  const meta: PatternResult['meta'] = { metric: o.metric, style: o.style };
  const t0 = now();
  let t = t0;
  const lap = (name: string) => {
    const n = now();
    timings[name] = n - t;
    t = n;
  };

  const palette = preparePalette(paletteInput);
  const mopts = { prefilterK: o.prefilterK };
  const matcher = createMatcher(palette, o.metric, undefined, mopts);
  lap('palette');

  const { cols, rows, region } = planGrid(image, o, meta, subject);
  const k = o.subSamples;
  const sub = resampleLinear(image, cols * k, rows * k, region);
  lap('resample');

  const sampled = sampleCells(sub, cols, rows, palette, matcher, {
    k,
    centerWeight: o.centerWeight,
    mode: o.style === 'pixel' ? 'center' : 'vote',
    darkLine: o.darkLine,
    flatThreshold: o.flatThreshold,
    alphaThreshold: o.alphaThreshold,
  });
  meta.flatCells = sampled.flatCount;
  meta.votedCells = sampled.votedCount;
  meta.darkLineCells = sampled.darkLineCount;
  lap('sample');

  if (o.edgeSnap.enabled && o.style !== 'pixel') {
    const sub3 = k === 3 ? sub : resampleLinear(image, cols * 3, rows * 3, region);
    const spread = cellSpread(sub3, cols, rows, o.alphaThreshold);
    meta.edgeSnapped = snapEdges(sampled.index, sampled.targets, sampled.means, cols, rows, o.edgeSnap, spread);
  }
  lap('edgeSnap');
  if (o.style !== 'pixel') {
    const strokes = detectStrokes(image, region, cols, rows, o.stroke, o.alphaThreshold, Math.max(4, k + 1));
    if (strokes) {
      meta.strokeFine = strokes.fine;
      meta.strokeCells = applyStrokes(strokes, sampled.index, sampled.targets, palette, matcher, o.stroke.contrast);
    }
  }
  lap('stroke');

  let index = sampled.index;
  let allowed: number[] | null = null;
  if (o.maxColors > 0) {
    const lim = limitColors(index, sampled.targets, cols, rows, palette, o.metric, matcher.distance, {
      prefilterK: o.prefilterK,
      maxColors: o.maxColors,
      countExponent: o.countExponent,
      saliency: o.saliency,
      refine: o.refine,
    });
    index = lim.index;
    allowed = lim.allowed;
    meta.colorsBeforeLimit = lim.before;
    meta.salientKept = lim.salient.length;
  }
  lap('limit');

  if (o.dither > 0) {
    const m = allowed ? createMatcher(palette, o.metric, allowed, mopts) : matcher;
    // flat cells diffuse from their mean color; voted (edge) cells keep their winning color as target
    index = ditherCells(index, sampled.targets, cols, rows, palette, m, o.dither);
  }
  lap('dither');

  if (o.removeBackground) {
    meta.backgroundRemoved = removeBackground(index, sampled.targets, cols, rows, matcher.distance, {
      tolerance: o.backgroundTolerance,
      minBorderShare: o.backgroundMinBorderShare,
      minRunRatio: o.backgroundMinRunRatio,
    });
  }
  if (o.isolatedCleanup) meta.isolatedFixed = removeIsolated(index, cols, rows, palette, matcher.distance, o.protectContrast);
  if (o.minRegionSize > 1) meta.smallRegionFixed = mergeSmallRegions(index, cols, rows, palette, matcher.distance, o.minRegionSize, o.protectContrast);
  let out = { index, cols, rows, x: 0, y: 0 };
  if (o.autoCrop) out = autoCrop(index, cols, rows);
  lap('post');

  const result = buildResult(out.index, out.cols, out.rows, palette, { cols, rows }, { x: out.x, y: out.y }, region, meta);
  lap('output');
  timings.total = t - t0;
  result.timings = timings;
  return result;
}

/** Compact the used colors (ordered by count) and build the public result. */
export function buildResult(
  index: Int32Array,
  cols: number,
  rows: number,
  palette: PreparedPalette,
  sourceGrid: { cols: number; rows: number },
  offset: { x: number; y: number },
  sourceRegion: PatternResult['sourceRegion'],
  meta: PatternResult['meta'],
): PatternResult {
  const counts = new Map<number, number>();
  for (let i = 0; i < index.length; i++) if (index[i] >= 0) counts.set(index[i], (counts.get(index[i]) ?? 0) + 1);
  const order = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (palette.colors[a[0]].key < palette.colors[b[0]].key ? -1 : 1));
  const remap = new Map<number, number>();
  order.forEach(([p], i) => remap.set(p, i));
  const cells = new Uint16Array(index.length);
  for (let i = 0; i < index.length; i++) cells[i] = index[i] < 0 ? EMPTY_CELL : remap.get(index[i])!;
  const usedPalette = order.map(([p]) => ({ key: palette.colors[p].key, hex: palette.colors[p].hex }));
  return {
    cols,
    rows,
    cells,
    palette: usedPalette,
    stats: order.map(([p, count]) => ({ key: palette.colors[p].key, hex: palette.colors[p].hex, count })),
    sourceGrid,
    offset,
    sourceRegion,
    timings: {},
    meta,
  };
}
