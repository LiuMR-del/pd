/**
 * MARD-specific corrections applied on top of the perler-beads data (see docs/色号调研.md):
 * code format without leading zeros, real retail kit lists, and optional local color values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const KITS_FILE = join(ROOT, 'data', 'mard-kits.json');
/** Local, git-ignored color values downloaded by scripts/fetch-mard.ts (not redistributed). */
export const LOCAL_DIR = join(ROOT, 'data', 'local');
export const LOCAL_HEX_FILE = join(LOCAL_DIR, 'mard-hex.json');

/** "A01" -> "A1", "H07" -> "H7"; MARD prints codes without leading zeros. */
export function normalizeMardCode(code: string): string {
  return code.replace(/^([A-Z]+)0+(\d)/, '$1$2');
}

export interface MardKits {
  _about: string;
  series221: Record<string, number>;
  /** Kit size -> codes added on top of the next smaller kit. */
  kitsAdded: Record<string, string[]>;
}

export function readKits(): MardKits {
  return JSON.parse(readFileSync(KITS_FILE, 'utf8')) as MardKits;
}

/** The 221 standard codes (series A-H, M). */
export function standardCodes(kits: MardKits): string[] {
  const out: string[] = [];
  for (const [series, n] of Object.entries(kits.series221)) for (let i = 1; i <= n; i++) out.push(`${series}${i}`);
  return out;
}

/** Kit size -> full code list (each kit contains every smaller kit), plus 221. */
export function kitCodes(kits: MardKits): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let acc: string[] = [];
  for (const size of Object.keys(kits.kitsAdded).map(Number).sort((a, b) => a - b)) {
    acc = acc.concat(kits.kitsAdded[String(size)]);
    out.set(size, acc.slice());
  }
  out.set(221, standardCodes(kits));
  return out;
}

export interface LocalHex {
  source: string;
  url: string;
  fetchedAt: string;
  /** MARD code -> "#RRGGBB". */
  colors: Record<string, string>;
}

/** Locally downloaded MARD color values, or null when they have not been fetched on this machine. */
export function readLocalHex(): LocalHex | null {
  if (!existsSync(LOCAL_HEX_FILE)) return null;
  return JSON.parse(readFileSync(LOCAL_HEX_FILE, 'utf8')) as LocalHex;
}
