/** Parsing of the original perler-beads files (vendor/perler-beads) for build and cross-checks. Node-only. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'perler-beads');
export const VENDOR_BRANDS = ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'] as const;

export type VendorMapping = Record<string, Record<string, string>>;

export function readVendorMapping(): VendorMapping {
  return JSON.parse(readFileSync(join(VENDOR_DIR, 'colorSystemMapping.json'), 'utf8')) as VendorMapping;
}

/** CSV rows as brand -> raw cell text (cells may hold "a/b" alternatives). */
export function readVendorCsv(): { header: string[]; rows: Record<string, string>[] } {
  const text = readFileSync(join(VENDOR_DIR, '色号对应表.csv'), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0].split(',').map((s) => s.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
  return { header, rows };
}

/** Split a CSV cell like "157/70" into ["157", "70"] (deduplicated, order kept). */
export function splitCodes(cell: string): string[] {
  return Array.from(new Set(cell.split('/').map((s) => s.trim()).filter(Boolean)));
}

/**
 * Cross-check converted data against the vendor files: same hex set, identical primary codes,
 * and every CSV cell equal to [primary, ...altCodes].
 */
export function crossCheckVendor(data: {
  brands: string[];
  colors: { hex: string; codes: Record<string, string>; altCodes?: Record<string, string[]> }[];
}): string[] {
  const errors: string[] = [];
  const mapping = readVendorMapping();
  const vendorHexes = Object.keys(mapping).map((h) => h.toUpperCase());
  const ours = new Map(data.colors.map((c) => [c.hex, c]));
  if (vendorHexes.length !== data.colors.length) errors.push(`color count ${data.colors.length} != vendor ${vendorHexes.length}`);
  for (const [hex, codes] of Object.entries(mapping)) {
    const c = ours.get(hex.toUpperCase());
    if (!c) {
      errors.push(`vendor color ${hex} missing`);
      continue;
    }
    for (const b of VENDOR_BRANDS) if (c.codes[b] !== codes[b]) errors.push(`${hex} ${b}: ${c.codes[b]} != vendor ${codes[b]}`);
  }
  const { header, rows } = readVendorCsv();
  for (const b of VENDOR_BRANDS) if (!header.includes(b)) errors.push(`CSV header lacks ${b}`);
  const byMard = new Map(data.colors.map((c) => [c.codes.MARD, c]));
  if (rows.length !== data.colors.length) errors.push(`CSV rows ${rows.length} != colors ${data.colors.length}`);
  for (const row of rows) {
    const c = byMard.get(row.MARD);
    if (!c) {
      errors.push(`CSV MARD ${row.MARD} not in data`);
      continue;
    }
    for (const b of VENDOR_BRANDS) {
      const expected = [c.codes[b], ...(c.altCodes?.[b] ?? [])].join('/');
      const got = splitCodes(row[b]).join('/');
      if (expected !== got) errors.push(`CSV ${row.MARD} ${b}: "${row[b]}" vs data "${expected}"`);
    }
  }
  return errors;
}
