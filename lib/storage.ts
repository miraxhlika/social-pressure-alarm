import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSocialSession } from '@/lib/social/client';

export const GUEST_STORAGE_SCOPE = 'guest';

function getScopedStorageKey(baseKey: string, scope: string) {
  return `${baseKey}/${scope}`;
}

export async function getActiveStorageScope() {
  const session = await getSocialSession().catch(() => null);
  return session?.user.id ?? GUEST_STORAGE_SCOPE;
}

export async function readScopedStorageValue(baseKey: string) {
  const scope = await getActiveStorageScope();
  const scopedKey = getScopedStorageKey(baseKey, scope);
  const scopedValue = await AsyncStorage.getItem(scopedKey);

  if (scopedValue !== null) {
    return {
      scope,
      storageKey: scopedKey,
      value: scopedValue,
    };
  }

  const legacyValue = await AsyncStorage.getItem(baseKey);

  if (legacyValue === null) {
    return {
      scope,
      storageKey: scopedKey,
      value: null,
    };
  }

  await AsyncStorage.setItem(scopedKey, legacyValue);
  await AsyncStorage.removeItem(baseKey);

  return {
    scope,
    storageKey: scopedKey,
    value: legacyValue,
  };
}

export async function writeScopedStorageValue(baseKey: string, value: string) {
  const scope = await getActiveStorageScope();
  const storageKey = getScopedStorageKey(baseKey, scope);
  await AsyncStorage.setItem(storageKey, value);

  return {
    scope,
    storageKey,
  };
}

export async function removeScopedStorageValue(baseKey: string) {
  const scope = await getActiveStorageScope();
  const storageKey = getScopedStorageKey(baseKey, scope);
  await AsyncStorage.removeItem(storageKey);

  return {
    scope,
    storageKey,
  };
}
