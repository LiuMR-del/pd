/** Static comparison page (data embedded; open out/index.html directly from disk). */

export function renderHtml(results: object): string {
  const data = JSON.stringify(results).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>阶段 0 算法对比</title>
<style>
  :root { --bg:#fafafa; --fg:#1d1d1f; --muted:#6e6e73; --card:#fff; --line:#e3e3e6; --accent:#2f6fde; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161618; --fg:#ececf0; --muted:#9a9aa2; --card:#202024; --line:#34343a; --accent:#7aa7ff; } }
  body { margin:0; padding:16px; font:14px/1.5 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; background:var(--bg); color:var(--fg); }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:28px 0 8px; }
  .muted { color:var(--muted); font-size:12px; }
  table { border-collapse:collapse; background:var(--card); font-size:12px; margin-bottom:8px; }
  th, td { border:1px solid var(--line); padding:3px 7px; text-align:right; white-space:nowrap; }
  th { background:var(--bg); } td:first-child, th:first-child { text-align:left; }
  .best { font-weight:700; color:var(--accent); }
  .tabs button { margin:0 6px 6px 0; padding:4px 10px; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:6px; cursor:pointer; }
  .tabs button.on { border-color:var(--accent); color:var(--accent); }
  .item { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:14px; }
  .row { display:flex; gap:8px; overflow-x:auto; }
  figure { margin:0; flex:0 0 auto; width:220px; }
  figure img { width:220px; image-rendering:pixelated; border:1px solid var(--line); background:#fff; }
  figcaption { font-size:11px; color:var(--muted); }
  figcaption b { color:var(--fg); }
  .wrap { overflow-x:auto; }
</style>
</head>
<body>
<h1>阶段 0 算法对比</h1>
<div class="muted" id="env"></div>
<h2>汇总（主矩阵：按类别 × 组别平均）</h2>
<div class="muted">ΔE00 / ΔEok：图纸与原图同网格区域平均的色差（越低越好）；平滑ΔE00：3×3 平滑后比较（抖动友好）；孤立：无同色 8 邻居的单颗占比；暗线召回：含暗线格中被画成深色的比例。ΔE00 天然偏向 CIEDE2000 组，ΔEok 天然偏向 Oklab 组；ΔE CAM16（CAM16-UCS）与两者都无关，作为中立裁判。</div>
<div class="wrap" id="summary"></div>
<h2>去背景（合成图，带真值掩码）</h2>
<div class="wrap" id="bg"></div>
<h2>像素图预设</h2>
<div class="wrap" id="pixel"></div>
<h2>参数扫描</h2>
<div class="wrap" id="sweeps"></div>
<h2>性能（100×100 网格）</h2>
<div class="wrap" id="perf"></div>
<h2>CIEDE2000：Oklab 预筛 K 个候选 vs 精确搜索</h2>
<div class="wrap" id="agree"></div>
<h2>竞品对比（用户提供的导出图，程序还原网格后用同一套指标评分）</h2>
<div class="muted">竞品颜色按其图纸实际显示色计算，不吸附到我们的色板；「色值偏差」= 竞品显示色与 perler-beads 同色最近色号的 CIEDE2000（反映两家 MARD 色值表的差异）。</div>
<div class="wrap" id="comp"></div>
<h2>逐图对比</h2>
<div class="tabs" id="tabs"></div>
<div id="gallery"></div>
<script>
const R = ${data};
const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v, d = 2) => v === null || v === undefined ? '–' : (typeof v === 'number' ? v.toFixed(d) : v);
const pct = (v) => v === null || v === undefined ? '–' : (v * 100).toFixed(1) + '%';
document.getElementById('env').textContent = '生成于 ' + R.generatedAt + ' · Node ' + R.env.node + ' · ' + R.env.cpu + ' · 色板 ' + R.config.brand + ' ' + R.config.palette + ' · 长边 ' + R.config.longSide + ' 格 · 上限 ' + R.config.maxColors + ' 色（baseline 无上限，按 perler-beads 默认相似度 30 合并）';

function table(rows, cols, bestCols = {}) {
  let h = '<table><tr>' + cols.map(c => '<th>' + c[0] + '</th>').join('') + '</tr>';
  for (const r of rows) h += '<tr>' + cols.map(c => '<td' + (bestCols[c[0]] && bestCols[c[0]](r) ? ' class="best"' : '') + '>' + c[1](r) + '</td>').join('') + '</tr>';
  return h + '</table>';
}
function agg(recs, keyFn) {
  const m = new Map();
  for (const r of recs) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].map(([k, rs]) => {
    const avg = (g) => { const v = rs.map(g).filter(x => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return { key: k, n: rs.length, de: avg(r => r.metrics.meanDE00), des: avg(r => r.metrics.meanDE00Smooth), deok: avg(r => r.metrics.meanDEok), decam: avg(r => r.metrics.meanDEcam), colors: avg(r => r.metrics.colors), iso: avg(r => r.metrics.isolatedRatio), dark: avg(r => r.metrics.darkRecall), mis: avg(r => r.metrics.bgMisdelete), res: avg(r => r.metrics.bgResidual), ms: avg(r => r.metrics.timeMs) };
  });
}
const cats = [...new Set(R.main.map(r => r.category))];
let sum = '';
for (const cat of ['全部', ...cats]) {
  const recs = cat === '全部' ? R.main : R.main.filter(r => r.category === cat);
  const rows = agg(recs, r => r.group + ' / ' + r.preset);
  sum += '<div class="muted">' + cat + '（' + new Set(recs.map(r => r.item)).size + ' 张）</div>' + table(rows, [
    ['组别 / 预设', r => r.key], ['ΔE00', r => f(r.de)], ['平滑ΔE00', r => f(r.des)], ['ΔEok', r => f(r.deok)], ['ΔE CAM16', r => f(r.decam)], ['用色', r => f(r.colors, 1)], ['孤立', r => pct(r.iso)], ['暗线召回', r => pct(r.dark)], ['耗时ms', r => f(r.ms, 0)],
  ]);
}
document.getElementById('summary').innerHTML = sum;
document.getElementById('bg').innerHTML = table(R.bg, [
  ['图', r => r.item], ['组别 / 预设', r => r.group + ' / ' + r.preset], ['主体误删', r => pct(r.metrics.bgMisdelete)], ['背景残留', r => pct(r.metrics.bgResidual)], ['ΔE00', r => f(r.metrics.meanDE00)], ['用色', r => r.metrics.colors],
]);
document.getElementById('pixel').innerHTML = table(R.pixel, [
  ['图', r => r.item], ['组别', r => r.group], ['网格', r => r.cols + '×' + r.rows], ['检测周期', r => f(r.meta.pixelPeriod, 0)], ['ΔE00', r => f(r.metrics.meanDE00)], ['用色', r => r.metrics.colors], ['孤立', r => pct(r.metrics.isolatedRatio)],
]);
document.getElementById('sweeps').innerHTML = table(R.sweeps, [
  ['扫描', r => r.sweep], ['取值', r => r.value], ['图数', r => r.items], ['ΔE00', r => f(r.meanDE00)], ['平滑ΔE00', r => f(r.meanDE00Smooth)], ['ΔEok', r => f(r.meanDEok)], ['ΔE CAM16', r => f(r.meanDEcam)], ['孤立', r => pct(r.isolatedRatio)], ['暗线召回', r => pct(r.darkRecall)], ['用色', r => f(r.colors, 1)], ['耗时ms', r => f(r.timeMs, 0)],
]);
document.getElementById('perf').innerHTML = table(R.perf, [
  ['用例', r => r.case], ['网格', r => r.grid], ['色板', r => r.paletteSize], ['首次ms', r => f(r.coldMs, 0)], ['中位ms', r => f(r.medianMs, 0)], ['阶段', r => Object.entries(r.stages).map(([k, v]) => k + ' ' + v.toFixed(0)).join(' · ')],
], { '中位ms': r => r.medianMs < 1000 });

document.getElementById('agree').innerHTML = table(R.agreement || [], [
  ['色板', r => r.palette], ['K', r => r.k], ['查询数', r => r.queries], ['一致率', r => pct(r.agreement)], ['平均 ΔE00 损失', r => f(r.meanPenalty, 4)], ['最大损失', r => f(r.maxPenalty)], ['精确 ms', r => f(r.exactMs, 0)], ['预筛 ms', r => f(r.prefilterMs, 0)],
]);
(function () {
  const CR = R.competitorRuns || [];
  if (!CR.length) { document.getElementById('comp').innerHTML = '<div class="muted">未放入竞品图（tools/bench/competitors/&lt;图片id&gt;__&lt;来源&gt;.png）</div>'; return; }
  const pick = (item) => [
    ...CR.filter(r => r.item === item),
    ...R.main.filter(r => r.item === item && ((r.group === 'ours-ciede2000-k8') || (r.group === 'ours-oklab' && r.preset === 'cartoon') || (r.group === 'baseline' && r.preset === 'cartoon'))),
  ];
  const items = [...new Set(CR.map(r => r.item))];
  const rows = items.flatMap(pick);
  const cols = [['图', r => r.item], ['组别 / 预设', r => r.group + ' / ' + r.preset], ['网格', r => r.cols + '×' + r.rows], ['用色', r => r.metrics.colors], ['ΔE00', r => f(r.metrics.meanDE00)], ['ΔEok', r => f(r.metrics.meanDEok)], ['ΔE CAM16', r => f(r.metrics.meanDEcam)], ['孤立', r => pct(r.metrics.isolatedRatio)], ['暗线召回', r => pct(r.metrics.darkRecall)], ['色值偏差 均/最大', r => r.snapMeanDE === undefined || (r.colorsTable && !r.colorsTable.length) ? '' : f(r.snapMeanDE) + ' / ' + f(r.snapMaxDE)]];
  const avgRows = agg(rows, r => r.group + ' / ' + r.preset).map(a => ({ key: a.key, a }));
  document.getElementById('comp').innerHTML = '<div class="muted">' + items.length + ' 张图平均</div>' + table(avgRows, [['组别 / 预设', r => r.key], ['ΔE00', r => f(r.a.de)], ['ΔEok', r => f(r.a.deok)], ['ΔE CAM16', r => f(r.a.decam)], ['用色', r => f(r.a.colors, 1)], ['孤立', r => pct(r.a.iso)], ['暗线召回', r => pct(r.a.dark)]]) + table(rows, cols);
})();
const tabs = document.getElementById('tabs');
const allCats = ['全部', ...new Set(R.items.map(i => i.category))];
function show(cat) {
  [...tabs.children].forEach(b => b.classList.toggle('on', b.textContent === cat));
  let h = '';
  for (const it of R.items.filter(i => cat === '全部' || i.category === cat)) {
    const recs = [...R.main, ...R.pixel, ...(R.competitorRuns || [])].filter(r => r.item === it.id);
    const comp = R.competitors.filter(c => c.startsWith(it.id));
    h += '<div class="item"><b>' + e(it.id) + '</b> <span class="muted">' + e(it.category) + ' · ' + e(it.note) + '</span><div class="row">';
    h += '<figure><img src="' + it.src + '" loading="lazy"><figcaption>原图</figcaption></figure>';
    h += '<figure><img src="previews/' + it.id + '__main__reference.png" loading="lazy"><figcaption>参考（同网格线性平均，无色板限制）</figcaption></figure>';
    for (const r of recs) h += '<figure><img src="' + r.preview + '" loading="lazy"><figcaption><b>' + r.group + ' / ' + r.preset + '</b><br>' + r.cols + '×' + r.rows + ' · ' + r.metrics.colors + ' 色 · ΔE00 ' + f(r.metrics.meanDE00) + ' · ΔEok ' + f(r.metrics.meanDEok) + ' · CAM16 ' + f(r.metrics.meanDEcam) + '<br>孤立 ' + pct(r.metrics.isolatedRatio) + ' · 暗线 ' + pct(r.metrics.darkRecall) + ' · ' + f(r.metrics.timeMs, 0) + 'ms</figcaption></figure>';
    for (const c of comp) h += '<figure><img src="../competitors/' + encodeURIComponent(c) + '" loading="lazy"><figcaption><b>竞品原图</b> ' + e(c) + '</figcaption></figure>';
    h += '</div></div>';
  }
  document.getElementById('gallery').innerHTML = h;
}
for (const c of allCats) { const b = document.createElement('button'); b.textContent = c; b.onclick = () => show(c); tabs.appendChild(b); }
show('全部');
</script>
</body>
</html>
`;
}
