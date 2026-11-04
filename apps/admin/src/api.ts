/** Admin API client. The admin token lives in sessionStorage (closing the tab signs out). */
const KEY = 'pd-admin:token';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null): void {
  try {
    if (t) sessionStorage.setItem(KEY, t);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError(0, '连不上服务器');
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && path !== '/admin/login') {
      // session over: back to the login form
      setToken(null);
      location.reload();
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
