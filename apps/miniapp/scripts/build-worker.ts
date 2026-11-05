import { statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { packageRoot, workerBuildOptions } from './worker-options';

// Bundles workers/generate.ts (pattern-core + wire codec) into src/static/workers/generate.js,
// which uni-app copies verbatim into the mini-program package.
// (No top-level await: this package is CommonJS so that uni-app's vite plugin loads normally.)
build(workerBuildOptions).then(
  () => {
    const out = path.join(packageRoot, workerBuildOptions.outfile as string);
    console.log(`worker: ${path.relative(packageRoot, out)} ${(statSync(out).size / 1024).toFixed(1)} KB`);
  },
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
