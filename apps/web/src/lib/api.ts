/**
 * Client for apps/server. Tokens live in localStorage so a reload stays signed in; the access token
 * is refreshed once on 401 `token_expired`. Every failure becomes an ApiError with a Chinese message.
 */

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const TOKENS_KEY = 'pd-web:tokens:v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** The server could not be reached (offline, not running, proxy error). */
  get offline(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ms epoch when the access token expires */
  expiresAt: number;
}

export interface PublicUser {
  id: string;
  username: string | null;
  nickname: string;
  hasPassword: boolean;
  hasWechat: boolean;
  createdAt: string;
}

let tokens: Tokens | null = readTokens();
const listeners = new Set<(t: Tokens | null) => void>();

function readTokens(): Tokens | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKENS_KEY) || 'null') as Tokens | null;
    return t && typeof t.refreshToken === 'string' ? t : null;
  } catch {
    return null;
  }
}

export function getTokens(): Tokens | null {
  return tokens;
}

export function setTokens(t: { accessToken: string; refreshToken: string; expiresIn: number } | null): void {
  tokens = t ? { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 } : null;
  try {
    if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* private mode: stays signed in for this tab only */
  }
  for (const l of listeners) l(tokens);
}

/** Called when the session ends (logout, refresh failure). */
export function onTokens(fn: (t: Tokens | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// another tab signed in or out
window.addEventListener('storage', (e) => {
  if (e.key !== TOKENS_KEY) return;
  tokens = readTokens();
  for (const l of listeners) l(tokens);
});

export interface RequestOptions {
  body?: unknown;
  /** Raw upload (image). */
  blob?: Blob;
  auth?: boolean;
  signal?: AbortSignal;
  /** Return the response body as a Blob. */
  asBlob?: boolean;
}

async function send(method: string, path: string, o: RequestOptions, access: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (access) headers.authorization = `Bearer ${access}`;
  let body: BodyInit | undefined;
  if (o.blob) {
    headers['content-type'] = o.blob.type || 'application/octet-stream';
    body = o.blob;
  } else if (o.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  try {
    return await fetch(API_BASE + path, { method, headers, body, cache: 'no-store', signal: o.signal ?? AbortSignal.timeout(20_000) });
  } catch (e) {
    if ((e as Error).name === 'AbortError' && o.signal?.aborted) throw e;
    throw new ApiError(0, 'offline', '连不上云端服务，作品先保存在本机');
  }
}

async function errorOf(res: Response): Promise<ApiError> {
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    if (j.error?.message) return new ApiError(res.status, j.error.code ?? 'error', j.error.message);
  } catch {
    /* not JSON (proxy error page) */
  }
  return new ApiError(res.status, `http_${res.status}`, res.status >= 500 ? '云端服务暂时不可用' : `请求失败（${res.status}）`);
}

let refreshing: Promise<boolean> | null = null;

/** Swaps the refresh token for a new pair; false when the session is over. */
function refresh(): Promise<boolean> {
  if (!refreshing) {
    const run = async (): Promise<boolean> => {
      // another tab may have refreshed while this one waited for the lock
      const stored = readTokens();
      if (stored && tokens && stored.refreshToken !== tokens.refreshToken) {
        tokens = stored;
        return true;
      }
      const t = tokens;
      if (!t) return false;
      const res = await send('POST', '/auth/refresh', { body: { refreshToken: t.refreshToken } }, null);
      if (res.ok) {
        setTokens((await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number });
        return true;
      }
      // another tab may have rotated it already
      const now = readTokens();
      if (now && now.refreshToken !== t.refreshToken) {
        tokens = now;
        return true;
      }
      const err = await errorOf(res);
      // raced with another tab (no lock support): its new tokens arrive through localStorage
      if (err.code === 'refresh_raced') return false;
      if (res.status === 401) setTokens(null);
      else throw err;
      return false;
    };
    // one refresh at a time across tabs, where the browser supports it
    const locked: Promise<boolean> = navigator.locks ? navigator.locks.request('pd-web-refresh', run).then((v) => v) : run();
    const p = locked.finally(() => (refreshing = null));
    refreshing = p;
    return p;
  }
  return refreshing;
}

export async function api<T = unknown>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
  const auth = o.auth !== false;
  if (auth && !tokens) throw new ApiError(401, 'unauthorized', '请先登录');
  if (auth && tokens && tokens.expiresAt - Date.now() < 30_000) await refresh();
  let res = await send(method, path, o, auth ? tokens?.accessToken ?? null : null);
  if (auth && res.status === 401) {
    if (!(await refresh())) throw new ApiError(401, 'unauthorized', '登录已过期，请重新登录');
    res = await send(method, path, o, tokens?.accessToken ?? null);
  }
  if (!res.ok) throw await errorOf(res);
  if (o.asBlob) return (await res.blob()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
