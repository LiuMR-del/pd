import type { PatternDraftV1 } from '@pd/editor-core';

/** One saved work in IndexedDB. The source image is kept so the pattern can be regenerated. */
export interface WorkRecord {
  id: string;
  name: string;
  updatedAt: number;
  /** JPEG data URL of the pattern (works list). */
  thumb: string;
  draft: PatternDraftV1;
  /** Downscaled source image and the crop used, or null when unavailable. */
  source: Blob | null;
  crop: { x: number; y: number; w: number; h: number } | null;
  /** Account (user id) the work belongs to; absent = made while signed out, on this device only. */
  owner?: string;
  /** Server copy this record was last synced with; absent = never uploaded. */
  cloud?: { revision: number; sourceKey: string | null };
  /** Changed locally since the last upload. */
  dirty?: boolean;
}

export type WorkSummary = Pick<WorkRecord, 'id' | 'name' | 'updatedAt' | 'thumb' | 'owner' | 'dirty'> & { synced: boolean };

const DB_NAME = 'pd-web';
const STORE = 'works';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('无法打开本机存储'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('本机存储失败'));
        tx.onabort = () => reject(tx.error ?? new Error('本机存储失败（可能空间不足）'));
      }),
  );
}

export function putWork(rec: WorkRecord): Promise<IDBValidKey> {
  return run('readwrite', (s) => s.put(rec));
}

export function getWork(id: string): Promise<WorkRecord | undefined> {
  return run('readonly', (s) => s.get(id) as IDBRequest<WorkRecord | undefined>);
}

export function deleteWork(id: string): Promise<undefined> {
  return run('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

export function allWorks(): Promise<WorkRecord[]> {
  return run('readonly', (s) => s.getAll() as IDBRequest<WorkRecord[]>);
}

/**
 * Works visible to `userId` (null = signed out): this device's own works plus that account's,
 * most recently edited first, without the heavy draft / source fields.
 */
export async function listWorks(userId: string | null): Promise<WorkSummary[]> {
  const all = await allWorks();
  return all
    .filter((w) => !w.owner || w.owner === userId)
    .map(({ id, name, updatedAt, thumb, owner, dirty, cloud }) => ({ id, name, updatedAt, thumb, owner, dirty, synced: !!cloud && !dirty }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

let lock: Promise<unknown> = Promise.resolve();
/**
 * Runs read-modify-write steps on work records one at a time (autosave and cloud sync both update
 * records). Keep network calls outside: the lock is meant for short IndexedDB work only.
 */
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.catch(() => undefined);
  return next;
}

export function newId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 16);
}

// v2 (2026-11-03): the palette default changed from all 291 colors to the 221-color kit
const SETTINGS_KEY = 'pd-web:settings:v2';

export function loadLastSettings(): unknown {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveLastSettings(s: unknown): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota: settings are a convenience only */
  }
}
