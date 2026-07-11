import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSocialSession } from '@/lib/social/client';

export const GUEST_STORAGE_SCOPE = 'guest';

function getScopedStorageKey(baseKey: string, scope: string) {
  return `${baseKey}/${scope}`;
}

export async function readDeviceStorageValue(key: string) {
  return AsyncStorage.getItem(key);
}

export async function writeDeviceStorageValue(key: string, value: string) {
  await AsyncStorage.setItem(key, value);
}

export async function getActiveStorageScope() {
  const session = await getSocialSession().catch(() => null);
  return session?.user.id ?? GUEST_STORAGE_SCOPE;
}

export async function readScopedStorageValue(baseKey: string) {
  const scope = await getActiveStorageScope();
  const scopedValue = await readScopedStorageValueForScope(baseKey, scope);

  if (scopedValue.value !== null) {
    return scopedValue;
  }

  const legacyValue = await AsyncStorage.getItem(baseKey);

  if (legacyValue === null) {
    return scopedValue;
  }

  await AsyncStorage.setItem(scopedValue.storageKey, legacyValue);
  await AsyncStorage.removeItem(baseKey);

  return {
    scope,
    storageKey: scopedValue.storageKey,
    value: legacyValue,
  };
}

export async function writeScopedStorageValue(baseKey: string, value: string) {
  const scope = await getActiveStorageScope();
  return writeScopedStorageValueForScope(baseKey, scope, value);
}

export async function removeScopedStorageValue(baseKey: string) {
  const scope = await getActiveStorageScope();
  return removeScopedStorageValueForScope(baseKey, scope);
}

export async function readScopedStorageValueForScope(baseKey: string, scope: string) {
  const storageKey = getScopedStorageKey(baseKey, scope);

  return {
    scope,
    storageKey,
    value: await AsyncStorage.getItem(storageKey),
  };
}

export async function writeScopedStorageValueForScope(baseKey: string, scope: string, value: string) {
  const storageKey = getScopedStorageKey(baseKey, scope);
  await AsyncStorage.setItem(storageKey, value);

  return {
    scope,
    storageKey,
  };
}

export async function removeScopedStorageValueForScope(baseKey: string, scope: string) {
  const storageKey = getScopedStorageKey(baseKey, scope);
  await AsyncStorage.removeItem(storageKey);

  return {
    scope,
    storageKey,
  };
}
