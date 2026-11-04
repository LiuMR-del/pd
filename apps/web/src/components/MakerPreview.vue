<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { beadCount, docFromPattern, type PatternDoc } from '@pd/editor-core';
import { MakerError } from '@pd/makers';
import { drawPattern } from '@pd/render';
import { makePattern } from '../lib/makers';
import { makerSettings, state } from '../store';

/** Live preview of a text / QR pattern before it is created. */
const wrap = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const preview = shallowRef<{ doc: PatternDoc | null; error: string }>({ doc: null, error: '' });
let timer: ReturnType<typeof setTimeout> | undefined;

function compute(): void {
  const ms = makerSettings();
  if (!ms || state.kind === 'image') return;
  if (!ms.text.trim()) {
    preview.value = { doc: null, error: state.kind === 'qr' ? '在右侧输入网址或文字' : '在右侧输入文字' };
    return;
  }
  try {
    const r = makePattern(state.kind, ms, state.settings.brand, state.settings.tier);
    preview.value = { doc: docFromPattern(r, { id: 'preview', name: '', brand: state.settings.brand, tier: String(state.settings.tier) }), error: '' };
  } catch (e) {
    preview.value = { doc: null, error: e instanceof MakerError ? e.message : String(e) };
  }
}

function draw(): void {
  const c = canvas.value;
  const box = wrap.value;
  const doc = preview.value.doc;
  if (!c || !box) return;
  const dpr = window.devicePixelRatio || 1;
  const w = box.clientWidth;
  const h = box.clientHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  if (!doc) return;
  const pad = 16 * dpr;
  const cell = Math.max(1, Math.floor(Math.min((c.width - 2 * pad) / doc.cols, (c.height - 2 * pad) / doc.rows)));
  const ox = Math.round((c.width - cell * doc.cols) / 2);
  const oy = Math.round((c.height - cell * doc.rows) / 2);
  drawPattern(ctx, doc, { cellSize: cell, offsetX: ox, offsetY: oy, width: c.width, height: c.height, showGrid: true, showCodes: false });
}

const info = computed(() => {
  const d = preview.value.doc;
  return d ? `${d.cols} × ${d.rows} 格 · ${beadCount(d).toLocaleString()} 颗` : '';
});

watch(
  () => [state.kind, state.textSettings, state.qrSettings, state.settings.brand, state.settings.tier],
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      compute();
      draw();
    }, 120);
  },
  { deep: true },
);

let ro: ResizeObserver | null = null;
onMounted(() => {
  compute();
  draw();
  ro = new ResizeObserver(() => draw());
  if (wrap.value) ro.observe(wrap.value);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  ro?.disconnect();
});
</script>

<template>
  <div class="maker-preview">
    <div ref="wrap" class="stage">
      <canvas ref="canvas" aria-label="图纸预览" />
      <p v-if="preview.error" class="msg" role="status">{{ preview.error }}</p>
    </div>
    <p v-if="info" class="info num">预览 · {{ info }}</p>
  </div>
</template>

<style scoped>
.maker-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 220px;
  background: var(--canvas);
  border-radius: 12px;
  overflow: hidden;
}
canvas {
  position: absolute;
  inset: 0;
}
.msg {
  position: absolute;
  inset: 0;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
.info {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
}
</style>
