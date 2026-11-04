import { reactive } from 'vue';
import type { PublicUser } from './api';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

/** Signed-in account and cloud sync status (shared by the store and the cloud module). */
export const account = reactive({
  user: null as PublicUser | null,
  /** True until the saved session has been checked on startup. */
  checking: false,
  sync: 'idle' as SyncStatus,
  /** Last problem worth showing (Chinese). */
  message: '',
  lastSync: 0,
});

export const userId = (): string | null => account.user?.id ?? null;

/** Set by the cloud module: called after every local save so changes get uploaded. */
export const cloudHooks = {
  afterSave: () => {},
  /** A synced work was deleted locally: delete it on the server too. */
  afterDelete: (_id: string, _revision: number) => {},
};
