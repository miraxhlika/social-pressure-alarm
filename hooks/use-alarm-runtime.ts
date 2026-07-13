import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

import {
  getAlarmPhase,
  getNextActionableAlarm,
  hydrateAlarmRuntimeForCurrentUser,
  updateAlarm,
} from '@/lib/alarms';
import { advanceRecurringOccurrence, createNextOccurrenceDate } from '@/lib/alarm-schedule';
import { getExactAlarmAccessState } from '@/lib/exact-alarm-access';
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

function getScheduleRevisionFromNotification(
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
  const revision = payload?.scheduleRevision;
  return typeof revision === 'number' ? revision : null;
}

function getNotificationDeliveryContext(
  notification:
    | Notifications.Notification
    | Notifications.NotificationResponse
    | null
    | undefined
) {
  if (!notification) {
    return { deliveredAt: null, timezone: null };
  }

  const resolvedNotification = 'notification' in notification ? notification.notification : notification;
  const timezone = resolvedNotification.request.content.data?.timezone;

  return {
    deliveredAt: typeof resolvedNotification.date === 'number' ? resolvedNotification.date : null,
    timezone: typeof timezone === 'string' ? timezone : null,
  };
}

function getOccurrenceAtOrBeforeDelivery(
  alarm: Awaited<ReturnType<typeof hydrateAlarmRuntimeForCurrentUser>>['alarms'][number],
  deliveredAt: number
) {
  let occurrence = createNextOccurrenceDate(
    alarm.hour,
    alarm.minute,
    alarm.repeatSchedule,
    new Date(deliveredAt - 8 * 24 * 60 * 60 * 1000),
    alarm.timezone
  );

  while (alarm.repeatSchedule !== 'once') {
    const next = advanceRecurringOccurrence(
      occurrence,
      alarm.hour,
      alarm.minute,
      alarm.repeatSchedule,
      alarm.timezone
    );

    if (next.getTime() > deliveredAt) {
      break;
    }

    occurrence = next;
  }

  return occurrence;
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

  return kind === 'circle-missed-checkpoint' || kind === 'circle-checkpoint-corrected' || kind === 'circle-nudge';
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

    const routeToAlarmIfStillActive = async (
      alarmId: string,
      clearLastResponse = false,
      scheduleRevision: number | null = null,
      deliveryContext: ReturnType<typeof getNotificationDeliveryContext> = { deliveredAt: null, timezone: null }
    ) => {
      try {
        const store = await hydrateAlarmRuntimeForCurrentUser();
        let alarm = store.alarms.find((candidate) => candidate.id === alarmId) ?? null;
        let acceptedTimezoneTransition = false;

        if (
          alarm &&
          scheduleRevision !== null &&
          alarm.scheduleRevision !== scheduleRevision &&
          deliveryContext.timezone &&
          deliveryContext.timezone !== alarm.timezone &&
          deliveryContext.deliveredAt
        ) {
          const occurrence = getOccurrenceAtOrBeforeDelivery(alarm, deliveryContext.deliveredAt);
          const now = Date.now();

          if (
            occurrence.getTime() <= now &&
            now <= occurrence.getTime() + alarm.gracePeriodSeconds * 1000
          ) {
            alarm = await updateAlarm({ ...alarm, scheduledFor: occurrence.toISOString() });
            acceptedTimezoneTransition = true;
          }
        }

        if (
          !alarm ||
          !alarm.isActive ||
          (scheduleRevision !== null && alarm.scheduleRevision !== scheduleRevision && !acceptedTimezoneTransition) ||
          getAlarmPhase(alarm) !== 'ringing'
        ) {
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
      const [store] = await Promise.all([
        hydrateAlarmRuntimeForCurrentUser(),
        getExactAlarmAccessState().catch(() => 'unsupported' as const),
      ]);
      await syncWeeklyReviewReminderAsync(undefined, {
        requestPermissions: false,
      }).catch(() => null);
      const dueAlarm = getNextActionableAlarm(store.alarms);

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
        void routeToAlarmIfStillActive(
          alarmId,
          true,
          getScheduleRevisionFromNotification(response),
          getNotificationDeliveryContext(response)
        );
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
        void routeToAlarmIfStillActive(
          alarmId,
          false,
          getScheduleRevisionFromNotification(notification),
          getNotificationDeliveryContext(notification)
        );
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const alarmId = getAlarmIdFromNotification(response);

      if (alarmId) {
        void routeToAlarmIfStillActive(
          alarmId,
          true,
          getScheduleRevisionFromNotification(response),
          getNotificationDeliveryContext(response)
        );
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
