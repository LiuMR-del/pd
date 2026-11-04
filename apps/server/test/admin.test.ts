import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { paletteData } from '@pd/palettes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validatePalette } from '../src/admin/palette-schema';
import { hashPassword } from '../src/auth/crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { registerUser, startServer, uniqueName, type TestServer } from './helpers';

let s: TestServer;
let adminToken = '';
const adminName = uniqueName('adm').toLowerCase();

beforeAll(async () => {
  s = await startServer();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.searchParams.set('allowPublicKeyRetrieval', 'true');
  const db = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });
  await db.admin.create({ data: { username: adminName, passwordHash: await hashPassword('admin-pass-123'), role: 'owner' } });
  await db.$disconnect();
  const r = await s.call('POST', '/admin/login', { body: { username: adminName, password: 'admin-pass-123' } });
  adminToken = r.body.accessToken;
});
afterAll(() => s.close());

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('palette validation', () => {
  it('accepts the shipped palette data', () => {
    const r = validatePalette(clone(paletteData));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('reports duplicate codes, bad colors and broken tiers', () => {
    const d = clone(paletteData);
    d.colors[1].codes.MARD = d.colors[0].codes.MARD;
    d.colors[2].hex = 'red';
    d.tiers[0].colorIds.push(99999);
    const r = validatePalette(d);
    expect(r.ok).toBe(false);
    const r2 = validatePalette({ ...clone(paletteData), colors: clone(paletteData.colors).map((c, i) => (i === 1 ? { ...c, codes: { ...c.codes, MARD: paletteData.colors[0].codes.MARD } } : c)) });
    expect(r2.ok ? '' : r2.errors.join()).toContain('重复');
  });
});

describe('admin', () => {
  it('logs in; user tokens are not admin tokens and vice versa', async () => {
    expect(adminToken).toBeTruthy();
    expect((await s.call('POST', '/admin/login', { body: { username: adminName, password: 'wrong-pass' } })).status).toBe(401);
    const u = await registerUser(s);
    expect((await s.call('GET', '/admin/users', { token: u.token })).status).toBe(401);
    expect((await s.call('GET', '/me', { token: adminToken })).status).toBe(401);
    expect((await s.call('GET', '/admin/me', { token: adminToken })).body.username).toBe(adminName);
  });

  it('publishes an edited palette that clients then receive', async () => {
    const cur = await s.call('GET', '/admin/palettes', { token: adminToken });
    expect(cur.status).toBe(200);
    const data = clone(cur.body.data);
    const newHex = data.colors[0].hex === '#123456' ? '#654321' : '#123456';
    data.colors[0].hex = newHex;
    expect((await s.call('PUT', '/admin/palettes', { token: adminToken, body: { data, note: '' } })).status).toBe(400);
    const bad = clone(data);
    bad.colors[0].hex = 'nope';
    const rb = await s.call('PUT', '/admin/palettes', { token: adminToken, body: { data: bad, note: '测试' } });
    expect(rb.body.error.code).toBe('invalid_palette');
    const ok = await s.call('PUT', '/admin/palettes', { token: adminToken, body: { data, note: '改第一个颜色' } });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBeGreaterThan(cur.body.version);
    const pub = await s.call('GET', '/palettes');
    expect(pub.body.version).toBe(ok.body.version);
    expect(pub.body.data.colors[0].hex).toBe(newHex);
    // restore the original data for other runs
    const back = clone(data);
    back.colors[0].hex = cur.body.data.colors[0].hex;
    await s.call('PUT', '/admin/palettes', { token: adminToken, body: { data: back, note: '测试后还原' } });
  });

  it('lists users with work counts and search', async () => {
    const u = await registerUser(s);
    const r = await s.call('GET', `/admin/users?q=${u.username}`, { token: adminToken });
    expect(r.body.total).toBe(1);
    expect(r.body.items[0]).toMatchObject({ username: u.username.toLowerCase(), works: 0, wechat: false });
    expect(r.body.items[0]).not.toHaveProperty('passwordHash');
  });
});
