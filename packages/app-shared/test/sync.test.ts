import type { PatternDraftV1 } from '@pd/editor-core';
import { describe, expect, it } from 'vitest';
import { copyName, SyncEngine, SyncHttpError, type CloudState, type RemoteSummary, type RemoteWork, type SyncStore, type SyncTransport, type SyncWork } from '../src/sync';

// A fake server with the same rules as apps/server (revisions, soft delete, error codes) and a fake
// local store; two "devices" can share one server.

const draft = (id: string, name: string, paint = 0): PatternDraftV1 =>
  ({ v: 1, id, name, createdAt: 1, updatedAt: 1000 + paint, cols: 1, rows: 1, brand: 'MARD', tier: 'all', settings: {}, palette: [], cells: `p${paint}` }) as unknown as PatternDraftV1;

interface Row {
  userId: string;
  revision: number;
  draft: PatternDraftV1;
  meta: { crop?: unknown } | null;
  sourceKey: string | null;
  deleted: boolean;
  updatedAt: string;
}

class FakeServer {
  rows = new Map<string, Row>();
  files = new Map<string, string>();
  offline = false;
  private clock = Date.parse('2026-11-07T00:00:00Z');
  private tick = () => new Date((this.clock += 1000)).toISOString();

  summary(id: string, r: Row): RemoteSummary {
    return { id, name: r.draft.name, revision: r.revision, updatedAt: r.updatedAt, deleted: r.deleted, sourceKey: r.sourceKey };
  }

  /** A change made on some other device. */
  edit(id: string, name: string, paint: number): void {
    const r = this.rows.get(id)!;
    Object.assign(r, { draft: draft(id, name, paint), revision: r.revision + 1, updatedAt: this.tick() });
  }

  transport(userId: string): SyncTransport & { calls: string[] } {
    const calls: string[] = [];
    const fail = (status: number, code: string, msg = code) => {
      throw new SyncHttpError(msg, status, code);
    };
    return {
      calls,
      uploadSource: async (w) => {
        const key = `f${this.files.size + 1}`;
        this.files.set(key, `photo of ${w.id}`);
        calls.push(`upload ${w.id}`);
        return key;
      },
      request: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        if (this.offline) throw new SyncHttpError('连不上', 0, 'offline', true);
        calls.push(`${method} ${path}`);
        const [pathname, query = ''] = path.split('?');
        const param = (k: string) => {
          const m = new RegExp(`(?:^|&)${k}=([^&]*)`).exec(query);
          return m ? decodeURIComponent(m[1]) : null;
        };
        const id = decodeURIComponent(pathname.split('/')[2] ?? '');
        const row = this.rows.get(id);
        if (method === 'GET' && !id) {
          const since = param('since');
          const out = [...this.rows].filter(([, r]) => r.userId === userId && (since ? r.updatedAt > since : !r.deleted));
          return out.map(([k, r]) => this.summary(k, r)) as T;
        }
        if (method === 'GET') {
          if (!row || row.userId !== userId || row.deleted) fail(404, 'work_not_found');
          return { ...this.summary(id, row!), draft: row!.draft, meta: row!.meta } as T;
        }
        if (method === 'PUT') {
          const b = body as { baseRevision: number | null; draft: PatternDraftV1; meta: Row['meta']; sourceKey: string | null };
          if (row && row.userId !== userId) fail(409, 'id_taken');
          if (row?.deleted) fail(409, 'work_deleted');
          if (!row && b.baseRevision) fail(404, 'work_not_found');
          if (row && b.baseRevision !== row.revision) fail(409, 'revision_conflict', '这个作品已在别处修改过');
          const next: Row = { userId, revision: (row?.revision ?? 0) + 1, draft: b.draft, meta: b.meta, sourceKey: b.sourceKey, deleted: false, updatedAt: this.tick() };
          this.rows.set(id, next);
          return { ...this.summary(id, next), draft: next.draft, meta: next.meta } as T;
        }
        if (method === 'DELETE') {
          if (!row || row.userId !== userId) fail(404, 'work_not_found');
          if (row!.deleted) return undefined as T;
          const base = param('baseRevision');
          if (base && Number(base) !== row!.revision) fail(409, 'revision_conflict');
          Object.assign(row!, { deleted: true, revision: row!.revision + 1, updatedAt: this.tick(), sourceKey: null });
          return undefined as T;
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    };
  }
}

class FakeStore implements SyncStore {
  works = new Map<string, SyncWork>();
  /** photo file "contents" by work id */
  photos = new Map<string, string>();
  private n = 0;
  constructor(private readonly server: FakeServer) {}

  /** A local edit (like the editor saving). */
  edit(id: string, name: string, paint: number, owner?: string): void {
    const cur = this.works.get(id);
    this.works.set(id, { id, name, draft: draft(id, name, paint), owner: cur?.owner ?? owner ?? null, cloud: cur?.cloud ?? null, dirty: true, hasSource: this.photos.has(id), crop: null });
  }

  async all() {
    return [...this.works.values()].map((w) => ({ ...w }));
  }
  async get(id: string) {
    const w = this.works.get(id);
    return w && { ...w };
  }
  async storeRemote(uid: string, w: RemoteWork, sourceChanged: boolean) {
    if (sourceChanged) {
      if (w.sourceKey) this.photos.set(w.id, this.server.files.get(w.sourceKey)!);
      else this.photos.delete(w.id);
    }
    this.works.set(w.id, { id: w.id, name: w.name, draft: w.draft, owner: uid, cloud: { revision: w.revision, sourceKey: w.sourceKey }, dirty: false, hasSource: this.photos.has(w.id), crop: w.meta?.crop ?? null });
  }
  async fork(uid: string, id: string, name: string) {
    const src = this.works.get(id)!;
    const nid = `copy${++this.n}`;
    if (this.photos.has(id)) this.photos.set(nid, this.photos.get(id)!);
    this.works.set(nid, { ...src, id: nid, name, draft: { ...src.draft, id: nid, name }, owner: uid, cloud: null, dirty: true });
    return nid;
  }
  async uploaded(id: string, snap: SyncWork, cloud: CloudState) {
    const cur = this.works.get(id);
    if (!cur) return false;
    const same = cur.draft.updatedAt === snap.draft.updatedAt && cur.name === snap.name;
    this.works.set(id, { ...cur, cloud, dirty: !same });
    return !same;
  }
  async setOwnerDirty(id: string, owner: string, dirty: boolean) {
    const cur = this.works.get(id);
    if (cur) this.works.set(id, { ...cur, owner, dirty });
  }
  async remove(id: string) {
    this.works.delete(id);
    this.photos.delete(id);
  }
  async flush() {}
}

function kv() {
  const m = new Map<string, unknown>();
  return { m, get: (k: string) => m.get(k), set: (k: string, v: unknown) => (v === null ? m.delete(k) : m.set(k, v)) };
}

function device(server: FakeServer, uid = 'u1') {
  const store = new FakeStore(server);
  const transport = server.transport(uid);
  const notes: string[] = [];
  const engine = new SyncEngine(transport, store, kv(), { notify: (m) => notes.push(m) });
  engine.setUser(uid);
  return { store, transport, engine, notes };
}

const names = (s: FakeStore) => [...s.works.values()].map((w) => w.name).sort();

describe('SyncEngine', () => {
  it('uploads new works (with the photo) and downloads them on another device', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.photos.set('w1', 'cat.jpg');
    a.store.edit('w1', '小猫', 1, 'u1');
    await a.engine.syncNow();
    expect(a.engine.status).toBe('synced');
    expect(a.store.works.get('w1')).toMatchObject({ dirty: false, cloud: { revision: 1, sourceKey: 'f1' } });

    const b = device(server);
    await b.engine.syncNow();
    expect(b.store.works.get('w1')).toMatchObject({ name: '小猫', owner: 'u1', dirty: false, cloud: { revision: 1 } });
    expect(b.store.photos.get('w1')).toBe('photo of w1');
  });

  it('does not upload works of nobody (made signed out) or of another account', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('anon', '没登录时做的', 1);
    a.store.edit('other', '别人的', 1, 'u2');
    await a.engine.syncNow();
    expect(server.rows.size).toBe(0);
  });

  it('pulls edits made elsewhere; a second round with the cursor only asks for changes', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', 'v1', 1, 'u1');
    await a.engine.syncNow();
    server.edit('w1', 'v2', 2);
    await a.engine.syncNow();
    expect(a.store.works.get('w1')).toMatchObject({ name: 'v2', cloud: { revision: 2 }, dirty: false });
    server.edit('w1', 'v3', 3);
    await a.engine.syncNow();
    expect(a.store.works.get('w1')!.name).toBe('v3');
    expect(a.transport.calls.filter((c) => c.startsWith('GET /works?since=')).length).toBeGreaterThan(0);
  });

  it('both sides changed: keeps the local edit as 「（冲突副本）」 and takes the remote version', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', '小猫', 1, 'u1');
    await a.engine.syncNow();
    server.edit('w1', '小猫', 5); // other device
    a.store.edit('w1', '小猫', 9); // this device, offline meanwhile
    await a.engine.syncNow();
    expect(names(a.store)).toEqual(['小猫', '小猫（冲突副本）']);
    expect(a.store.works.get('w1')).toMatchObject({ dirty: false, cloud: { revision: 2 } });
    expect((a.store.works.get('w1')!.draft as unknown as { cells: string }).cells).toBe('p5');
    // the copy was uploaded as a new work
    expect(server.rows.size).toBe(2);
    expect(a.notes.join()).toContain('冲突副本');
  });

  it('a push that loses the race (409) also ends with both versions', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', '甲', 1, 'u1');
    await a.engine.syncNow();
    a.store.edit('w1', '甲', 3);
    // the other device saves between this device's pull and push
    const real = a.transport.request;
    let once = true;
    a.transport.request = (async (method: 'PUT', path: string, body?: unknown) => {
      if (method === 'PUT' && once) {
        once = false;
        server.edit('w1', '甲', 7);
      }
      return real(method, path, body);
    }) as typeof real;
    await a.engine.syncNow();
    expect(names(a.store)).toEqual(['甲', '甲（冲突副本）']);
    expect(a.store.works.get('w1')).toMatchObject({ dirty: false, cloud: { revision: 2 } });
    expect((a.store.works.get('w1')!.draft as unknown as { cells: string }).cells).toBe('p7');
  });

  it('deleted elsewhere: removed here, or kept as 「（已在别处删除）」 when edited here', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', '留着', 1, 'u1');
    a.store.edit('w2', '改过', 1, 'u1');
    await a.engine.syncNow();
    const b = device(server);
    await b.engine.syncNow();
    for (const id of ['w1', 'w2']) {
      await b.store.remove(id);
      b.engine.deleted(id, 1);
    }
    await b.engine.syncNow();
    expect(server.rows.get('w1')!.deleted).toBe(true);
    a.store.edit('w2', '改过', 4);
    await a.engine.syncNow();
    expect(names(a.store)).toEqual(['改过（已在别处删除）']);
  });

  it('a delete loses to a newer edit elsewhere: the work comes back', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', '作品', 1, 'u1');
    await a.engine.syncNow();
    server.edit('w1', '作品', 2);
    await a.store.remove('w1');
    a.engine.deleted('w1', 1);
    await a.engine.syncNow();
    expect(server.rows.get('w1')!.deleted).toBe(false);
    expect(a.store.works.get('w1')).toMatchObject({ cloud: { revision: 2 } });
    expect(a.notes.join()).toContain('没有删除');
  });

  it('offline: status offline, local changes stay dirty and go up later', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', '离线', 1, 'u1');
    server.offline = true;
    await a.engine.syncNow();
    expect(a.engine.status).toBe('offline');
    expect(a.store.works.get('w1')!.dirty).toBe(true);
    server.offline = false;
    await a.engine.syncNow();
    expect(a.engine.status).toBe('synced');
    expect(server.rows.get('w1')!.revision).toBe(1);
  });

  it('edited again during the upload: stays dirty and is uploaded in the same sync', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.store.edit('w1', 'v1', 1, 'u1');
    const real = a.transport.request;
    let once = true;
    a.transport.request = (async (method: 'PUT', path: string, body?: unknown) => {
      const r = await real(method, path, body);
      if (method === 'PUT' && once) {
        once = false;
        a.store.edit('w1', 'v1', 2);
      }
      return r;
    }) as typeof real;
    await a.engine.syncNow();
    expect(server.rows.get('w1')!.revision).toBe(2);
    expect(a.store.works.get('w1')!.dirty).toBe(false);
  });

  it('signed out: nothing syncs', async () => {
    const server = new FakeServer();
    const a = device(server);
    a.engine.setUser(null);
    a.store.edit('w1', 'x', 1, 'u1');
    await a.engine.syncNow();
    expect(server.rows.size).toBe(0);
    expect(a.engine.status).toBe('idle');
  });

  it('copy names keep the suffix when the name is long', () => {
    expect(copyName('小猫', '（冲突副本）')).toBe('小猫（冲突副本）');
    const long = 'x'.repeat(80);
    expect(copyName(long, '（冲突副本）')).toHaveLength(60);
    expect(copyName(long, '（冲突副本）').endsWith('（冲突副本）')).toBe(true);
  });

  it('keeps instanceof after ES5-style prototype loss', () => {
    const e = new SyncHttpError('x', 409, 'revision_conflict');
    expect(e).toBeInstanceOf(SyncHttpError);
    expect(e.code).toBe('revision_conflict');
  });
});
