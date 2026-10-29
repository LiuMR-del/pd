/**
 * Build data/palettes.json from the vendor perler-beads files.
 * Usage: pnpm --filter @pd/palettes build:data
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciede2000, hexToRgb, srgb8ToLab, type Vec3 } from '@pd/pattern-core';
import { validatePaletteData, type PaletteColorEntry, type PaletteData, type PaletteTier, type KnownIssue } from '../src/schema';
import { crossCheckVendor, readVendorCsv, readVendorMapping, splitCodes, VENDOR_BRANDS } from './vendor';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'palettes.json');
const TIER_SIZES = [24, 48, 72, 96, 120, 144, 168, 221];

const mapping = readVendorMapping();
const csv = readVendorCsv();
const csvByMard = new Map(csv.rows.map((r) => [r.MARD, r]));

const colors: PaletteColorEntry[] = Object.entries(mapping).map(([hex, codes], id) => {
  const entry: PaletteColorEntry = { id, hex: hex.toUpperCase(), codes: {} };
  for (const b of VENDOR_BRANDS) entry.codes[b] = codes[b];
  const row = csvByMard.get(codes.MARD);
  if (row) {
    for (const b of VENDOR_BRANDS) {
      const extra = splitCodes(row[b]).filter((c) => c !== codes[b]);
      if (extra.length) (entry.altCodes ??= {})[b] = extra;
    }
  }
  return entry;
});

// Nested tiers by farthest-point sampling under CIEDE2000, seeded with the colors nearest to white and black.
const labs: Vec3[] = colors.map((c) => srgb8ToLab(hexToRgb(c.hex)!));
const nearestTo = (lab: Vec3) => labs.reduce((best, l, i) => (ciede2000(l, lab) < ciede2000(labs[best], lab) ? i : best), 0);
const order: number[] = [nearestTo([100, 0, 0]), nearestTo([0, 0, 0])];
const minD = labs.map((l) => Math.min(...order.map((o) => ciede2000(l, labs[o]))));
while (order.length < colors.length) {
  let best = -1;
  for (let i = 0; i < colors.length; i++) if (!order.includes(i) && (best < 0 || minD[i] > minD[best])) best = i;
  order.push(best);
  for (let i = 0; i < colors.length; i++) minD[i] = Math.min(minD[i], ciede2000(labs[i], labs[best]));
}
const FPS = 'farthest-point sampling (CIEDE2000), seeds = nearest to white and black; placeholder until official kit lists are available';
const tiers: PaletteTier[] = TIER_SIZES.filter((s) => s < colors.length).map((size) => ({
  id: `t${size}`,
  size,
  synthetic: true,
  method: FPS,
  colorIds: order.slice(0, size).sort((a, b) => a - b),
}));
tiers.push({ id: 'all', size: colors.length, synthetic: false, method: 'all colors in the source mapping', colorIds: colors.map((c) => c.id) });

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
    changes: 'Restructured into a color array with per-brand codes, altCodes from the CSV, generated tiers and knownIssues. Non-MARD brands are mapped by MARD hex values, not measured.',
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
