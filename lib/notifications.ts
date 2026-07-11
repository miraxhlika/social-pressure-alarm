import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { Alarm } from '@/types/alarm';
import { createNextAlarmDateForSchedule, formatAlarmTime } from '@/lib/alarms';
import {
  getCheckpointNotificationCopy,
  getCheckpointReadinessNotificationCopy,
  getWeeklyReviewNotificationCopy,
} from '@/lib/checkpoint-templates';
import { readScopedStorageValue, writeScopedStorageValue } from '@/lib/storage';

const ALARM_CHANNEL_ID = 'social-pressure-alarm';
const SOCIAL_PUSH_CHANNEL_ID = 'social-pressure-social-alerts';
const NOTIFICATION_PREFERENCES_STORAGE_KEY = 'social-pressure-alarm/notification-preferences';
const WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY = 'social-pressure-alarm/weekly-review-notification';
const CHECKPOINT_NOTIFICATION_ID_PREFIX = 'checkpoint';

export type NotificationPreferences = {
  urgencyRemindersEnabled: boolean;
  eveningReadinessRemindersEnabled: boolean;
  weeklyReviewRemindersEnabled: boolean;
};

export type NotificationPermissionState = 'granted' | 'provisional' | 'denied' | 'undetermined';

export class NotificationPermissionRequiredError extends Error {
  constructor() {
    super('Notifications are off. Enable them in device settings before scheduling this checkpoint.');
    this.name = 'NotificationPermissionRequiredError';
  }
}

export function isNotificationPermissionRequiredError(error: unknown) {
  return error instanceof NotificationPermissionRequiredError;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  urgencyRemindersEnabled: false,
  eveningReadinessRemindersEnabled: false,
  weeklyReviewRemindersEnabled: false,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function configureNotificationsAsync() {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Checkpoint reminders',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 300, 200, 300],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(SOCIAL_PUSH_CHANNEL_ID, {
    name: 'Circle alerts',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 200, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  if (!isRecord(value)) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  return {
    urgencyRemindersEnabled:
      typeof value.urgencyRemindersEnabled === 'boolean'
        ? value.urgencyRemindersEnabled
        : DEFAULT_NOTIFICATION_PREFERENCES.urgencyRemindersEnabled,
    eveningReadinessRemindersEnabled:
      typeof value.eveningReadinessRemindersEnabled === 'boolean'
        ? value.eveningReadinessRemindersEnabled
        : DEFAULT_NOTIFICATION_PREFERENCES.eveningReadinessRemindersEnabled,
    weeklyReviewRemindersEnabled:
      typeof value.weeklyReviewRemindersEnabled === 'boolean'
        ? value.weeklyReviewRemindersEnabled
        : DEFAULT_NOTIFICATION_PREFERENCES.weeklyReviewRemindersEnabled,
  };
}

function getWeeklyReviewNotificationId(rawValue: string | null) {
  return rawValue && rawValue.trim().length > 0 ? rawValue.trim() : null;
}

function getUrgencyReminderDelaySeconds(gracePeriodSeconds: number) {
  if (gracePeriodSeconds < 90) {
    return null;
  }

  const halfWindow = Math.floor(gracePeriodSeconds / 2);
  return Math.min(gracePeriodSeconds - 30, Math.max(45, halfWindow));
}

function shouldScheduleEveningReadinessReminder(alarm: Alarm, scheduledFor: Date) {
  const isMorningCheckpoint = scheduledFor.getHours() < 12;
  return isMorningCheckpoint && alarm.repeatSchedule !== 'once';
}

function getEveningReadinessDate(scheduledFor: Date) {
  const reminderDate = new Date(scheduledFor);
  reminderDate.setDate(reminderDate.getDate() - 1);
  reminderDate.setHours(20, 0, 0, 0);
  return reminderDate;
}

function getNextWeeklyReviewDate() {
  const reminderDate = new Date();
  const day = reminderDate.getDay();
  const daysUntilSunday = (7 - day) % 7;
  reminderDate.setDate(reminderDate.getDate() + daysUntilSunday);
  reminderDate.setHours(18, 0, 0, 0);

  if (reminderDate.getTime() <= Date.now()) {
    reminderDate.setDate(reminderDate.getDate() + 7);
  }

  return reminderDate;
}

function getCheckpointNotificationId(alarmId: string, scheduledFor: Date, kind: 'primary' | 'urgency' | 'readiness') {
  return [CHECKPOINT_NOTIFICATION_ID_PREFIX, alarmId, scheduledFor.toISOString(), kind].join(':');
}

function getNotificationAlarmId(notification: Notifications.NotificationRequest) {
  const alarmId = notification.content.data?.alarmId;
  return typeof alarmId === 'string' ? alarmId : null;
}

async function cancelScheduledNotificationsForAlarmAsync(alarmId: string, preservedNotificationIds: string[] = []) {
  const preservedNotificationIdSet = new Set(preservedNotificationIds);
  const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
  const matchingNotificationIds = scheduledNotifications
    .filter((notification) => getNotificationAlarmId(notification) === alarmId)
    .filter((notification) => !preservedNotificationIdSet.has(notification.identifier))
    .map((notification) => notification.identifier);

  await cancelAlarmNotificationAsync(matchingNotificationIds);
}

export async function readNotificationPreferences() {
  const storedValue = await readScopedStorageValue(NOTIFICATION_PREFERENCES_STORAGE_KEY);

  if (!storedValue.value) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  try {
    return normalizeNotificationPreferences(JSON.parse(storedValue.value));
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  const normalizedPreferences = normalizeNotificationPreferences(preferences);
  await writeScopedStorageValue(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizedPreferences));
  return normalizedPreferences;
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const currentSettings = await Notifications.getPermissionsAsync();

  if (currentSettings.granted) {
    return 'granted';
  }

  if (currentSettings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'provisional';
  }

  if (currentSettings.canAskAgain) {
    return 'undetermined';
  }

  return 'denied';
}

function hasUsableNotificationPermission(settings: Notifications.NotificationPermissionsStatus) {
  return settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export function isNotificationPermissionEnabled(state: NotificationPermissionState) {
  return state === 'granted' || state === 'provisional';
}

export async function openNotificationSettingsAsync() {
  await Linking.openSettings();
}

export async function ensureNotificationPermissionsAsync() {
  const currentSettings = await Notifications.getPermissionsAsync();

  if (hasUsableNotificationPermission(currentSettings)) {
    return true;
  }

  if (!currentSettings.canAskAgain) {
    return false;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return hasUsableNotificationPermission(requested);
}

export function getAlarmNotificationStrategyKey(
  alarm: Alarm,
  preferences: NotificationPreferences,
  scheduledFor: Date
) {
  return [
    'core:2',
    `urgency:${preferences.urgencyRemindersEnabled && getUrgencyReminderDelaySeconds(alarm.gracePeriodSeconds) ? 1 : 0}`,
    `readiness:${
      preferences.eveningReadinessRemindersEnabled && shouldScheduleEveningReadinessReminder(alarm, scheduledFor) ? 1 : 0
    }`,
  ].join('|');
}

export async function scheduleAlarmNotificationAsync(
  alarm: Alarm,
  options?: {
    scheduledFor?: string;
  }
) {
  const permissionState = await getNotificationPermissionState();

  if (!isNotificationPermissionEnabled(permissionState)) {
    throw new NotificationPermissionRequiredError();
  }

  const preferences = await readNotificationPreferences();
  const scheduledFor = options?.scheduledFor
    ? new Date(options.scheduledFor)
    : createNextAlarmDateForSchedule(alarm.hour, alarm.minute, alarm.repeatSchedule);
  const triggerContent = getCheckpointNotificationCopy(
    alarm.useCaseType,
    alarm.label,
    alarm.gracePeriodSeconds
  );
  const strategyKey = getAlarmNotificationStrategyKey(alarm, preferences, scheduledFor);

  const primaryNotificationIdentifier = getCheckpointNotificationId(alarm.id, scheduledFor, 'primary');
  const primaryNotificationId = await Notifications.scheduleNotificationAsync({
    identifier: primaryNotificationIdentifier,
    content: {
      title: `${triggerContent.title} · ${formatAlarmTime(scheduledFor.getHours(), scheduledFor.getMinutes())}`,
      body: triggerContent.body,
      sound: 'default',
      data: {
        alarmId: alarm.id,
        kind: 'primary',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: scheduledFor,
      channelId: ALARM_CHANNEL_ID,
    },
  });

  const notificationIds = [primaryNotificationId];
  const reminderDelaySeconds = preferences.urgencyRemindersEnabled
    ? getUrgencyReminderDelaySeconds(alarm.gracePeriodSeconds)
    : null;

  if (reminderDelaySeconds && reminderDelaySeconds < alarm.gracePeriodSeconds) {
    const reminderDate = new Date(scheduledFor.getTime() + reminderDelaySeconds * 1000);
    const secondsRemaining = alarm.gracePeriodSeconds - reminderDelaySeconds;
    const reminderContent = getCheckpointNotificationCopy(
      alarm.useCaseType,
      alarm.label,
      alarm.gracePeriodSeconds,
      secondsRemaining
    );

    const reminderNotificationIdentifier = getCheckpointNotificationId(alarm.id, scheduledFor, 'urgency');
    const reminderNotificationId = await Notifications.scheduleNotificationAsync({
      identifier: reminderNotificationIdentifier,
      content: {
        title: reminderContent.title,
        body: reminderContent.body,
        sound: 'default',
        data: {
          alarmId: alarm.id,
          kind: 'urgency',
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
        channelId: ALARM_CHANNEL_ID,
      },
    });

    notificationIds.push(reminderNotificationId);
  }

  if (preferences.eveningReadinessRemindersEnabled && shouldScheduleEveningReadinessReminder(alarm, scheduledFor)) {
    const readinessDate = getEveningReadinessDate(scheduledFor);

    if (readinessDate.getTime() > Date.now()) {
      const readinessContent = getCheckpointReadinessNotificationCopy(alarm.useCaseType, alarm.label);
      const readinessNotificationIdentifier = getCheckpointNotificationId(alarm.id, scheduledFor, 'readiness');
      const readinessNotificationId = await Notifications.scheduleNotificationAsync({
        identifier: readinessNotificationIdentifier,
        content: {
          title: readinessContent.title,
          body: readinessContent.body,
          sound: 'default',
          data: {
            alarmId: alarm.id,
            kind: 'readiness',
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: readinessDate,
          channelId: ALARM_CHANNEL_ID,
        },
      });

      notificationIds.push(readinessNotificationId);
    }
  }

  await cancelScheduledNotificationsForAlarmAsync(alarm.id, notificationIds).catch(() => null);

  return {
    notificationIds,
    scheduledFor: scheduledFor.toISOString(),
    strategyKey,
  };
}

export async function cancelAlarmNotificationAsync(notificationIds?: string | string[]) {
  if (!notificationIds) {
    return;
  }

  const ids = Array.isArray(notificationIds) ? notificationIds : [notificationIds];
  await Promise.all(ids.map((notificationId) => Notifications.cancelScheduledNotificationAsync(notificationId)));
}

export async function syncWeeklyReviewReminderAsync(
  preferences?: NotificationPreferences,
  options?: {
    requestPermissions?: boolean;
  }
) {
  const resolvedPreferences = preferences ?? (await readNotificationPreferences());
  const weeklyReminderRecord = await readScopedStorageValue(WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY);
  const existingNotificationId = getWeeklyReviewNotificationId(weeklyReminderRecord.value);

  if (existingNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(existingNotificationId).catch(() => null);
  }

  if (!resolvedPreferences.weeklyReviewRemindersEnabled) {
    await writeScopedStorageValue(WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY, '');
    return null;
  }

  const requestPermissions = options?.requestPermissions ?? true;
  const hasPermission = requestPermissions
    ? await ensureNotificationPermissionsAsync()
    : ['granted', 'provisional'].includes(await getNotificationPermissionState());

  if (!hasPermission) {
    await writeScopedStorageValue(WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY, '');
    return null;
  }

  const weeklyReviewDate = getNextWeeklyReviewDate();
  const weeklyReviewContent = getWeeklyReviewNotificationCopy();
  const weeklyReviewNotificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: weeklyReviewContent.title,
      body: weeklyReviewContent.body,
      sound: 'default',
      data: {
        kind: 'weekly-review',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: weeklyReviewDate,
      channelId: ALARM_CHANNEL_ID,
    },
  });

  await writeScopedStorageValue(WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY, weeklyReviewNotificationId);

  return {
    notificationId: weeklyReviewNotificationId,
    scheduledFor: weeklyReviewDate.toISOString(),
  };
}

export async function syncNotificationStrategyAsync(preferences?: NotificationPreferences) {
  const resolvedPreferences = preferences ?? (await readNotificationPreferences());
  await saveNotificationPreferences(resolvedPreferences);
  await syncWeeklyReviewReminderAsync(resolvedPreferences);

  const { hydrateAlarmRuntimeForCurrentUser } = await import('@/lib/alarms');
  await hydrateAlarmRuntimeForCurrentUser();

  return resolvedPreferences;
}
