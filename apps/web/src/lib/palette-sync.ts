import { replacePaletteData, type PaletteData } from '@pd/palettes';
import { API_BASE } from './api';

const CACHE_KEY = 'pd-web:palette:v1';

interface Release {
  version: number;
  data: PaletteData;
}

function looksValid(d: unknown): d is PaletteData {
  const p = d as PaletteData;
  return !!p && Array.isArray(p.brands) && p.brands.length > 0 && Array.isArray(p.colors) && p.colors.length > 0 && Array.isArray(p.tiers) && p.tiers.some((t) => t.id === 'all');
}

/**
 * Uses the palette edited in the admin when the server has one. Runs once before the app starts:
 * the server copy (1.5 s at most), else the last cached copy, else the palette bundled in the app.
 */
export async function loadServerPalette(): Promise<void> {
  let cached: Release | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as Release | null;
  } catch {
    cached = null;
  }
  let release = cached;
  try {
    const res = await fetch(`${API_BASE}/palettes`, {
      headers: cached ? { 'if-none-match': `"palette-${cached.version}"` } : {},
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      release = (await res.json()) as Release;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(release));
      } catch {
        /* quota: use it this time only */
      }
    }
  } catch {
    /* offline or no server: cached / bundled data */
  }
  if (release && looksValid(release.data)) replacePaletteData(release.data);
}
