import { defaultSettings, normalizeSettings, type Settings } from '@pd/app-shared';

const KEY = 'pd:last-settings';

/** The settings used for the last generation (defaults on first use or if storage is unreadable). */
export function loadLastSettings(): Settings {
  try {
    const raw = uni.getStorageSync(KEY);
    return raw && typeof raw === 'object' ? normalizeSettings(raw as Partial<Settings>) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveLastSettings(s: Settings): void {
  try {
    uni.setStorageSync(KEY, { ...s });
  } catch {
    // storage full or unavailable: only the next session's defaults are affected
  }
}
