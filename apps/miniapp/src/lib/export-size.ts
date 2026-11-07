import type { PatternDoc } from '@pd/editor-core';
import { layoutSheet, type SheetLayout, type SheetOptions } from '@pd/render';

/** Limits for one exported image on phones: canvas side and total pixels. */
export const MAX_EXPORT_SIDE = 4096;
export const MAX_EXPORT_PIXELS = 16_000_000;
/**
 * Pixels per cell in exported sheets. Large enough that the codes in the cells stay sharp when the
 * picture is zoomed in on a phone (24 px gave 8 px text, which is blurry however far you zoom).
 */
export const EXPORT_CELL = 48;

/**
 * Lay out the export sheet with the largest cell size (≤ `preferred`) whose image stays within the
 * phone limits, so the whole sheet is one picture in the album. Returns the layout and the cell size used.
 */
export function fitSheet(doc: PatternDoc, options: Omit<SheetOptions, 'cellSize'>, preferred = EXPORT_CELL, min = 8): { sheet: SheetLayout; cell: number } {
  let cell = preferred;
  let sheet = layoutSheet(doc, { ...options, cellSize: cell });
  while (cell > min && (sheet.width > MAX_EXPORT_SIDE || sheet.height > MAX_EXPORT_SIDE || sheet.width * sheet.height > MAX_EXPORT_PIXELS)) {
    cell -= 2;
    sheet = layoutSheet(doc, { ...options, cellSize: cell });
  }
  return { sheet, cell };
}
