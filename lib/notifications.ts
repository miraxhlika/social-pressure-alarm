import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { Alarm, AlarmNotificationKind, AlarmNotificationRegistration } from '@/types/alarm';
import { createNextAlarmDateForSchedule, formatAlarmTime } from '@/lib/alarms';
import { shiftWeekdayAndTime } from '@/lib/alarm-schedule';
import {
  getNotificationAlarmId,
  getNotificationIdsForAlarms,
  getOrphanedNotificationIds,
} from '@/lib/notification-identity';
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
const WEEKLY_REVIEW_NOTIFICATION_ID = 'weekly-review:1';
const IOS_PENDING_NOTIFICATION_LIMIT = 64;

type NotificationPlanItem = {
  identifier: string;
  kind: AlarmNotificationKind;
  optional: boolean;
  request: Parameters<typeof Notifications.scheduleNotificationAsync>[0];
  triggerSignature: string;
  weekday?: number;
};

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

function getCheckpointNotificationId(
  alarmId: string,
  scheduleRevision: number,
  kind: AlarmNotificationKind,
  slot: string
) {
  return [CHECKPOINT_NOTIFICATION_ID_PREFIX, alarmId, `r${scheduleRevision}`, kind, slot].join(':');
}

async function scheduleLocalNotificationAsync(
  request: Parameters<typeof Notifications.scheduleNotificationAsync>[0],
  failureMessage: string
) {
  try {
    return await Notifications.scheduleNotificationAsync(request);
  } catch (error) {
    if (__DEV__) {
      console.error('[notifications] Native scheduling failed', error);
    }

    throw new Error(failureMessage);
  }
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
    'core:3',
    `schedule:${alarm.repeatSchedule}:${alarm.hour}:${alarm.minute}:${alarm.timezone}:${alarm.scheduleRevision}`,
    `urgency:${preferences.urgencyRemindersEnabled && getUrgencyReminderDelaySeconds(alarm.gracePeriodSeconds) ? 1 : 0}`,
    `readiness:${
      preferences.eveningReadinessRemindersEnabled && shouldScheduleEveningReadinessReminder(alarm, scheduledFor) ? 1 : 0
    }`,
  ].join('|');
}

function createPlanItem(
  alarm: Alarm,
  kind: AlarmNotificationKind,
  slot: string,
  trigger: Notifications.SchedulableNotificationTriggerInput,
  copy: { title: string; body: string },
  optional: boolean,
  weekday?: number
): NotificationPlanItem {
  const triggerSignature = JSON.stringify(trigger);
  const identifier = getCheckpointNotificationId(alarm.id, alarm.scheduleRevision, kind, slot);

  return {
    identifier,
    kind,
    optional,
    triggerSignature,
    weekday,
    request: {
      identifier,
      content: {
        title: copy.title,
        body: copy.body,
        sound: 'default',
        data: {
          alarmId: alarm.id,
          kind,
          repeatSchedule: alarm.repeatSchedule,
          scheduleRevision: alarm.scheduleRevision,
          timezone: alarm.timezone,
          triggerSignature,
        },
      },
      trigger,
    },
  };
}

function buildRecurringItems(
  alarm: Alarm,
  kind: AlarmNotificationKind,
  hour: number,
  minute: number,
  copy: { title: string; body: string },
  optional: boolean,
  weekdays?: number[]
) {
  if (alarm.repeatSchedule === 'daily') {
    return [
      createPlanItem(
        alarm,
        kind,
        'daily',
        {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId: ALARM_CHANNEL_ID,
        },
        copy,
        optional
      ),
    ];
  }

  return (weekdays ?? [2, 3, 4, 5, 6]).map((weekday) =>
    createPlanItem(
      alarm,
      kind,
      `w${weekday}`,
      {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour,
        minute,
        channelId: ALARM_CHANNEL_ID,
      },
      copy,
      optional,
      weekday
    )
  );
}

export function buildAlarmNotificationPlan(
  alarm: Alarm,
  preferences: NotificationPreferences,
  scheduledFor: Date
) {
  const primaryCopy = getCheckpointNotificationCopy(alarm.useCaseType, alarm.label, alarm.gracePeriodSeconds);
  const titledPrimaryCopy = {
    ...primaryCopy,
    title: `${primaryCopy.title} · ${formatAlarmTime(alarm.hour, alarm.minute)}`,
  };

  if (alarm.repeatSchedule === 'once') {
    const primary = createPlanItem(
      alarm,
      'primary',
      scheduledFor.toISOString(),
      {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: scheduledFor,
        channelId: ALARM_CHANNEL_ID,
      },
      titledPrimaryCopy,
      false
    );
    const items = [primary];
    const reminderDelaySeconds = preferences.urgencyRemindersEnabled
      ? getUrgencyReminderDelaySeconds(alarm.gracePeriodSeconds)
      : null;

    if (reminderDelaySeconds && reminderDelaySeconds < alarm.gracePeriodSeconds) {
      const reminderDate = new Date(scheduledFor.getTime() + reminderDelaySeconds * 1000);
      const reminderCopy = getCheckpointNotificationCopy(
        alarm.useCaseType,
        alarm.label,
        alarm.gracePeriodSeconds,
        alarm.gracePeriodSeconds - reminderDelaySeconds
      );
      items.push(
        createPlanItem(
          alarm,
          'urgency',
          reminderDate.toISOString(),
          {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: reminderDate,
            channelId: ALARM_CHANNEL_ID,
          },
          reminderCopy,
          true
        )
      );
    }

    return items;
  }

  const items = buildRecurringItems(
    alarm,
    'primary',
    alarm.hour,
    alarm.minute,
    titledPrimaryCopy,
    false
  );
  const urgencyDelaySeconds = preferences.urgencyRemindersEnabled
    ? getUrgencyReminderDelaySeconds(alarm.gracePeriodSeconds)
    : null;
  const urgencyDelayMinutes = urgencyDelaySeconds ? Math.floor(urgencyDelaySeconds / 60) : 0;

  if (urgencyDelayMinutes > 0 && urgencyDelayMinutes * 60 < alarm.gracePeriodSeconds) {
    const urgencyCopy = getCheckpointNotificationCopy(
      alarm.useCaseType,
      alarm.label,
      alarm.gracePeriodSeconds,
      alarm.gracePeriodSeconds - urgencyDelayMinutes * 60
    );

    if (alarm.repeatSchedule === 'daily') {
      const shifted = shiftWeekdayAndTime(1, alarm.hour, alarm.minute, urgencyDelayMinutes);
      items.push(...buildRecurringItems(alarm, 'urgency', shifted.hour, shifted.minute, urgencyCopy, true));
    } else {
      for (const sourceWeekday of [2, 3, 4, 5, 6]) {
        const shifted = shiftWeekdayAndTime(sourceWeekday, alarm.hour, alarm.minute, urgencyDelayMinutes);
        items.push(
          ...buildRecurringItems(
            alarm,
            'urgency',
            shifted.hour,
            shifted.minute,
            urgencyCopy,
            true,
            [shifted.weekday]
          )
        );
      }
    }
  }

  if (preferences.eveningReadinessRemindersEnabled && scheduledFor.getHours() < 12) {
    const readinessCopy = getCheckpointReadinessNotificationCopy(alarm.useCaseType, alarm.label);
    items.push(
      ...buildRecurringItems(
        alarm,
        'readiness',
        20,
        0,
        readinessCopy,
        true,
        alarm.repeatSchedule === 'weekdays' ? [1, 2, 3, 4, 5] : undefined
      )
    );
  }

  return items;
}

export async function reconcileAlarmNotificationPlanAsync(
  alarm: Alarm,
  options?: { scheduledFor?: string }
) {
  const permissionState = await getNotificationPermissionState();

  if (!isNotificationPermissionEnabled(permissionState)) {
    throw new NotificationPermissionRequiredError();
  }

  const preferences = await readNotificationPreferences();
  const scheduledFor = options?.scheduledFor
    ? new Date(options.scheduledFor)
    : createNextAlarmDateForSchedule(alarm.hour, alarm.minute, alarm.repeatSchedule);

  if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
    throw new Error('The checkpoint time has already passed. Choose a future time and try again.');
  }

  const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
  const alarmScheduled = allScheduled.filter((notification) => getNotificationAlarmId(notification) === alarm.id);
  const otherScheduledCount = allScheduled.length - alarmScheduled.length;
  const desired = buildAlarmNotificationPlan(alarm, preferences, scheduledFor);
  const primary = desired.filter((item) => !item.optional);
  const optional = desired.filter((item) => item.optional);
  const weeklyReviewReserve =
    preferences.weeklyReviewRemindersEnabled &&
    !allScheduled.some((notification) => notification.identifier === WEEKLY_REVIEW_NOTIFICATION_ID)
      ? 1
      : 0;
  const available = Platform.OS === 'ios'
    ? Math.max(0, IOS_PENDING_NOTIFICATION_LIMIT - otherScheduledCount - weeklyReviewReserve)
    : Infinity;

  if (primary.length > available) {
    throw new Error('This device has no remaining notification capacity for another active checkpoint.');
  }

  const selected = [...primary, ...optional.slice(0, Math.max(0, available - primary.length))];
  const omittedKinds = [...new Set(optional.slice(Math.max(0, available - primary.length)).map((item) => item.kind))];
  const selectedIdentifiers = new Set(selected.map((item) => item.identifier));
  const existingByIdentifier = new Map(alarmScheduled.map((request) => [request.identifier, request]));
  const registrations: AlarmNotificationRegistration[] = [];

  for (const item of selected) {
    const existing = existingByIdentifier.get(item.identifier);
    const existingSignature = existing?.content.data?.triggerSignature;

    if (existing && existingSignature !== item.triggerSignature) {
      await Notifications.cancelScheduledNotificationAsync(existing.identifier);
    }

    if (!existing || existingSignature !== item.triggerSignature) {
      try {
        await scheduleLocalNotificationAsync(
          item.request,
          item.optional
            ? `The optional ${item.kind} reminder could not be scheduled.`
            : 'This checkpoint reminder could not be scheduled. Choose a future time and try again.'
        );
      } catch (error) {
        if (!item.optional) {
          throw error;
        }
        omittedKinds.push(item.kind);
        continue;
      }
    }

    registrations.push({
      identifier: item.identifier,
      kind: item.kind,
      triggerSignature: item.triggerSignature,
      weekday: item.weekday,
    });
  }

  await Promise.all(
    alarmScheduled
      .filter((request) => !selectedIdentifiers.has(request.identifier))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
  );

  return {
    notificationIds: registrations.map((registration) => registration.identifier),
    notificationRegistrations: registrations,
    omittedKinds: [...new Set(omittedKinds)],
    scheduledFor: scheduledFor.toISOString(),
    strategyKey: getAlarmNotificationStrategyKey(alarm, preferences, scheduledFor),
  };
}

export async function scheduleAlarmNotificationAsync(
  alarm: Alarm,
  options?: {
    scheduledFor?: string;
  }
) {
  return reconcileAlarmNotificationPlanAsync(alarm, options);
}

export async function cancelAlarmNotificationAsync(notificationIds?: string | string[]) {
  if (!notificationIds) {
    return;
  }

  const ids = Array.isArray(notificationIds) ? notificationIds : [notificationIds];
  await Promise.all(ids.map((notificationId) => Notifications.cancelScheduledNotificationAsync(notificationId)));
}

export async function cancelAlarmNotificationPlansAsync(
  alarmIds: Iterable<string>,
  knownNotificationIds: Iterable<string> = [],
  preservedNotificationIds: Iterable<string> = []
) {
  const alarmIdList = [...new Set(alarmIds)];

  if (alarmIdList.length === 0) {
    return;
  }

  const preservedNotificationIdSet = new Set(preservedNotificationIds);
  const [scheduledNotifications, presentedNotifications] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync(),
    Notifications.getPresentedNotificationsAsync(),
  ]);
  const scheduledIds = getNotificationIdsForAlarms(
    scheduledNotifications,
    alarmIdList,
    preservedNotificationIdSet
  );
  const knownIds = [...knownNotificationIds].filter(
    (notificationId) => !preservedNotificationIdSet.has(notificationId)
  );
  const presentedIds = getNotificationIdsForAlarms(
    presentedNotifications.map((notification) => notification.request),
    alarmIdList
  );

  await Promise.all([
    ...[...new Set([...scheduledIds, ...knownIds])].map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId)
    ),
    ...[...new Set(presentedIds)].map((notificationId) =>
      Notifications.dismissNotificationAsync(notificationId)
    ),
  ]);
}

export async function cancelAlarmNotificationsForAlarmAsync(
  alarmId: string,
  knownNotificationIds: Iterable<string> = []
) {
  await cancelAlarmNotificationPlansAsync([alarmId], knownNotificationIds);
}

export async function cancelOrphanedAlarmNotificationsAsync(activeAlarmIds: Iterable<string>) {
  const activeAlarmIdList = [...new Set(activeAlarmIds)];
  const [scheduledNotifications, presentedNotifications] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync(),
    Notifications.getPresentedNotificationsAsync(),
  ]);
  const scheduledIds = getOrphanedNotificationIds(scheduledNotifications, activeAlarmIdList);
  const presentedIds = getOrphanedNotificationIds(
    presentedNotifications.map((notification) => notification.request),
    activeAlarmIdList
  );

  await Promise.all([
    ...[...new Set(scheduledIds)].map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId)
    ),
    ...[...new Set(presentedIds)].map((notificationId) =>
      Notifications.dismissNotificationAsync(notificationId)
    ),
  ]);
}

export async function cancelAllCheckpointNotificationsAsync() {
  await cancelOrphanedAlarmNotificationsAsync([]);
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

  if (existingNotificationId && existingNotificationId !== WEEKLY_REVIEW_NOTIFICATION_ID) {
    await Notifications.cancelScheduledNotificationAsync(existingNotificationId).catch(() => null);
  }

  if (!resolvedPreferences.weeklyReviewRemindersEnabled) {
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_REVIEW_NOTIFICATION_ID).catch(() => null);
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

  const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
  if (scheduledNotifications.some((notification) => notification.identifier === WEEKLY_REVIEW_NOTIFICATION_ID)) {
    await writeScopedStorageValue(WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY, WEEKLY_REVIEW_NOTIFICATION_ID);
    return {
      notificationId: WEEKLY_REVIEW_NOTIFICATION_ID,
      scheduledFor: 'weekly:sunday:18:00',
    };
  }

  const weeklyReviewContent = getWeeklyReviewNotificationCopy();
  const weeklyReviewNotificationId = await scheduleLocalNotificationAsync(
    {
      identifier: WEEKLY_REVIEW_NOTIFICATION_ID,
      content: {
        title: weeklyReviewContent.title,
        body: weeklyReviewContent.body,
        sound: 'default',
        data: {
          kind: 'weekly-review',
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1,
        hour: 18,
        minute: 0,
        channelId: ALARM_CHANNEL_ID,
      },
    },
    'The weekly review reminder could not be scheduled.'
  );

  await writeScopedStorageValue(WEEKLY_REVIEW_NOTIFICATION_STORAGE_KEY, weeklyReviewNotificationId);

  return {
    notificationId: weeklyReviewNotificationId,
    scheduledFor: 'weekly:sunday:18:00',
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
