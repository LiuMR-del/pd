<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Rect } from '../lib/image';
import { setCrop, state } from '../store';
import Modal from './Modal.vue';

const src = state.source!;
const stage = ref<HTMLCanvasElement | null>(null);
const box = ref<HTMLDivElement | null>(null);
const scale = ref(1);
const rect = ref<Rect>(state.crop ? { ...state.crop } : { x: 0, y: 0, w: src.width, h: src.height });
const MIN = 16;

onMounted(() => {
  const maxW = Math.min(680, window.innerWidth - 48);
  const maxH = Math.min(520, window.innerHeight * 0.6);
  scale.value = Math.min(maxW / src.width, maxH / src.height, 1);
  const c = stage.value!;
  c.width = Math.round(src.width * scale.value);
  c.height = Math.round(src.height * scale.value);
  c.getContext('2d')!.drawImage(src.canvas, 0, 0, c.width, c.height);
});

const style = computed(() => {
  const k = scale.value;
  const r = rect.value;
  return { left: `${r.x * k}px`, top: `${r.y * k}px`, width: `${r.w * k}px`, height: `${r.h * k}px` };
});
const label = computed(() => `${Math.round(rect.value.w)} × ${Math.round(rect.value.h)} 像素`);

type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; start: Rect };
let drag: Drag | null = null;

function down(mode: Drag['mode'], e: PointerEvent): void {
  e.stopPropagation();
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  drag = { mode, x: e.clientX, y: e.clientY, start: { ...rect.value } };
}
function move(e: PointerEvent): void {
  if (!drag) return;
  const dx = (e.clientX - drag.x) / scale.value;
  const dy = (e.clientY - drag.y) / scale.value;
  const s = drag.start;
  let { x, y, w, h } = s;
  if (drag.mode === 'move') {
    x = Math.max(0, Math.min(src.width - w, s.x + dx));
    y = Math.max(0, Math.min(src.height - h, s.y + dy));
  } else {
    let x0 = s.x;
    let y0 = s.y;
    let x1 = s.x + s.w;
    let y1 = s.y + s.h;
    if (drag.mode.includes('w')) x0 = Math.max(0, Math.min(x1 - MIN, s.x + dx));
    if (drag.mode.includes('e')) x1 = Math.min(src.width, Math.max(x0 + MIN, s.x + s.w + dx));
    if (drag.mode.includes('n')) y0 = Math.max(0, Math.min(y1 - MIN, s.y + dy));
    if (drag.mode.includes('s')) y1 = Math.min(src.height, Math.max(y0 + MIN, s.y + s.h + dy));
    x = x0;
    y = y0;
    w = x1 - x0;
    h = y1 - y0;
  }
  rect.value = { x, y, w, h };
}
function up(): void {
  drag = null;
}
function square(): void {
  const side = Math.min(src.width, src.height);
  rect.value = { x: (src.width - side) / 2, y: (src.height - side) / 2, w: side, h: side };
}
function whole(): void {
  rect.value = { x: 0, y: 0, w: src.width, h: src.height };
}
function done(): void {
  const r = rect.value;
  const full = r.x <= 0.5 && r.y <= 0.5 && r.w >= src.width - 1 && r.h >= src.height - 1;
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  // rounding x and w separately could reach one pixel past the image edge
  setCrop(full ? null : { x, y, w: Math.min(Math.round(r.w), src.width - x), h: Math.min(Math.round(r.h), src.height - y) });
  state.dialog = null;
}
</script>

<template>
  <Modal title="裁剪图片" :width="760" @close="state.dialog = null">
    <div class="tools">
      <button class="btn secondary" @click="whole">整张图</button>
      <button class="btn secondary" @click="square">正方形</button>
      <span class="size num">{{ label }}</span>
    </div>
    <div ref="box" class="stage" @pointermove="move" @pointerup="up" @pointercancel="up">
      <canvas ref="stage" />
      <div class="crop" :style="style" @pointerdown="down('move', $event)">
        <span v-for="h in ['nw', 'ne', 'sw', 'se'] as const" :key="h" :class="['handle', h]" @pointerdown="down(h, $event)" />
      </div>
    </div>
    <p class="help">拖动方框移动，拖四个角调整大小。只裁剪需要的部分，图纸的格子会更集中在主体上。</p>
    <template #footer>
      <button class="btn secondary" @click="state.dialog = null">取消</button>
      <button class="btn primary" @click="done">完成裁剪</button>
    </template>
  </Modal>
</template>

<style scoped>
.tools {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.size {
  margin-left: auto;
  color: var(--muted);
  font-size: 13px;
}
.stage {
  position: relative;
  width: fit-content;
  margin: 0 auto;
  touch-action: none;
  user-select: none;
}
canvas {
  display: block;
  border-radius: 6px;
}
.crop {
  position: absolute;
  border: 2px solid #fff;
  outline: 1px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.45);
  cursor: move;
}
.handle {
  position: absolute;
  width: 22px;
  height: 22px;
  background: #fff;
  border: 2px solid var(--primary);
  border-radius: 50%;
}
.nw {
  left: -12px;
  top: -12px;
  cursor: nwse-resize;
}
.ne {
  right: -12px;
  top: -12px;
  cursor: nesw-resize;
}
.sw {
  left: -12px;
  bottom: -12px;
  cursor: nesw-resize;
}
.se {
  right: -12px;
  bottom: -12px;
  cursor: nwse-resize;
}
.stage {
  overflow: hidden;
  border-radius: 6px;
}
.help {
  color: var(--muted);
  font-size: 13px;
}
</style>
