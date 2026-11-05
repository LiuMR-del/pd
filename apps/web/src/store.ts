import { markRaw, reactive, watch } from 'vue';
import { MakerError } from '@pd/makers';
import { applyBrandConversion, beadCount, colorUsage, docFromDraft, docFromPattern, docToDraft, PatternEditor, type ColorUsage, type ConversionPlan, type PatternDoc } from '@pd/editor-core';
import { getPalette } from '@pd/palettes';
import type { PatternResult } from '@pd/pattern-core';
import { drawPattern } from '@pd/render';
import { CancelledError, Generator } from './lib/generator';
import { canvasToBlob, decodeImage, thumbnail, toRgba, type Rect, type SourceImage } from './lib/image';
import { defaultQrSettings, defaultTextSettings, makePattern, makerName, normalizeQr, normalizeText, type ColorId, type Kind, type QrSettings, type TextSettings } from './lib/makers';
import { normalizeSettings, toPatternOptions, type Settings } from '@pd/app-shared';
import { account, cloudHooks, userId } from './lib/account';
import { deleteWork as dbDelete, getWork, listWorks, loadLastSettings, newId, putWork, saveLastSettings, withLock, type WorkRecord, type WorkSummary } from './lib/storage';

export type Tool = 'move' | 'pen' | 'eraser' | 'picker' | 'fill' | 'replace';
export type Phase = 'empty' | 'ready' | 'result';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface ColorPickRequest {
  title: string;
  /** Offer a "none" choice (resolves null). */
  allowNone: boolean;
  current: ColorId | null;
  /** Color id, null for "none", undefined when cancelled. */
  resolve: (id: ColorId | null | undefined) => void;
}

interface ConfirmRequest {
  title: string;
  message: string;
  okText: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export const state = reactive({
  phase: 'empty' as Phase,
  /** What the current work is made from. */
  kind: 'image' as Kind,
  textSettings: defaultTextSettings(),
  qrSettings: defaultQrSettings(),
  /** Text / QR settings (JSON) the current pattern was made with. */
  appliedMaker: null as string | null,
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
  colorPick: null as ColorPickRequest | null,
  /** Open dialog / sheet. */
  dialog: null as null | 'crop' | 'export' | 'works' | 'palette' | 'settings' | 'brand' | 'account' | 'history' | 'legal',
  /** Which text the legal dialog shows. */
  legal: 'privacy' as 'privacy' | 'terms',
});

const generator = new Generator();
/** Encoded source images, so autosave does not re-encode on every edit. */
const sourceBlobs = new WeakMap<SourceImage, Blob>();
let unsubscribe: (() => void) | null = null;
/** Bumped whenever the current work changes; async results from an older work are dropped. */
let workSession = 0;
/**
 * Server revision the open document was based on when it was opened (or last uploaded). A save
 * whose record has meanwhile been moved to another revision (another tab, a download) must not
 * reuse that revision: it becomes a conflict copy instead.
 */
let openedBase: number | null = null;

export function setOpenedBase(id: string, revision: number): void {
  if (state.workId === id) openedBase = revision;
}

/** Name for a copy that keeps one side of a conflict (the suffix always survives truncation). */
export function copyName(name: string, suffix: string): string {
  return name.slice(0, Math.max(1, 60 - suffix.length)) + suffix;
}

/** Keep editing the open document, but as the (already created) work `id`. */
export function retargetOpenWork(id: string, name: string): void {
  const doc = state.doc;
  if (!doc) return;
  doc.id = id;
  doc.name = name;
  state.workId = id;
  openedBase = null;
  state.version++;
  scheduleSave(0);
}

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

/** Let the user pick a color of the current brand + tier. */
export function pickColor(title: string, current: ColorId | null, allowNone = false): Promise<ColorId | null | undefined> {
  return new Promise((resolve) => {
    state.colorPick?.resolve(undefined);
    state.colorPick = { title, current, allowNone, resolve };
  });
}

export function answerColor(id: ColorId | null | undefined): void {
  const c = state.colorPick;
  state.colorPick = null;
  c?.resolve(id);
}

/** Changes whenever the current work changes (to drop async results that belong to an older one). */
export function workToken(): number {
  return workSession;
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
    state.kind = 'image';
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
  openedBase = null;
  state.doc = null;
  state.editor = null;
  state.appliedSettings = null;
  state.appliedMaker = null;
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
  state.kind = 'image';
  state.source = null;
  state.crop = null;
  state.phase = 'empty';
  void refreshWorks();
}

/** Start a new text or QR pattern (settings first, then 生成图纸). */
export async function startMaker(kind: Exclude<Kind, 'image'>): Promise<void> {
  state.error = '';
  if (state.edited && state.doc && !(await ask(`新建${kind === 'qr' ? '二维码' : '文字'}图纸？`, '当前图纸会保存在「我的作品」里，可以随时回来继续编辑。', '新建'))) return;
  await flushSave();
  resetWork();
  state.kind = kind;
  state.source = null;
  state.crop = null;
  state.phase = 'ready';
  // phones: the input fields live in the bottom sheet
  if (window.matchMedia('(max-width: 767px)').matches) state.dialog = 'settings';
}

// --- generation -----------------------------------------------------------------------------

/** Text / QR settings of the current kind. */
export function makerSettings(): TextSettings | QrSettings | null {
  return state.kind === 'text' ? normalizeText(state.textSettings) : state.kind === 'qr' ? normalizeQr(state.qrSettings) : null;
}

export function settingsChanged(): boolean {
  if (!state.appliedSettings) return true;
  if (state.kind !== 'image') {
    const a = state.appliedSettings;
    return a.brand !== state.settings.brand || a.tier !== state.settings.tier || state.appliedMaker !== JSON.stringify(makerSettings());
  }
  return JSON.stringify(state.appliedSettings) !== JSON.stringify(state.settings) || JSON.stringify(state.appliedCrop) !== JSON.stringify(state.crop);
}

/** Before replacing an edited pattern: ask, then back it up. False = do not regenerate. */
async function confirmOverwrite(session: number): Promise<boolean> {
  if (!state.edited || !state.doc) return true;
  const ok = await ask('重新生成会覆盖手工修改', '当前修改会先另存一份到「我的作品」（名称后加「修改前」），然后再重新生成。', '备份并重新生成');
  if (!ok || session !== workSession) return false;
  try {
    await saveBackup();
  } catch {
    state.error = '备份失败（可能是本机存储空间不足），已取消重新生成。请先导出图纸保存。';
    return false;
  }
  return session === workSession;
}

/** Make the result the current pattern (new work, or the same work regenerated). */
function adopt(result: PatternResult, settings: Settings, name: string, meta: Record<string, unknown>): void {
  if (!state.workId) state.workId = newId();
  const doc = docFromPattern(result, { id: state.workId, name: state.doc?.name || name, brand: settings.brand, tier: String(settings.tier), settings: meta });
  if (state.doc) doc.createdAt = state.doc.createdAt;
  // palette indices change with every generation: the old current color would point elsewhere
  state.currentColor = null;
  attachDoc(doc);
  state.appliedSettings = settings;
  state.edited = false;
  state.phase = 'result';
  state.viewMode = 'pattern';
  state.highlight = null;
  scheduleSave(0);
}

export async function generate(): Promise<void> {
  if (state.kind !== 'image') return make();
  const src = state.source;
  if (!src || state.generating) return;
  const session = workSession;
  if (!(await confirmOverwrite(session))) return;
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
    adopt(result, settings, src.name, { kind: 'image', settings, crop, frame: frameOf(result, crop) });
    state.appliedCrop = crop;
    state.sourceFrame = frameOf(result, crop);
  } catch (e) {
    if (!(e instanceof CancelledError)) state.error = `生成失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (session === workSession) state.generating = false;
  }
}

/** Text / QR: made on the main thread (a few milliseconds). */
async function make(): Promise<void> {
  const kind = state.kind;
  const ms = makerSettings();
  if (kind === 'image' || !ms || state.generating) return;
  const session = workSession;
  if (!(await confirmOverwrite(session))) return;
  const settings = normalizeSettings(state.settings);
  let result: PatternResult;
  try {
    result = makePattern(kind, ms, settings.brand, settings.tier);
  } catch (e) {
    state.error = e instanceof MakerError ? e.message : `生成失败：${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  state.error = '';
  adopt(result, settings, makerName(kind, ms), kind === 'qr' ? { kind, settings, qr: ms } : { kind, settings, text: ms });
  state.appliedMaker = JSON.stringify(ms);
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
  let brand = `${doc.brand}|${doc.tier}`;
  unsubscribe = editor.subscribe(() => {
    state.version++;
    state.edited = true;
    // brand conversion (or undoing it): regenerating should use the brand the pattern now has
    if (`${doc.brand}|${doc.tier}` !== brand) {
      brand = `${doc.brand}|${doc.tier}`;
      const tier = doc.tier === 'all' ? 'all' : Number(doc.tier);
      state.settings = normalizeSettings({ ...state.settings, brand: doc.brand, tier });
      if (state.appliedSettings) state.appliedSettings = normalizeSettings({ ...state.appliedSettings, brand: doc.brand, tier });
      // keep the saved generation settings in step, so reopening the work keeps the brand
      const meta = doc.settings as { settings?: Partial<Settings> };
      if (meta.settings) meta.settings = { ...meta.settings, brand: doc.brand, tier };
      // the pen color / highlight may be a bead of the previous brand now
      state.highlight = null;
      const inBrand = new Set(getPalette(doc.brand, tier).map((c) => `${c.key}${c.hex.toUpperCase()}`));
      const cur = state.currentColor === null ? null : doc.palette[state.currentColor];
      if (!cur || !inBrand.has(`${cur.key}${cur.hex.toUpperCase()}`)) state.currentColor = colorUsage(doc)[0]?.index ?? null;
    }
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

/** Switch the pattern to another brand / tier (one undo step). */
export function convertBrand(plan: ConversionPlan): boolean {
  if (!state.editor) return false;
  // state.editor is markRaw'd: it is the PatternEditor instance, only its reactive type is unwrapped
  const editor = state.editor as unknown as PatternEditor;
  const cur = state.currentColor === null ? undefined : plan.rows.find((r) => r.index === state.currentColor);
  const changed = applyBrandConversion(editor, plan);
  // keep painting with the same bead, now under its new code
  if (changed && cur) state.currentColor = editor.ensureColor(cur.to);
  return changed;
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
  base: number | null;
}

function currentJob(): SaveJob | null {
  return state.doc ? { doc: state.doc, source: state.source, crop: plainCrop(), base: openedBase } : null;
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
    const source = await sourceBlob(job.source);
    let forked = '';
    await withLock(async () => {
      // keep the sync fields; a new work belongs to the signed-in account
      let prev = await getWork(doc.id);
      if (prev?.cloud && prev.cloud.revision !== job.base) {
        // the stored work moved on (other tab / other device) since this document was opened
        const owner = prev.owner;
        forked = copyName(doc.name, '（冲突副本）');
        const id = newId();
        if (state.doc === doc) {
          doc.id = id;
          doc.name = forked;
          state.workId = id;
          openedBase = null;
          state.version++;
        } else {
          doc.id = id;
          doc.name = forked;
        }
        prev = { ...prev, owner, cloud: undefined };
      }
      await putWork({
        id: doc.id,
        name: doc.name,
        updatedAt: doc.updatedAt,
        thumb: patternThumb(doc),
        draft: docToDraft(doc),
        source,
        crop: job.crop,
        owner: prev ? prev.owner : userId() ?? undefined,
        cloud: prev?.cloud,
        dirty: true,
      });
    });
    // a newer edit may already be waiting; then the work is not saved yet
    if (state.doc === doc && saveTimer === undefined) state.saveState = 'saved';
    if (forked) notify(`这个作品在别处有新版本，你的修改另存为「${forked}」`);
    cloudHooks.afterSave();
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
  const owner = (await getWork(doc.id))?.owner;
  await putWork({ id: copy.id, name: copy.name, updatedAt: copy.updatedAt, thumb: patternThumb(copy), draft: docToDraft(copy), source: await sourceBlob(state.source), crop: plainCrop(), owner, dirty: true });
  cloudHooks.afterSave();
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
    state.works = await listWorks(userId());
  } catch {
    state.works = [];
  }
}

export async function openWork(id: string): Promise<void> {
  state.error = '';
  try {
    await flushSave();
    const rec = await getWork(id);
    if (!rec || (rec.owner && rec.owner !== userId())) throw new Error('作品不存在或已被删除');
    let doc: PatternDoc;
    try {
      doc = docFromDraft(rec.draft);
    } catch {
      throw new Error('作品数据已损坏或版本不兼容');
    }
    resetWork();
    const meta = doc.settings as { kind?: Kind; settings?: Partial<Settings>; crop?: Rect | null; frame?: Rect | null; text?: Partial<TextSettings>; qr?: Partial<QrSettings> };
    const session = workSession;
    const source = rec.source ? markRaw(await decodeImage(rec.source, doc.name)) : null;
    if (session !== workSession) return;
    if (source && rec.source) sourceBlobs.set(source, rec.source);
    state.kind = meta.kind === 'text' || meta.kind === 'qr' ? meta.kind : 'image';
    if (state.kind === 'text') state.textSettings = normalizeText(meta.text);
    if (state.kind === 'qr') state.qrSettings = normalizeQr(meta.qr);
    state.appliedMaker = state.kind === 'image' ? null : JSON.stringify(makerSettings());
    state.source = source;
    // the document's own brand / tier win: a brand conversion changes them after generation
    const docBrand: Partial<Settings> = { brand: doc.brand, tier: doc.tier === 'all' ? 'all' : Number(doc.tier) };
    state.settings = normalizeSettings({ ...meta.settings, ...docBrand });
    state.crop = meta.crop ?? null;
    state.workId = doc.id;
    openedBase = rec.cloud?.revision ?? null;
    attachDoc(doc);
    state.appliedSettings = normalizeSettings({ ...meta.settings, ...docBrand });
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
  const rec = await getWork(id).catch(() => undefined);
  const synced = !!rec?.cloud && !!account.user && rec.owner === account.user.id;
  if (!(await ask('删除作品？', synced ? `「${name}」会从本机和云端一起删除，无法恢复。` : `「${name}」会从本机删除，无法恢复。`, '删除', true))) return;
  try {
    if (state.workId === id) {
      // stop autosave first, or it would write the work back right after deleting it
      await flushSave();
      await withLock(() => dbDelete(id));
      resetWork();
      state.kind = 'image';
      state.source = null;
      state.crop = null;
      state.phase = 'empty';
    } else {
      await withLock(() => dbDelete(id));
    }
    if (synced) cloudHooks.afterDelete(id, rec!.cloud!.revision);
  } catch {
    notify('删除失败，请稍后再试');
  }
  await refreshWorks();
}

/** Leave the current work without saving again (used when it disappears: deleted elsewhere, account removed). */
export function closeWork(): void {
  resetWork();
  state.kind = 'image';
  state.source = null;
  state.crop = null;
  state.phase = 'empty';
}

export type { WorkRecord };
