import { ciede2000, createMatcher, hexToRgb, pointFromLab, preparePalette, srgb8ToLab, type Vec3 } from '@pd/pattern-core';
import { colorUsage, type PaletteEntry, type PatternDoc } from './doc';
import type { PatternEditor } from './editor';

/** One color of the brand table (@pd/palettes `paletteData.colors`): the same bead under every brand's code. */
export interface BrandColor {
  id: number;
  hex: string;
  codes: Readonly<Record<string, string>>;
}

export interface ConversionTarget {
  brand: string;
  /** Stored as the document's tier ("221", "all", ...). */
  tier: string;
  /** Colors (ids into the table) of the target tier. */
  colorIds: readonly number[];
}

export interface ConversionRow {
  /** Palette index in the document. */
  index: number;
  from: PaletteEntry;
  to: PaletteEntry;
  count: number;
  /** Same bead in the brand table (only the code changes); false = nearest color in the target tier. */
  exact: boolean;
  /** CIEDE2000 between the old and the new color (0 for the same color value). */
  deltaE: number;
}

export interface ConversionPlan {
  target: ConversionTarget;
  /** Approximate rows first (largest color difference first), then exact rows by bead count. */
  rows: ConversionRow[];
}

function lab(hex: string): Vec3 {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`invalid hex "${hex}"`);
  return srgb8ToLab(rgb);
}

/** The table color a document entry stands for: by its code in the document's brand, else by color value. */
function lookup(entry: PaletteEntry, brand: string, colors: readonly BrandColor[]): BrandColor | undefined {
  const hex = entry.hex.toUpperCase();
  const byCode = colors.filter((c) => c.codes[brand] === entry.key);
  // a code can name two colors (漫漫 S4), and a code may come from another brand: the color value decides
  return byCode.find((c) => c.hex.toUpperCase() === hex) ?? colors.find((c) => c.hex.toUpperCase() === hex) ?? byCode[0];
}

/**
 * How every used color of `doc` maps to the target brand + tier. Colors present in the target
 * tier keep their value and only change code; others go to the CIEDE2000-nearest target color.
 */
export function planBrandConversion(doc: PatternDoc, colors: readonly BrandColor[], target: ConversionTarget): ConversionPlan {
  const allowed = target.colorIds.map((id) => colors[id]).filter((c): c is BrandColor => !!c);
  if (allowed.length === 0) throw new Error('target tier has no colors');
  const allowedIds = new Set(allowed.map((c) => c.id));
  const prepared = preparePalette(allowed.map((c) => ({ key: c.codes[target.brand], hex: c.hex })));
  const matcher = createMatcher(prepared, 'ciede2000');

  const rows: ConversionRow[] = colorUsage(doc).map((u) => {
    const from = { key: u.key, hex: u.hex.toUpperCase() };
    const found = lookup(from, doc.brand, colors);
    let toColor: BrandColor;
    let exact = false;
    // only the same color value counts as the same bead
    if (found && allowedIds.has(found.id) && found.hex.toUpperCase() === from.hex) {
      toColor = found;
      exact = true;
    } else {
      toColor = allowed[matcher.nearest(pointFromLab(lab(from.hex)))];
    }
    const to = { key: toColor.codes[target.brand], hex: toColor.hex.toUpperCase() };
    const deltaE = from.hex === to.hex ? 0 : ciede2000(lab(from.hex), lab(to.hex));
    return { index: u.index, from, to, count: u.count, exact, deltaE };
  });
  rows.sort((a, b) => Number(a.exact) - Number(b.exact) || (a.exact ? b.count - a.count : b.deltaE - a.deltaE) || a.index - b.index);
  return { target: { ...target, colorIds: target.colorIds.slice() }, rows };
}

/** Apply a plan as one undoable step (colors and the document's brand / tier). */
export function applyBrandConversion(editor: PatternEditor, plan: ConversionPlan): boolean {
  const map = new Map<number, number>();
  for (const r of plan.rows) map.set(r.index, editor.ensureColor(r.to));
  return editor.remapColors(map, { brand: plan.target.brand, tier: plan.target.tier }, 'brand');
}
