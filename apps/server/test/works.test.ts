import { randomBytes } from 'node:crypto';
import { docToDraft, EMPTY_CELL, type PatternDoc } from '@pd/editor-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_VERSIONS_PER_WORK } from '../src/works/works.service';
import { registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

const newId = () => randomBytes(8).toString('hex');

function draft(id: string, name = '小猫', paint = 0) {
  const now = Date.now();
  const doc: PatternDoc = {
    id, name, createdAt: now, updatedAt: now, cols: 4, rows: 3, brand: 'MARD', tier: 't72', settings: {},
    cells: new Uint16Array(12).fill(EMPTY_CELL),
    palette: [{ key: 'A1', hex: '#FFFFFF' }, { key: 'H7', hex: '#000000' }],
  };
  for (let i = 0; i <= paint && i < doc.cells.length; i++) doc.cells[i] = i % 2;
  return docToDraft(doc);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(32)]);

describe('works', () => {
  it('creates, reads, updates with revisions and lists', async () => {
    const u = await registerUser(s);
    const id = newId();
    const c = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(id), meta: { source: 'image' } } });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ id, name: '小猫', revision: 1, deleted: false, meta: { source: 'image' } });
    const up = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 1, draft: draft(id, '小狗', 5) } });
    expect(up.body.revision).toBe(2);
    expect(up.body.meta).toEqual({ source: 'image' });
    const g = await s.call('GET', `/works/${id}`, { token: u.token });
    expect(g.body.draft.name).toBe('小狗');
    const l = await s.call('GET', '/works', { token: u.token });
    expect(l.body.map((w: { id: string }) => w.id)).toEqual([id]);
    expect(l.body[0]).not.toHaveProperty('draft');
  });

  it('refuses a stale revision without overwriting', async () => {
    const u = await registerUser(s);
    const id = newId();
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(id) } });
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 1, draft: draft(id, '电脑 A') } });
    const r = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 1, draft: draft(id, '电脑 B') } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('revision_conflict');
    expect((await s.call('GET', `/works/${id}`, { token: u.token })).body.name).toBe('电脑 A');
  });

  it('only one of two simultaneous saves of the same revision wins', async () => {
    const u = await registerUser(s);
    const id = newId();
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(id) } });
    const rs = await Promise.all(
      ['甲', '乙', '丙'].map((n) => s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 1, draft: draft(id, n) } })),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await s.call('GET', `/works/${id}`, { token: u.token })).body.revision).toBe(2);
  });

  it('keeps users apart', async () => {
    const a = await registerUser(s);
    const b = await registerUser(s);
    const id = newId();
    await s.call('PUT', `/works/${id}`, { token: a.token, body: { baseRevision: null, draft: draft(id) } });
    expect((await s.call('GET', `/works/${id}`, { token: b.token })).status).toBe(404);
    expect((await s.call('GET', '/works', { token: b.token })).body).toEqual([]);
    const steal = await s.call('PUT', `/works/${id}`, { token: b.token, body: { baseRevision: null, draft: draft(id, '抢') } });
    expect(steal.body.error.code).toBe('id_taken');
    expect((await s.call('DELETE', `/works/${id}`, { token: b.token })).status).toBe(404);
    expect((await s.call('GET', `/works/${id}`, { token: a.token })).body.name).toBe('小猫');
  });

  it('validates the draft', async () => {
    const u = await registerUser(s);
    const id = newId();
    const bad = { ...draft(id), cells: 'AAAA' };
    const r = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: bad } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_draft');
    const other = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(newId()) } });
    expect(other.body.error.message).toContain('不一致');
    expect((await s.call('PUT', '/works/../x', { token: u.token, body: {} })).status).toBe(404);
    expect((await s.call('GET', '/works/a$b', { token: u.token })).body.error.code).toBe('invalid_id');
  });

  it('deletes softly so sync can see it', async () => {
    const u = await registerUser(s);
    const id = newId();
    const before = new Date(Date.now() - 1000).toISOString();
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(id) } });
    expect((await s.call('DELETE', `/works/${id}`, { token: u.token })).status).toBe(204);
    expect((await s.call('GET', `/works/${id}`, { token: u.token })).status).toBe(404);
    expect((await s.call('GET', '/works', { token: u.token })).body).toEqual([]);
    const changes = await s.call('GET', `/works?since=${encodeURIComponent(before)}`, { token: u.token });
    expect(changes.body).toHaveLength(1);
    expect(changes.body[0]).toMatchObject({ id, deleted: true });
    const revive = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 1, draft: draft(id) } });
    expect(revive.body.error.code).toBe('work_deleted');
  });
});

describe('history', () => {
  it('versions on create, on request and on backup; restores', async () => {
    const u = await registerUser(s);
    const id = newId();
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(id, 'v1') } });
    // within 30 minutes: no automatic version
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 1, draft: draft(id, 'v2') } });
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: 2, draft: draft(id, 'v3'), snapshot: 'backup' } });
    let vs = (await s.call('GET', `/works/${id}/versions`, { token: u.token })).body;
    expect(vs.map((v: { name: string; reason: string }) => `${v.name}:${v.reason}`)).toEqual(['v3:backup', 'v1:auto']);
    vs = (await s.call('POST', `/works/${id}/versions`, { token: u.token })).body;
    expect(vs[0]).toMatchObject({ name: 'v3', reason: 'manual' });

    const v1 = vs.find((v: { name: string }) => v.name === 'v1');
    const one = await s.call('GET', `/works/${id}/versions/${v1.id}`, { token: u.token });
    expect(one.body.draft.name).toBe('v1');
    expect((await s.call('POST', `/works/${id}/versions/${v1.id}/restore`, { token: u.token, body: { baseRevision: 1 } })).status).toBe(409);
    const r = await s.call('POST', `/works/${id}/versions/${v1.id}/restore`, { token: u.token, body: { baseRevision: 3 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'v1', revision: 4 });
    vs = (await s.call('GET', `/works/${id}/versions`, { token: u.token })).body;
    expect(vs[0]).toMatchObject({ name: 'v3', reason: 'restore' });
  });

  it(`keeps at most ${MAX_VERSIONS_PER_WORK} versions`, async () => {
    const u = await registerUser(s);
    const id = newId();
    await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: null, draft: draft(id, 'n0') } });
    for (let i = 1; i <= MAX_VERSIONS_PER_WORK + 2; i++) {
      const r = await s.call('PUT', `/works/${id}`, { token: u.token, body: { baseRevision: i, draft: draft(id, `n${i}`), snapshot: 'manual' } });
      expect(r.status).toBe(200);
    }
    const vs = (await s.call('GET', `/works/${id}/versions`, { token: u.token })).body;
    expect(vs).toHaveLength(MAX_VERSIONS_PER_WORK);
    expect(vs[0].name).toBe(`n${MAX_VERSIONS_PER_WORK + 2}`);
    expect(vs.some((v: { name: string }) => v.name === 'n0')).toBe(false);
  });

  it("does not show another user's versions", async () => {
    const a = await registerUser(s);
    const b = await registerUser(s);
    const id = newId();
    await s.call('PUT', `/works/${id}`, { token: a.token, body: { baseRevision: null, draft: draft(id) } });
    const vs = (await s.call('GET', `/works/${id}/versions`, { token: a.token })).body;
    expect((await s.call('GET', `/works/${id}/versions`, { token: b.token })).status).toBe(404);
    expect((await s.call('GET', `/works/${id}/versions/${vs[0].id}`, { token: b.token })).status).toBe(404);
  });
});

describe('files', () => {
  it('uploads an image, serves it only to its owner, and links it to a work', async () => {
    const a = await registerUser(s);
    const b = await registerUser(s);
    const up = await s.call('POST', '/files', { token: a.token, raw: PNG, type: 'image/png' });
    expect(up.status).toBe(201);
    const key = up.body.key as string;
    expect(key).toMatch(/^[a-f0-9]{24}\.png$/);
    const got = await s.call('GET', `/files/${key}`, { token: a.token });
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.bytes.equals(PNG)).toBe(true);
    expect((await s.call('GET', `/files/${key}`, { token: b.token })).status).toBe(404);

    const id = newId();
    const w = await s.call('PUT', `/works/${id}`, { token: a.token, body: { baseRevision: null, draft: draft(id), thumbKey: key, sourceKey: key } });
    expect(w.body.thumbKey).toBe(key);
    // b cannot reference a's file
    const id2 = newId();
    const bad = await s.call('PUT', `/works/${id2}`, { token: b.token, body: { baseRevision: null, draft: draft(id2), thumbKey: key } });
    expect(bad.body.error.code).toBe('file_not_found');
  });

  it('rejects non-images, wrong types and path tricks', async () => {
    const u = await registerUser(s);
    const txt = await s.call('POST', '/files', { token: u.token, raw: Buffer.from('<svg onload=alert(1)>'), type: 'image/png' });
    expect(txt.body.error.code).toBe('file_type');
    const json = await s.call('POST', '/files', { token: u.token, body: { a: 1 } });
    expect(json.body.error.code).toBe('file_type');
    expect((await s.call('GET', '/files/..%2F..%2Fetc%2Fpasswd', { token: u.token })).status).toBe(404);
    expect((await s.call('POST', '/files', { raw: PNG, type: 'image/png' })).status).toBe(401);
  });

  it('deletes a replaced thumbnail unless another work still uses it', async () => {
    const u = await registerUser(s);
    const k1 = (await s.call('POST', '/files', { token: u.token, raw: PNG, type: 'image/png' })).body.key;
    const k2 = (await s.call('POST', '/files', { token: u.token, raw: PNG, type: 'image/png' })).body.key;
    const a = newId();
    const b = newId();
    await s.call('PUT', `/works/${a}`, { token: u.token, body: { baseRevision: null, draft: draft(a), sourceKey: k1, thumbKey: k1 } });
    await s.call('PUT', `/works/${b}`, { token: u.token, body: { baseRevision: null, draft: draft(b), sourceKey: k1 } });
    await s.call('PUT', `/works/${a}`, { token: u.token, body: { baseRevision: 1, draft: draft(a), thumbKey: k2, sourceKey: null } });
    expect((await s.call('GET', `/files/${k1}`, { token: u.token })).status).toBe(200);
    await s.call('DELETE', `/works/${b}`, { token: u.token });
    expect((await s.call('GET', `/files/${k1}`, { token: u.token })).status).toBe(404);
    expect((await s.call('GET', `/files/${k2}`, { token: u.token })).status).toBe(200);
  });
});

describe('palettes', () => {
  it('serves the palette data with an ETag', async () => {
    const r = await s.call('GET', '/palettes');
    expect(r.status).toBe(200);
    expect(r.body.data.brands).toContain('MARD');
    expect(r.body.data.colors.length).toBeGreaterThan(200);
    const etag = r.headers.get('etag')!;
    const res = await fetch(`${(await s.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/palettes`, { headers: { 'if-none-match': etag } });
    expect(res.status).toBe(304);
  });
});
