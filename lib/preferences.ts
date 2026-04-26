import { AlarmProofStrictness } from '@/types/alarm';
import { readScopedStorageValue, writeScopedStorageValue } from '@/lib/storage';

const APP_PREFERENCES_STORAGE_KEY = 'social-pressure-alarm/preferences';

export type AppPreferences = {
  defaultProofStrictness: AlarmProofStrictness;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultProofStrictness: 'strict',
};

function normalizeProofStrictness(value: unknown): AlarmProofStrictness {
  return value === 'standard' ? 'standard' : 'strict';
}

function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_APP_PREFERENCES;
  }

  const rawPreferences = value as Partial<Record<keyof AppPreferences, unknown>>;

  return {
    defaultProofStrictness: normalizeProofStrictness(rawPreferences.defaultProofStrictness),
  };
}

export async function readAppPreferences() {
  const storedValue = await readScopedStorageValue(APP_PREFERENCES_STORAGE_KEY);

  if (!storedValue.value) {
    return DEFAULT_APP_PREFERENCES;
  }

  try {
    return normalizeAppPreferences(JSON.parse(storedValue.value));
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export async function saveAppPreferences(preferences: AppPreferences) {
  const normalizedPreferences = normalizeAppPreferences(preferences);
  await writeScopedStorageValue(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizedPreferences));

  return normalizedPreferences;
}
