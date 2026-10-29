/** Validate data/palettes.json (format, uniqueness, brand completeness, tiers) and cross-check the vendor files. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePaletteData, type PaletteData } from '../src/schema';
import { crossCheckVendor } from './vendor';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'palettes.json');
const data = JSON.parse(readFileSync(file, 'utf8')) as PaletteData;
const errors = [...validatePaletteData(data), ...crossCheckVendor(data)];
// warning only: an alternative code that is another color's primary code makes reverse lookup ambiguous
for (const c of data.colors) {
  for (const [brand, alts] of Object.entries(c.altCodes ?? {})) {
    for (const alt of alts) {
      const other = data.colors.find((o) => o !== c && o.codes[brand] === alt);
      if (other) process.stdout.write(`warning: ${brand} alt code ${alt} of ${c.hex} (MARD ${c.codes.MARD}) is the primary code of ${other.hex} (MARD ${other.codes.MARD})\n`);
    }
  }
}
for (const k of data.knownIssues) process.stdout.write(`known issue: ${k.brand} ${k.code} -> ${k.hexes.join(', ')}\n`);
if (errors.length) {
  process.stderr.write(`${errors.length} error(s):\n${errors.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`ok: ${data.colors.length} colors x ${data.brands.length} brands, tiers ${data.tiers.map((t) => t.id).join('/')}\n`);
