import type { PatternDraftV1 } from '@pd/editor-core';

// timers exist on every platform this runs on (browser, WeChat, Node), but this package compiles
// against plain ES2020 without DOM / Node types
declare const setTimeout: (fn: () => void, ms: number) => unknown;
declare const clearTimeout: (id: unknown) => void;

/**
 * Cloud sync engine, platform independent (used by the mini-program; same rules as the web app's
 * `apps/web/src/cloud.ts`). The local store stays primary (works offline); a sync round
 *   1. sends deletes made on this device (a newer change elsewhere cancels the delete),
 *   2. pulls changes since the last cursor (a little further back, so out-of-order commits are not
 *      missed) and applies them,
 *   3. pushes works with local changes (baseRevision = the revision they were edited from).
 * Conflicts never overwrite anything: the local side is kept as a new work 「…（冲突副本）」, a work
 * deleted elsewhere but edited here is kept as 「…（已在别处删除）」.
 */

export interface CloudState {
  revision: number;
  /** Server file key of the work's source photo. */
  sourceKey: string | null;
}

/** What the engine needs to know about a local work. */
export interface SyncWork {
  id: string;
  name: string;
  draft: PatternDraftV1;
  /** Account the work belongs to; null / undefined = made while signed out. */
  owner?: string | null;
  /** Last state known to be on the server; absent = never uploaded. */
  cloud?: CloudState | null;
  /** Changed locally since the last upload / download. */
  dirty?: boolean;
  /** A source photo is stored with the work on this device. */
  hasSource: boolean;
  crop: unknown;
}

export interface RemoteSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  deleted: boolean;
  sourceKey: string | null;
}

export interface RemoteWork extends RemoteSummary {
  draft: PatternDraftV1;
  meta: { crop?: unknown } | null;
}

/** An API failure: `offline` when the server could not be reached at all. */
export class SyncHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly offline = false,
  ) {
    super(message);
    // keep `instanceof` working after ES5 compilation (WeChat DevTools)
    Object.setPrototypeOf(this, SyncHttpError.prototype);
    this.name = 'SyncHttpError';
  }
}

export interface SyncTransport {
  /** JSON request to the API (path relative to /api). Throws SyncHttpError. */
  request<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>;
  /** Upload the source photo stored with this local work; returns its file key. */
  uploadSource(work: SyncWork): Promise<string>;
  /** Download a photo; returns a platform handle (temp file path, Blob…) for SyncStore.storeRemote. */
  fetchSource(key: string): Promise<unknown>;
}

export interface SyncStore {
  all(): Promise<SyncWork[]>;
  get(id: string): Promise<SyncWork | undefined>;
  /**
   * Store a downloaded work as synced (owner `uid`, not dirty). `source`: undefined = keep the local
   * photo, null = the work has no photo any more, otherwise a handle from SyncTransport.fetchSource.
   * Should not wait on the network (edits made meanwhile would be overwritten).
   */
  storeRemote(uid: string, w: RemoteWork, source: unknown): Promise<void>;
  /** Keep a work under a new id and `name`, owned by `uid`, not uploaded yet. Returns the new id. */
  fork(uid: string, id: string, name: string): Promise<string>;
  /** After an upload of `snap`: record `cloud`; the work stays dirty when it changed meanwhile. Returns that. */
  uploaded(id: string, snap: SyncWork, cloud: CloudState): Promise<boolean>;
  setOwnerDirty(id: string, owner: string, dirty: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  /** Write edits still held in memory by an open editor: they count as local changes. */
  flush(): Promise<void>;
}

export interface SyncKV {
  get(key: string): unknown;
  /** null removes the key. */
  set(key: string, value: unknown): void;
}

export interface SyncEvents {
  /** A short message for the user (e.g. a conflict copy was made). */
  notify?(message: string): void;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface PendingDelete {
  id: string;
  /** Revision the user saw when deleting: newer changes elsewhere cancel the delete. */
  revision: number;
}

/** Name for a copy that keeps one side of a conflict (the suffix always survives truncation). */
export function copyName(name: string, suffix: string): string {
  return name.slice(0, Math.max(1, 60 - suffix.length)) + suffix;
}

export class SyncEngine {
  status: SyncStatus = 'idle';
  /** Last error / limit message for the user, '' when none. */
  message = '';
  lastSync = 0;
  private uid: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: unknown;
  private listeners = new Set<() => void>();

  constructor(
    private readonly transport: SyncTransport,
    private readonly store: SyncStore,
    private readonly kv: SyncKV,
    private readonly events: SyncEvents = {},
    /** Prefix of the key-value keys (cursor, pending deletes). */
    private readonly prefix = 'pd:sync',
  ) {}

  get user(): string | null {
    return this.uid;
  }

  /** Called on every status change (and after every round, so lists can refresh). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Signed in as `uid` (null = signed out: nothing syncs). `fresh` forgets the cursor (full listing). */
  setUser(uid: string | null, fresh = false): void {
    if (uid === this.uid && !fresh) return;
    clearTimeout(this.timer);
    this.uid = uid;
    this.status = 'idle';
    this.message = '';
    if (uid && fresh) this.kv.set(this.cursorKey(uid), null);
    this.emit();
  }

  /** Forget everything stored for `uid` (account deleted). */
  forget(uid: string): void {
    this.kv.set(this.cursorKey(uid), null);
    this.kv.set(this.pendingKey(uid), null);
  }

  /** Record a work deleted on this device (sent on the next round). */
  deleted(id: string, revision: number): void {
    const uid = this.uid;
    if (!uid) return;
    const list = this.pending(uid).filter((p) => p.id !== id);
    this.kv.set(this.pendingKey(uid), [...list, { id, revision }]);
    this.schedule(0);
  }

  schedule(delay = 2000): void {
    if (!this.uid) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow().catch(() => undefined), delay);
  }

  /** Runs one sync round (or waits for the running one and runs again). Never throws for API errors. */
  syncNow(): Promise<void> {
    if (!this.uid) return Promise.resolve();
    clearTimeout(this.timer);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.round();
        } while (this.again && this.uid);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async round(): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    this.status = 'syncing';
    this.emit();
    try {
      await this.pushDeletes(uid);
      await this.pull(uid);
      await this.push(uid);
      if (this.uid !== uid) return;
      this.status = 'synced';
      this.lastSync = Date.now();
      if (this.message && !this.message.startsWith('云端最多')) this.message = '';
    } catch (e) {
      if (this.uid !== uid) return;
      const offline = e instanceof SyncHttpError && e.offline;
      this.status = offline ? 'offline' : 'error';
      this.message = offline ? '' : `同步失败：${e instanceof Error ? e.message : String(e)}`;
      // 401: the caller's transport signs the user out
    } finally {
      this.emit();
    }
  }

  private async pushDeletes(uid: string): Promise<void> {
    for (const p of this.pending(uid)) {
      try {
        await this.transport.request('DELETE', `/works/${encodeURIComponent(p.id)}${p.revision ? `?baseRevision=${p.revision}` : ''}`);
      } catch (e) {
        if (e instanceof SyncHttpError && e.code === 'revision_conflict') {
          // changed on another device after this one deleted it: bring it back with a full listing
          this.kv.set(this.cursorKey(uid), null);
          this.events.notify?.('有个作品在别的设备上改过，没有删除，已重新下载');
        } else if (!(e instanceof SyncHttpError && e.status === 404)) throw e;
      }
      this.kv.set(
        this.pendingKey(uid),
        this.pending(uid).filter((x) => x.id !== p.id),
      );
    }
  }

  private async pull(uid: string): Promise<void> {
    await this.store.flush();
    const since = this.cursor(uid);
    const from = since ? new Date(Date.parse(since) - 10_000).toISOString() : null;
    const list = await this.transport.request<RemoteSummary[]>('GET', from ? `/works?since=${encodeURIComponent(from)}` : '/works');
    let cursor = since;
    for (const r of list) {
      if (this.uid !== uid) return;
      await this.applyRemote(uid, r);
      if (!cursor || r.updatedAt > cursor) cursor = r.updatedAt;
    }
    if (!since) {
      // full listing: synced works missing from it were deleted elsewhere while we had no cursor
      const live = new Set(list.map((r) => r.id));
      for (const w of await this.store.all()) {
        if (w.owner === uid && w.cloud && !live.has(w.id))
          await this.applyRemote(uid, { id: w.id, name: w.name, revision: w.cloud.revision, updatedAt: '', deleted: true, sourceKey: null });
      }
    }
    if (cursor && this.uid === uid) this.kv.set(this.cursorKey(uid), cursor);
  }

  private async applyRemote(uid: string, r: RemoteSummary): Promise<void> {
    await this.store.flush();
    const local = await this.store.get(r.id);
    if (local?.owner && local.owner !== uid) return;
    if (r.deleted) {
      if (!local) return;
      if (local.dirty) await this.fork(uid, local, '（已在别处删除）');
      await this.store.remove(r.id);
      return;
    }
    if (local && (local.cloud?.revision ?? 0) >= r.revision) return;
    if (local?.dirty) await this.fork(uid, local, '（冲突副本）');
    await this.download(uid, r.id, local);
  }

  private async download(uid: string, id: string, local?: SyncWork): Promise<void> {
    const w = await this.transport.request<RemoteWork>('GET', `/works/${encodeURIComponent(id)}`);
    const sourceChanged = (w.sourceKey ?? null) !== (local?.cloud?.sourceKey ?? null) || (!!w.sourceKey && !local?.hasSource);
    // undefined: keep the local photo; null: the work has none now; otherwise the fetched photo
    let source: unknown = sourceChanged ? null : undefined;
    if (sourceChanged && w.sourceKey) {
      try {
        source = await this.transport.fetchSource(w.sourceKey);
      } catch (e) {
        // offline / signed out: stop this round; any other failure (file gone…): keep the local photo,
        // the pattern itself still syncs (and the photo is fetched again with the next version)
        if (!(e instanceof SyncHttpError) || e.offline || e.status === 401) throw e;
        source = undefined;
      }
    }
    // edited while downloading: keep those edits as a copy (edits that were dirty before were
    // already kept by the caller; only a newer edit counts)
    await this.store.flush();
    const now = await this.store.get(id);
    if (now?.dirty && (!local?.dirty || now.draft.updatedAt !== local.draft.updatedAt || now.name !== local.name)) await this.fork(uid, now, '（冲突副本）');
    await this.store.storeRemote(uid, w, source);
  }

  private async fork(uid: string, snap: SyncWork, suffix: string): Promise<string> {
    const id = await this.store.fork(uid, snap.id, suffix ? copyName(snap.name, suffix) : snap.name);
    this.events.notify?.(suffix ? `「${snap.name}」在别处也改过，你的修改另存为「${copyName(snap.name, suffix)}」` : '作品已另存一份');
    this.again = true;
    return id;
  }

  private async push(uid: string): Promise<void> {
    const todo = (await this.store.all()).filter((w) => w.owner === uid && (w.dirty || !w.cloud));
    for (const snap of todo) {
      if (this.uid !== uid) return;
      try {
        await this.upload(snap);
      } catch (e) {
        if (!(e instanceof SyncHttpError) || e.offline || e.status === 401) throw e;
        if (e.code === 'revision_conflict') {
          await this.fork(uid, snap, '（冲突副本）');
          await this.store.setOwnerDirty(snap.id, uid, false);
          await this.download(uid, snap.id, { ...snap, dirty: false });
        } else if (e.code === 'work_deleted' || e.code === 'id_taken' || e.code === 'work_not_found') {
          await this.fork(uid, snap, e.code === 'work_deleted' ? '（已在别处删除）' : '');
          await this.store.remove(snap.id);
        } else if (e.code === 'too_many_works') {
          this.message = e.message;
          return;
        } else {
          // a bad record must not block the others; it stays dirty and is retried later
          this.message = `「${snap.name}」上传失败：${e.message}`;
        }
      }
    }
  }

  private async upload(snap: SyncWork): Promise<void> {
    // the photo already in the cloud stays (also when this device could not fetch it); a local photo
    // not uploaded yet goes up first
    let sourceKey = snap.cloud?.sourceKey ?? null;
    if (snap.hasSource && !sourceKey) sourceKey = await this.transport.uploadSource(snap);
    const res = await this.transport.request<RemoteWork>('PUT', `/works/${encodeURIComponent(snap.id)}`, {
      baseRevision: snap.cloud?.revision ?? null,
      draft: snap.draft,
      meta: { crop: snap.crop },
      sourceKey,
    });
    if (await this.store.uploaded(snap.id, snap, { revision: res.revision, sourceKey })) this.again = true;
  }

  private cursor(uid: string): string | null {
    const v = this.kv.get(this.cursorKey(uid));
    return typeof v === 'string' && v ? v : null;
  }

  private pending(uid: string): PendingDelete[] {
    const v = this.kv.get(this.pendingKey(uid));
    return Array.isArray(v) ? (v as PendingDelete[]).filter((p) => p && typeof p.id === 'string') : [];
  }

  private cursorKey(uid: string): string {
    return `${this.prefix}:cursor:${uid}`;
  }

  private pendingKey(uid: string): string {
    return `${this.prefix}:pending-deletes:${uid}`;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
