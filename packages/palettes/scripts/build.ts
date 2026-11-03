/**
 * Build data/palettes.json (generated, git-ignored) from the vendor perler-beads files plus the
 * MARD corrections in scripts/mard.ts: codes without leading zeros, real retail kit lists, and
 * MARD color values from data/local/mard-hex.json when it has been fetched on this machine.
 * Usage: pnpm --filter @pd/palettes build:data   (runs on `pnpm install`; `pnpm palettes:sync` fetches first)
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePaletteData, type PaletteColorEntry, type PaletteData, type PaletteTier, type KnownIssue } from '../src/schema';
import { kitCodes, normalizeMardCode, readKits, readLocalHex } from './mard';
import { crossCheckVendor, readVendorCsv, readVendorMapping, splitCodes, VENDOR_BRANDS } from './vendor';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'palettes.json');
const mapping = readVendorMapping();
const csv = readVendorCsv();
const csvByMard = new Map(csv.rows.map((r) => [r.MARD, r]));

const localHex = readLocalHex();
const colors: PaletteColorEntry[] = Object.entries(mapping).map(([hex, codes], id) => {
  const entry: PaletteColorEntry = { id, hex: hex.toUpperCase(), codes: {} };
  for (const b of VENDOR_BRANDS) entry.codes[b] = codes[b];
  entry.codes.MARD = normalizeMardCode(codes.MARD);
  const measured = localHex?.colors[entry.codes.MARD];
  if (measured && measured !== entry.hex) {
    entry.vendorHex = entry.hex;
    entry.hex = measured;
  }
  const row = csvByMard.get(codes.MARD);
  if (row) {
    for (const b of VENDOR_BRANDS) {
      const extra = splitCodes(row[b])
        .filter((c) => c !== codes[b])
        .map((c) => (b === 'MARD' ? normalizeMardCode(c) : c));
      if (extra.length) (entry.altCodes ??= {})[b] = extra;
    }
  }
  return entry;
});

// Tiers = real MARD retail kits (data/mard-kits.json); other brands use the same colors.
const idByMard = new Map(colors.map((c) => [c.codes.MARD, c.id]));
const kits = readKits();
const tiers: PaletteTier[] = [];
for (const [size, codes] of kitCodes(kits)) {
  const missing = codes.filter((c) => !idByMard.has(c));
  if (missing.length) throw new Error(`kit ${size}: codes not in the palette: ${missing.join(' ')}`);
  tiers.push({ id: `t${size}`, size, synthetic: false, method: `MARD ${size}-color retail kit (data/mard-kits.json)`, colorIds: codes.map((c) => idByMard.get(c)!).sort((x, y) => x - y) });
}
tiers.push({ id: 'all', size: colors.length, synthetic: false, method: 'all colors incl. special series (pearl, jelly, transparent, glow ...)', colorIds: colors.map((c) => c.id) });

// Known data issues: duplicated codes within a brand (kept as-is, documented)
const knownIssues: KnownIssue[] = [];
for (const b of VENDOR_BRANDS) {
  const byCode = new Map<string, string[]>();
  for (const c of colors) byCode.set(c.codes[b], [...(byCode.get(c.codes[b]) ?? []), c.hex]);
  byCode.forEach((hexes, code) => {
    if (hexes.length > 1)
      knownIssues.push({ brand: b, code, hexes, note: 'Source maps one brand code to several colors; code -> hex lookups resolve to the first. Needs verification against the brand chart.' });
  });
}

const data: PaletteData = {
  _source: {
    repository: 'https://github.com/Zippland/perler-beads',
    commit: '2efee730f73dd4eb472ebde443a022d11f98bc21',
    files: 'src/app/colorSystemMapping.json, 色号对应表.csv',
    license: 'AGPL-3.0',
    changes:
      'Restructured into a color array with per-brand codes, altCodes from the CSV and knownIssues. MARD codes without leading zeros; tiers are the real MARD retail kits. Non-MARD brands are mapped by MARD hex values, not measured.',
    mardHex: localHex
      ? `MARD colors from ${localHex.source} (${localHex.url}, fetched ${localHex.fetchedAt}); vendorHex keeps the perler-beads value`
      : 'perler-beads values (run `pnpm palettes:sync` to use MARD values)',
    generatedBy: 'packages/palettes/scripts/build.ts',
  },
  schemaVersion: 1,
  brands: [...VENDOR_BRANDS],
  colors,
  tiers,
  knownIssues,
};

const errors = [...validatePaletteData(data), ...crossCheckVendor(data)];
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exit(1);
}

// one color / tier per line keeps diffs readable
const lines = [
  '{',
  `  "_source": ${JSON.stringify(data._source)},`,
  `  "schemaVersion": 1,`,
  `  "brands": ${JSON.stringify(data.brands)},`,
  '  "colors": [',
  colors.map((c) => `    ${JSON.stringify(c)}`).join(',\n'),
  '  ],',
  '  "tiers": [',
  tiers.map((t) => `    ${JSON.stringify(t)}`).join(',\n'),
  '  ],',
  '  "knownIssues": [',
  knownIssues.map((k) => `    ${JSON.stringify(k)}`).join(',\n'),
  '  ]',
  '}',
  '',
];
writeFileSync(OUT, lines.join('\n'));
process.stdout.write(`wrote ${OUT}: ${colors.length} colors, ${tiers.length} tiers, ${knownIssues.length} known issues\n`);
