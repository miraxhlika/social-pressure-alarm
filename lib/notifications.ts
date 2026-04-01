import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { Alarm } from '@/types/alarm';
import { createNextAlarmDateForSchedule, formatAlarmTime } from '@/lib/alarms';

const ALARM_CHANNEL_ID = 'social-pressure-alarm';

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
    name: 'Alarm reminders',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 300, 200, 300],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function ensureNotificationPermissionsAsync() {
  const currentSettings = await Notifications.getPermissionsAsync();

  if (currentSettings.granted || currentSettings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function scheduleAlarmNotificationAsync(
  alarm: Alarm,
  options?: {
    scheduledFor?: string;
  }
) {
  const scheduledFor = options?.scheduledFor
    ? new Date(options.scheduledFor)
    : createNextAlarmDateForSchedule(alarm.hour, alarm.minute, alarm.repeatSchedule);

  const primaryNotificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `Wake up: ${formatAlarmTime(alarm.hour, alarm.minute)}`,
      body:
        alarm.repeatSchedule === 'once'
          ? `Scan the ${alarm.label} checkpoint within ${alarm.gracePeriodSeconds} seconds to clear this alarm.`
          : `Your ${alarm.label} checkpoint starts now. You have ${alarm.gracePeriodSeconds} seconds to clear it.`,
      sound: 'default',
      data: {
        alarmId: alarm.id,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: scheduledFor,
      channelId: ALARM_CHANNEL_ID,
    },
  });

  const notificationIds = [primaryNotificationId];
  const reminderDelaySeconds =
    alarm.gracePeriodSeconds >= 30 ? Math.max(15, Math.floor(alarm.gracePeriodSeconds / 2)) : null;

  if (reminderDelaySeconds && reminderDelaySeconds < alarm.gracePeriodSeconds) {
    const reminderDate = new Date(scheduledFor.getTime() + reminderDelaySeconds * 1000);
    const secondsRemaining = alarm.gracePeriodSeconds - reminderDelaySeconds;

    const reminderNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Keep moving: ${alarm.label}`,
        body: `${secondsRemaining} seconds left to scan the QR checkpoint.`,
        sound: 'default',
        data: {
          alarmId: alarm.id,
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

  return {
    notificationIds,
    scheduledFor: scheduledFor.toISOString(),
  };
}

export async function cancelAlarmNotificationAsync(notificationIds?: string | string[]) {
  if (!notificationIds) {
    return;
  }

  const ids = Array.isArray(notificationIds) ? notificationIds : [notificationIds];
  await Promise.all(ids.map((notificationId) => Notifications.cancelScheduledNotificationAsync(notificationId)));
}
