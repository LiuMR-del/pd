<script setup lang="ts">
import { onLoad, onReady, onUnload } from '@dcloudio/uni-app';
import { normalizeSettings, toPatternOptions, type Settings } from '@pd/app-shared';
import { beadCount, colorUsage, docFromPattern, type PatternDoc } from '@pd/editor-core';
import { getPalette } from '@pd/palettes';
import type { RgbaImage } from '@pd/pattern-core';
import { drawPattern, type Ctx2D } from '@pd/render';
import { computed, getCurrentInstance, ref, shallowRef, watch } from 'vue';
import SettingsPanel from '../../components/SettingsPanel.vue';
import { dragRect, fullRect, hitHandle, isFull, scaleRect, type Handle, type Rect, type Size } from '../../lib/crop';
import { CancelledError, Generator } from '../../lib/generator';
import { decodeImage, loadCanvasImage } from '../../lib/image';
import { loadLastSettings, saveLastSettings } from '../../lib/last-settings';
import { queryCanvas, touchPoint, type CanvasHandle } from '../../lib/mp-canvas';
import { createMpWorker } from '../../lib/mp-worker';
import { cropRgba } from '../../lib/pixels';
import { fitContain, type Fit } from '../../lib/view';

// 1b-2: picked photo → optional crop → settings → worker generation → pattern on the canvas.
// Editing tools (1b-3), saving / export (1b-4) come later on this same page.

const instance = getCurrentInstance();
const generator = new Generator(createMpWorker);

const src = ref('');
const settings = ref<Settings>(loadLastSettings());
const generating = ref(false);
const error = ref('');
const doc = shallowRef<PatternDoc | null>(null);
const viewMode = ref<'pattern' | 'source'>('pattern');
/** Crop box in preview-image pixels; null = whole image. */
const crop = ref<Rect | null>(null);
const cropping = ref(false);
/** Settings + crop the current pattern was made with (to offer "regenerate with new settings"). */
const appliedKey = ref('');

let board: CanvasHandle | null = null;
/** The photo loaded by the on-screen canvas (preview and crop). */
let preview: MpImage | null = null;
/** Downscaled RGBA pixels of the photo, decoded on first generation. */
let decoded: RgbaImage | null = null;
let cropBefore: Rect | null = null;
const workId = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const imageSize = (): Size => ({ w: preview?.width ?? 1, h: preview?.height ?? 1 });
const currentKey = () => JSON.stringify({ s: normalizeSettings(settings.value), c: crop.value });
const stale = computed(() => !!doc.value && appliedKey.value !== currentKey());
const summary = computed(() => {
  const d = doc.value;
  return d ? `${d.cols}×${d.rows} 格 · ${colorUsage(d).length} 色 · ${beadCount(d)} 颗` : '';
});
const showingPattern = computed(() => !!doc.value && viewMode.value === 'pattern' && !cropping.value);

onLoad((query) => {
  const raw = String((query as Record<string, string> | undefined)?.src ?? '');
  try {
    src.value = decodeURIComponent(raw);
  } catch {
    src.value = raw;
  }
});

onReady(async () => {
  try {
    board = await queryCanvas(instance?.proxy, '#board');
    if (!src.value) throw new Error('没有收到图片，请返回首页重新选择');
    preview = await loadCanvasImage(board.canvas, src.value);
    draw();
  } catch (e) {
    error.value = messageOf(e);
  }
});

onUnload(() => generator.dispose());

watch([viewMode, cropping], () => draw());

// --- drawing ------------------------------------------------------------------------------

function previewFit(): Fit {
  const s = imageSize();
  return fitContain(s.w, s.h, board?.width ?? 1, board?.height ?? 1, 12);
}

function toScreen(r: Rect, f: Fit): Rect {
  return { x: f.x + r.x * f.scale, y: f.y + r.y * f.scale, w: r.w * f.scale, h: r.h * f.scale };
}

function draw(): void {
  const b = board;
  if (!b) return;
  const ctx = b.ctx;
  ctx.fillStyle = '#EEF1EF';
  ctx.fillRect(0, 0, b.width, b.height);
  const d = doc.value;
  if (showingPattern.value && d) {
    const f = fitContain(d.cols, d.rows, b.width, b.height, 12, 1, 80);
    drawPattern(ctx as unknown as Ctx2D, d, { cellSize: f.scale, offsetX: f.x, offsetY: f.y, width: b.width, height: b.height, showGrid: true, showCodes: true });
    return;
  }
  if (!preview) return;
  const f = previewFit();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(preview, f.x, f.y, preview.width * f.scale, preview.height * f.scale);
  const r = crop.value ?? (cropping.value ? fullRect(imageSize()) : null);
  if (!r) return;
  const box = toScreen(r, f);
  if (cropping.value) {
    // dim everything outside the box, then the box frame and its corner handles
    const imgBox = toScreen(fullRect(imageSize()), f);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(imgBox.x, imgBox.y, imgBox.w, box.y - imgBox.y);
    ctx.fillRect(imgBox.x, box.y + box.h, imgBox.w, imgBox.y + imgBox.h - box.y - box.h);
    ctx.fillRect(imgBox.x, box.y, box.x - imgBox.x, box.h);
    ctx.fillRect(box.x + box.w, box.y, imgBox.x + imgBox.w - box.x - box.w, box.h);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = '#FFFFFF';
    for (const [cx, cy] of [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x, box.y + box.h],
      [box.x + box.w, box.y + box.h],
    ]) {
      ctx.fillRect(cx - 7, cy - 7, 14, 14);
    }
  } else {
    ctx.strokeStyle = '#0F766E';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);
  }
}

// --- crop ---------------------------------------------------------------------------------

type TouchList = { touches?: { x?: number; y?: number; clientX?: number; clientY?: number }[] };
let drag: { handle: Handle; x: number; y: number; start: Rect } | null = null;

function startCrop(): void {
  if (!preview || generating.value) return;
  cropBefore = crop.value;
  crop.value = crop.value ?? fullRect(imageSize());
  viewMode.value = 'source';
  cropping.value = true;
}

function finishCrop(): void {
  if (crop.value && isFull(crop.value, imageSize())) crop.value = null;
  cropping.value = false;
  draw();
}

function cancelCrop(): void {
  crop.value = cropBefore;
  cropping.value = false;
  draw();
}

function resetCrop(): void {
  crop.value = fullRect(imageSize());
  draw();
}

function onTouchStart(e: unknown): void {
  const t = (e as TouchList).touches?.[0];
  if (!cropping.value || !board || !t || !crop.value) return;
  const p = touchPoint(t, board);
  const h = hitHandle(toScreen(crop.value, previewFit()), p.x, p.y, 24);
  drag = h ? { handle: h, x: p.x, y: p.y, start: { ...crop.value } } : null;
}

function onTouchMove(e: unknown): void {
  const t = (e as TouchList).touches?.[0];
  if (!drag || !board || !t) return;
  const p = touchPoint(t, board);
  const k = previewFit().scale;
  crop.value = dragRect(drag.start, drag.handle, (p.x - drag.x) / k, (p.y - drag.y) / k, imageSize());
  draw();
}

function onTouchEnd(): void {
  drag = null;
}

// --- generation ---------------------------------------------------------------------------

async function generate(): Promise<void> {
  if (generating.value || cropping.value || !preview || !src.value) return;
  error.value = '';
  generating.value = true;
  const s = normalizeSettings(settings.value);
  settings.value = s;
  saveLastSettings(s);
  const usedCrop = crop.value ? { ...crop.value } : null;
  try {
    if (!decoded) decoded = await decodeImage(src.value);
    const input = usedCrop ? cropRgba(decoded, scaleRect(usedCrop, decoded.width / preview.width)) : decoded;
    const result = await generator.generate(input, getPalette(s.brand, s.tier), toPatternOptions(s));
    if (result.meta.empty) {
      error.value =
        result.meta.emptyReason === 'background'
          ? '整张图都被当成背景去掉了。请关闭「去掉背景」，或裁剪到主体后再试。'
          : '图片是全透明的，没有可以转换的内容。';
      return;
    }
    doc.value = docFromPattern(result, { id: workId, name: '新图纸', brand: s.brand, tier: String(s.tier), settings: { kind: 'image', settings: s, crop: usedCrop } });
    appliedKey.value = JSON.stringify({ s, c: usedCrop });
    viewMode.value = 'pattern';
    draw();
  } catch (e) {
    if (!(e instanceof CancelledError)) error.value = `生成失败：${messageOf(e)}`;
  } finally {
    generating.value = false;
  }
}

function cancelGenerate(): void {
  generator.cancel();
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
</script>

<template>
  <view class="page">
    <view class="board-wrap">
      <canvas id="board" type="2d" class="board" :disable-scroll="cropping" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd" />
      <view v-if="generating" class="busy">
        <view class="busy-text">正在生成…</view>
        <button size="mini" @tap="cancelGenerate">取消</button>
      </view>
    </view>

    <view v-if="cropping" class="bar">
      <view class="muted">拖动框移动，拖四个角调整大小</view>
      <view class="bar-actions">
        <button size="mini" @tap="resetCrop">全图</button>
        <button size="mini" @tap="cancelCrop">取消</button>
        <button size="mini" class="btn-primary" @tap="finishCrop">完成</button>
      </view>
    </view>
    <view v-else class="bar">
      <view v-if="doc" class="seg">
        <view class="seg-item" :class="{ on: viewMode === 'pattern' }" @tap="viewMode = 'pattern'">图纸</view>
        <view class="seg-item" :class="{ on: viewMode === 'source' }" @tap="viewMode = 'source'">原图</view>
      </view>
      <view class="summary">{{ summary }}</view>
      <button size="mini" :disabled="generating" @tap="startCrop">{{ crop ? '调整裁剪' : '裁剪' }}</button>
    </view>

    <view v-if="error" class="error">{{ error }}</view>

    <SettingsPanel v-model="settings" :disabled="generating || cropping" />

    <button class="btn btn-primary generate" :disabled="generating || cropping || !src" @tap="generate">
      {{ !doc ? '生成图纸' : stale ? '按新设置重新生成' : '重新生成' }}
    </button>
  </view>
</template>

<style>
.page {
  padding: 24rpx;
}
.board-wrap {
  position: relative;
  border-radius: 16rpx;
  overflow: hidden;
  background: #eef1ef;
}
.board {
  display: block;
  width: 100%;
  height: 680rpx;
}
.busy {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(238, 241, 239, 0.75);
}
.busy-text {
  font-weight: 600;
  margin-bottom: 16rpx;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  margin: 8rpx 0 16rpx;
}
.bar .muted {
  flex: 1;
  min-width: 0;
  margin-right: 12rpx;
}
.bar button {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 0 24rpx;
}
.bar-actions {
  display: flex;
  flex-shrink: 0;
}
.bar-actions button {
  margin-left: 12rpx;
}
.summary {
  flex: 1;
  min-width: 0;
  margin: 0 12rpx;
  font-size: 24rpx;
  color: #333;
}
.seg {
  display: flex;
  border: 1rpx solid #d0d7d4;
  border-radius: 12rpx;
  overflow: hidden;
  flex-shrink: 0;
}
.seg-item {
  padding: 10rpx 20rpx;
  font-size: 26rpx;
}
.seg-item.on {
  background: #0f766e;
  color: #fff;
}
.error {
  background: #fdecec;
  color: #b42318;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
  margin-bottom: 16rpx;
  font-size: 26rpx;
}
.generate {
  margin-top: 24rpx;
}
</style>
