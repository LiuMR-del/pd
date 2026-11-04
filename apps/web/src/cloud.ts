import { docFromDraft, type PatternDraftV1 } from '@pd/editor-core';
import { account, cloudHooks } from './lib/account';
import { api, ApiError, getTokens, onTokens, setTokens, type PublicUser } from './lib/api';
import { deleteWork, getWork, newId, putWork, withLock, allWorks, type WorkRecord } from './lib/storage';
import { ask, closeWork, flushSave, notify, openWork, patternThumb, refreshWorks, state } from './store';

/**
 * Cloud sync for signed-in users. IndexedDB stays the primary store (works offline); this module
 * uploads changed works, downloads changes made on other devices and resolves conflicts by keeping
 * both sides (the local side becomes a 「冲突副本」 work). Nothing is ever overwritten silently.
 */

interface WorkSummaryDto {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  deleted: boolean;
  sourceKey: string | null;
}

interface WorkDto extends WorkSummaryDto {
  draft: PatternDraftV1;
  meta: { crop?: WorkRecord['crop'] } | null;
}

interface AuthResult {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}

const cursorKey = (uid: string) => `pd-web:sync-cursor:${uid}`;
const pendingKey = (uid: string) => `pd-web:pending-deletes:${uid}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) || 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full / private mode: worst case a full resync */
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --- account ------------------------------------------------------------------------------

export async function initCloud(): Promise<void> {
  cloudHooks.afterSave = () => scheduleSync(2000);
  cloudHooks.afterDelete = (id) => {
    const uid = account.user?.id;
    if (!uid) return;
    writeJson(pendingKey(uid), [...new Set([...readJson<string[]>(pendingKey(uid), []), id])]);
    scheduleSync(0);
  };
  onTokens((t) => {
    if (!t && account.user) void signedOut('登录已失效，请重新登录');
  });
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  });
  if (!getTokens()) return;
  account.checking = true;
  try {
    account.user = await api<PublicUser>('GET', '/me');
    await refreshWorks();
    scheduleSync(0);
  } catch (e) {
    if (e instanceof ApiError && e.offline) account.sync = 'offline';
    else if (e instanceof ApiError && e.status === 401) setTokens(null);
  } finally {
    account.checking = false;
  }
}

export async function login(username: string, password: string, register = false): Promise<void> {
  const r = await api<AuthResult>('POST', register ? '/auth/register' : '/auth/login', { body: { username, password }, auth: false });
  setTokens(r.tokens);
  account.user = r.user;
  account.message = '';
  writeJson(cursorKey(r.user.id), null);
  await offerLocalWorks(r.user);
  await refreshWorks();
  await syncNow();
}

/** Works made while signed out: ask whether they should belong to this account. */
async function offerLocalWorks(user: PublicUser): Promise<void> {
  const mine = (await allWorks()).filter((w) => !w.owner);
  if (!mine.length) return;
  const ok = await ask(
    '把这台设备上的作品存到账号？',
    `这台设备上有 ${mine.length} 个没登录时做的作品。存到账号「${user.nickname || user.username}」后会同步到云端，在别的设备登录也能看到。`,
    '存到账号',
  );
  if (!ok) return;
  await withLock(async () => {
    for (const w of mine) {
      const cur = await getWork(w.id);
      if (cur && !cur.owner) await putWork({ ...cur, owner: user.id, dirty: true });
    }
  });
}

export async function logout(): Promise<void> {
  const t = getTokens();
  await flushSave();
  // one last upload, so nothing waits on this device only
  await syncNow().catch(() => undefined);
  if (t) await api('POST', '/auth/logout', { body: { refreshToken: t.refreshToken }, auth: false }).catch(() => undefined);
  await signedOut('');
}

async function signedOut(msg: string): Promise<void> {
  const uid = account.user?.id;
  await flushSave();
  if (getTokens()) setTokens(null);
  account.user = null;
  account.sync = 'idle';
  account.message = msg;
  // the account's works stay on this device but are hidden while signed out
  if (uid && state.workId && (await getWork(state.workId))?.owner === uid) closeWork();
  await refreshWorks();
}

export async function updateNickname(nickname: string): Promise<void> {
  account.user = await api<PublicUser>('PATCH', '/me', { body: { nickname } });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const t = await api<{ accessToken: string; refreshToken: string; expiresIn: number }>('PUT', '/me/password', { body: { oldPassword, newPassword } });
  setTokens(t);
  account.user = await api<PublicUser>('GET', '/me');
}

/** Deletes the account on the server and its works on this device. */
export async function deleteAccount(password: string): Promise<void> {
  const uid = account.user?.id;
  await api('DELETE', '/me', { body: { password } });
  if (uid) {
    await flushSave();
    await withLock(async () => {
      for (const w of await allWorks()) if (w.owner === uid) await deleteWork(w.id);
    });
    writeJson(cursorKey(uid), null);
    writeJson(pendingKey(uid), null);
    if (state.workId && !(await getWork(state.workId))) closeWork();
  }
  setTokens(null);
  account.user = null;
  account.sync = 'idle';
  await refreshWorks();
}

// --- sync ---------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;

export function scheduleSync(delay = 2000): void {
  if (!account.user) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow().catch(() => undefined), delay);
}

/** Runs one sync (or waits for the running one and runs again). */
export function syncNow(): Promise<void> {
  if (!account.user) return Promise.resolve();
  clearTimeout(timer);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again && account.user);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce(): Promise<void> {
  const user = account.user;
  if (!user) return;
  account.sync = 'syncing';
  try {
    await pushDeletes(user.id);
    await pull(user.id);
    await push(user.id);
    if (account.user?.id !== user.id) return;
    account.sync = 'synced';
    account.lastSync = Date.now();
    if (account.message && !account.message.startsWith('云端最多')) account.message = '';
  } catch (e) {
    if (account.user?.id !== user.id) return;
    const offline = e instanceof ApiError && e.offline;
    account.sync = offline ? 'offline' : 'error';
    account.message = offline ? '' : `同步失败：${message(e)}`;
    if (!offline) console.error('sync failed', e);
  }
  await refreshWorks();
}

async function pushDeletes(uid: string): Promise<void> {
  const ids = readJson<string[]>(pendingKey(uid), []);
  for (const id of ids) {
    try {
      await api('DELETE', `/works/${id}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    writeJson(pendingKey(uid), readJson<string[]>(pendingKey(uid), []).filter((x) => x !== id));
  }
}

async function pull(uid: string): Promise<void> {
  // edits still in memory must count as local changes, or a remote change could replace them
  await flushSave();
  const since = readJson<string | null>(cursorKey(uid), null);
  // ask a little further back than the cursor: saves that committed out of order are not missed,
  // and changes seen twice are skipped by their revision
  const from = since ? new Date(Date.parse(since) - 10_000).toISOString() : null;
  const list = await api<WorkSummaryDto[]>('GET', from ? `/works?since=${encodeURIComponent(from)}` : '/works');
  let cursor = since;
  for (const r of list) {
    if (account.user?.id !== uid) return;
    await applyRemote(uid, r);
    if (!cursor || r.updatedAt > cursor) cursor = r.updatedAt;
  }
  if (!since) {
    // full listing: synced works missing from it were deleted elsewhere while we had no cursor
    const live = new Set(list.map((r) => r.id));
    for (const w of await allWorks()) {
      if (w.owner === uid && w.cloud && !live.has(w.id)) await applyRemote(uid, { id: w.id, name: w.name, revision: w.cloud.revision, updatedAt: '', deleted: true, sourceKey: null });
    }
  }
  if (cursor && account.user?.id === uid) writeJson(cursorKey(uid), cursor);
}

/** Bring one remote change into IndexedDB. */
async function applyRemote(uid: string, r: WorkSummaryDto): Promise<void> {
  const local = await getWork(r.id);
  if (local?.owner && local.owner !== uid) return;
  if (r.deleted) {
    if (!local) return;
    if (local.dirty) await fork(uid, local, '（已在别处删除）');
    await withLock(() => deleteWork(r.id));
    if (state.workId === r.id) {
      closeWork();
      notify(local.dirty ? '这个作品已在别处删除，你的修改另存了一份' : '这个作品已在别处删除');
    }
    return;
  }
  if (local && (local.cloud?.revision ?? 0) >= r.revision) return;
  if (local?.dirty) await fork(uid, local, '（冲突副本）');
  await download(uid, r.id, local);
}

/** Fetches a work (and its source image when it changed) and stores it as synced. */
async function download(uid: string, id: string, local?: WorkRecord, notice = '这个作品在别的设备上改过，已载入最新版本'): Promise<void> {
  const w = await api<WorkDto>('GET', `/works/${id}`);
  const doc = docFromDraft(w.draft);
  let source = local?.source ?? null;
  if (w.sourceKey && w.sourceKey !== local?.cloud?.sourceKey) source = await api<Blob>('GET', `/files/${w.sourceKey}`, { asBlob: true });
  if (!w.sourceKey) source = null;
  if (state.workId === id) {
    // edited while downloading: keep those edits as a copy
    await flushSave();
    const now = await getWork(id);
    if (now?.dirty) await fork(uid, now, '（冲突副本）');
  }
  const wasOpen = state.workId === id;
  await withLock(() =>
    putWork({
      id,
      name: doc.name,
      updatedAt: doc.updatedAt,
      thumb: patternThumb(doc),
      draft: w.draft,
      source,
      crop: w.meta?.crop ?? null,
      owner: uid,
      cloud: { revision: w.revision, sourceKey: w.sourceKey },
      dirty: false,
    }),
  );
  if (wasOpen && state.workId === id) {
    await openWork(id);
    if (notice) notify(notice);
  }
}

/** Keeps the local side of a conflict as a new work (it is uploaded on the next push). */
async function fork(uid: string, snap: WorkRecord, suffix: string): Promise<string> {
  const open = state.workId === snap.id;
  if (open) await flushSave();
  const rec = (await getWork(snap.id)) ?? snap;
  const id = newId();
  const name = `${rec.name}${suffix}`.slice(0, 60);
  const now = Date.now();
  await withLock(() =>
    putWork({ ...rec, id, name, updatedAt: now, draft: { ...rec.draft, id, name, updatedAt: now }, owner: uid, cloud: undefined, dirty: true }),
  );
  if (open && state.workId === snap.id) {
    // keep the user on their own edits
    await openWork(id);
    notify(`这个作品在别处也改过，你的修改另存为「${name}」`);
  }
  again = true;
  return id;
}

async function push(uid: string): Promise<void> {
  const todo = (await allWorks()).filter((w) => w.owner === uid && (w.dirty || !w.cloud));
  for (const snap of todo) {
    if (account.user?.id !== uid) return;
    try {
      await upload(uid, snap);
    } catch (e) {
      if (!(e instanceof ApiError) || e.offline || e.status === 401) throw e;
      if (e.code === 'revision_conflict') {
        await fork(uid, snap, '（冲突副本）');
        await withLock(async () => {
          const cur = await getWork(snap.id);
          if (cur) await putWork({ ...cur, dirty: false });
        });
        await download(uid, snap.id, { ...snap, dirty: false });
      } else if (e.code === 'work_deleted' || e.code === 'id_taken' || e.code === 'work_not_found') {
        await fork(uid, snap, e.code === 'work_deleted' ? '（已在别处删除）' : '');
        await withLock(() => deleteWork(snap.id));
      } else if (e.code === 'too_many_works') {
        account.message = e.message;
        return;
      } else {
        // a bad record must not block the others; it stays dirty and is retried later
        account.message = `「${snap.name}」上传失败：${e.message}`;
      }
    }
  }
}

async function upload(uid: string, snap: WorkRecord): Promise<void> {
  let sourceKey = snap.cloud?.sourceKey ?? null;
  if (snap.source && !sourceKey) sourceKey = (await api<{ key: string }>('POST', '/files', { blob: snap.source })).key;
  if (!snap.source) sourceKey = null;
  const res = await api<WorkDto>('PUT', `/works/${snap.id}`, {
    body: { baseRevision: snap.cloud?.revision ?? null, draft: snap.draft, meta: { crop: snap.crop }, sourceKey },
  });
  await withLock(async () => {
    const cur = await getWork(snap.id);
    if (!cur || cur.owner !== uid) return;
    // edited again while uploading: stays dirty, goes up on the next round
    const same = cur.draft.updatedAt === snap.draft.updatedAt && cur.name === snap.name;
    await putWork({ ...cur, cloud: { revision: res.revision, sourceKey }, dirty: !same });
    if (!same) again = true;
  });
}

// --- history ------------------------------------------------------------------------------

export interface VersionInfo {
  id: number;
  revision: number;
  name: string;
  reason: 'auto' | 'manual' | 'backup' | 'restore';
  createdAt: string;
}

/** Make sure the current work is on the server and return its record. */
async function uploadCurrent(): Promise<WorkRecord> {
  await flushSave();
  await syncNow();
  const rec = state.workId ? await getWork(state.workId) : undefined;
  if (!rec?.cloud || rec.dirty) throw new Error(account.sync === 'offline' ? '连不上云端服务' : '作品还没同步到云端');
  return rec;
}

export async function listVersions(): Promise<VersionInfo[]> {
  const rec = await uploadCurrent();
  return api<VersionInfo[]>('GET', `/works/${rec.id}/versions`);
}

export async function saveVersion(): Promise<VersionInfo[]> {
  const rec = await uploadCurrent();
  return api<VersionInfo[]>('POST', `/works/${rec.id}/versions`);
}

export async function restoreVersion(versionId: number): Promise<void> {
  const rec = await uploadCurrent();
  await api<WorkDto>('POST', `/works/${rec.id}/versions/${versionId}/restore`, { body: { baseRevision: rec.cloud!.revision } });
  await download(account.user!.id, rec.id, rec, '已恢复到这个历史版本');
}

// dev builds: let end-to-end scripts trigger a sync and read the status
if (import.meta.env.DEV) Object.assign(window, { __pdCloud: { syncNow, account } });
