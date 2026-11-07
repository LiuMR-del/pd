import { docToDraft, EMPTY_CELL, type PatternDoc } from '@pd/editor-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { registerUser, startServer, uniqueName, type TestServer } from './helpers';

let s: TestServer;
const wxCalls: string[] = [];
beforeAll(async () => {
  s = await startServer({
    wxFetch: async (url) => {
      wxCalls.push(url);
      const code = new URL(url).searchParams.get('js_code');
      return { json: async () => (code === 'bad' ? { errcode: 40029, errmsg: 'invalid code' } : { openid: `openid-${code}` }) };
    },
  });
});
afterAll(() => s.close());

describe('health', () => {
  it('reports the database and the source URL (AGPL §13)', async () => {
    const r = await s.call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, source: 'https://github.com/LiuMR-del/pd' });
  });
  it('unknown routes use the error format', async () => {
    const r = await s.call('GET', '/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('http_404');
  });
});

describe('register / login', () => {
  it('registers, then logs in case-insensitively', async () => {
    const u = await registerUser(s);
    const me = await s.call('GET', '/me', { token: u.token });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ username: u.username.toLowerCase(), hasPassword: true, hasWechat: false });
    const r = await s.call('POST', '/auth/login', { body: { username: u.username.toUpperCase(), password: u.password } });
    expect(r.status).toBe(200);
    expect(r.body.tokens.accessToken).toBeTruthy();
    expect(r.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects taken names, bad names and short passwords', async () => {
    const u = await registerUser(s);
    expect((await s.call('POST', '/auth/register', { body: { username: u.username.toUpperCase(), password: 'password123' } })).body.error.code).toBe('username_taken');
    const bad = await s.call('POST', '/auth/register', { body: { username: 'a b', password: 'password123' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('用户名');
    const short = await s.call('POST', '/auth/register', { body: { username: uniqueName(), password: 'short' } });
    expect(short.body.error.message).toContain('至少 8 位');
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const u = await registerUser(s);
    const a = await s.call('POST', '/auth/login', { body: { username: u.username, password: 'wrong-password' } });
    const b = await s.call('POST', '/auth/login', { body: { username: uniqueName('ghost'), password: 'wrong-password' } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('limits repeated login attempts for one username', async () => {
    const u = await registerUser(s);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await s.call('POST', '/auth/login', { body: { username: u.username, password: 'nope' } })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('tokens', () => {
  it('requires a token for /me and refuses garbage', async () => {
    expect((await s.call('GET', '/me')).status).toBe(401);
    expect((await s.call('GET', '/me', { token: 'x.y.z' })).body.error.code).toBe('token_expired');
  });

  it('rotates refresh tokens; replaying an old one revokes every session', async () => {
    const u = await registerUser(s);
    const r1 = await s.call('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    expect(r1.status).toBe(200);
    const next = r1.body.refreshToken as string;
    expect(next).not.toBe(u.refresh);
    s.app.get(AuthService).graceMs = 0;
    const replay = await s.call('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    s.app.get(AuthService).graceMs = 30_000;
    expect(replay.body.error.code).toBe('refresh_reused');
    // the legit newer token was revoked too (after the grace period a replay signs everyone out)
    expect((await s.call('POST', '/auth/refresh', { body: { refreshToken: next } })).status).toBe(401);
  });

  it('a token rotated moments ago (another tab) does not sign everyone out', async () => {
    const u = await registerUser(s);
    const fresh = (await s.call('POST', '/auth/refresh', { body: { refreshToken: u.refresh } })).body.refreshToken;
    const raced = await s.call('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    expect(raced.body.error.code).toBe('refresh_raced');
    expect((await s.call('POST', '/auth/refresh', { body: { refreshToken: fresh } })).status).toBe(200);
  });

  it('refuses the example JWT secret', async () => {
    const { loadConfig } = await import('../src/config');
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x@y/z', JWT_SECRET: 'change-me-change-me-change-me-change-me' })).toThrow('示例值');
  });

  it('logout revokes the refresh token', async () => {
    const u = await registerUser(s);
    expect((await s.call('POST', '/auth/logout', { body: { refreshToken: u.refresh } })).status).toBe(204);
    expect((await s.call('POST', '/auth/refresh', { body: { refreshToken: u.refresh } })).status).toBe(401);
  });
});

describe('profile', () => {
  it('updates the nickname', async () => {
    const u = await registerUser(s);
    const r = await s.call('PATCH', '/me', { token: u.token, body: { nickname: ' 小豆 ' } });
    expect(r.body.nickname).toBe('小豆');
    expect((await s.call('PATCH', '/me', { token: u.token, body: { nickname: '' } })).status).toBe(400);
    // PUT works too (wx.request has no PATCH)
    expect((await s.call('PUT', '/me', { token: u.token, body: { nickname: '大豆' } })).body.nickname).toBe('大豆');
  });

  it('changes the password and signs out other sessions', async () => {
    const u = await registerUser(s);
    expect((await s.call('PUT', '/me/password', { token: u.token, body: { oldPassword: 'bad-old-pass', newPassword: 'newpass123' } })).status).toBe(401);
    const r = await s.call('PUT', '/me/password', { token: u.token, body: { oldPassword: u.password, newPassword: 'newpass123' } });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).toBeTruthy();
    expect((await s.call('POST', '/auth/refresh', { body: { refreshToken: u.refresh } })).status).toBe(401);
    expect((await s.call('POST', '/auth/login', { body: { username: u.username, password: 'newpass123' } })).status).toBe(200);
  });

  it('deletes the account after checking the password', async () => {
    const u = await registerUser(s);
    expect((await s.call('DELETE', '/me', { token: u.token, body: { password: 'wrong-pass' } })).status).toBe(401);
    expect((await s.call('DELETE', '/me', { token: u.token, body: { password: u.password } })).status).toBe(204);
    expect((await s.call('POST', '/auth/login', { body: { username: u.username, password: u.password } })).status).toBe(401);
    expect((await s.call('GET', '/me', { token: u.token })).status).toBe(404);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    expect((await s.call('POST', '/files', { token: u.token, raw: png, type: 'image/png' })).status).toBe(401);
  });
});

describe('wechat login', () => {
  it('creates the account on first login and reuses it later', async () => {
    const code = uniqueName('code');
    const a = await s.call('POST', '/auth/wx-login', { body: { code } });
    expect(a.status).toBe(200);
    expect(a.body.created).toBe(true);
    expect(a.body.user).toMatchObject({ hasWechat: true, hasPassword: false, username: null });
    const b = await s.call('POST', '/auth/wx-login', { body: { code } });
    expect(b.body.created).toBe(false);
    expect(b.body.user.id).toBe(a.body.user.id);
    expect(wxCalls[0]).toContain('appid=wx-test');
  });
  it('reports an invalid code', async () => {
    const r = await s.call('POST', '/auth/wx-login', { body: { code: 'bad' } });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('wx_code_invalid');
  });
});

describe('wechat binding (mini-program ↔ web account)', () => {
  // the fake code2Session gives openid `openid-<code>`: the same code means the same WeChat user
  const work = (id: string) => {
    const now = Date.now();
    const doc: PatternDoc = {
      id, name: '小猫', createdAt: now, updatedAt: now, cols: 2, rows: 1, brand: 'MARD', tier: 'all', settings: {},
      cells: Uint16Array.of(0, EMPTY_CELL), palette: [{ key: 'A1', hex: '#FFFFFF' }],
    };
    return { baseRevision: null, draft: docToDraft(doc) };
  };

  it('binds a WeChat to a web account; one-tap login then opens that account', async () => {
    const u = await registerUser(s);
    const code = uniqueName('bind');
    const r = await s.call('POST', '/me/wx-bind', { token: u.token, body: { code } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ hasWechat: true, hasPassword: true, username: u.username.toLowerCase() });
    const login = await s.call('POST', '/auth/wx-login', { body: { code } });
    expect(login.body.created).toBe(false);
    expect(login.body.user.id).toBe(r.body.id);
    // binding the same WeChat again is a no-op
    expect((await s.call('POST', '/me/wx-bind', { token: u.token, body: { code } })).status).toBe(200);
    // another WeChat cannot replace it
    const other = await s.call('POST', '/me/wx-bind', { token: u.token, body: { code: uniqueName('bind') } });
    expect(other.body.error.code).toBe('wx_already_bound');
  });

  it('takes the WeChat over from an empty WeChat-only account, which is deleted', async () => {
    const code = uniqueName('bind');
    const wxOnly = await s.call('POST', '/auth/wx-login', { body: { code } });
    const u = await registerUser(s);
    const r = await s.call('POST', '/me/wx-bind', { token: u.token, body: { code } });
    expect(r.status).toBe(200);
    expect((await s.call('GET', '/me', { token: wxOnly.body.tokens.accessToken })).status).toBe(404);
    expect((await s.call('POST', '/auth/wx-login', { body: { code } })).body.user.id).toBe(r.body.id);
  });

  it('refuses when that WeChat already has an account with works (no silent merge)', async () => {
    const code = uniqueName('bind');
    const wxOnly = await s.call('POST', '/auth/wx-login', { body: { code } });
    const id = uniqueName('w');
    expect((await s.call('PUT', `/works/${id}`, { token: wxOnly.body.tokens.accessToken, body: work(id) })).status).toBe(200);
    const u = await registerUser(s);
    const r = await s.call('POST', '/me/wx-bind', { token: u.token, body: { code } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('wx_in_use');
    expect((await s.call('GET', '/me', { token: wxOnly.body.tokens.accessToken })).status).toBe(200);
  });

  it('gives a WeChat-only account a username and password for the web app, once', async () => {
    const wx = await s.call('POST', '/auth/wx-login', { body: { code: uniqueName('cred') } });
    const token = wx.body.tokens.accessToken;
    const name = uniqueName('Web');
    const r = await s.call('PUT', '/me/credentials', { token, body: { username: name, password: 'password123' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ username: name.toLowerCase(), hasPassword: true, hasWechat: true });
    const login = await s.call('POST', '/auth/login', { body: { username: name, password: 'password123' } });
    expect(login.body.user.id).toBe(wx.body.user.id);
    expect((await s.call('PUT', '/me/credentials', { token, body: { username: uniqueName('x'), password: 'password123' } })).body.error.code).toBe('credentials_exist');
  });

  it('refuses a taken username and a short password', async () => {
    const taken = await registerUser(s);
    const wx = await s.call('POST', '/auth/wx-login', { body: { code: uniqueName('cred') } });
    const token = wx.body.tokens.accessToken;
    expect((await s.call('PUT', '/me/credentials', { token, body: { username: taken.username, password: 'password123' } })).body.error.code).toBe('username_taken');
    expect((await s.call('PUT', '/me/credentials', { token, body: { username: uniqueName('x'), password: 'short' } })).status).toBe(400);
  });
});
