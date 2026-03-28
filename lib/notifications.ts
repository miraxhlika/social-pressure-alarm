import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { Alarm } from '@/types/alarm';
import { createNextAlarmDate, formatAlarmTime } from '@/lib/alarms';

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

export async function scheduleAlarmNotificationAsync(alarm: Alarm) {
  const scheduledFor = createNextAlarmDate(alarm.hour, alarm.minute);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `Wake up: ${formatAlarmTime(alarm.hour, alarm.minute)}`,
      body: `Tap to prove you're awake before ${alarm.contactName} gets the message.`,
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

  return {
    notificationId,
    scheduledFor: scheduledFor.toISOString(),
  };
}

export async function cancelAlarmNotificationAsync(notificationId?: string) {
  if (!notificationId) {
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
