import { beadCount, colorUsage, EMPTY_CELL, type ColorUsage, type PatternDoc } from '@pd/editor-core';
import { FONT_FAMILY, textColorFor, type Ctx2D } from './canvas';
import { drawEmptyCell, drawGridLines } from './pattern';

export interface SheetOptions {
  /** Pixels per cell in the exported image. Default 24. */
  cellSize?: number;
  /** Title line (pattern name). */
  title?: string;
  /** Flip left-right (for ironing from the back). */
  mirror?: boolean;
  /** Print color codes in the cells. Default true. */
  showCodes?: boolean;
  /** Draw empty cells as a checkerboard (true) or leave them white (false). Default false. */
  checkerEmpty?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  /** Where the bead grid sits in the sheet. */
  grid: Rect;
  /** Usage entries in legend order. */
  usage: ColorUsage[];
  /**
   * Draw the sheet. With `tile`, draw only that part of the sheet into a canvas of the tile's
   * size (for platforms that cap canvas size, such as WeChat mini-programs).
   */
  draw(ctx: Ctx2D, tile?: Rect): void;
}

const INK = '#24312F';
const MUTED = '#5F6F6B';

/** Lay out a printable pattern sheet: header, coordinate rulers, coded grid and usage legend. */
export function layoutSheet(doc: PatternDoc, options: SheetOptions = {}): SheetLayout {
  const s = Math.max(8, Math.round(options.cellSize ?? 24));
  const showCodes = options.showCodes !== false;
  const mirror = !!options.mirror;
  const usage = colorUsage(doc);
  const beads = beadCount(doc);
  // some brand data maps one code to two colors (漫漫 S4): tell them apart in the legend
  const counts = new Map<string, number>();
  for (const u of usage) counts.set(u.key, (counts.get(u.key) ?? 0) + 1);
  const label = (u: ColorUsage) => ((counts.get(u.key) ?? 0) > 1 ? `${u.key}(${u.hex}) × ${u.count}` : `${u.key} × ${u.count}`);
  const pad = Math.max(16, s);
  const headerH = Math.round(s * 2.4);
  const rulerTop = Math.round(s * 1.0);
  const rulerLeft = Math.round(s * 1.6);
  const gridW = doc.cols * s;
  const gridH = doc.rows * s;
  const itemW = Math.round(s * 6);
  const itemH = Math.round(s * 1.4);
  const contentW = Math.max(rulerLeft + gridW, itemW * 3);
  const perRow = Math.max(1, Math.floor(contentW / itemW));
  const legendRows = Math.ceil(usage.length / perRow);
  const legendTitleH = Math.round(s * 1.4);
  const legendTop = pad + headerH + rulerTop + gridH + s;
  const width = pad * 2 + contentW;
  const height = legendTop + legendTitleH + legendRows * itemH + pad;
  const grid: Rect = { x: pad + rulerLeft, y: pad + headerH + rulerTop, w: gridW, h: gridH };
  const subtitle = `${doc.cols} × ${doc.rows} 格 · ${usage.length} 色 · ${beads} 颗 · ${doc.brand}${mirror ? ' · 镜像（背面）' : ''}`;

  function draw(ctx: Ctx2D, tile?: Rect): void {
    const view: Rect = tile ?? { x: 0, y: 0, w: width, h: height };
    ctx.save();
    ctx.translate(-view.x, -view.y);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(view.x, view.y, view.w, view.h);

    // header
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = INK;
    ctx.font = `600 ${Math.round(s * 0.8)}px ${FONT_FAMILY}`;
    ctx.fillText(options.title || doc.name || '拼豆图纸', pad, pad);
    ctx.fillStyle = MUTED;
    ctx.font = `${Math.round(s * 0.5)}px ${FONT_FAMILY}`;
    ctx.fillText(subtitle, pad, pad + Math.round(s * 1.2));

    // rulers: 1, 5, 10, 15 ... (1-based, as counted on the bead board)
    ctx.font = `${Math.max(8, Math.round(s * 0.42))}px ${FONT_FAMILY}`;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < doc.cols; c++) {
      const n = c + 1;
      if (n === 1 || n % 5 === 0) ctx.fillText(String(n), grid.x + c * s + s / 2, grid.y - rulerTop / 2);
    }
    ctx.textAlign = 'right';
    for (let r = 0; r < doc.rows; r++) {
      const n = r + 1;
      if (n === 1 || n % 5 === 0) ctx.fillText(String(n), grid.x - s * 0.3, grid.y + r * s + s / 2);
    }

    // cells (only those intersecting the tile)
    const c0 = Math.max(0, Math.floor((view.x - grid.x) / s));
    const c1 = Math.min(doc.cols, Math.ceil((view.x + view.w - grid.x) / s));
    const r0 = Math.max(0, Math.floor((view.y - grid.y) / s));
    const r1 = Math.min(doc.rows, Math.ceil((view.y + view.h - grid.y) / s));
    if (c0 < c1 && r0 < r1) {
      ctx.font = `${Math.max(7, Math.floor(s * 0.36))}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = r0; r < r1; r++) {
        for (let vc = c0; vc < c1; vc++) {
          const col = mirror ? doc.cols - 1 - vc : vc;
          const v = doc.cells[r * doc.cols + col];
          const x = grid.x + vc * s;
          const y = grid.y + r * s;
          if (v === EMPTY_CELL) {
            if (options.checkerEmpty) drawEmptyCell(ctx, x, y, s);
            continue;
          }
          const p = doc.palette[v];
          ctx.fillStyle = p.hex;
          ctx.fillRect(x, y, s, s);
          if (showCodes) {
            ctx.fillStyle = textColorFor(p.hex);
            ctx.fillText(p.key, x + s / 2, y + s / 2);
          }
        }
      }
      drawGridLines(ctx, grid.x, grid.y, s, { c0, c1, r0, r1 });
    }

    // usage legend
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.font = `600 ${Math.round(s * 0.55)}px ${FONT_FAMILY}`;
    ctx.fillText(`用量（共 ${beads} 颗）`, pad, legendTop + legendTitleH / 2);
    ctx.font = `${Math.round(s * 0.5)}px ${FONT_FAMILY}`;
    usage.forEach((u, k) => {
      const x = pad + (k % perRow) * itemW;
      const y = legendTop + legendTitleH + Math.floor(k / perRow) * itemH;
      ctx.fillStyle = u.hex;
      ctx.fillRect(x, y + (itemH - s) / 2, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y + (itemH - s) / 2 + 0.5);
      ctx.lineTo(x + s - 0.5, y + (itemH - s) / 2 + 0.5);
      ctx.lineTo(x + s - 0.5, y + (itemH + s) / 2 - 0.5);
      ctx.lineTo(x + 0.5, y + (itemH + s) / 2 - 0.5);
      ctx.lineTo(x + 0.5, y + (itemH - s) / 2 + 0.5);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillText(label(u), x + s * 1.3, y + itemH / 2);
    });
    ctx.restore();
  }

  return { width, height, grid, usage, draw };
}

/** Split a sheet into tiles no larger than `max` pixels per side (row-major). */
export function sheetTiles(layout: { width: number; height: number }, max: number): Rect[] {
  const out: Rect[] = [];
  for (let y = 0; y < layout.height; y += max)
    for (let x = 0; x < layout.width; x += max) out.push({ x, y, w: Math.min(max, layout.width - x), h: Math.min(max, layout.height - y) });
  return out;
}

/** Plain-text shopping list, e.g. for copying into a chat. */
export function usageText(doc: PatternDoc): string {
  const usage = colorUsage(doc);
  const lines = usage.map((u) => `${u.key}\t${u.count}`);
  return [`${doc.name || '拼豆图纸'}（${doc.brand}，${doc.cols}×${doc.rows} 格，共 ${beadCount(doc)} 颗）`, ...lines].join('\n');
}
