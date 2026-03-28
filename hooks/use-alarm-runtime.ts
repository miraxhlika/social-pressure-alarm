import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

import { getAlarms, getNextActionableAlarm } from '@/lib/alarms';
import { configureNotificationsAsync } from '@/lib/notifications';

function getAlarmIdFromNotification(
  notification:
    | Notifications.Notification
    | Notifications.NotificationResponse
    | null
    | undefined
) {
  if (!notification) {
    return null;
  }

  const payload =
    'notification' in notification
      ? notification.notification.request.content.data
      : notification.request.content.data;

  const alarmId = payload?.alarmId;
  return typeof alarmId === 'string' ? alarmId : null;
}

export function useAlarmRuntime() {
  const router = useRouter();

  useEffect(() => {
    const routeToAlarm = (alarmId: string) => {
      router.replace({
        pathname: '/ringing',
        params: {
          alarmId,
        },
      });
    };

    const checkForDueAlarms = async () => {
      const alarms = await getAlarms();
      const dueAlarm = getNextActionableAlarm(alarms);

      if (dueAlarm) {
        // Managed Expo cannot force a full-screen alarm takeover when the app is killed,
        // so the MVP re-enters the ringing flow when a notification is received, tapped,
        // or when the user returns to the app after the scheduled time.
        routeToAlarm(dueAlarm.id);
      }
    };

    void configureNotificationsAsync();
    void checkForDueAlarms();

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const alarmId = getAlarmIdFromNotification(response);

      if (alarmId) {
        routeToAlarm(alarmId);
      }
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const alarmId = getAlarmIdFromNotification(notification);

      if (alarmId) {
        routeToAlarm(alarmId);
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const alarmId = getAlarmIdFromNotification(response);

      if (alarmId) {
        routeToAlarm(alarmId);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkForDueAlarms();
      }
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
      appStateSubscription.remove();
    };
  }, [router]);
}
