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
}

export interface SaveOptions {
  /** A photo to keep with the work (copied into the works folder the first time). */
  source?: string | null;
  crop?: Rect | null;
  /** A freshly rendered thumbnail file (copied into the works folder). */
  thumb?: string | null;
}

const INDEX_KEY = 'pd:works:index';

export class WorksStore {
  constructor(
    private readonly files: FileStore,
    private readonly kv: KeyValue,
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  newId(): string {
    return `${this.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  list(): WorkSummary[] {
    const raw = this.kv.get(INDEX_KEY);
    const items = Array.isArray(raw) ? (raw as WorkSummary[]).filter((w) => w && typeof w.id === 'string') : [];
    return items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
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

  /** Write the work (creating it on first save) and update the index. */
  save(doc: PatternDoc, options: SaveOptions = {}): WorkSummary {
    this.files.ensureDir(this.root);
    const id = doc.id;
    const prev = this.readFile(id);
    let source = prev?.source ?? null;
    if (options.source && options.source !== source) {
      const dest = `${this.root}/${id}.src${extOf(options.source)}`;
      this.files.copy(options.source, dest);
      source = dest;
    }
    const prevThumb = this.list().find((w) => w.id === id)?.thumb ?? null;
    let thumb = prevThumb;
    if (options.thumb) {
      thumb = `${this.root}/${id}.thumb.png`;
      this.files.copy(options.thumb, thumb);
    }
    const updatedAt = this.now();
    const file: WorkFile = {
      version: 1,
      id,
      name: doc.name,
      updatedAt,
      draft: docToDraft(doc),
      source,
      crop: options.crop !== undefined ? options.crop : (prev?.crop ?? null),
    };
    this.files.writeText(this.jsonPath(id), JSON.stringify(file));
    const summary: WorkSummary = {
      id,
      name: doc.name,
      updatedAt,
      cols: doc.cols,
      rows: doc.rows,
      colors: colorUsage(doc).length,
      beads: beadCount(doc),
      thumb,
    };
    this.kv.set(INDEX_KEY, [summary, ...this.list().filter((w) => w.id !== id)]);
    return summary;
  }

  /** Save a copy of a work under a new id and name (e.g. the backup before regenerating). */
  saveCopy(doc: PatternDoc, name: string, options: SaveOptions = {}): WorkSummary {
    const copy: PatternDoc = { ...doc, id: this.newId(), name, cells: doc.cells.slice(), palette: doc.palette.map((p) => ({ ...p })) };
    return this.save(copy, options);
  }

  rename(id: string, name: string): void {
    const loaded = this.load(id);
    if (!loaded) return;
    loaded.doc.name = name;
    this.save(loaded.doc);
  }

  remove(id: string): void {
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
