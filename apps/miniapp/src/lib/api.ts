import { SyncHttpError } from '@pd/app-shared';

/**
 * Client for apps/server. Tokens live in the mini-program's key-value storage so the user stays
 * signed in; the access token is refreshed shortly before it expires and once after a 401. The HTTP
 * function is injected (wx.request in the app, a fake in tests). Errors are SyncHttpError with the
 * server's Chinese message; `offline` when the server could not be reached.
 */

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  header: Record<string, string>;
  /** JSON-able body, or raw bytes. */
  data?: unknown;
  /** ms */
  timeout?: number;
}

export interface HttpResponse {
  status: number;
  data: unknown;
}

/** Resolves with any HTTP status; rejects only when the server could not be reached. */
export type Http = (req: HttpRequest) => Promise<HttpResponse>;

export interface Storage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ms timestamp */
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

export interface AuthResult {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  created?: boolean;
}

export interface RequestOptions {
  body?: unknown;
  /** Raw image upload instead of JSON. */
  raw?: { data: ArrayBuffer; type: string };
  /** Send the access token (default true). */
  auth?: boolean;
  /** ms; default 20 s (photo uploads need longer on slow networks). */
  timeout?: number;
}

const TOKENS_KEY = 'pd:auth:tokens';

export class ApiClient {
  /** Called when the session ended on the server side (refresh failed). */
  onSignedOut: ((message: string) => void) | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly http: Http,
    private readonly storage: Storage,
    readonly base: string,
    private readonly now: () => number = Date.now,
  ) {}

  tokens(): Tokens | null {
    const t = this.storage.get(TOKENS_KEY) as Tokens | null | undefined;
    return t && typeof t.accessToken === 'string' && typeof t.refreshToken === 'string' ? t : null;
  }

  setTokens(t: { accessToken: string; refreshToken: string; expiresIn: number } | null): void {
    this.storage.set(TOKENS_KEY, t ? { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: this.now() + t.expiresIn * 1000 } : null);
  }

  /** `Authorization` header with a fresh access token (for file downloads), or null when signed out. */
  async authHeader(): Promise<Record<string, string> | null> {
    let t = this.tokens();
    if (!t) return null;
    if (t.expiresAt - 60_000 < this.now()) {
      if (!(await this.refresh())) return null;
      t = this.tokens();
    }
    return t ? { Authorization: `Bearer ${t.accessToken}` } : null;
  }

  async request<T = unknown>(method: HttpRequest['method'], path: string, o: RequestOptions = {}): Promise<T> {
    const auth = o.auth !== false;
    if (auth) {
      const t = this.tokens();
      if (t && t.expiresAt - 60_000 < this.now()) await this.refresh();
    }
    let res = await this.send(method, path, o, auth);
    if (res.status === 401 && auth && this.tokens()) {
      if (await this.refresh()) res = await this.send(method, path, o, auth);
    }
    if (res.status >= 200 && res.status < 300) return (res.status === 204 ? undefined : res.data) as T;
    throw errorOf(res);
  }

  private async send(method: HttpRequest['method'], path: string, o: RequestOptions, auth: boolean): Promise<HttpResponse> {
    const header: Record<string, string> = {};
    const t = auth ? this.tokens() : null;
    if (t) header.Authorization = `Bearer ${t.accessToken}`;
    let data: unknown;
    if (o.raw) {
      header['Content-Type'] = o.raw.type;
      data = o.raw.data;
    } else if (o.body !== undefined) {
      header['Content-Type'] = 'application/json';
      data = o.body;
    }
    try {
      return await this.http({ method, url: this.base + path, header, data, timeout: o.timeout ?? 20_000 });
    } catch {
      throw new SyncHttpError('连不上云端服务，作品先保存在手机上，联网后自动同步', 0, 'offline', true);
    }
  }

  /** One refresh at a time; false (and signed out) when the session is gone. */
  private refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const t = this.tokens();
      if (!t) return false;
      let res: HttpResponse;
      try {
        res = await this.http({ method: 'POST', url: `${this.base}/auth/refresh`, header: { 'Content-Type': 'application/json' }, data: { refreshToken: t.refreshToken } });
      } catch {
        // offline: keep the tokens, the request itself reports offline
        return false;
      }
      if (res.status === 200) {
        this.setTokens(res.data as AuthResult['tokens']);
        return true;
      }
      if (res.status === 401 || res.status === 400) {
        this.setTokens(null);
        this.onSignedOut?.(errorOf(res).message || '登录已失效，请重新登录');
      }
      return false;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}

function errorOf(res: HttpResponse): SyncHttpError {
  const e = (res.data as { error?: { code?: string; message?: string } } | null)?.error;
  return new SyncHttpError(e?.message || `服务出错（${res.status}）`, res.status, e?.code || `http_${res.status}`);
}
