import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type ExactAlarmAccessNativeModule = {
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<boolean>;
};

export type ExactAlarmAccessState = 'available' | 'inexact' | 'unsupported';

function getNativeModule() {
  return requireOptionalNativeModule<ExactAlarmAccessNativeModule>('ExactAlarmAccess');
}

export async function getExactAlarmAccessState(): Promise<ExactAlarmAccessState> {
  if (Platform.OS !== 'android') {
    return 'unsupported';
  }

  const nativeModule = getNativeModule();

  if (!nativeModule) {
    // Expo Go cannot load project-local native modules. Production and
    // development builds expose the real capability state.
    return 'inexact';
  }

  return (await nativeModule.canScheduleExactAlarms()) ? 'available' : 'inexact';
}

export async function openExactAlarmSettingsAsync() {
  const nativeModule = getNativeModule();

  if (!nativeModule) {
    return false;
  }

  return nativeModule.openExactAlarmSettings();
}
