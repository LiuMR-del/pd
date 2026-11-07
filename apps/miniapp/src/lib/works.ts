import type { CloudState, RemoteWork, SyncWork } from '@pd/app-shared';
import { beadCount, colorUsage, docFromDraft, docToDraft, type PatternDoc, type PatternDraftV1 } from '@pd/editor-core';
import type { Rect } from './crop';

/**
 * Local works of the mini-program. Each work is a JSON file (same draft format as the web app, so a
 * later cloud sync can share it) plus a copy of the source photo and a thumbnail; a small summary
 * index lives in key-value storage for the works list. Files and storage are injected so this logic
 * is unit-tested without WeChat.
 */
export interface FileStore {
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  copy(src: string, dest: string): void;
  remove(path: string): void;
  ensureDir(path: string): void;
}

export interface KeyValue {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface WorkSummary {
  id: string;
  name: string;
  updatedAt: number;
  cols: number;
  rows: number;
  colors: number;
  beads: number;
  /** Thumbnail file, or null. */
  thumb: string | null;
  /** Account the work belongs to (null: made while signed out, stays on this phone). */
  owner?: string | null;
  /** Has changes not uploaded yet (only meaningful for works with an owner). */
  dirty?: boolean;
  /** Uploaded at least once. */
  inCloud?: boolean;
}

export interface WorkFile {
  version: 1;
  id: string;
  name: string;
  updatedAt: number;
  draft: PatternDraftV1;
  /** Saved copy of the source photo (for regenerating / re-cropping), or null. */
  source: string | null;
  crop: Rect | null;
  owner?: string | null;
  /** State last known to be on the server (absent: never uploaded). */
  cloud?: CloudState | null;
  dirty?: boolean;
}

export interface SaveOptions {
  /** A photo to keep with the work (copied into the works folder the first time). */
  source?: string | null;
  crop?: Rect | null;
  /** A freshly rendered thumbnail file (copied into the works folder). */
  thumb?: string | null;
  /**
   * Cloud revision the editor's copy is based on. When the stored work has moved on (a newer version
   * was downloaded meanwhile), the editor's doc is saved as 「…（冲突副本）」 instead of overwriting it;
   * the returned summary then has the copy's id.
   */
  baseRevision?: number | null;
}

/** Name for a copy that keeps one side of a conflict (same rule as the sync engine). */
const copyName = (name: string, suffix: string) => name.slice(0, Math.max(1, 60 - suffix.length)) + suffix;

const INDEX_KEY = 'pd:works:index';

export class WorksStore {
  constructor(
    private readonly files: FileStore,
    private readonly kv: KeyValue,
    private readonly root: string,
    private readonly now: () => number = Date.now,
    /** The signed-in account (new works belong to it), or null. */
    private readonly currentUser: () => string | null = () => null,
  ) {}

  newId(): string {
    return `${this.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /** All works on this phone, newest first (including other accounts'; see visible()). */
  list(): WorkSummary[] {
    const raw = this.kv.get(INDEX_KEY);
    const items = Array.isArray(raw) ? (raw as WorkSummary[]).filter((w) => w && typeof w.id === 'string') : [];
    return items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Works to show: made while signed out, or belonging to the signed-in account. */
  visible(): WorkSummary[] {
    const uid = this.currentUser();
    return this.list().filter((w) => !w.owner || w.owner === uid);
  }

  /** The saved work, or null when it does not exist; throws a readable error when the file is damaged. */
  load(id: string): { file: WorkFile; doc: PatternDoc } | null {
    const text = this.files.readText(this.jsonPath(id));
    if (text === null) return null;
    let file: WorkFile;
    try {
      file = JSON.parse(text) as WorkFile;
    } catch {
      throw new Error('作品文件已损坏，无法打开');
    }
    try {
      const doc = docFromDraft(file.draft);
      doc.id = file.id;
      doc.name = file.name;
      return { file, doc };
    } catch (e) {
      throw new Error(`作品文件已损坏，无法打开（${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  /** Write the work (creating it on first save) and update the index. A local save marks it changed. */
  save(doc: PatternDoc, options: SaveOptions = {}): WorkSummary {
    this.files.ensureDir(this.root);
    const prev = this.readFile(doc.id);
    if (prev && options.baseRevision !== undefined && (prev.cloud?.revision ?? null) !== options.baseRevision) {
      // a newer version arrived from the cloud after the editor opened this one: keep both
      const copy: PatternDoc = { ...doc, id: this.newId(), name: copyName(doc.name, '（冲突副本）') };
      const thumb = this.list().find((w) => w.id === doc.id)?.thumb ?? null;
      const saved = this.save(copy, { source: prev.source, crop: options.crop !== undefined ? options.crop : prev.crop, thumb: options.thumb ?? thumb });
      return this.keepOwner(saved, prev.owner ?? null);
    }
    const id = doc.id;
    let source = prev?.source ?? null;
    if (options.source && options.source !== source) {
      const dest = `${this.root}/${id}.src${extOf(options.source)}`;
      this.files.copy(options.source, dest);
      source = dest;
    }
    const prevThumb = this.list().find((w) => w.id === id)?.thumb ?? null;
    let thumb = prevThumb;
    if (options.thumb && options.thumb !== `${this.root}/${id}.thumb.png`) {
      thumb = `${this.root}/${id}.thumb.png`;
      this.files.copy(options.thumb, thumb);
    }
    return this.write({
      version: 1,
      id,
      name: doc.name,
      updatedAt: this.now(),
      draft: docToDraft(doc),
      source,
      crop: options.crop !== undefined ? options.crop : (prev?.crop ?? null),
      owner: prev ? (prev.owner ?? null) : this.currentUser(),
      cloud: prev?.cloud ?? null,
      dirty: true,
    }, doc, thumb);
  }

  /**
   * Attach a freshly rendered thumbnail to a saved work. Separate from save() so the work data can
   * be written synchronously (e.g. when the page closes) and the slower thumbnail follows.
   */
  setThumb(id: string, tempThumb: string): void {
    const list = this.list();
    const hit = list.find((w) => w.id === id);
    if (!hit) return;
    const thumb = `${this.root}/${id}.thumb.png`;
    this.files.copy(tempThumb, thumb);
    hit.thumb = thumb;
    this.kv.set(INDEX_KEY, list);
  }

  /** Save a copy of a work under a new id and name (e.g. the backup before regenerating). */
  saveCopy(doc: PatternDoc, name: string, options: SaveOptions = {}): WorkSummary {
    const owner = this.readFile(doc.id)?.owner;
    const copy: PatternDoc = { ...doc, id: this.newId(), name, cells: doc.cells.slice(), palette: doc.palette.map((p) => ({ ...p })) };
    const saved = this.save(copy, { ...options, baseRevision: undefined });
    return owner === undefined ? saved : this.keepOwner(saved, owner ?? null);
  }

  /**
   * A copy belongs to the account of its original (not to whoever is signed in now; e.g. after being
   * signed out, a copy must not become a 「made while signed out」 work another account could claim).
   */
  private keepOwner(saved: WorkSummary, owner: string | null): WorkSummary {
    if ((saved.owner ?? null) === owner) return saved;
    const f = this.readFile(saved.id);
    if (f) this.patch(f, { owner });
    return { ...saved, owner };
  }

  rename(id: string, name: string): void {
    const loaded = this.load(id);
    if (!loaded) return;
    loaded.doc.name = name;
    this.save(loaded.doc);
  }

  /** Delete the work and its files. Returns where it stood in the cloud (to delete it there too). */
  remove(id: string): { owner: string | null; revision: number | null } {
    const file = this.readFile(id);
    const summary = this.list().find((w) => w.id === id);
    for (const p of [this.jsonPath(id), file?.source, summary?.thumb]) {
      if (p) {
        try {
          this.files.remove(p);
        } catch {
          // already gone
        }
      }
    }
    this.kv.set(INDEX_KEY, this.list().filter((w) => w.id !== id));
    return { owner: file?.owner ?? null, revision: file?.cloud?.revision ?? null };
  }

  // --- cloud sync (see SyncStore in @pd/app-shared) ------------------------------------------

  /** Cloud revision of a saved work (null: never uploaded / unknown work). */
  revisionOf(id: string): number | null {
    return this.readFile(id)?.cloud?.revision ?? null;
  }

  syncWork(id: string): SyncWork | undefined {
    const f = this.readFile(id);
    return f ? { id: f.id, name: f.name, draft: f.draft, owner: f.owner ?? null, cloud: f.cloud ?? null, dirty: !!f.dirty, hasSource: !!f.source, crop: f.crop } : undefined;
  }

  syncWorks(): SyncWork[] {
    return this.list()
      .map((w) => this.syncWork(w.id))
      .filter((w): w is SyncWork => !!w);
  }

  /** Path of the source photo kept with a work, or null. */
  sourceOf(id: string): string | null {
    return this.readFile(id)?.source ?? null;
  }

  /**
   * Store a version downloaded from the cloud (synced, not dirty). `source`: undefined keeps the local
   * photo, null drops it, a path is copied in. The thumbnail is stale afterwards (render a new one).
   */
  storeRemote(uid: string, w: RemoteWork, source: string | null | undefined): WorkSummary {
    this.files.ensureDir(this.root);
    const prev = this.readFile(w.id);
    let src = prev?.source ?? null;
    if (source !== undefined) {
      if (src) this.removeQuietly(src);
      src = null;
      if (source) {
        src = `${this.root}/${w.id}.src${extOf(source)}`;
        this.files.copy(source, src);
      }
    }
    const doc = docFromDraft(w.draft);
    doc.id = w.id;
    const crop = (w.meta?.crop ?? null) as Rect | null;
    const thumb = this.list().find((s) => s.id === w.id)?.thumb ?? null;
    return this.write(
      { version: 1, id: w.id, name: doc.name, updatedAt: this.now(), draft: { ...w.draft, id: w.id }, source: src, crop, owner: uid, cloud: { revision: w.revision, sourceKey: w.sourceKey }, dirty: false },
      doc,
      thumb,
    );
  }

  /** Copy a work under a new id and name, owned by `uid`, not uploaded yet. Returns the new id. */
  fork(uid: string, id: string, name: string): string {
    const f = this.readFile(id);
    if (!f) throw new Error('作品不存在');
    const nid = this.newId();
    let source: string | null = null;
    if (f.source) {
      source = `${this.root}/${nid}.src${extOf(f.source)}`;
      this.files.copy(f.source, source);
    }
    let thumb = this.list().find((s) => s.id === id)?.thumb ?? null;
    if (thumb) {
      const dest = `${this.root}/${nid}.thumb.png`;
      this.files.copy(thumb, dest);
      thumb = dest;
    }
    const now = this.now();
    const draft: PatternDraftV1 = { ...f.draft, id: nid, name, updatedAt: now };
    const doc = docFromDraft(draft);
    this.write({ version: 1, id: nid, name, updatedAt: now, draft, source, crop: f.crop, owner: uid, cloud: null, dirty: true }, doc, thumb);
    return nid;
  }

  /** After uploading `snap`: record the cloud state; stays dirty when the work changed meanwhile (returns that). */
  uploaded(id: string, snap: SyncWork, cloud: CloudState): boolean {
    const f = this.readFile(id);
    if (!f) return false;
    const changed = f.draft.updatedAt !== snap.draft.updatedAt || f.name !== snap.name;
    this.patch(f, { cloud, dirty: changed });
    return changed;
  }

  setOwnerDirty(id: string, owner: string, dirty: boolean): void {
    const f = this.readFile(id);
    if (f) this.patch(f, { owner, dirty });
  }

  /** Give the works made while signed out to `uid` (they are uploaded on the next sync). Returns how many. */
  claim(uid: string): number {
    let n = 0;
    for (const w of this.list()) {
      if (w.owner) continue;
      const f = this.readFile(w.id);
      if (!f || f.owner) continue;
      this.patch(f, { owner: uid, dirty: true });
      n++;
    }
    return n;
  }

  /** Delete every work of `uid` on this phone (account deleted). */
  removeOwnedBy(uid: string): void {
    for (const w of this.list()) if (w.owner === uid) this.remove(w.id);
  }

  /** Update sync fields without counting as a local change. */
  private patch(f: WorkFile, fields: Partial<Pick<WorkFile, 'owner' | 'cloud' | 'dirty'>>): void {
    const next = { ...f, ...fields };
    this.files.writeText(this.jsonPath(f.id), JSON.stringify(next));
    const list = this.list();
    const hit = list.find((w) => w.id === f.id);
    if (hit) {
      hit.owner = next.owner ?? null;
      hit.dirty = !!next.dirty;
      hit.inCloud = !!next.cloud;
      this.kv.set(INDEX_KEY, list);
    }
  }

  private write(file: WorkFile, doc: PatternDoc, thumb: string | null): WorkSummary {
    this.files.writeText(this.jsonPath(file.id), JSON.stringify(file));
    const summary: WorkSummary = {
      id: file.id,
      name: file.name,
      updatedAt: file.updatedAt,
      cols: doc.cols,
      rows: doc.rows,
      colors: colorUsage(doc).length,
      beads: beadCount(doc),
      thumb,
      owner: file.owner ?? null,
      dirty: !!file.dirty,
      inCloud: !!file.cloud,
    };
    this.kv.set(INDEX_KEY, [summary, ...this.list().filter((w) => w.id !== file.id)]);
    return summary;
  }

  private removeQuietly(path: string): void {
    try {
      this.files.remove(path);
    } catch {
      // already gone
    }
  }

  private readFile(id: string): WorkFile | null {
    const text = this.files.readText(this.jsonPath(id));
    if (text === null) return null;
    try {
      return JSON.parse(text) as WorkFile;
    } catch {
      return null;
    }
  }

  private jsonPath(id: string): string {
    return `${this.root}/${id}.json`;
  }
}

function extOf(path: string): string {
  const m = /\.(jpe?g|png|webp|gif|bmp)$/i.exec(path);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

/** Default work name, e.g. 「图纸 11-06 00:15」. */
export function defaultWorkName(now = new Date()): string {
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `图纸 ${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
}
