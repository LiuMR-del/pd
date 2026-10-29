import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const IMAGES_DIR = join(BENCH_DIR, 'images');
export const SYNTH_DIR = join(BENCH_DIR, 'synthetic');
export const OUT_DIR = join(BENCH_DIR, 'out');
export const COMPETITORS_DIR = join(BENCH_DIR, 'competitors');
