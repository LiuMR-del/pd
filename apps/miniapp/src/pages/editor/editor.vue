<script setup lang="ts">
import { onLoad, onReady, onUnload } from '@dcloudio/uni-app';
import { normalizeSettings, toPatternOptions, type Settings } from '@pd/app-shared';
import { beadCount, colorUsage, docFromPattern, EMPTY_CELL, PatternEditor, type PaletteEntry, type PatternDoc } from '@pd/editor-core';
import { getPalette } from '@pd/palettes';
import type { RgbaImage } from '@pd/pattern-core';
import { cellAtPoint, drawPattern, type Ctx2D, type PatternView } from '@pd/render';
import { computed, getCurrentInstance, ref, shallowRef, watch } from 'vue';
import ColorSheet from '../../components/ColorSheet.vue';
import SettingsPanel from '../../components/SettingsPanel.vue';
import UsageSheet from '../../components/UsageSheet.vue';
import { dragRect, fullRect, hitHandle, isFull, scaleRect, type Handle, type Rect, type Size } from '../../lib/crop';
import { CancelledError, Generator } from '../../lib/generator';
import { decodeImage, loadCanvasImage } from '../../lib/image';
import { loadLastSettings, saveLastSettings } from '../../lib/last-settings';
import { queryCanvas, touchPoint, type CanvasHandle } from '../../lib/mp-canvas';
import { createMpWorker } from '../../lib/mp-worker';
import { cropRgba } from '../../lib/pixels';
import { fitContain, type Fit } from '../../lib/view';
import { fitViewport, keepVisible, MIN_TOUCH_EDIT_CELL, pan, pinchOf, pinchStep, zoomAt, type Pinch, type Viewport } from '../../lib/viewport';

// Picked photo → optional crop → settings → worker generation → pattern on the canvas (1b-2),
// then touch editing: tools, undo / redo, pinch zoom, usage and color sheets (1b-3).
// Saving works / export (1b-4) come later on this same page.

type Tool = 'move' | 'pen' | 'eraser' | 'picker' | 'fill' | 'replace';
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'move', label: '移动' },
  { id: 'pen', label: '画笔' },
  { id: 'eraser', label: '橡皮' },
  { id: 'picker', label: '取色' },
  { id: 'fill', label: '填充' },
  { id: 'replace', label: '换色' },
];

const instance = getCurrentInstance();
const generator = new Generator(createMpWorker);

const src = ref('');
const settings = ref<Settings>(loadLastSettings());
const generating = ref(false);
const error = ref('');
const doc = shallowRef<PatternDoc | null>(null);
const editor = shallowRef<PatternEditor | null>(null);
/** Bumped on every edit (the doc is mutated in place, so computed values depend on this). */
const version = ref(0);
/** The pattern was changed by hand since it was generated. */
const edited = ref(false);
const viewMode = ref<'pattern' | 'source'>('pattern');
const tool = ref<Tool>('move');
const currentColor = ref<number | null>(null);
const highlight = ref<number | null>(null);
const sheet = ref<'usage' | 'color' | null>(null);
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
let vp: Viewport = { cell: 10, ox: 0, oy: 0 };
let unsubscribe: (() => void) | null = null;
const workId = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const imageSize = (): Size => ({ w: preview?.width ?? 1, h: preview?.height ?? 1 });
const currentKey = () => JSON.stringify({ s: normalizeSettings(settings.value), c: crop.value });
const stale = computed(() => !!doc.value && appliedKey.value !== currentKey());
const summary = computed(() => {
  void version.value;
  const d = doc.value;
  return d ? `${d.cols}×${d.rows} 格 · ${colorUsage(d).length} 色 · ${beadCount(d)} 颗` : '';
});
const showingPattern = computed(() => !!doc.value && viewMode.value === 'pattern' && !cropping.value);
const canUndo = computed(() => (void version.value, !!editor.value?.canUndo));
const canRedo = computed(() => (void version.value, !!editor.value?.canRedo));
const current = computed<PaletteEntry | null>(() => {
  void version.value;
  const i = currentColor.value;
  return i !== null && doc.value && i < doc.value.palette.length ? doc.value.palette[i] : null;
});

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

onUnload(() => {
  generator.dispose();
  unsubscribe?.();
});

watch([viewMode, cropping, highlight], () => requestDraw());

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

// --- drawing ------------------------------------------------------------------------------

let drawPending = false;
/** Coalesce redraws to one per frame (touch moves arrive faster than the screen refreshes). */
function requestDraw(): void {
  const b = board;
  if (!b || drawPending) return;
  if (!b.canvas.requestAnimationFrame) {
    draw();
    return;
  }
  drawPending = true;
  b.canvas.requestAnimationFrame(() => {
    drawPending = false;
    draw();
  });
}

function patternView(): PatternView {
  return {
    cellSize: vp.cell,
    offsetX: vp.ox,
    offsetY: vp.oy,
    width: board?.width ?? 1,
    height: board?.height ?? 1,
    showGrid: true,
    showCodes: true,
    highlight: highlight.value,
  };
}

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
    drawPattern(ctx as unknown as Ctx2D, d, patternView());
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

function fitView(): void {
  const d = doc.value;
  if (!d || !board) return;
  vp = fitViewport(d.cols, d.rows, board.width, board.height);
  requestDraw();
}

function zoomBy(factor: number): void {
  if (!board || !doc.value) return;
  vp = zoomAt(vp, factor, board.width / 2, board.height / 2);
  requestDraw();
}

// --- touch: crop box, or editing / pan / pinch on the pattern -------------------------------

type TouchPoint = { x?: number; y?: number; clientX?: number; clientY?: number };
type TouchLike = { touches?: TouchPoint[] };
type Gesture =
  | { kind: 'crop'; handle: Handle; x: number; y: number; start: Rect }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'stroke'; last: { row: number; col: number }; value: number }
  | { kind: 'pinch'; p: Pinch }
  | null;
let gesture: Gesture = null;

function pointsOf(e: unknown): { x: number; y: number }[] {
  const b = board;
  const touches = (e as TouchLike).touches ?? [];
  return b ? touches.map((t) => touchPoint(t, b)) : [];
}

function onTouchStart(e: unknown): void {
  const pts = pointsOf(e);
  if (!pts.length || !board) return;
  if (cropping.value) {
    if (!crop.value) return;
    const h = hitHandle(toScreen(crop.value, previewFit()), pts[0].x, pts[0].y, 24);
    gesture = h ? { kind: 'crop', handle: h, x: pts[0].x, y: pts[0].y, start: { ...crop.value } } : null;
    return;
  }
  const d = doc.value;
  const ed = editor.value;
  if (!showingPattern.value || !d || !ed) return;
  if (pts.length >= 2) {
    // second finger: abandon an unfinished stroke instead of committing a stray mark
    if (gesture?.kind === 'stroke' && ed.endStroke()) ed.undo();
    gesture = { kind: 'pinch', p: pinchOf(pts[0], pts[1]) };
    return;
  }
  const p = pts[0];
  if (tool.value === 'move') {
    gesture = { kind: 'pan', x: p.x, y: p.y };
    return;
  }
  if (vp.cell < MIN_TOUCH_EDIT_CELL) {
    toast('格子太小，先放大再编辑');
    gesture = { kind: 'pan', x: p.x, y: p.y };
    return;
  }
  const hit = cellAtPoint(d, patternView(), p.x, p.y);
  if (hit) applyTool(hit);
}

function applyTool(hit: { row: number; col: number }): void {
  const ed = editor.value!;
  const d = doc.value!;
  const v = ed.cellAt(hit.row, hit.col);
  switch (tool.value) {
    case 'pen':
    case 'eraser': {
      const value = tool.value === 'eraser' ? EMPTY_CELL : currentColor.value;
      if (value === null) {
        toast('先点「颜色」选一个颜色');
        return;
      }
      ed.beginStroke(tool.value === 'eraser' ? 'erase' : 'paint');
      ed.paintCell(hit.row, hit.col, value);
      gesture = { kind: 'stroke', last: hit, value };
      return;
    }
    case 'picker':
      if (v === EMPTY_CELL) {
        toast('这一格是空的');
        return;
      }
      currentColor.value = v;
      tool.value = 'pen';
      toast(`已选 ${d.palette[v].key}，切换到画笔`);
      return;
    case 'fill':
      if (currentColor.value === null) {
        toast('先点「颜色」选一个颜色');
        return;
      }
      ed.fill(hit.row, hit.col, currentColor.value);
      return;
    case 'replace':
      if (currentColor.value === null) {
        toast('先点「颜色」选一个颜色');
        return;
      }
      if (v === EMPTY_CELL || v === currentColor.value) {
        toast('点一个和当前颜色不同的格子');
        return;
      }
      ed.replaceColor(v, currentColor.value);
      toast(`已把全部 ${d.palette[v].key} 换成 ${d.palette[currentColor.value].key}`);
      return;
  }
}

function onTouchMove(e: unknown): void {
  const pts = pointsOf(e);
  const g = gesture;
  const b = board;
  if (!g || !pts.length || !b) return;
  if (g.kind === 'crop') {
    const k = previewFit().scale;
    crop.value = dragRect(g.start, g.handle, (pts[0].x - g.x) / k, (pts[0].y - g.y) / k, imageSize());
    draw();
    return;
  }
  const d = doc.value;
  if (!d) return;
  if (g.kind === 'pinch') {
    if (pts.length < 2) return;
    const now = pinchOf(pts[0], pts[1]);
    vp = keepVisible(pinchStep(vp, g.p, now), d.cols, d.rows, b.width, b.height);
    g.p = now;
    requestDraw();
    return;
  }
  if (g.kind === 'pan') {
    vp = keepVisible(pan(vp, pts[0].x - g.x, pts[0].y - g.y), d.cols, d.rows, b.width, b.height);
    g.x = pts[0].x;
    g.y = pts[0].y;
    requestDraw();
    return;
  }
  const ed = editor.value;
  // the stroke was closed elsewhere (e.g. undo pressed mid-stroke): stop painting
  if (!ed?.stroking) {
    gesture = null;
    return;
  }
  const hit = cellAtPoint(d, patternView(), pts[0].x, pts[0].y);
  if (hit) {
    ed.paintLine(g.last.row, g.last.col, hit.row, hit.col, g.value);
    g.last = hit;
  }
}

function onTouchEnd(e: unknown): void {
  const left = pointsOf(e);
  const g = gesture;
  if (g?.kind === 'stroke') editor.value?.endStroke();
  if (g?.kind === 'pinch' && left.length === 1) {
    gesture = { kind: 'pan', x: left[0].x, y: left[0].y };
    return;
  }
  if (left.length === 0) gesture = null;
}

// --- crop ---------------------------------------------------------------------------------

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

// --- editing commands -----------------------------------------------------------------------

function attach(next: PatternDoc): void {
  unsubscribe?.();
  const sameSize = !!doc.value && doc.value.cols === next.cols && doc.value.rows === next.rows;
  const ed = new PatternEditor(next);
  unsubscribe = ed.subscribe(() => {
    version.value++;
    edited.value = true;
    requestDraw();
  });
  doc.value = next;
  editor.value = ed;
  // palette indices change with every generation: the old current / highlighted color would point elsewhere
  currentColor.value = null;
  highlight.value = null;
  edited.value = false;
  version.value++;
  // regenerating at the same size keeps the view; a new size is re-fitted
  if (!sameSize && board) vp = fitViewport(next.cols, next.rows, board.width, board.height);
}

function undo(): void {
  editor.value?.undo();
}

function redo(): void {
  editor.value?.redo();
}

function mirror(): void {
  if (editor.value?.mirrorHorizontal()) toast('已左右翻转（可撤销）');
}

function toggleSheet(which: 'usage' | 'color'): void {
  sheet.value = sheet.value === which ? null : which;
}

function pickColor(entry: PaletteEntry): void {
  const ed = editor.value;
  if (!ed) return;
  currentColor.value = ed.ensureColor(entry);
  sheet.value = null;
  if (tool.value === 'move' || tool.value === 'eraser' || tool.value === 'picker') tool.value = 'pen';
}

function useColor(index: number): void {
  currentColor.value = index;
  sheet.value = null;
  if (tool.value === 'move' || tool.value === 'eraser' || tool.value === 'picker') tool.value = 'pen';
}

// --- generation ---------------------------------------------------------------------------

function confirmOverwrite(): Promise<boolean> {
  if (!edited.value) return Promise.resolve(true);
  return new Promise((resolve) => {
    uni.showModal({
      title: '重新生成会覆盖手工修改',
      content: '当前图纸上的手工修改会被新生成的图纸替换。确定重新生成吗？',
      confirmText: '重新生成',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    });
  });
}

async function generate(): Promise<void> {
  if (generating.value || cropping.value || !preview || !src.value) return;
  if (!(await confirmOverwrite())) return;
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
    attach(docFromPattern(result, { id: workId, name: '新图纸', brand: s.brand, tier: String(s.tier), settings: { kind: 'image', settings: s, crop: usedCrop } }));
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
      <canvas
        id="board"
        type="2d"
        class="board"
        :disable-scroll="cropping || showingPattern"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      />
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

    <view v-if="doc && showingPattern" class="tools">
      <view class="seg tool-seg">
        <view v-for="t in TOOLS" :key="t.id" class="seg-item tool" :class="{ on: tool === t.id }" @tap="tool = t.id">{{ t.label }}</view>
      </view>
      <view class="actions">
        <button size="mini" class="act-undo" :disabled="!canUndo" @tap="undo">撤销</button>
        <button size="mini" class="act-redo" :disabled="!canRedo" @tap="redo">重做</button>
        <button size="mini" class="act-zoom-out" @tap="zoomBy(1 / 1.5)">－</button>
        <button size="mini" class="act-zoom-in" @tap="zoomBy(1.5)">＋</button>
        <button size="mini" class="act-fit" @tap="fitView">适应</button>
        <button size="mini" class="act-mirror" @tap="mirror">翻转</button>
      </view>
      <view class="actions">
        <view class="current" @tap="toggleSheet('color')">
          <view class="swatch" :class="{ none: !current }" :style="{ background: current ? current.hex : '' }" />
          <text>{{ current ? `颜色 ${current.key}` : '选颜色' }}</text>
        </view>
        <view v-if="highlight !== null" class="hl" @tap="highlight = null">取消高亮</view>
        <button size="mini" class="act-usage" @tap="toggleSheet('usage')">{{ sheet === 'usage' ? '收起用量' : '用量' }}</button>
      </view>
    </view>

    <UsageSheet
      v-if="sheet === 'usage' && doc && showingPattern"
      :doc="doc"
      :version="version"
      :highlight="highlight"
      :current="currentColor"
      @close="sheet = null"
      @highlight="highlight = $event"
      @current="useColor"
    />
    <ColorSheet v-if="sheet === 'color' && doc && showingPattern" :doc="doc" :version="version" :current="current" @close="sheet = null" @pick="pickColor" />

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
.tools {
  background: #fff;
  border-radius: 16rpx;
  padding: 16rpx;
  margin-bottom: 16rpx;
}
.tool-seg {
  display: flex;
}
.tool {
  flex: 1;
  text-align: center;
  padding: 14rpx 0;
}
.tool + .tool {
  border-left: 1rpx solid #d0d7d4;
}
.actions {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}
.actions button {
  margin: 0 12rpx 0 0;
  padding: 0 20rpx;
  white-space: nowrap;
}
.current {
  display: flex;
  align-items: center;
  flex: 1;
  font-weight: 600;
  font-size: 26rpx;
}
.swatch {
  width: 44rpx;
  height: 44rpx;
  border-radius: 8rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.25);
  margin-right: 12rpx;
}
.swatch.none {
  background: repeating-linear-gradient(45deg, #fff 0 8rpx, #e2e7e4 8rpx 16rpx);
}
.hl {
  color: #0f766e;
  font-size: 24rpx;
  margin-right: 16rpx;
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
