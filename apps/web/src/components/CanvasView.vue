<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EMPTY_CELL } from '@pd/editor-core';
import { cellAtPoint, drawPattern } from '@pd/render';
import { notify, state } from '../store';

const wrap = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

// view transform in CSS pixels
const cell = ref(12);
const ox = ref(0);
const oy = ref(0);
const size = { w: 0, h: 0, dpr: 1 };
const hover = ref<{ row: number; col: number } | null>(null);
const spaceHeld = ref(false);
let fitted = false;
/** Set once the user zooms or pans; until then a resize (window, rotation) re-fits the view. */
let viewTouched = false;

const MIN_CELL = 1;
const MAX_CELL = 80;
/** Touch editing needs targets of about a fingertip; below this, single-finger touches pan. */
const MIN_TOUCH_EDIT_CELL = 12;

const zoomPercent = computed(() => Math.round((cell.value / 12) * 100));
const hoverLabel = computed(() => {
  void state.version;
  const h = hover.value;
  if (!h || !state.doc) return '';
  const v = state.doc.cells[h.row * state.doc.cols + h.col];
  const color = v === EMPTY_CELL ? '空' : state.doc.palette[v].key;
  return `第 ${h.col + 1} 列 · 第 ${h.row + 1} 行 · ${color}`;
});
const current = computed(() => {
  void state.version;
  const i = state.currentColor;
  return i !== null && state.doc && i < state.doc.palette.length ? state.doc.palette[i] : null;
});

function view() {
  return {
    cellSize: cell.value,
    offsetX: ox.value,
    offsetY: oy.value,
    width: size.w,
    height: size.h,
    showGrid: state.showGrid,
    showCodes: state.showCodes,
    highlight: state.highlight,
  };
}

let raf = 0;
function requestDraw(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
  });
}

function draw(): void {
  const c = canvas.value;
  const doc = state.doc;
  if (!c) return;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.fillStyle = '#EEF1EF';
  ctx.fillRect(0, 0, size.w, size.h);
  if (!doc) return;
  const s = cell.value;
  if (state.viewMode === 'source' && state.source && state.sourceFrame) {
    const f = state.sourceFrame;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.source.canvas, f.x, f.y, f.w, f.h, ox.value, oy.value, doc.cols * s, doc.rows * s);
    return;
  }
  drawPattern(ctx, doc, view());
  const h = hover.value;
  if (h && state.tool !== 'move' && s >= 4) {
    ctx.strokeStyle = '#0F766E';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox.value + h.col * s + 1, oy.value + h.row * s + 1, s - 2, s - 2);
  }
}

function resize(): void {
  const w = wrap.value;
  const c = canvas.value;
  if (!w || !c) return;
  const r = w.getBoundingClientRect();
  size.w = Math.max(1, Math.floor(r.width));
  size.h = Math.max(1, Math.floor(r.height));
  size.dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = Math.round(size.w * size.dpr);
  c.height = Math.round(size.h * size.dpr);
  c.style.width = `${size.w}px`;
  c.style.height = `${size.h}px`;
  if (state.doc && (!fitted || !viewTouched)) fit();
  requestDraw();
}

function fit(): void {
  const doc = state.doc;
  if (!doc || !size.w) return;
  const s = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min((size.w - 32) / doc.cols, (size.h - 32) / doc.rows)));
  cell.value = s;
  ox.value = Math.round((size.w - doc.cols * s) / 2);
  oy.value = Math.round((size.h - doc.rows * s) / 2);
  fitted = true;
  viewTouched = false;
  requestDraw();
}

function zoomAt(factor: number, mx: number, my: number): void {
  const old = cell.value;
  const next = Math.max(MIN_CELL, Math.min(MAX_CELL, old * factor));
  if (next === old) return;
  ox.value = mx - ((mx - ox.value) * next) / old;
  oy.value = my - ((my - oy.value) * next) / old;
  cell.value = next;
  viewTouched = true;
  requestDraw();
}

function zoomBy(factor: number): void {
  zoomAt(factor, size.w / 2, size.h / 2);
}

defineExpose({ fit, zoomBy });

// --- pointer handling ---------------------------------------------------------------------

type Gesture =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'stroke'; last: { row: number; col: number }; value: number }
  | { kind: 'pinch'; dist: number; cx: number; cy: number }
  | null;
let gesture: Gesture = null;
const pointers = new Map<number, { x: number; y: number }>();

function local(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const r = canvas.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function cellAt(x: number, y: number) {
  return state.doc ? cellAtPoint(state.doc, view(), x, y) : null;
}

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

function onPointerDown(e: PointerEvent): void {
  if (!state.doc) return;
  canvas.value!.setPointerCapture(e.pointerId);
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    // second finger: abandon an unfinished stroke instead of committing a stray mark
    if (gesture?.kind === 'stroke' && state.editor?.endStroke()) state.editor.undo();
    gesture = { kind: 'pinch', ...pinchInfo() };
    return;
  }
  if (pointers.size > 2) return;
  // mouse: left edits, middle pans, right does nothing (context menu is suppressed)
  if (e.pointerType === 'mouse' && e.button === 2) return;
  const panning = state.tool === 'move' || spaceHeld.value || e.button === 1 || state.viewMode === 'source';
  if (panning) {
    gesture = { kind: 'pan', x: p.x, y: p.y };
    return;
  }
  if (e.pointerType === 'touch' && cell.value < MIN_TOUCH_EDIT_CELL) {
    notify('格子太小，先放大再编辑');
    gesture = { kind: 'pan', x: p.x, y: p.y };
    return;
  }
  const hit = cellAt(p.x, p.y);
  if (!hit || !state.editor) return;
  applyTool(hit, e);
}

function applyTool(hit: { row: number; col: number }, e: PointerEvent): void {
  const ed = state.editor!;
  const doc = state.doc!;
  const v = ed.cellAt(hit.row, hit.col);
  switch (state.tool) {
    case 'pen':
    case 'eraser': {
      const value = state.tool === 'eraser' ? EMPTY_CELL : state.currentColor;
      if (value === null) {
        notify('先在「用量」或「当前颜色」里选一个颜色');
        return;
      }
      ed.beginStroke(state.tool === 'eraser' ? 'erase' : 'paint');
      ed.paintCell(hit.row, hit.col, value);
      gesture = { kind: 'stroke', last: hit, value };
      return;
    }
    case 'picker':
      if (v === EMPTY_CELL) {
        notify('这一格是空的');
        return;
      }
      state.currentColor = v;
      state.tool = 'pen';
      notify(`已选 ${doc.palette[v].key}，切换到画笔`);
      return;
    case 'fill':
      if (state.currentColor === null) {
        notify('先选一个颜色');
        return;
      }
      ed.fill(hit.row, hit.col, e.altKey ? EMPTY_CELL : state.currentColor);
      return;
    case 'replace':
      if (v === EMPTY_CELL || state.currentColor === null || v === state.currentColor) {
        notify(state.currentColor === null ? '先选一个颜色' : '点一个和当前颜色不同的格子');
        return;
      }
      ed.replaceColor(v, state.currentColor);
      notify(`已把全部 ${doc.palette[v].key} 换成 ${doc.palette[state.currentColor].key}（可撤销）`);
      return;
  }
}

function onPointerMove(e: PointerEvent): void {
  const p = local(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  const g = gesture;
  if (g?.kind === 'pinch' && pointers.size >= 2) {
    const now = pinchInfo();
    ox.value += now.cx - g.cx;
    oy.value += now.cy - g.cy;
    zoomAt(now.dist / Math.max(1, g.dist), now.cx, now.cy);
    gesture = { kind: 'pinch', ...now };
    requestDraw();
    return;
  }
  if (g?.kind === 'pan') {
    ox.value += p.x - g.x;
    oy.value += p.y - g.y;
    viewTouched = true;
    g.x = p.x;
    g.y = p.y;
    requestDraw();
    return;
  }
  const hit = cellAt(p.x, p.y);
  const changed = hit?.row !== hover.value?.row || hit?.col !== hover.value?.col;
  hover.value = hit;
  // the stroke was closed elsewhere (e.g. undo pressed mid-stroke): stop painting
  if (g?.kind === 'stroke' && !state.editor?.stroking) gesture = null;
  else if (g?.kind === 'stroke' && hit && state.editor) {
    state.editor.paintLine(g.last.row, g.last.col, hit.row, hit.col, g.value);
    g.last = hit;
  }
  if (changed) requestDraw();
}

function onPointerUp(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (gesture?.kind === 'stroke') state.editor?.endStroke();
  if (gesture?.kind === 'pinch' && pointers.size === 1) {
    const [p] = [...pointers.values()];
    gesture = { kind: 'pan', x: p.x, y: p.y };
    return;
  }
  if (pointers.size === 0) gesture = null;
}

function onLeave(): void {
  if (!gesture) {
    hover.value = null;
    requestDraw();
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const p = local(e);
  // trackpad pinch arrives as ctrl+wheel with small deltas
  const k = e.ctrlKey ? 0.01 : 0.0015;
  zoomAt(Math.exp(-e.deltaY * k), p.x, p.y);
}

function onKey(e: KeyboardEvent): void {
  if (e.code !== 'Space') return;
  const target = e.target as HTMLElement | null;
  if (e.type === 'keyup') {
    spaceHeld.value = false;
    return;
  }
  if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
  spaceHeld.value = true;
  if (e.type === 'keydown') e.preventDefault();
}

/** A key-up lost to another window or field would otherwise leave temporary panning on. */
function releaseSpace(): void {
  spaceHeld.value = false;
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(resize);
  ro.observe(wrap.value!);
  canvas.value!.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', releaseSpace);
  resize();
});
onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKey);
  window.removeEventListener('blur', releaseSpace);
  cancelAnimationFrame(raf);
});

watch(
  () => [state.version, state.viewMode, state.showGrid, state.showCodes, state.highlight, state.tool],
  () => requestDraw(),
);
watch(
  () => state.doc,
  (d, old) => {
    // a new pattern of a different size gets re-fitted; regenerating at the same size keeps the view
    if (!d || !old || d.cols !== old.cols || d.rows !== old.rows) fitted = false;
    if (!fitted) fit();
    requestDraw();
  },
);

const cursor = computed(() => {
  if (state.tool === 'move' || spaceHeld.value || state.viewMode === 'source') return gesture?.kind === 'pan' ? 'grabbing' : 'grab';
  return 'crosshair';
});
</script>

<template>
  <div class="canvas-area">
    <div ref="wrap" class="canvas-wrap">
      <canvas
        ref="canvas"
        :style="{ cursor }"
        role="img"
        :aria-label="state.doc ? `拼豆图纸 ${state.doc.cols} × ${state.doc.rows} 格` : '画布'"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onLeave"
        @contextmenu.prevent
      />
      <div v-if="state.generating" class="busy" role="status">正在生成…</div>
    </div>
    <div class="canvas-bar">
      <div class="zoom">
        <button class="btn icon" aria-label="缩小" @click="zoomBy(1 / 1.25)">−</button>
        <span class="num">{{ zoomPercent }}%</span>
        <button class="btn icon" aria-label="放大" @click="zoomBy(1.25)">+</button>
        <button class="btn ghost" @click="fit">适应</button>
      </div>
      <div class="pos num" aria-live="off">{{ hoverLabel }}</div>
      <button class="current" :aria-label="current ? `当前颜色 ${current.key}，点击更换` : '选择当前颜色'" @click="state.dialog = 'palette'">
        <span class="swatch" :style="{ background: current?.hex ?? 'transparent' }" :class="{ none: !current }" />
        <span>{{ current ? current.key : '选颜色' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.canvas-area {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 220px;
  background: var(--canvas);
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
}
canvas {
  /* out of flow: its pixel size must not feed back into the wrapper's flex size */
  position: absolute;
  inset: 0;
  display: block;
  touch-action: none;
}
.busy {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(238 241 239 / 0.7);
  font-weight: 600;
  color: var(--ink);
}
.canvas-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 2px 0;
  min-height: 52px;
  flex-wrap: wrap;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zoom .num {
  min-width: 48px;
  text-align: center;
}
.pos {
  flex: 1;
  color: var(--muted);
  font-size: 13px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.current {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  font-weight: 600;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgb(0 0 0 / 0.25);
}
.swatch.none {
  background: repeating-linear-gradient(45deg, #fff 0 4px, #e2e7e4 4px 8px) !important;
}
</style>
