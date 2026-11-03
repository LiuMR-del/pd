/**
 * Brand color systems: code <-> hex conversion across brands, hue sorting.
 *
 * Derived from perler-beads:
 *   Source:   https://github.com/Zippland/perler-beads
 *   Commit:   2efee730f73dd4eb472ebde443a022d11f98bc21
 *   Original: src/utils/colorSystemUtils.ts (getAllHexValues, getMardToHexMapping,
 *             convertPaletteToColorSystem, getDisplayColorKey, convertColorKeyToHex,
 *             isValidColorInSystem, getColorKeyByHex, hexToHsl, sortColorsByHue)
 *   License:  AGPL-3.0
 *   Changes:  Mapping data is injected (from @pd/palettes) instead of importing a JSON file;
 *             brands are open strings instead of a fixed union; lookups are indexed with Maps
 *             (O(1) code -> hex instead of a linear scan); sortColorsByHue works on `hex`.
 */

export interface ColorSystemData {
  brands: readonly string[];
  colors: readonly { hex: string; codes: Readonly<Record<string, string>> }[];
}

export const UNKNOWN_CODE = '?';

export interface ColorSystem {
  brands: readonly string[];
  getAllHexValues(): string[];
  /** brand code -> hex for one brand (e.g. MARD "A1" -> "#F9F0CD"). */
  getCodeToHexMapping(brand: string): Map<string, string>;
  /** Hex -> brand code, or "?" when the brand has no such color. */
  getColorKeyByHex(hex: string, brand: string): string;
  /** Brand code -> hex; returns the input unchanged if it is already a hex or unknown. */
  convertColorKeyToHex(code: string, brand: string): string;
  isValidColorInSystem(hex: string, brand: string): boolean;
  /** Re-key a palette (by hex) to another brand's codes; colors without a mapping keep their key. */
  convertPaletteToColorSystem<T extends { key: string; hex: string }>(palette: readonly T[], brand: string): T[];
}

export function createColorSystem(data: ColorSystemData): ColorSystem {
  const byHex = new Map<string, Readonly<Record<string, string>>>();
  for (const c of data.colors) byHex.set(c.hex.toUpperCase(), c.codes);
  const codeToHex = new Map<string, Map<string, string>>();
  for (const brand of data.brands) {
    const m = new Map<string, string>();
    // first occurrence wins when a brand reuses a code (see palettes knownIssues)
    for (const c of data.colors) if (c.codes[brand] && !m.has(c.codes[brand])) m.set(c.codes[brand], c.hex.toUpperCase());
    codeToHex.set(brand, m);
  }
  return {
    brands: data.brands,
    getAllHexValues: () => Array.from(byHex.keys()),
    getCodeToHexMapping: (brand) => new Map(codeToHex.get(brand) ?? []),
    getColorKeyByHex(hex, brand) {
      return byHex.get(hex.toUpperCase())?.[brand] ?? UNKNOWN_CODE;
    },
    convertColorKeyToHex(code, brand) {
      if (/^#[0-9a-f]{6}$/i.test(code)) return code.toUpperCase();
      return codeToHex.get(brand)?.get(code) ?? code;
    },
    isValidColorInSystem(hex, brand) {
      return byHex.get(hex.toUpperCase())?.[brand] !== undefined;
    },
    convertPaletteToColorSystem(palette, brand) {
      return palette.map((c) => {
        const code = byHex.get(c.hex.toUpperCase())?.[brand];
        return code ? { ...c, key: code } : c;
      });
    },
  };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
    if (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / diff + 2) / 6;
    else h = ((r - g) / diff + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** Sort by hue (5° buckets), then lightness (light first), then saturation (vivid first). */
export function sortColorsByHue<T extends { hex: string }>(colors: readonly T[]): T[] {
  return colors.slice().sort((a, b) => {
    const A = hexToHsl(a.hex);
    const B = hexToHsl(b.hex);
    if (Math.abs(A.h - B.h) > 5) return A.h - B.h;
    if (Math.abs(A.l - B.l) > 3) return B.l - A.l;
    return B.s - A.s;
  });
}
