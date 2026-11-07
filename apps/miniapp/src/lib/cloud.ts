import { SyncEngine, SyncHttpError, type RemoteWork, type SyncStatus, type SyncStore, type SyncTransport } from '@pd/app-shared';
import { docFromDraft } from '@pd/editor-core';
import { reactive } from 'vue';
import { ApiClient, type AuthResult, type Http, type PublicUser } from './api';
import { mpStorage, renderThumb, worksStore } from './mp-files';
import { session } from './session';

// Account and cloud sync of the mini-program: wx.request client, the shared sync engine over the
// local works store, and hooks for open editor pages. Same rules as the web app (apps/web/src/cloud.ts).

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3100/api';

export const account = reactive({
  user: null as PublicUser | null,
  status: 'idle' as SyncStatus,
  message: '',
  /** Asking the server who we are (app start). */
  checking: false,
});

// --- editor pages -------------------------------------------------------------------------

/** What an open editor page lets the sync touch. Several editor pages can be in the page stack. */
export interface EditorHooks {
  /** Write edits still waiting for the auto-save. */
  flush(): void;
  /** The work `id` was kept as a copy (conflict): keep editing it as `newId` / `name`. */
  forked(id: string, newId: string, name: string): void;
  /** A newer version of `id` was stored (downloaded): reload it. */
  replaced(id: string): void;
  /** `id` was uploaded and is now at `revision` (the editor's base for conflict checks). */
  uploaded(id: string, revision: number): void;
  /** `id` was deleted on another device. */
  removed(id: string): void;
}

const editors = new Set<EditorHooks>();
export function registerEditor(h: EditorHooks): () => void {
  editors.add(h);
  return () => editors.delete(h);
}

// --- transport ----------------------------------------------------------------------------

const http: Http = (req) =>
  new Promise((resolve, reject) => {
    uni.request({
      url: req.url,
      method: req.method as 'GET',
      header: req.header,
      data: req.data as string | object | ArrayBuffer,
      timeout: req.timeout ?? 20_000,
      success: (r) => resolve({ status: r.statusCode, data: r.data }),
      fail: (e) => reject(e),
    });
  });

export const api = new ApiClient(http, mpStorage, API_BASE);

const MAX_UPLOAD = 7.5 * 1024 * 1024;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** The photo as bytes the server accepts (PNG / JPEG / WebP, ≤ 8MB): other formats or big files are re-encoded. */
async function photoBytes(path: string): Promise<{ data: ArrayBuffer; type: string }> {
  const fsm = wx.getFileSystemManager();
  const ext = (/\.(\w+)$/.exec(path)?.[1] ?? '').toLowerCase();
  let file = path;
  let type = TYPES[ext];
  if (!type || fsm.statSync(path).size > MAX_UPLOAD) {
    file = await new Promise<string>((resolve, reject) =>
      uni.compressImage({ src: path, quality: 80, success: (r) => resolve(r.tempFilePath), fail: () => reject(new Error('原图压缩失败')) }),
    );
    type = 'image/jpeg';
    // still too big after compressing: a per-work error (the other works keep syncing), not "offline"
    if (fsm.statSync(file).size > MAX_UPLOAD) throw new SyncHttpError('原图太大，压缩后仍超过 8MB，没有上传到云端', 413, 'file_too_large');
  }
  return { data: fsm.readFileSync(file), type };
}

const transport: SyncTransport = {
  request: (method, path, body) => api.request(method, path, { body }),
  async uploadSource(work) {
    const path = worksStore().sourceOf(work.id);
    if (!path) throw new SyncHttpError('原图找不到了', 0, 'source_missing');
    const raw = await photoBytes(path);
    return (await api.request<{ key: string }>('POST', '/files', { raw, timeout: 90_000 })).key;
  },
  async fetchSource(key) {
    const header = await api.authHeader();
    if (!header) throw new SyncHttpError('登录已失效，请重新登录', 401, 'unauthorized');
    return new Promise<string>((resolve, reject) =>
      uni.downloadFile({
        url: `${API_BASE}/files/${encodeURIComponent(key)}`,
        header,
        success: (r) => (r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new SyncHttpError('原图下载失败', r.statusCode, `http_${r.statusCode}`))),
        fail: () => reject(new SyncHttpError('连不上云端服务', 0, 'offline', true)),
      }),
    );
  },
};

// --- local store --------------------------------------------------------------------------

function flushEditors(): void {
  for (const e of editors) e.flush();
}

async function refreshThumb(id: string, w: RemoteWork): Promise<void> {
  try {
    const doc = docFromDraft(w.draft);
    worksStore().setThumb(id, await renderThumb(doc));
    changed();
  } catch {
    // the list shows the old thumbnail
  }
}

const store: SyncStore = {
  all: async () => worksStore().syncWorks(),
  get: async (id) => worksStore().syncWork(id),
  async storeRemote(uid, w, source) {
    worksStore().storeRemote(uid, w, source as string | null | undefined);
    for (const e of editors) e.replaced(w.id);
    void refreshThumb(w.id, w);
  },
  async fork(uid, id, name) {
    const nid = worksStore().fork(uid, id, name);
    for (const e of editors) e.forked(id, nid, name);
    return nid;
  },
  async uploaded(id, snap, cloud) {
    const still = worksStore().uploaded(id, snap, cloud);
    for (const e of editors) e.uploaded(id, cloud.revision);
    return still;
  },
  setOwnerDirty: async (id, owner, dirty) => worksStore().setOwnerDirty(id, owner, dirty),
  async remove(id) {
    worksStore().remove(id);
    for (const e of editors) e.removed(id);
  },
  flush: async () => flushEditors(),
};

export const engine = new SyncEngine(transport, store, mpStorage, { notify: (m) => uni.showToast({ title: m, icon: 'none', duration: 3000 }) });

const listeners = new Set<() => void>();
/** Works or sync status changed (lists refresh). */
export function onCloudChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed(): void {
  for (const fn of listeners) fn();
}

engine.subscribe(() => {
  account.status = engine.status;
  account.message = engine.message;
  changed();
});

// --- account ------------------------------------------------------------------------------

const USER_KEY = 'pd:auth:user';
let started = false;
/** The server confirmed the session since the app started. */
let verified = false;

/** App start: restore the session and sync. */
export async function initCloud(): Promise<void> {
  if (started) return;
  started = true;
  api.onSignedOut = (msg) => void signedOut(msg);
  uni.onNetworkStatusChange((r) => {
    if (r.isConnected) resume();
  });
  if (!api.tokens()) return;
  // signed in last time: use that account right away (works made now belong to it, 「我的」 shows it,
  // also offline); the server confirms it below
  const cached = mpStorage.get(USER_KEY) as PublicUser | null | '';
  if (cached && typeof cached.id === 'string') setUser(cached);
  await checkSession();
}

/** Back in the foreground / online again: confirm the session if not done yet, then sync. */
export function resume(): void {
  if (api.tokens() && !verified) void checkSession();
  else engine.schedule(0);
}

let checking: Promise<void> | null = null;
function checkSession(): Promise<void> {
  if (checking) return checking;
  account.checking = true;
  checking = (async () => {
    try {
      const me = await api.request<PublicUser>('GET', '/me');
      verified = true;
      setUser(me);
      void engine.syncNow();
    } catch (e) {
      if (e instanceof SyncHttpError && e.offline) account.status = 'offline';
      else if (e instanceof SyncHttpError && (e.status === 401 || e.status === 404)) await signedOut('登录已失效，请重新登录');
    } finally {
      account.checking = false;
      checking = null;
    }
  })();
  return checking;
}

function setUser(user: PublicUser, fresh = false): void {
  keepUser(user);
  session.uid = user.id;
  engine.setUser(user.id, fresh);
  changed();
}

/** Show and remember the account (for the next start, also offline). */
function keepUser(user: PublicUser): void {
  account.user = user;
  mpStorage.set(USER_KEY, user);
}

function wxCode(): Promise<string> {
  return new Promise((resolve, reject) =>
    uni.login({ provider: 'weixin', success: (r) => resolve(r.code), fail: (e) => reject(new Error(`微信登录失败：${e.errMsg}`)) }),
  );
}

function ask(title: string, content: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => uni.showModal({ title, content, confirmText, success: (r) => resolve(!!r.confirm), fail: () => resolve(false) }));
}

async function afterLogin(r: AuthResult): Promise<void> {
  api.setTokens(r.tokens);
  verified = true;
  account.message = '';
  flushEditors();
  const local = worksStore().list().filter((w) => !w.owner).length;
  setUser(r.user, true);
  if (local) {
    const ok = await ask('把手机上的作品存到账号？', `手机上有 ${local} 个没登录时做的作品。存到账号「${r.user.nickname || r.user.username}」后会同步到云端，在网页上登录也能看到。`, '存到账号');
    if (ok) worksStore().claim(r.user.id);
  }
  changed();
  await engine.syncNow();
}

/** One-tap WeChat login (creates the account on first use). */
export async function loginWithWechat(): Promise<{ created: boolean }> {
  const r = await api.request<AuthResult>('POST', '/auth/wx-login', { body: { code: await wxCode() }, auth: false });
  await afterLogin(r);
  return { created: !!r.created };
}

/** Sign in with the web app's username and password. */
export async function loginWithPassword(username: string, password: string): Promise<void> {
  await afterLogin(await api.request<AuthResult>('POST', '/auth/login', { body: { username, password }, auth: false }));
}

export async function logout(): Promise<void> {
  flushEditors();
  // one last upload, so nothing waits on this phone only
  await engine.syncNow().catch(() => undefined);
  const t = api.tokens();
  if (t) await api.request('POST', '/auth/logout', { body: { refreshToken: t.refreshToken }, auth: false }).catch(() => undefined);
  await signedOut('');
}

async function signedOut(message: string): Promise<void> {
  flushEditors();
  engine.setUser(null);
  session.uid = null;
  verified = false;
  mpStorage.set(USER_KEY, null);
  account.user = null;
  if (api.tokens()) api.setTokens(null);
  account.status = 'idle';
  account.message = message;
  // the account's works stay on this phone but are hidden while signed out
  changed();
}

/** Bind this WeChat to the signed-in account (one-tap login opens it from now on). */
export async function bindWechat(): Promise<void> {
  keepUser(await api.request<PublicUser>('POST', '/me/wx-bind', { body: { code: await wxCode() } }));
}

/** Username + password for a WeChat-made account, to sign in on the web app. */
export async function setCredentials(username: string, password: string): Promise<void> {
  keepUser(await api.request<PublicUser>('PUT', '/me/credentials', { body: { username, password } }));
}

export async function updateNickname(nickname: string): Promise<void> {
  // PUT, not PATCH: wx.request has no PATCH method
  keepUser(await api.request<PublicUser>('PUT', '/me', { body: { nickname } }));
}

/**
 * A work was deleted on this phone: delete it in the cloud too. Also when it has no revision yet (its
 * first upload may be under way), otherwise the next sync would bring it back.
 */
export function workDeleted(owner: string | null, id: string, revision: number | null): void {
  if (owner && owner === session.uid) engine.deleted(id, revision ?? 0);
}

/** Schedule a sync after a local save. */
export function workSaved(): void {
  engine.schedule(2000);
}
