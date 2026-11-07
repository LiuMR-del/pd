<script setup lang="ts">
import { onHide, onLoad, onReady, onUnload } from '@dcloudio/uni-app';
import {
  defaultQrSettings,
  defaultTextSettings,
  makePattern,
  makerName,
  normalizeQr,
  normalizeSettings,
  normalizeText,
  toPatternOptions,
  type Kind,
  type QrSettings,
  type Settings,
  type TextSettings,
} from '@pd/app-shared';
import { applyBrandConversion, beadCount, colorUsage, docFromPattern, EMPTY_CELL, PatternEditor, type ConversionPlan, type PaletteEntry, type PatternDoc } from '@pd/editor-core';
import { MakerError } from '@pd/makers';
import { getPalette } from '@pd/palettes';
import type { PatternResult, RgbaImage } from '@pd/pattern-core';
import { cellAtPoint, drawPattern, type Ctx2D, type PatternView } from '@pd/render';
import { computed, getCurrentInstance, ref, shallowRef, watch } from 'vue';
import BrandCard from '../../components/BrandCard.vue';
import ColorSheet from '../../components/ColorSheet.vue';
import ExportCard from '../../components/ExportCard.vue';
import MakerPanel from '../../components/MakerPanel.vue';
import SettingsPanel from '../../components/SettingsPanel.vue';
import UsageSheet from '../../components/UsageSheet.vue';
import { dragRect, fullRect, hitHandle, isFull, scaleRect, type Handle, type Rect, type Size } from '../../lib/crop';
import { CancelledError } from '../../lib/generator';
import { decodeImage, loadCanvasImage } from '../../lib/image';
import { loadLastSettings, saveLastSettings } from '../../lib/last-settings';
import { queryCanvas, touchPoint, type CanvasHandle } from '../../lib/mp-canvas';
import { registerEditor, workSaved } from '../../lib/cloud';
import { renderThumb, worksStore } from '../../lib/mp-files';
import { mpTextRasterizer } from '../../lib/mp-raster';
import { sharedGenerator } from '../../lib/mp-worker';
import { cropRgba } from '../../lib/pixels';
import { fitContain, type Fit } from '../../lib/view';
import { fitViewport, keepVisible, MIN_TOUCH_EDIT_CELL, pan, pinchOf, pinchStep, zoomAt, type Pinch, type Viewport } from '../../lib/viewport';
import { defaultWorkName } from '../../lib/works';

// Picked photo (?src=) or a saved work (?work=) → optional crop → settings → worker generation →
// pattern on the canvas (1b-2); touch editing: tools, undo / redo, pinch zoom, usage and color
// panels (1b-3); auto-saved to 「我的作品」 and exported to the photo album (1b-4); text / QR
// patterns (?kind=text|qr, made on the main thread) and switching brand / kit (1b-5).

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
const generator = sharedGenerator();

/** Where the pattern comes from: a photo, or made from text / a QR code. */
const kind = ref<Kind>('image');
const textSettings = ref<TextSettings>(defaultTextSettings());
const qrSettings = ref<QrSettings>(defaultQrSettings());
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
const sheet = ref<'usage' | 'color' | 'export' | 'brand' | null>(null);
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
/** Id of the work in 「我的作品」 (assigned on the first generation, or from ?work=). */
let workId = '';
/** Cloud revision this page's pattern is based on (null: not uploaded yet); see SaveOptions.baseRevision. */
let baseRevision: number | null = null;
/** Crop the current pattern was generated with (saved with the work). */
let appliedCrop: Rect | null = null;
/** The source photo is already in the works folder (no need to copy it on every save). */
let sourceStored = false;
/** A saved work opened via ?work=, attached once the canvas exists. */
let pendingDoc: PatternDoc | null = null;

const imageSize = (): Size => ({ w: preview?.width ?? 1, h: preview?.height ?? 1 });
const makerSettings = (): TextSettings | QrSettings | null =>
  kind.value === 'text' ? normalizeText(textSettings.value) : kind.value === 'qr' ? normalizeQr(qrSettings.value) : null;
/** What the pattern depends on: settings + crop for photos; text / QR settings + brand / kit for makers. */
const currentKey = () => {
  const s = normalizeSettings(settings.value);
  return kind.value === 'image' ? JSON.stringify({ s, c: crop.value }) : JSON.stringify({ b: s.brand, t: s.tier, m: makerSettings() });
};
const isMaker = computed(() => kind.value !== 'image');
const tierValue = computed<number | 'all'>(() => normalizeSettings(settings.value).tier);
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
  const q = (query ?? {}) as Record<string, string>;
  const decode = (raw: string) => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  if (q.work) {
    openWork(decode(q.work));
    return;
  }
  if (q.kind === 'text' || q.kind === 'qr') {
    kind.value = q.kind;
    uni.setNavigationBarTitle({ title: q.kind === 'text' ? '文字图纸' : '二维码图纸' });
    return;
  }
  src.value = decode(String(q.src ?? ''));
});

onReady(async () => {
  try {
    board = await queryCanvas(instance?.proxy, '#board');
  } catch (e) {
    error.value = messageOf(e);
    return;
  }
  if (pendingDoc) {
    const d = pendingDoc;
    pendingDoc = null;
    const wasEdited = d.settings.edited === true;
    attach(d);
    edited.value = wasEdited;
    draw();
  }
  if (isMaker.value) {
    // a new text pattern shows right away (default text); a new QR pattern waits for content
    if (!doc.value) void make(true);
    return;
  }
  if (!src.value) {
    if (!doc.value && !error.value) error.value = '没有收到图片，请返回首页重新选择';
    return;
  }
  try {
    preview = await loadCanvasImage(board.canvas, src.value);
    draw();
  } catch (e) {
    if (doc.value) {
      // an old work whose photo file is gone: the pattern can still be edited and exported
      src.value = '';
      error.value = '原图已找不到，只能编辑和导出图纸，不能重新生成或裁剪。';
    } else {
      error.value = messageOf(e);
    }
  }
});

onHide(() => {
  if (dirty) void saveNow();
});

onUnload(() => {
  if (makeTimer) clearTimeout(makeTimer);
  if (dirty) void saveNow();
  unregisterEditor();
  // the worker is shared by all pages: only stop the job this page is waiting for
  if (generating.value) generator.cancel();
  unsubscribe?.();
});

/** Open a saved work: its pattern, the photo kept with it, its crop and settings. */
function openWork(id: string): void {
  let loaded: ReturnType<ReturnType<typeof worksStore>['load']>;
  try {
    loaded = worksStore().load(id);
  } catch (e) {
    error.value = messageOf(e);
    return;
  }
  if (!loaded) {
    error.value = '这个作品已经不存在了';
    return;
  }
  const { file, doc: d } = loaded;
  workId = file.id;
  baseRevision = file.cloud?.revision ?? null;
  // same draft meta as the web app: { kind, settings, crop } / { kind, settings, text } / { kind, settings, qr }
  const meta = d.settings as { kind?: string; settings?: Partial<Settings>; text?: Partial<TextSettings>; qr?: Partial<QrSettings> };
  kind.value = meta.kind === 'text' || meta.kind === 'qr' ? meta.kind : 'image';
  if (kind.value === 'text') textSettings.value = normalizeText(meta.text);
  if (kind.value === 'qr') qrSettings.value = normalizeQr(meta.qr);
  src.value = kind.value === 'image' ? (file.source ?? '') : '';
  sourceStored = true;
  crop.value = file.crop;
  appliedCrop = file.crop;
  // brand / kit: the pattern's own (switching brand on the web does not touch meta.settings)
  const saved = meta.settings && typeof meta.settings === 'object' ? meta.settings : settings.value;
  settings.value = normalizeSettings({ ...saved, brand: d.brand, tier: d.tier === 'all' ? 'all' : Number(d.tier) });
  appliedKey.value = currentKey();
  pendingDoc = d;
  uni.setNavigationBarTitle({ title: d.name });
}

// --- saving to 「我的作品」 --------------------------------------------------------------------

let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

function scheduleSave(delay = 1500): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, delay);
}

/**
 * Save the current pattern. The work data is written synchronously right here (so it is on disk
 * even when the page closes and another page opens the work at once); the thumbnail is rendered
 * afterwards and attached when ready. The returned promise settles when the thumbnail is done.
 */
function saveNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const d = doc.value;
  if (!d) return saving;
  dirty = false;
  try {
    if (edited.value) d.settings.edited = true;
    const saved = worksStore().save(d, { source: sourceStored ? undefined : src.value || null, crop: appliedCrop, baseRevision });
    sourceStored = sourceStored || !!src.value;
    if (saved.id !== d.id) {
      // a newer version came from the cloud meanwhile: these edits went to a copy; keep editing the copy
      retarget(saved.id, saved.name);
      toast(`这个作品在别处也改过，你的修改另存为「${saved.name}」`);
    }
    workSaved();
  } catch {
    dirty = true;
    toast('保存作品失败（可能是手机存储空间不足）');
    return saving;
  }
  saving = saving.then(async () => {
    try {
      worksStore().setThumb(d.id, await renderThumb(d));
    } catch {
      // the works list then shows no (or an older) thumbnail; the work itself is saved
    }
  });
  return saving;
}

/** Keep editing the open pattern as another work (a conflict copy that already holds these edits). */
function retarget(id: string, name: string): void {
  const d = doc.value;
  if (!d) return;
  workId = id;
  d.id = id;
  d.name = name;
  baseRevision = null;
  uni.setNavigationBarTitle({ title: name });
}

// cloud sync talks to this page through these hooks (see lib/cloud.ts)
const unregisterEditor = registerEditor({
  flush() {
    if (dirty) void saveNow();
  },
  forked(id, newId, name) {
    if (workId === id) retarget(newId, name);
  },
  replaced(id) {
    if (workId !== id || !board || generating.value) return;
    // settings / crop / text changed here but not generated yet: keep the page as it is; its next save
    // is based on the older revision and goes to a conflict copy, so nothing typed here is lost
    if (dirty || stale.value || cropping.value || makeTimer) return;
    // a newer version from another device: show it (edits made here were kept as a copy first)
    openWork(id);
    const d = pendingDoc;
    pendingDoc = null;
    if (!d) return;
    attach(d);
    edited.value = d.settings.edited === true;
    decoded = null;
    if (kind.value === 'image' && src.value)
      void loadCanvasImage(board.canvas, src.value)
        .then((img) => {
          preview = img;
        })
        .catch(() => undefined);
    draw();
    toast('已载入在别处做的修改');
  },
  uploaded(id, revision) {
    if (workId === id) baseRevision = revision;
  },
  removed(id) {
    if (workId !== id) return;
    workId = '';
    uni.showModal({ title: '作品已删除', content: '这个作品已在别的设备上删除。', showCancel: false, success: () => uni.navigateBack() });
  },
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
  let docBrand = `${next.brand}|${next.tier}`;
  unsubscribe = ed.subscribe(() => {
    version.value++;
    edited.value = true;
    // a brand switch (and its undo / redo) changes the pattern's brand / kit: the settings follow it.
    // If the pattern matched the settings before, it still does: no "regenerate with new settings".
    const nowBrand = `${next.brand}|${next.tier}`;
    if (nowBrand !== docBrand) {
      docBrand = nowBrand;
      const wasStale = appliedKey.value !== currentKey();
      const brandTier = { brand: next.brand, tier: next.tier === 'all' ? ('all' as const) : Number(next.tier) };
      settings.value = normalizeSettings({ ...settings.value, ...brandTier });
      if (!wasStale) appliedKey.value = currentKey();
      // only brand / kit: other settings may not have been applied to this pattern yet
      const meta = next.settings as { settings?: Partial<Settings> };
      next.settings = { ...next.settings, settings: { ...(meta.settings ?? {}), ...brandTier } };
    }
    requestDraw();
    scheduleSave();
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
  uni.setNavigationBarTitle({ title: next.name });
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

function toggleSheet(which: 'usage' | 'color' | 'export' | 'brand'): void {
  sheet.value = sheet.value === which ? null : which;
}

/** Switch the pattern to another brand / kit (one undo step); the settings follow. */
function convertBrand(plan: ConversionPlan): void {
  const ed = editor.value;
  const d = doc.value;
  if (!ed || !d) return;
  const cur = currentColor.value === null ? undefined : plan.rows.find((r) => r.index === currentColor.value);
  // the settings follow the pattern's new brand / kit in the editor change listener (attach)
  const changed = applyBrandConversion(ed, plan);
  // keep painting with the same bead, now under its new code
  if (changed && cur) currentColor.value = ed.ensureColor(cur.to);
  sheet.value = null;
  toast(changed ? `已换成 ${plan.target.brand} 色号，可以撤销` : '色号没有变化');
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

function ask(title: string, content: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({ title, content, confirmText, success: (r) => resolve(!!r.confirm), fail: () => resolve(false) });
  });
}

/** Before replacing a hand-edited pattern: ask, then keep a copy in 「我的作品」. False = do not regenerate. */
async function confirmOverwrite(): Promise<boolean> {
  const d = doc.value;
  if (!edited.value || !d) return true;
  const ok = await ask('重新生成会覆盖手工修改', '当前修改会先另存一份到「我的作品」（名称后加「修改前」），然后再重新生成。', '备份并生成');
  if (!ok) return false;
  try {
    await saveNow();
    const file = worksStore().load(d.id)?.file;
    let thumb: string | null = null;
    try {
      thumb = await renderThumb(d);
    } catch {
      // backup without a thumbnail
    }
    worksStore().saveCopy(d, `${d.name}（修改前）`, { source: file?.source ?? null, crop: file?.crop ?? null, thumb });
    return true;
  } catch {
    error.value = '备份失败（可能是手机存储空间不足），已取消重新生成。请先导出图纸保存。';
    return false;
  }
}

/** Make the result the current pattern (new work, or the same work regenerated) and save it. */
async function adopt(result: PatternResult, s: Settings, newName: string, meta: Record<string, unknown>, usedCrop: Rect | null): Promise<void> {
  const prev = doc.value;
  if (!workId) workId = worksStore().newId();
  const next = docFromPattern(result, { id: workId, name: prev?.name || newName, brand: s.brand, tier: String(s.tier), settings: meta });
  if (prev) next.createdAt = prev.createdAt;
  attach(next);
  appliedKey.value = currentKey();
  appliedCrop = usedCrop;
  viewMode.value = 'pattern';
  draw();
  await saveNow();
}

/**
 * Text / QR: made on the main thread (a few milliseconds). `auto` = live update while the settings
 * are edited: no prompt, and an empty / unusable input just leaves the current pattern.
 */
async function make(auto = false): Promise<void> {
  const k = kind.value;
  if (k === 'image' || generating.value) return;
  if (auto) {
    // a live update never replaces hand edits, a work still being opened, or a pattern that
    // already matches the settings (e.g. a just-opened work made on another device)
    if (edited.value || pendingDoc || (doc.value && appliedKey.value === currentKey())) return;
    await makeNow(k, true);
    return;
  }
  generating.value = true;
  try {
    if (await confirmOverwrite()) await makeNow(k, false);
  } finally {
    generating.value = false;
  }
}

async function makeNow(k: Exclude<Kind, 'image'>, auto: boolean): Promise<void> {
  // read the settings only now (after any prompt), so the pattern and appliedKey agree
  const ms = makerSettings();
  if (!ms) return;
  const s = normalizeSettings(settings.value);
  let result: PatternResult;
  try {
    result = makePattern(k, ms, s.brand, s.tier, mpTextRasterizer);
  } catch (e) {
    if (auto && e instanceof MakerError && e.code === 'empty') {
      error.value = '';
      return;
    }
    error.value = e instanceof MakerError ? e.message : `生成失败：${messageOf(e)}`;
    return;
  }
  error.value = '';
  saveLastSettings(s);
  await adopt(result, s, makerName(k, ms), k === 'qr' ? { kind: k, settings: s, qr: ms } : { kind: k, settings: s, text: ms }, null);
}

let makeTimer: ReturnType<typeof setTimeout> | null = null;
// live preview while typing / sliding (only until the pattern is edited by hand)
watch(
  [textSettings, qrSettings, () => settings.value.brand, () => settings.value.tier],
  () => {
    if (!isMaker.value || edited.value) return;
    if (makeTimer) clearTimeout(makeTimer);
    makeTimer = setTimeout(() => {
      makeTimer = null;
      void make(true);
    }, 300);
  },
  { deep: true },
);

function onGenerate(): void {
  if (isMaker.value) void make();
  else void generate();
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
    await adopt(result, s, defaultWorkName(), { kind: 'image', settings: s, crop: usedCrop }, usedCrop);
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
      <view v-if="doc && !isMaker" class="seg">
        <view class="seg-item" :class="{ on: viewMode === 'pattern' }" @tap="viewMode = 'pattern'">图纸</view>
        <view class="seg-item" :class="{ on: viewMode === 'source' }" @tap="viewMode = 'source'">原图</view>
      </view>
      <view class="summary">{{ summary }}</view>
      <button v-if="!isMaker" size="mini" :disabled="generating" @tap="startCrop">{{ crop ? '调整裁剪' : '裁剪' }}</button>
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
        <button size="mini" class="act-brand" @tap="toggleSheet('brand')">换品牌</button>
        <button size="mini" class="act-export" @tap="toggleSheet('export')">导出</button>
      </view>
    </view>

    <ExportCard v-if="sheet === 'export' && doc && showingPattern" :doc="doc" :version="version" @close="sheet = null" />
    <BrandCard v-if="sheet === 'brand' && doc && showingPattern" :doc="doc" :version="version" @close="sheet = null" @apply="convertBrand" />

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

    <MakerPanel
      v-if="isMaker"
      :kind="kind === 'qr' ? 'qr' : 'text'"
      v-model:text="textSettings"
      v-model:qr="qrSettings"
      :brand="settings.brand"
      :tier="tierValue"
      :disabled="generating"
    />
    <SettingsPanel v-model="settings" :disabled="generating || cropping" :palette-only="isMaker" />

    <view v-if="isMaker && !edited" class="muted live">改参数后图纸会自动更新；手工修改后再改参数，需要点下面的按钮重新生成</view>
    <button class="btn btn-primary generate" :disabled="generating || cropping || (!isMaker && !src)" @tap="onGenerate">
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
.live {
  margin-top: 16rpx;
}
</style>
