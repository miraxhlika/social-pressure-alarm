export type NotificationIdentity = {
  identifier: string;
  content?: {
    data?: Record<string, unknown> | null;
  } | null;
};

export function getNotificationAlarmId(notification: NotificationIdentity) {
  const alarmId = notification.content?.data?.alarmId;
  return typeof alarmId === 'string' && alarmId.trim().length > 0 ? alarmId : null;
}

export function getNotificationIdsForAlarms(
  notifications: NotificationIdentity[],
  alarmIds: Iterable<string>,
  preservedNotificationIds: Iterable<string> = []
) {
  const alarmIdSet = new Set(alarmIds);
  const preservedNotificationIdSet = new Set(preservedNotificationIds);

  return notifications
    .filter((notification) => {
      const alarmId = getNotificationAlarmId(notification);
      return alarmId !== null && alarmIdSet.has(alarmId);
    })
    .filter((notification) => !preservedNotificationIdSet.has(notification.identifier))
    .map((notification) => notification.identifier);
}

export function getOrphanedNotificationIds(
  notifications: NotificationIdentity[],
  activeAlarmIds: Iterable<string>
) {
  const activeAlarmIdSet = new Set(activeAlarmIds);

  return notifications
    .filter((notification) => {
      const alarmId = getNotificationAlarmId(notification);
      if (alarmId !== null) {
        return !activeAlarmIdSet.has(alarmId);
      }

      // Requests using our checkpoint namespace but missing modern payload data
      // cannot be safely associated with an active alarm. Remove them and let
      // foreground reconciliation recreate a valid request when appropriate.
      return notification.identifier.startsWith('checkpoint:');
    })
    .map((notification) => notification.identifier);
}
