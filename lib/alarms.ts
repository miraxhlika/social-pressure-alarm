import AsyncStorage from '@react-native-async-storage/async-storage';

import { Alarm, AlarmStore, FREE_ALARM_LIMIT } from '@/types/alarm';

const STORAGE_KEY = 'social-pressure-alarm/store';

const DEFAULT_STORE: AlarmStore = {
  alarms: [],
  lifetimeAlarmCreations: 0,
};

async function writeAlarmStore(store: AlarmStore) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export async function readAlarmStore(): Promise<AlarmStore> {
  const rawValue = await AsyncStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return DEFAULT_STORE;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AlarmStore>;

    return {
      alarms: Array.isArray(parsed.alarms) ? parsed.alarms : [],
      lifetimeAlarmCreations:
        typeof parsed.lifetimeAlarmCreations === 'number' ? parsed.lifetimeAlarmCreations : 0,
    };
  } catch {
    return DEFAULT_STORE;
  }
}

export async function getAlarms() {
  const store = await readAlarmStore();
  return sortAlarms(store.alarms);
}

export async function resetAlarmStore() {
  await AsyncStorage.removeItem(STORAGE_KEY);
  return DEFAULT_STORE;
}

export async function getAlarmById(id: string) {
  const alarms = await getAlarms();
  return alarms.find((alarm) => alarm.id === id) ?? null;
}

export async function saveNewAlarm(alarm: Alarm) {
  const store = await readAlarmStore();

  if (store.lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
    throw new Error('Free alarm limit reached.');
  }

  const nextStore: AlarmStore = {
    alarms: sortAlarms([alarm, ...store.alarms]),
    lifetimeAlarmCreations: store.lifetimeAlarmCreations + 1,
  };

  await writeAlarmStore(nextStore);
  return nextStore;
}

export async function updateAlarm(updatedAlarm: Alarm) {
  const store = await readAlarmStore();

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms(
      store.alarms.map((alarm) => (alarm.id === updatedAlarm.id ? updatedAlarm : alarm))
    ),
  };

  await writeAlarmStore(nextStore);
  return updatedAlarm;
}

export async function deleteAlarm(id: string) {
  const store = await readAlarmStore();

  const nextStore: AlarmStore = {
    ...store,
    alarms: store.alarms.filter((alarm) => alarm.id !== id),
  };

  await writeAlarmStore(nextStore);
  return nextStore;
}

export async function resolveAlarm(id: string, outcome: Alarm['lastOutcome']) {
  const alarm = await getAlarmById(id);

  if (!alarm) {
    return null;
  }

  const updatedAlarm: Alarm = {
    ...alarm,
    isActive: false,
    notificationId: undefined,
    lastOutcome: outcome,
  };

  await updateAlarm(updatedAlarm);
  return updatedAlarm;
}

export function createNextAlarmDate(hour: number, minute: number, now = new Date()) {
  const scheduledFor = new Date(now);
  scheduledFor.setSeconds(0, 0);
  scheduledFor.setHours(hour, minute, 0, 0);

  if (scheduledFor.getTime() <= now.getTime()) {
    scheduledFor.setDate(scheduledFor.getDate() + 1);
  }

  return scheduledFor;
}

export function getAlarmDeadlineTimestamp(alarm: Alarm) {
  if (!alarm.scheduledFor) {
    return null;
  }

  return new Date(alarm.scheduledFor).getTime() + alarm.gracePeriodSeconds * 1000;
}

export function getAlarmPhase(alarm: Alarm, now = Date.now()) {
  if (!alarm.isActive) {
    return alarm.lastOutcome === 'missed' ? 'missed' : 'inactive';
  }

  if (!alarm.scheduledFor) {
    return 'unscheduled';
  }

  const scheduledTime = new Date(alarm.scheduledFor).getTime();
  const deadline = getAlarmDeadlineTimestamp(alarm);

  if (now < scheduledTime) {
    return 'scheduled';
  }

  if (deadline && now <= deadline) {
    return 'ringing';
  }

  return 'missed';
}

export function getNextActionableAlarm(alarms: Alarm[], now = Date.now()) {
  return alarms
    .filter((alarm) => alarm.isActive && alarm.scheduledFor && now >= new Date(alarm.scheduledFor).getTime())
    .sort((left, right) => {
      const leftTime = left.scheduledFor ? new Date(left.scheduledFor).getTime() : 0;
      const rightTime = right.scheduledFor ? new Date(right.scheduledFor).getTime() : 0;
      return leftTime - rightTime;
    })[0] ?? null;
}

export function formatAlarmTime(hour: number, minute: number) {
  const formatted = new Date(2026, 0, 1, hour, minute);
  return formatted.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatScheduledFor(scheduledFor?: string) {
  if (!scheduledFor) {
    return 'Not scheduled';
  }

  return new Date(scheduledFor).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function sortAlarms(alarms: Alarm[]) {
  return [...alarms].sort((left, right) => {
    const leftTime = left.scheduledFor ? new Date(left.scheduledFor).getTime() : 0;
    const rightTime = right.scheduledFor ? new Date(right.scheduledFor).getTime() : 0;

    if (leftTime === rightTime) {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }

    return leftTime - rightTime;
  });
}
