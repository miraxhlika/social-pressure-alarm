import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getNotificationPermissionState } from '@/lib/notifications';
import { getSocialSession, getSupabaseClient } from '@/lib/social/client';

type ExpoConstantsWithEasConfig = typeof Constants & {
  easConfig?: {
    projectId?: string;
  };
};

type FunctionInvokeResult = {
  delivered?: number;
  duplicate?: boolean;
  error?: string;
  reason?: string;
};

function getExpoProjectId() {
  const expoConfigProjectId = Constants.expoConfig?.extra?.eas;

  if (expoConfigProjectId && typeof expoConfigProjectId === 'object') {
    const projectId = (expoConfigProjectId as Record<string, unknown>).projectId;

    if (typeof projectId === 'string' && projectId.trim()) {
      return projectId.trim();
    }
  }

  return (Constants as ExpoConstantsWithEasConfig).easConfig?.projectId;
}

async function getExpoPushToken() {
  const projectId = getExpoProjectId();

  const tokenResult = await Notifications.getExpoPushTokenAsync(
    projectId
      ? {
          projectId,
        }
      : undefined
  );

  return tokenResult.data;
}

export async function registerSignedInDevicePushToken() {
  if (Platform.OS === 'web') {
    return null;
  }

  const [client, session, permissionState] = await Promise.all([
    Promise.resolve(getSupabaseClient()),
    getSocialSession().catch(() => null),
    getNotificationPermissionState().catch(() => 'undetermined' as const),
  ]);

  if (!client || !session?.user || (permissionState !== 'granted' && permissionState !== 'provisional')) {
    return null;
  }

  const token = await getExpoPushToken();
  const { data, error } = await client.rpc('register_device_push_token', {
    expo_push_token_input: token,
    platform_input: Platform.OS,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function unregisterSignedInDevicePushToken() {
  if (Platform.OS === 'web') {
    return;
  }

  const client = getSupabaseClient();
  const session = await getSocialSession().catch(() => null);

  if (!client || !session?.user) {
    return;
  }

  const token = await getExpoPushToken();
  const { error } = await client.rpc('unregister_device_push_token', {
    expo_push_token_input: token,
  });

  if (error) {
    throw error;
  }
}

async function invokeCircleAlert(action: 'missed_checkpoint' | 'nudge', alarmEventId: string) {
  const client = getSupabaseClient();
  const session = await getSocialSession().catch(() => null);

  if (!client || !session?.user) {
    throw new Error('Sign in to use circle alerts.');
  }

  const { data, error } = await client.functions.invoke<FunctionInvokeResult>('send-circle-alert', {
    body: {
      action,
      alarmEventId,
    },
  });

  if (error) {
    throw error;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data ?? {};
}

export async function sendMissedCheckpointAlertForEvent(alarmEventId: string) {
  return invokeCircleAlert('missed_checkpoint', alarmEventId);
}

export async function sendCircleNudge(alarmEventId: string) {
  return invokeCircleAlert('nudge', alarmEventId);
}
