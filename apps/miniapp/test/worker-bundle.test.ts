import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { workerBuildOptions } from '../scripts/worker-options';

// Same compatibility floor as packages/pattern-core/test/es2015.test.ts, applied to the real worker
// bundle (pattern-core + editor-core base64 + wire codec) that ships in the mini-program.
describe('worker bundle', () => {
  it('is a single ES2015 script without newer syntax or APIs', async () => {
    const out = await build({ ...workerBuildOptions, outfile: undefined, write: false, minify: false, logLevel: 'silent' });
    const code = out.outputFiles![0].text;
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).not.toMatch(/\?\?|\?\.[\w([]/);
    expect(code).not.toMatch(/\*\*/);
    expect(code).not.toMatch(/\b(async|await)\b/);
    const banned = /\.(includes|padStart|padEnd|flat|flatMap|at|replaceAll|trimStart|trimEnd)\(|Object\.(entries|values|fromEntries)|\bglobalThis\b|\bstructuredClone\b|\bBigInt\b/g;
    expect(code.match(banned) ?? []).toEqual([]);
    expect(code).toContain('worker.onMessage');
  });
});
