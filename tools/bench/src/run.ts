/**
 * Stage-0 benchmark. Usage: pnpm bench  (from repo root)
 * Outputs to tools/bench/out/: previews/*.png, overview-*.png, results.json, results.csv, index.html
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import {
  baselinePattern,
  createMatcher,
  generatePattern,
  getDistanceFn,
  gridSize,
  pointFromLinear,
  preparePalette,
  presetOptions,
  resampleLinear,
  type PatternOptions,
  type PatternResult,
  type RgbaImage,
} from '@pd/pattern-core';
import { getPalette } from '@pd/palettes';
import { renderHtml } from './html';
import { computeMetrics, type Metrics } from './metrics';
import { COMPETITORS_DIR, IMAGES_DIR, OUT_DIR, SYNTH_DIR } from './paths';
import { readPng, writePng } from './png';
import { contactSheet, renderPattern, renderReference } from './render';
import { generateAll } from './synth';

export interface BenchItem {
  id: string;
  category: string;
  note: string;
  src: string; // path relative to out/
  path: string;
  maskPath?: string;
  synthetic: boolean;
}

export interface RunRecord {
  item: string;
  category: string;
  group: string;
  preset: string;
  metric: string;
  cols: number;
  rows: number;
  preview: string;
  metrics: Metrics;
  meta: PatternResult['meta'];
}

const LONG_SIDE = 72; // 均衡档
const MAX_COLORS = 24;
const BRAND = 'MARD';
const CELL_PX = 6;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function loadItems(): BenchItem[] {
  const items: BenchItem[] = [];
  const manifest = join(IMAGES_DIR, 'manifest.csv');
  if (existsSync(manifest)) {
    for (const row of parseCsv(readFileSync(manifest, 'utf8'))) {
      const path = join(IMAGES_DIR, row.file);
      if (!existsSync(path)) {
        process.stderr.write(`missing image ${row.file}, skipped\n`);
        continue;
      }
      items.push({ id: row.file.replace(/\.png$/, ''), category: row.category, note: row.note, src: `../images/${row.file}`, path, synthetic: false });
    }
  }
  for (const s of generateAll()) {
    items.push({
      id: s.name,
      category: 'synthetic',
      note: s.note,
      src: `../synthetic/${s.name}.png`,
      path: join(SYNTH_DIR, `${s.name}.png`),
      maskPath: s.hasMask ? join(SYNTH_DIR, `${s.name}.mask.png`) : undefined,
      synthetic: true,
    });
  }
  return items;
}

type Runner = (img: RgbaImage, palette: { key: string; hex: string }[]) => PatternResult;

interface Group {
  group: string;
  preset: string;
  metric: string;
  run: Runner;
}

function ours(metric: 'oklab' | 'ciede2000', style: 'cartoon' | 'photo' | 'pixel', extra: PatternOptions = {}): Runner {
  return (img, pal) => generatePattern(img, pal, { ...presetOptions(style, 'balanced'), longSide: LONG_SIDE, maxColors: MAX_COLORS, metric, ...extra });
}

function baseline(mode: 'dominant' | 'average', extra: { removeBackground?: boolean; similarityThreshold?: number } = {}): Runner {
  return (img, pal) => baselinePattern(img, pal, { ...gridSize(img.width, img.height, LONG_SIDE), mode, ...extra });
}

const MAIN_GROUPS: Group[] = [
  { group: 'baseline', preset: 'cartoon', metric: 'oklab', run: baseline('dominant') },
  { group: 'baseline', preset: 'photo', metric: 'oklab', run: baseline('average') },
  { group: 'baseline-nomerge', preset: 'cartoon', metric: 'oklab', run: baseline('dominant', { similarityThreshold: 0 }) },
  { group: 'baseline-nomerge', preset: 'photo', metric: 'oklab', run: baseline('average', { similarityThreshold: 0 }) },
  { group: 'ours-oklab', preset: 'cartoon', metric: 'oklab', run: ours('oklab', 'cartoon') },
  { group: 'ours-oklab', preset: 'photo', metric: 'oklab', run: ours('oklab', 'photo') },
  { group: 'ours-ciede2000', preset: 'cartoon', metric: 'ciede2000', run: ours('ciede2000', 'cartoon', { prefilterK: 0 }) },
  { group: 'ours-ciede2000', preset: 'photo', metric: 'ciede2000', run: ours('ciede2000', 'photo', { prefilterK: 0 }) },
  { group: 'ours-ciede2000-k8', preset: 'cartoon', metric: 'ciede2000+oklab-k8', run: ours('ciede2000', 'cartoon') },
  { group: 'ours-ciede2000-k8', preset: 'photo', metric: 'ciede2000+oklab-k8', run: ours('ciede2000', 'photo') },
  // review aid: k=1 (plain area average per cell) vs the default k=3 vote, see report §8
  { group: 'ours-ciede2000-k8-k1', preset: 'cartoon', metric: 'ciede2000+oklab-k8', run: ours('ciede2000', 'cartoon', { subSamples: 1 }) },
];

const PIXEL_GROUPS: Group[] = [
  { group: 'ours-oklab', preset: 'pixel', metric: 'oklab', run: ours('oklab', 'pixel') },
  { group: 'ours-ciede2000-k8', preset: 'pixel', metric: 'ciede2000+oklab-k8', run: ours('ciede2000', 'pixel') },
];

const BG_GROUPS: Group[] = [
  { group: 'baseline', preset: 'cartoon', metric: 'oklab', run: baseline('dominant', { removeBackground: true }) },
  { group: 'baseline', preset: 'photo', metric: 'oklab', run: baseline('average', { removeBackground: true }) },
  { group: 'ours-oklab', preset: 'cartoon', metric: 'oklab', run: ours('oklab', 'cartoon', { removeBackground: true }) },
  { group: 'ours-oklab', preset: 'photo', metric: 'oklab', run: ours('oklab', 'photo', { removeBackground: true }) },
  { group: 'ours-ciede2000-k8', preset: 'cartoon', metric: 'ciede2000+oklab-k8', run: ours('ciede2000', 'cartoon', { removeBackground: true }) },
  { group: 'ours-ciede2000-k8', preset: 'photo', metric: 'ciede2000+oklab-k8', run: ours('ciede2000', 'photo', { removeBackground: true }) },
];

function runGroups(items: BenchItem[], groups: Group[], palette: { key: string; hex: string }[], tag: string, previews: boolean): RunRecord[] {
  const out: RunRecord[] = [];
  for (const it of items) {
    const img = readPng(it.path);
    const mask = it.maskPath ? readPng(it.maskPath) : undefined;
    let refWritten = false;
    for (const g of groups) {
      const r = g.run(img, palette);
      const name = `${it.id}__${tag}__${g.group}__${g.preset}.png`;
      if (previews) {
        writePng(join(OUT_DIR, 'previews', name), renderPattern(r, CELL_PX));
        if (!refWritten) {
          writePng(join(OUT_DIR, 'previews', `${it.id}__${tag}__reference.png`), renderReference(img, r, CELL_PX));
          refWritten = true;
        }
      }
      out.push({
        item: it.id,
        category: it.category,
        group: g.group,
        preset: g.preset,
        metric: g.metric,
        cols: r.cols,
        rows: r.rows,
        preview: previews ? `previews/${name}` : '',
        metrics: computeMetrics(img, r, mask),
        meta: r.meta,
      });
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return out;
}

// --- parameter sweeps (for default recommendations) ---
interface SweepRecord {
  sweep: string;
  value: string;
  items: number;
  meanDE00: number;
  meanDE00Smooth: number;
  meanDEok: number;
  meanDEcam: number;
  isolatedRatio: number;
  darkRecall: number | null;
  colors: number;
  timeMs: number;
}

function sweep(name: string, items: BenchItem[], palette: { key: string; hex: string }[], values: [string, PatternOptions][]): SweepRecord[] {
  const imgs = items.map((it) => readPng(it.path));
  return values.map(([label, opts]) => {
    const ms = imgs.map((img) => computeMetrics(img, generatePattern(img, palette, { longSide: LONG_SIDE, maxColors: MAX_COLORS, ...opts })));
    const avg = (f: (m: Metrics) => number) => ms.reduce((s, m) => s + f(m), 0) / ms.length;
    const dr = ms.filter((m) => m.darkRecall !== null);
    return {
      sweep: name,
      value: label,
      items: ms.length,
      meanDE00: avg((m) => m.meanDE00),
      meanDE00Smooth: avg((m) => m.meanDE00Smooth),
      meanDEok: avg((m) => m.meanDEok),
      meanDEcam: avg((m) => m.meanDEcam),
      isolatedRatio: avg((m) => m.isolatedRatio),
      darkRecall: dr.length ? dr.reduce((s, m) => s + m.darkRecall!, 0) / dr.length : null,
      colors: avg((m) => m.colors),
      timeMs: avg((m) => m.timeMs),
    };
  });
}

// --- performance: 100x100 grid, MARD 72 tier ---
interface PerfRecord {
  case: string;
  grid: string;
  paletteSize: number;
  coldMs: number;
  medianMs: number;
  stages: Record<string, number>;
}

// --- CIEDE2000 with an Oklab shortlist vs exact CIEDE2000 search ---
interface AgreementRecord {
  palette: number;
  k: number;
  queries: number;
  agreement: number;
  /** Mean extra ΔE00 of the shortlisted pick over the exact nearest (all queries). */
  meanPenalty: number;
  maxPenalty: number;
  exactMs: number;
  prefilterMs: number;
}

function agreement(items: BenchItem[]): AgreementRecord[] {
  const pts = items
    .filter((i) => !i.synthetic)
    .flatMap((it) => {
      const img = readPng(it.path);
      const sub = resampleLinear(img, 216, Math.max(1, Math.round((216 * img.height) / img.width)));
      const out = [];
      for (let i = 0; i < sub.width * sub.height; i++) out.push(pointFromLinear([sub.lin[i * 3], sub.lin[i * 3 + 1], sub.lin[i * 3 + 2]]));
      return out;
    });
  const d00 = getDistanceFn('ciede2000');
  const out: AgreementRecord[] = [];
  for (const tier of [72, 'all'] as const) {
    const pal = preparePalette(getPalette(BRAND, tier));
    const exact = createMatcher(pal, 'ciede2000');
    let t = performance.now();
    const ref = pts.map((p) => exact.nearest(p));
    const exactMs = performance.now() - t;
    for (const k of [4, 8, 16]) {
      const m = createMatcher(pal, 'ciede2000', undefined, { prefilterK: k });
      t = performance.now();
      const got = pts.map((p) => m.nearest(p));
      const prefilterMs = performance.now() - t;
      let agree = 0;
      let pen = 0;
      let maxPen = 0;
      got.forEach((g, i) => {
        if (g === ref[i]) {
          agree++;
          return;
        }
        const d = d00(pts[i], pal.colors[g]) - d00(pts[i], pal.colors[ref[i]]);
        pen += d;
        maxPen = Math.max(maxPen, d);
      });
      out.push({ palette: pal.colors.length, k, queries: pts.length, agreement: agree / pts.length, meanPenalty: pen / pts.length, maxPenalty: maxPen, exactMs, prefilterMs });
    }
  }
  return out;
}

function centerSquare(img: RgbaImage): RgbaImage {
  const s = Math.min(img.width, img.height);
  const ox = Math.floor((img.width - s) / 2);
  const oy = Math.floor((img.height - s) / 2);
  const data = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) data.set(img.data.subarray(((y + oy) * img.width + ox) * 4, ((y + oy) * img.width + ox + s) * 4), y * s * 4);
  return { data, width: s, height: s };
}

function perf(items: BenchItem[]): PerfRecord[] {
  const out: PerfRecord[] = [];
  const pick = ['landscape_01', 'portrait_01', 'cartoon_02'].map((p) => items.find((i) => i.id.startsWith(p))).filter(Boolean) as BenchItem[];
  for (const paletteTier of [72, 'all'] as const) {
    const palette = getPalette(BRAND, paletteTier);
    for (const it of pick) {
      const img = centerSquare(readPng(it.path));
      const cases: [string, () => PatternResult][] = [
        ['baseline-dominant', () => baselinePattern(img, palette, { cols: 100, rows: 100, mode: 'dominant' })],
        ['baseline-average', () => baselinePattern(img, palette, { cols: 100, rows: 100, mode: 'average' })],
        ...(['oklab', 'ciede2000', 'ciede2000-k8'] as const).flatMap((variant) =>
          (['cartoon', 'photo'] as const).map(
            (style) =>
              [
                `ours-${variant}-${style}`,
                () =>
                  generatePattern(img, palette, {
                    ...presetOptions(style, 'detail'),
                    longSide: 100,
                    metric: variant === 'oklab' ? 'oklab' : 'ciede2000',
                    prefilterK: variant === 'ciede2000-k8' ? 8 : 0,
                  }),
              ] as [string, () => PatternResult],
          ),
        ),
      ];
      for (const [name, fn] of cases) {
        const t0 = performance.now();
        fn();
        const cold = performance.now() - t0;
        const times: number[] = [];
        let last: PatternResult | null = null;
        for (let k = 0; k < 5; k++) {
          const t = performance.now();
          last = fn();
          times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        out.push({
          case: `${it.id.split('_').slice(0, 2).join('_')} ${name}`,
          grid: `${last!.sourceGrid.cols}x${last!.sourceGrid.rows}`,
          paletteSize: palette.length,
          coldMs: cold,
          medianMs: times[2],
          stages: last!.timings,
        });
      }
    }
  }
  return out;
}

function main() {
  mkdirSync(join(OUT_DIR, 'previews'), { recursive: true });
  const items = loadItems();
  const real = items.filter((i) => !i.synthetic);
  process.stdout.write(`items: ${real.length} real + ${items.length - real.length} synthetic\n`);
  const fullPalette = getPalette(BRAND, 'all');

  process.stdout.write('main matrix');
  const main = runGroups(items, MAIN_GROUPS, fullPalette, 'main', true);
  process.stdout.write('pixel preset');
  const pixel = runGroups(items.filter((i) => i.category === 'pixel' || i.id.startsWith('syn_pixel')), PIXEL_GROUPS, fullPalette, 'pixel', true);
  process.stdout.write('background removal');
  const bg = runGroups(items.filter((i) => i.maskPath), BG_GROUPS, fullPalette, 'bg', true);

  process.stdout.write('sweeps\n');
  const cartoonish = items.filter((i) => ['cartoon', 'text', 'ai'].includes(i.category) || ['syn_lines', 'syn_text', 'syn_subject_white'].includes(i.id));
  const photoish = items.filter((i) => ['portrait', 'pet', 'landscape'].includes(i.category) || i.id === 'syn_gradient');
  const sweeps: SweepRecord[] = [
    ...sweep('cartoon: subSamples k', cartoonish, fullPalette, [1, 2, 3, 4].map((k) => [`k=${k}`, { style: 'cartoon', subSamples: k }])),
    ...sweep('cartoon: darkLine', cartoonish, fullPalette, [
      ['off', { style: 'cartoon', darkLine: { enabled: false, luma: 45, ratio: 0.3 } }],
      ['luma45 ratio0.3', { style: 'cartoon' }],
      ['luma35 ratio0.3', { style: 'cartoon', darkLine: { enabled: true, luma: 35, ratio: 0.3, maxNeighborDark: 0.5 } }],
      ['luma45 ratio0.2', { style: 'cartoon', darkLine: { enabled: true, luma: 45, ratio: 0.2 } }],
      ['luma60 ratio0.3', { style: 'cartoon', darkLine: { enabled: true, luma: 60, ratio: 0.3 } }],
    ]),
    ...sweep('cartoon: minRegionSize', cartoonish, fullPalette, [0, 2, 3, 4].map((n) => [`N=${n}`, { style: 'cartoon', minRegionSize: n }])),
    ...sweep('cartoon: saliency', cartoonish, fullPalette, [
      ['on', { style: 'cartoon' }],
      ['off', { style: 'cartoon', saliency: { enabled: false, chroma: 45, contrast: 35, maxShare: 0.02, darkL: 22, weight: 6 } }],
    ]),
    ...sweep('photo: dither', photoish, fullPalette, [0, 0.25, 0.5, 1].map((d) => [`dither=${d}`, { style: 'photo', dither: d }])),
    ...sweep('photo: minRegionSize', photoish, fullPalette, [0, 2, 3, 4].map((n) => [`N=${n}`, { style: 'photo', minRegionSize: n }])),
    ...sweep('photo: flatThreshold', photoish, fullPalette, [4, 8, 12, 20, 30].map((f) => [`flat=${f}`, { style: 'photo', flatThreshold: f }])),
    ...sweep('photo: metric', photoish, fullPalette, (['oklab', 'ciede2000'] as const).map((m) => [m, { style: 'photo', metric: m, prefilterK: 0 }])),
    ...sweep('cartoon: metric', cartoonish, fullPalette, (['oklab', 'ciede2000'] as const).map((m) => [m, { style: 'cartoon', metric: m, prefilterK: 0 }])),
    ...sweep('photo: ciede2000 prefilterK', photoish, fullPalette, [0, 8].map((k) => [`K=${k}`, { style: 'photo', metric: 'ciede2000', prefilterK: k }])),
    ...sweep('cartoon: ciede2000 prefilterK', cartoonish, fullPalette, [0, 8].map((k) => [`K=${k}`, { style: 'cartoon', metric: 'ciede2000', prefilterK: k }])),
  ];

  process.stdout.write('perf\n');
  const perfRecords = perf(items);
  process.stdout.write('matcher agreement\n');
  const agreementRecords = agreement(items);

  // overview contact sheets: columns = original, reference, baseline c/p, oklab c/p, ciede c/p
  const order = MAIN_GROUPS.map((g) => `${g.group}__${g.preset}`);
  const sheets: [string, string[]][] = [
    ['overview-1.png', ['cartoon', 'portrait', 'pet']],
    ['overview-2.png', ['landscape', 'text', 'pixel', 'ai']],
    ['overview-3.png', ['synthetic']],
  ];
  for (const [file, cats] of sheets) {
    const rows = items
      .filter((i) => cats.includes(i.category))
      .map((it) => [
        readPng(it.path),
        readPng(join(OUT_DIR, 'previews', `${it.id}__main__reference.png`)),
        ...order.map((o) => readPng(join(OUT_DIR, 'previews', `${it.id}__main__${o}.png`))),
      ]);
    if (rows.length) writePng(join(OUT_DIR, file), contactSheet(rows, 160, 96));
  }
  const bgItems = items.filter((i) => i.maskPath);
  writePng(
    join(OUT_DIR, 'overview-bg.png'),
    contactSheet(
      bgItems.map((it) => [readPng(it.path), ...BG_GROUPS.map((g) => readPng(join(OUT_DIR, 'previews', `${it.id}__bg__${g.group}__${g.preset}.png`)))]),
      200,
      150,
    ),
  );

  const competitors = existsSync(COMPETITORS_DIR) ? readdirSync(COMPETITORS_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  const results = {
    generatedAt: new Date().toISOString(),
    env: { node: process.version, cpu: cpus()[0]?.model ?? 'unknown', platform: process.platform },
    config: { brand: BRAND, palette: 'all (291)', longSide: LONG_SIDE, maxColors: MAX_COLORS, cellPx: CELL_PX },
    items: items.map(({ path: _p, maskPath: _m, ...rest }) => rest),
    main,
    pixel,
    bg,
    sweeps,
    perf: perfRecords,
    agreement: agreementRecords,
    competitors,
  };
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 1));
  const csvRows = [...main, ...pixel, ...bg].map((r) =>
    [r.item, r.category, r.group, r.preset, r.cols, r.rows, r.metrics.meanDE00.toFixed(3), r.metrics.meanDE00Smooth.toFixed(3), r.metrics.meanDEok.toFixed(3), r.metrics.meanDEcam.toFixed(3), r.metrics.colors, r.metrics.isolatedRatio.toFixed(4), r.metrics.darkRecall ?? '', r.metrics.bgMisdelete ?? '', r.metrics.bgResidual ?? '', r.metrics.timeMs.toFixed(1)].join(','),
  );
  writeFileSync(join(OUT_DIR, 'results.csv'), ['item,category,group,preset,cols,rows,dE00,dE00_smooth,dEok,dEcam16,colors,isolated,dark_recall,bg_misdelete,bg_residual,ms', ...csvRows].join('\n') + '\n');
  writeFileSync(join(OUT_DIR, 'index.html'), renderHtml(results));
  process.stdout.write(`done -> ${OUT_DIR}\n`);
}

main();
