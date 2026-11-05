import path from 'node:path';
import type { BuildOptions } from 'esbuild';

/** esbuild options for the mini-program worker; shared by build-worker.ts and the bundle test. */
export const packageRoot = path.resolve(__dirname, '..');

export const workerBuildOptions: BuildOptions = {
  absWorkingDir: packageRoot,
  entryPoints: ['workers/generate.ts'],
  outfile: 'src/static/workers/generate.js',
  bundle: true,
  // a classic script: WeChat loads worker files without module support
  format: 'iife',
  // compatibility floor: old iOS JSCore in mini-program Workers (same as pattern-core's ES2015 test)
  target: 'es2015',
  minify: true,
  logLevel: 'warning',
};
