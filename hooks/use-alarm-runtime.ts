import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

import { getAlarmPhase, getAlarms, getNextActionableAlarm, hydrateAlarmRuntimeForCurrentUser } from '@/lib/alarms';
import { configureNotificationsAsync, syncWeeklyReviewReminderAsync } from '@/lib/notifications';
import { getSupabaseClient } from '@/lib/social/client';

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

function isCircleNotification(
  notification:
    | Notifications.Notification
    | Notifications.NotificationResponse
    | null
    | undefined
) {
  if (!notification) {
    return false;
  }

  const payload =
    'notification' in notification
      ? notification.notification.request.content.data
      : notification.request.content.data;
  const kind = payload?.kind;

  return kind === 'circle-missed-checkpoint' || kind === 'circle-nudge';
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

    const routeToAlarmIfStillActive = async (alarmId: string, clearLastResponse = false) => {
      try {
        const store = await hydrateAlarmRuntimeForCurrentUser();
        const alarm = store.alarms.find((candidate) => candidate.id === alarmId) ?? null;

        if (!alarm || !alarm.isActive || getAlarmPhase(alarm) !== 'ringing') {
          return;
        }

        routeToAlarm(alarmId);
      } finally {
        if (clearLastResponse) {
          await Notifications.clearLastNotificationResponseAsync().catch(() => null);
        }
      }
    };

    const hydrateAndCheckForDueAlarms = async () => {
      await hydrateAlarmRuntimeForCurrentUser();
      await syncWeeklyReviewReminderAsync(undefined, {
        requestPermissions: false,
      }).catch(() => null);
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
    void hydrateAndCheckForDueAlarms();

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const alarmId = getAlarmIdFromNotification(response);

      if (alarmId) {
        void routeToAlarmIfStillActive(alarmId, true);
        return;
      }

      if (isCircleNotification(response)) {
        router.replace('/circles');
        void Notifications.clearLastNotificationResponseAsync().catch(() => null);
      }
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const alarmId = getAlarmIdFromNotification(notification);

      if (alarmId) {
        void routeToAlarmIfStillActive(alarmId);
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const alarmId = getAlarmIdFromNotification(response);

      if (alarmId) {
        void routeToAlarmIfStillActive(alarmId, true);
        return;
      }

      if (isCircleNotification(response)) {
        router.replace('/circles');
        void Notifications.clearLastNotificationResponseAsync().catch(() => null);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void hydrateAndCheckForDueAlarms();
      }
    });
    const client = getSupabaseClient();
    const authSubscription = client?.auth.onAuthStateChange(() => {
      void hydrateAlarmRuntimeForCurrentUser();
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
      appStateSubscription.remove();
      authSubscription?.data.subscription.unsubscribe();
    };
  }, [router]);
}
