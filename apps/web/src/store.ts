import { markRaw, reactive, watch } from 'vue';
import { beadCount, colorUsage, docFromDraft, docFromPattern, docToDraft, PatternEditor, type ColorUsage, type PatternDoc } from '@pd/editor-core';
import { getPalette } from '@pd/palettes';
import { drawPattern } from '@pd/render';
import { CancelledError, Generator } from './lib/generator';
import { canvasToBlob, decodeImage, thumbnail, toRgba, type Rect, type SourceImage } from './lib/image';
import { normalizeSettings, toPatternOptions, type Settings } from './lib/settings';
import { deleteWork as dbDelete, getWork, listWorks, loadLastSettings, newId, putWork, saveLastSettings, type WorkSummary } from './lib/storage';

export type Tool = 'move' | 'pen' | 'eraser' | 'picker' | 'fill' | 'replace';
export type Phase = 'empty' | 'ready' | 'result';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface ConfirmRequest {
  title: string;
  message: string;
  okText: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export const state = reactive({
  phase: 'empty' as Phase,
  source: null as SourceImage | null,
  crop: null as Rect | null,
  settings: normalizeSettings((loadLastSettings() as Partial<Settings>) ?? {}),
  /** Settings the current pattern was generated with (to tell whether they changed since). */
  appliedSettings: null as Settings | null,
  appliedCrop: null as Rect | null,
  generating: false,
  error: '',
  notice: '',
  workId: '',
  doc: null as PatternDoc | null,
  editor: null as PatternEditor | null,
  /** Bumped on every pattern change; components read it to re-render. */
  version: 0,
  /** Manual edits since the last generation. */
  edited: false,
  saveState: 'idle' as SaveState,
  tool: 'move' as Tool,
  currentColor: null as number | null,
  highlight: null as number | null,
  viewMode: 'pattern' as 'pattern' | 'source',
  showGrid: true,
  showCodes: true,
  /** Source-image rectangle covered by the pattern grid (for the 原图 view). */
  sourceFrame: null as Rect | null,
  works: [] as WorkSummary[],
  confirm: null as ConfirmRequest | null,
  /** Open dialog / sheet. */
  dialog: null as null | 'crop' | 'export' | 'works' | 'palette' | 'settings',
});

const generator = new Generator();
/** Encoded source images, so autosave does not re-encode on every edit. */
const sourceBlobs = new WeakMap<SourceImage, Blob>();
let unsubscribe: (() => void) | null = null;
/** Bumped whenever the current work changes; async results from an older work are dropped. */
let workSession = 0;

watch(
  () => state.settings,
  (s) => saveLastSettings(s),
  { deep: true },
);

export function ask(title: string, message: string, okText: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = { title, message, okText, danger, resolve };
  });
}

export function answer(ok: boolean): void {
  const c = state.confirm;
  state.confirm = null;
  c?.resolve(ok);
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(msg: string): void {
  state.notice = msg;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (state.notice = ''), 2600);
}

// --- source image ---------------------------------------------------------------------------

export async function loadFile(file: Blob, name = '新图纸'): Promise<void> {
  state.error = '';
  try {
    const src = await decodeImage(file, (file as File).name ?? name);
    if (state.edited && state.doc && !(await ask('换一张图片？', '当前图纸会保存在「我的作品」里，可以随时回来继续编辑。', '换图片'))) return;
    await flushSave();
    resetWork();
    state.source = markRaw(src);
    state.crop = null;
    state.phase = 'ready';
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
  }
}

export function setCrop(r: Rect | null): void {
  state.crop = r;
}

function resetWork(): void {
  state.generating = false;
  // a pending generation belongs to the work being left
  generator.cancel();
  workSession++;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  unsubscribe?.();
  unsubscribe = null;
  state.workId = '';
  state.doc = null;
  state.editor = null;
  state.appliedSettings = null;
  state.appliedCrop = null;
  state.edited = false;
  state.highlight = null;
  state.currentColor = null;
  state.sourceFrame = null;
  state.saveState = 'idle';
  state.viewMode = 'pattern';
  state.tool = 'move';
}

export async function startOver(): Promise<void> {
  await flushSave();
  resetWork();
  state.source = null;
  state.crop = null;
  state.phase = 'empty';
  void refreshWorks();
}

// --- generation -----------------------------------------------------------------------------

export function settingsChanged(): boolean {
  if (!state.appliedSettings) return true;
  return JSON.stringify(state.appliedSettings) !== JSON.stringify(state.settings) || JSON.stringify(state.appliedCrop) !== JSON.stringify(state.crop);
}

export async function generate(): Promise<void> {
  const src = state.source;
  if (!src || state.generating) return;
  const session = workSession;
  if (state.edited && state.doc) {
    const ok = await ask('重新生成会覆盖手工修改', '当前修改会先另存一份到「我的作品」（名称后加「修改前」），然后再重新生成。', '备份并重新生成');
    if (!ok || session !== workSession) return;
    try {
      await saveBackup();
    } catch {
      state.error = '备份失败（可能是本机存储空间不足），已取消重新生成。请先导出图纸保存。';
      return;
    }
    if (session !== workSession) return;
  }
  state.error = '';
  state.generating = true;
  const settings = normalizeSettings(state.settings);
  const crop = state.crop ? { ...state.crop } : null;
  try {
    const palette = getPalette(settings.brand, settings.tier);
    const result = await generator.generate(toRgba(src, crop), palette, toPatternOptions(settings));
    // the user opened another work, changed the image or started over meanwhile
    if (session !== workSession || state.source !== src) return;
    if (result.meta.empty) {
      state.error =
        result.meta.emptyReason === 'background'
          ? '整张图都被当成背景去掉了。请关闭「去掉背景」，或裁剪到主体后再试。'
          : '图片是全透明的，没有可以转换的内容。';
      return;
    }
    const isNew = !state.workId;
    if (isNew) state.workId = newId();
    const name = state.doc?.name || src.name;
    const doc = docFromPattern(result, {
      id: state.workId,
      name,
      brand: settings.brand,
      tier: String(settings.tier),
      settings: { settings, crop, frame: frameOf(result, crop) },
    });
    if (state.doc) doc.createdAt = state.doc.createdAt;
    // palette indices change with every generation: the old current color would point elsewhere
    state.currentColor = null;
    attachDoc(doc);
    state.appliedSettings = settings;
    state.appliedCrop = crop;
    state.sourceFrame = frameOf(result, crop);
    state.edited = false;
    state.phase = 'result';
    state.viewMode = 'pattern';
    state.highlight = null;
    scheduleSave(0);
  } catch (e) {
    if (!(e instanceof CancelledError)) state.error = `生成失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (session === workSession) state.generating = false;
  }
}

export function cancelGenerate(): void {
  generator.cancel();
}

/** Source rectangle (in source-image px) that the pattern grid covers. */
function frameOf(r: { sourceRegion: Rect; sourceGrid: { cols: number; rows: number }; offset: { x: number; y: number }; cols: number; rows: number }, crop: Rect | null): Rect {
  const cw = r.sourceRegion.w / r.sourceGrid.cols;
  const ch = r.sourceRegion.h / r.sourceGrid.rows;
  return {
    x: (crop?.x ?? 0) + r.sourceRegion.x + r.offset.x * cw,
    y: (crop?.y ?? 0) + r.sourceRegion.y + r.offset.y * ch,
    w: r.cols * cw,
    h: r.rows * ch,
  };
}

function attachDoc(doc: PatternDoc): void {
  unsubscribe?.();
  const editor = new PatternEditor(doc);
  state.doc = markRaw(doc);
  state.editor = markRaw(editor);
  unsubscribe = editor.subscribe(() => {
    state.version++;
    state.edited = true;
    scheduleSave();
  });
  state.version++;
  if (state.currentColor !== null && state.currentColor >= doc.palette.length) state.currentColor = null;
  if (state.currentColor === null) state.currentColor = colorUsage(doc)[0]?.index ?? null;
}

// --- editing helpers ------------------------------------------------------------------------

export function usage(): ColorUsage[] {
  void state.version;
  return state.doc ? colorUsage(state.doc) : [];
}

export function totalBeads(): number {
  void state.version;
  return state.doc ? beadCount(state.doc) : 0;
}

export function undo(): void {
  state.editor?.undo();
}

export function redo(): void {
  state.editor?.redo();
}

export function rename(name: string): void {
  if (!state.doc) return;
  state.doc.name = name.trim().slice(0, 40) || '未命名图纸';
  state.doc.updatedAt = Date.now();
  state.version++;
  scheduleSave();
}

// --- persistence ----------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

/** What a save writes, captured when it is scheduled (the current work may change before it runs). */
interface SaveJob {
  doc: PatternDoc;
  source: SourceImage | null;
  crop: Rect | null;
}

function currentJob(): SaveJob | null {
  return state.doc ? { doc: state.doc, source: state.source, crop: plainCrop() } : null;
}

export function scheduleSave(delay = 800): void {
  if (!state.doc) return;
  state.saveState = 'saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const job = currentJob();
    if (job) saving = saving.then(() => saveNow(job));
  }, delay);
}

/** Write a pending autosave now and wait for all saves to finish. */
export async function flushSave(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const job = currentJob();
    if (job) saving = saving.then(() => saveNow(job));
  }
  await saving;
}

async function sourceBlob(src: SourceImage | null): Promise<Blob | null> {
  if (!src) return null;
  let blob = sourceBlobs.get(src);
  if (!blob) {
    blob = await canvasToBlob(src.canvas, 'image/jpeg', 0.92);
    sourceBlobs.set(src, blob);
  }
  return blob;
}

async function saveNow(job: SaveJob): Promise<void> {
  const { doc } = job;
  try {
    await putWork({
      id: doc.id,
      name: doc.name,
      updatedAt: doc.updatedAt,
      thumb: patternThumb(doc),
      draft: docToDraft(doc),
      source: await sourceBlob(job.source),
      crop: job.crop,
    });
    // a newer edit may already be waiting; then the work is not saved yet
    if (state.doc === doc && saveTimer === undefined) state.saveState = 'saved';
  } catch (e) {
    console.error('save failed', e);
    if (state.doc === doc) state.saveState = 'error';
  }
}

/** IndexedDB cannot store Vue's reactive proxies: copy to a plain object. */
function plainCrop(): Rect | null {
  const c = state.appliedCrop;
  return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null;
}

async function saveBackup(): Promise<void> {
  const doc = state.doc;
  if (!doc) return;
  await flushSave();
  const copy: PatternDoc = { ...doc, id: newId(), name: `${doc.name}（修改前）`, cells: doc.cells.slice(), palette: doc.palette.slice(), updatedAt: Date.now() };
  await putWork({ id: copy.id, name: copy.name, updatedAt: copy.updatedAt, thumb: patternThumb(copy), draft: docToDraft(copy), source: await sourceBlob(state.source), crop: plainCrop() });
  await refreshWorks();
}

export function patternThumb(doc: PatternDoc, max = 240): string {
  const cell = Math.max(1, Math.floor(max / Math.max(doc.cols, doc.rows, 1)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, doc.cols * cell);
  c.height = Math.max(1, doc.rows * cell);
  drawPattern(c.getContext('2d')!, doc, { cellSize: cell, offsetX: 0, offsetY: 0, width: c.width, height: c.height, showGrid: false });
  return thumbnail(c, c.width, c.height, max);
}

export async function refreshWorks(): Promise<void> {
  try {
    state.works = await listWorks();
  } catch {
    state.works = [];
  }
}

export async function openWork(id: string): Promise<void> {
  state.error = '';
  try {
    await flushSave();
    const rec = await getWork(id);
    if (!rec) throw new Error('作品不存在或已被删除');
    let doc: PatternDoc;
    try {
      doc = docFromDraft(rec.draft);
    } catch {
      throw new Error('作品数据已损坏或版本不兼容');
    }
    resetWork();
    const meta = doc.settings as { settings?: Partial<Settings>; crop?: Rect | null; frame?: Rect | null };
    const session = workSession;
    const source = rec.source ? markRaw(await decodeImage(rec.source, doc.name)) : null;
    if (session !== workSession) return;
    if (source && rec.source) sourceBlobs.set(source, rec.source);
    state.source = source;
    state.settings = normalizeSettings(meta.settings ?? {});
    state.crop = meta.crop ?? null;
    state.workId = doc.id;
    attachDoc(doc);
    state.appliedSettings = normalizeSettings(meta.settings ?? {});
    state.appliedCrop = meta.crop ?? null;
    state.sourceFrame = meta.frame ?? null;
    state.edited = false;
    state.saveState = 'saved';
    state.phase = 'result';
    state.dialog = null;
  } catch (e) {
    state.error = `打开失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function removeWork(id: string, name: string): Promise<void> {
  if (!(await ask('删除作品？', `「${name}」会从本机删除，无法恢复。`, '删除', true))) return;
  try {
    if (state.workId === id) {
      // stop autosave first, or it would write the work back right after deleting it
      await flushSave();
      await dbDelete(id);
      resetWork();
      state.source = null;
      state.crop = null;
      state.phase = 'empty';
    } else {
      await dbDelete(id);
    }
  } catch {
    notify('删除失败，请稍后再试');
  }
  await refreshWorks();
}
