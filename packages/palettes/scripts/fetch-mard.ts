/**
 * Download MARD color values from the public "MARD拼豆助手" web app into data/local/mard-hex.json.
 * The values are not redistributed in this repository (no license is stated); run this on each
 * machine instead: `pnpm palettes:sync` (fetch + rebuild data/palettes.json).
 *
 * The page's JavaScript is only downloaded and parsed as text, never executed. The result is
 * checked against the committed kit facts (data/mard-kits.json) before it is written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { kitCodes, LOCAL_DIR, LOCAL_HEX_FILE, readKits, standardCodes, type LocalHex } from './mard';

const PAGE = 'https://pixto.mardtoys.cn/';
const UA = 'pd-palettes-sync/1.0 (bead pattern tool; color data check)';

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const html = await get(PAGE);
const script = html.match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
if (!script) throw new Error('app script not found on the page; the site layout may have changed');
const scriptUrl = new URL(script, PAGE).href;
const js = await get(scriptUrl);

// the script holds several {id, hex} arrays; the MARD palette is the one that starts at A1
const start = js.indexOf('[{id:"A1",hex:"');
const end = start < 0 ? -1 : js.indexOf(']', start);
if (end < 0) throw new Error('MARD palette array not found in the app script; the site may have changed');
const colors: Record<string, string> = {};
for (const m of js.slice(start, end + 1).matchAll(/\{id:"([A-Z]+\d+)",hex:"(#[0-9a-fA-F]{6})"\}/g)) colors[m[1]] = m[2].toUpperCase();

const kits = readKits();
const expected = standardCodes(kits);
const problems: string[] = [];
const got = Object.keys(colors);
if (got.length !== expected.length) problems.push(`expected ${expected.length} colors, found ${got.length}`);
const missing = expected.filter((c) => !(c in colors));
if (missing.length) problems.push(`missing codes: ${missing.join(' ')}`);

// the app also carries kit lists; report (do not fail on) any drift from the committed facts
for (const [size, codes] of kitCodes(kits)) {
  if (size === 221) continue;
  const m = js.match(new RegExp(`\\b${size}:\\[((?:"[A-Z]+\\d+",?)+)\\]`));
  if (!m) continue;
  const theirs = new Set(m[1].match(/[A-Z]+\d+/g));
  const differs = codes.length !== theirs.size || codes.some((c) => !theirs.has(c));
  if (differs) process.stdout.write(`note: the ${size}-color kit list on the site differs from data/mard-kits.json; review it\n`);
}

if (problems.length) {
  process.stderr.write(`not written:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}

const out: LocalHex = { source: 'MARD拼豆助手 web app', url: scriptUrl, fetchedAt: new Date().toISOString(), colors };
mkdirSync(LOCAL_DIR, { recursive: true });
writeFileSync(LOCAL_HEX_FILE, JSON.stringify(out, null, 1) + '\n');
process.stdout.write(`wrote ${LOCAL_HEX_FILE}: ${got.length} MARD colors from ${scriptUrl}\n`);
