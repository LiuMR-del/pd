import raw from '../data/palettes.json';
import type { PaletteData, PaletteTier } from './schema';

export * from './schema';

export const paletteData = raw as unknown as PaletteData;
export const BRANDS: readonly string[] = paletteData.brands;

/**
 * Replace the palette data at runtime (e.g. with the server's admin-edited copy). The exported
 * objects are updated in place so existing imports see the new data; call it before the UI uses
 * any palette, not in the middle of a session.
 */
export function replacePaletteData(next: PaletteData): void {
  (paletteData.brands as string[]).splice(0, paletteData.brands.length, ...next.brands);
  paletteData.colors = next.colors;
  paletteData.tiers = next.tiers;
  paletteData.knownIssues = next.knownIssues;
  paletteData._source = next._source;
}

export function listTiers(): PaletteTier[] {
  return paletteData.tiers.slice().sort((a, b) => a.size - b.size);
}

export function getTier(tier: number | 'all' = 'all'): PaletteTier {
  const t = paletteData.tiers.find((x) => (tier === 'all' ? x.id === 'all' : x.size === tier));
  if (!t) throw new Error(`unknown tier ${tier}; available: ${listTiers().map((x) => x.size).join(', ')}`);
  return t;
}

/** Palette for a brand + color tier, as `{ key: brand code, hex }` (input format of @pd/pattern-core). */
export function getPalette(brand: string, tier: number | 'all' = 'all'): { key: string; hex: string }[] {
  if (!BRANDS.includes(brand)) throw new Error(`unknown brand ${brand}`);
  return getTier(tier).colorIds.map((id) => {
    const c = paletteData.colors[id];
    return { key: c.codes[brand], hex: c.hex };
  });
}
