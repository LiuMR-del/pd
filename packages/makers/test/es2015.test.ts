import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// The WeChat mini-program Worker (old iOS JSCore) is the compatibility floor: the bundle must
// down-level to ES2015 syntax and must not call runtime APIs newer than ES2015.
describe('ES2015 compatibility', () => {
  it('bundles to ES2015 without newer syntax or APIs', async () => {
    // relative to the package root (vitest's working directory); keeps Node types out of this package
    const out = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', target: 'es2015', write: false, logLevel: 'silent' });
    const code = out.outputFiles[0].text;
    expect(code).not.toMatch(/\?\?|\?\.[\w([]/);
    expect(code).not.toMatch(/\*\*/);
    expect(code).not.toMatch(/\b(async|await)\b/);
    const banned = /\.(includes|padStart|padEnd|flat|flatMap|at|replaceAll|trimStart|trimEnd)\(|Object\.(entries|values|fromEntries)|\bglobalThis\b|\bstructuredClone\b|\bBigInt\b/g;
    expect(code.match(banned) ?? []).toEqual([]);
  });
});
