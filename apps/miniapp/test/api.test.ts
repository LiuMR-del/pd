import { SyncHttpError } from '@pd/app-shared';
import { describe, expect, it } from 'vitest';
import { ApiClient, type HttpRequest, type HttpResponse } from '../src/lib/api';

function setup(handler: (req: HttpRequest) => HttpResponse | 'offline') {
  const kv = new Map<string, unknown>();
  const calls: HttpRequest[] = [];
  let now = 1_000_000;
  const client = new ApiClient(
    async (req) => {
      calls.push(req);
      const r = handler(req);
      if (r === 'offline') throw new Error('request:fail');
      return r;
    },
    { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) },
    'http://api',
    () => now,
  );
  const signedOut: string[] = [];
  client.onSignedOut = (m) => signedOut.push(m);
  return { client, calls, signedOut, advance: (ms: number) => (now += ms) };
}

const tokens = (n: number) => ({ accessToken: `a${n}`, refreshToken: `r${n}-xxxxxxxxxx`, expiresIn: 7200 });

describe('ApiClient (mini-program)', () => {
  it('sends JSON with the access token and returns the data', async () => {
    const { client, calls } = setup(() => ({ status: 200, data: { ok: 1 } }));
    client.setTokens(tokens(1));
    expect(await client.request('PATCH', '/me', { body: { nickname: 'x' } })).toEqual({ ok: 1 });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'http://api/me', header: { Authorization: 'Bearer a1', 'Content-Type': 'application/json' }, data: { nickname: 'x' } });
  });

  it('uploads raw bytes with their type', async () => {
    const { client, calls } = setup(() => ({ status: 201, data: { key: 'k' } }));
    client.setTokens(tokens(1));
    const data = new ArrayBuffer(4);
    expect(await client.request('POST', '/files', { raw: { data, type: 'image/png' } })).toEqual({ key: 'k' });
    expect(calls[0].header['Content-Type']).toBe('image/png');
    expect(calls[0].data).toBe(data);
  });

  it('turns error bodies into SyncHttpError with the server message', async () => {
    const { client } = setup(() => ({ status: 409, data: { error: { code: 'username_taken', message: '这个用户名已被使用' } } }));
    const e = await client.request('PUT', '/me/credentials', { body: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SyncHttpError);
    expect(e).toMatchObject({ status: 409, code: 'username_taken', message: '这个用户名已被使用', offline: false });
  });

  it('reports offline when the server cannot be reached', async () => {
    const { client } = setup(() => 'offline');
    const e = (await client.request('GET', '/me').catch((x: unknown) => x)) as SyncHttpError;
    expect(e.offline).toBe(true);
  });

  it('refreshes once after a 401 and retries with the new token', async () => {
    const { client, calls } = setup((req) => {
      if (req.url.endsWith('/auth/refresh')) return { status: 200, data: tokens(2) };
      return req.header.Authorization === 'Bearer a2' ? { status: 200, data: 'ok' } : { status: 401, data: { error: { code: 'token_expired', message: '登录已过期' } } };
    });
    client.setTokens(tokens(1));
    expect(await client.request('GET', '/me')).toBe('ok');
    expect(calls.map((c) => c.url)).toEqual(['http://api/me', 'http://api/auth/refresh', 'http://api/me']);
    expect(client.tokens()!.accessToken).toBe('a2');
  });

  it('refreshes before the access token expires, one refresh for parallel requests', async () => {
    const { client, calls, advance } = setup((req) => (req.url.endsWith('/auth/refresh') ? { status: 200, data: tokens(2) } : { status: 200, data: req.header.Authorization }));
    client.setTokens(tokens(1));
    advance(7200 * 1000 - 30_000);
    const r = await Promise.all([client.request('GET', '/a'), client.request('GET', '/b')]);
    expect(r).toEqual(['Bearer a2', 'Bearer a2']);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('a dead session signs out and clears the tokens', async () => {
    const { client, signedOut } = setup((req) =>
      req.url.endsWith('/auth/refresh') ? { status: 401, data: { error: { code: 'refresh_reused', message: '登录已失效，请重新登录' } } } : { status: 401, data: { error: { code: 'token_expired', message: 'x' } } },
    );
    client.setTokens(tokens(1));
    await expect(client.request('GET', '/me')).rejects.toMatchObject({ status: 401 });
    expect(client.tokens()).toBeNull();
    expect(signedOut).toEqual(['登录已失效，请重新登录']);
  });

  it('auth: false sends no token (login, refresh)', async () => {
    const { client, calls } = setup(() => ({ status: 200, data: {} }));
    client.setTokens(tokens(1));
    await client.request('POST', '/auth/wx-login', { body: { code: 'c' }, auth: false });
    expect(calls[0].header.Authorization).toBeUndefined();
  });
});
