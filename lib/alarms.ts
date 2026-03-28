import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  Alarm,
  AlarmOutcome,
  AlarmStore,
  CheckpointPreset,
  FREE_ALARM_LIMIT,
  FailureHistoryEntry,
  MAX_CHECKPOINT_PRESETS,
  MAX_FAILURE_HISTORY,
  MAX_SUCCESS_HISTORY,
  RepeatSchedule,
  SuccessHistoryEntry,
} from '@/types/alarm';

const STORAGE_KEY = 'social-pressure-alarm/store';

type LegacyAlarmInput = Partial<Alarm> & {
  title?: unknown;
  qrValue?: unknown;
  contactName?: unknown;
  message?: unknown;
  notificationId?: unknown;
};

function createDefaultStore(): AlarmStore {
  return {
    alarms: [],
    lifetimeAlarmCreations: 0,
    currentStreak: 0,
    longestStreak: 0,
    failureHistory: [],
    successHistory: [],
    checkpointPresets: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function getBoundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function getOptionalIsoString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

function getRequiredIsoString(value: unknown, fallback: string) {
  return getOptionalIsoString(value) ?? fallback;
}

function getRepeatSchedule(value: unknown): RepeatSchedule {
  return value === 'daily' || value === 'weekdays' ? value : 'once';
}

function normalizeAlarm(rawAlarm: unknown): Alarm | null {
  if (!isRecord(rawAlarm)) {
    return null;
  }

  const legacyAlarm = rawAlarm as LegacyAlarmInput;
  const id = getTrimmedString(legacyAlarm.id);

  if (!id) {
    return null;
  }

  const expectedQrPayload =
    getTrimmedString(legacyAlarm.expectedQrPayload) ??
    getTrimmedString(legacyAlarm.qrValue) ??
    getTrimmedString(legacyAlarm.message) ??
    '';

  const lastOutcome: AlarmOutcome | undefined =
    legacyAlarm.lastOutcome === 'confirmed' || legacyAlarm.lastOutcome === 'missed'
      ? legacyAlarm.lastOutcome
      : undefined;

  return {
    id,
    hour: getBoundedNumber(legacyAlarm.hour, 0, 23, 7),
    minute: getBoundedNumber(legacyAlarm.minute, 0, 59, 0),
    label:
      getTrimmedString(legacyAlarm.label) ??
      getTrimmedString(legacyAlarm.title) ??
      getTrimmedString(legacyAlarm.contactName) ??
      'Checkpoint alarm',
    expectedQrPayload,
    repeatSchedule: getRepeatSchedule(legacyAlarm.repeatSchedule),
    gracePeriodSeconds: getBoundedNumber(legacyAlarm.gracePeriodSeconds, 15, 3600, 120),
    isActive: typeof legacyAlarm.isActive === 'boolean' ? legacyAlarm.isActive : true,
    createdAt: getRequiredIsoString(legacyAlarm.createdAt, new Date().toISOString()),
    scheduledFor: getOptionalIsoString(legacyAlarm.scheduledFor),
    notificationIds: Array.isArray(legacyAlarm.notificationIds)
      ? legacyAlarm.notificationIds
          .map((value) => getTrimmedString(value))
          .filter((value): value is string => Boolean(value))
      : getTrimmedString(legacyAlarm.notificationId)
        ? [getTrimmedString(legacyAlarm.notificationId) as string]
        : undefined,
    lastOutcome,
  };
}

function normalizeFailureEntry(rawEntry: unknown): FailureHistoryEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const alarmId = getTrimmedString(rawEntry.alarmId);
  const failedAt = getOptionalIsoString(rawEntry.failedAt);

  if (!alarmId || !failedAt) {
    return null;
  }

  return {
    alarmId,
    label: getTrimmedString(rawEntry.label) ?? 'Checkpoint alarm',
    scheduledFor: getOptionalIsoString(rawEntry.scheduledFor),
    failedAt,
  };
}

function normalizeSuccessEntry(rawEntry: unknown): SuccessHistoryEntry | null {
  if (!isRecord(rawEntry)) {
    return null;
  }

  const alarmId = getTrimmedString(rawEntry.alarmId);
  const confirmedAt = getOptionalIsoString(rawEntry.confirmedAt);

  if (!alarmId || !confirmedAt) {
    return null;
  }

  return {
    alarmId,
    label: getTrimmedString(rawEntry.label) ?? 'Checkpoint alarm',
    scheduledFor: getOptionalIsoString(rawEntry.scheduledFor),
    confirmedAt,
    timeToScanSeconds: getBoundedNumber(rawEntry.timeToScanSeconds, 0, 86400, 0),
    gracePeriodSeconds: getBoundedNumber(rawEntry.gracePeriodSeconds, 15, 3600, 120),
  };
}

function normalizeCheckpointPreset(rawPreset: unknown): CheckpointPreset | null {
  if (!isRecord(rawPreset)) {
    return null;
  }

  const id = getTrimmedString(rawPreset.id);
  const label = getTrimmedString(rawPreset.label);
  const expectedQrPayload = getTrimmedString(rawPreset.expectedQrPayload);
  const createdAt = getOptionalIsoString(rawPreset.createdAt);
  const lastUsedAt = getOptionalIsoString(rawPreset.lastUsedAt);

  if (!id || !label || !expectedQrPayload || !createdAt || !lastUsedAt) {
    return null;
  }

  return {
    id,
    label,
    expectedQrPayload,
    createdAt,
    lastUsedAt,
  };
}

function sortFailureHistory(entries: FailureHistoryEntry[]) {
  return [...entries]
    .sort((left, right) => new Date(right.failedAt).getTime() - new Date(left.failedAt).getTime())
    .slice(0, MAX_FAILURE_HISTORY);
}

function sortSuccessHistory(entries: SuccessHistoryEntry[]) {
  return [...entries]
    .sort((left, right) => new Date(right.confirmedAt).getTime() - new Date(left.confirmedAt).getTime())
    .slice(0, MAX_SUCCESS_HISTORY);
}

function sortCheckpointPresets(entries: CheckpointPreset[]) {
  return [...entries]
    .sort((left, right) => new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime())
    .slice(0, MAX_CHECKPOINT_PRESETS);
}

function upsertCheckpointPreset(existingPresets: CheckpointPreset[], alarmLike: Pick<Alarm, 'label' | 'expectedQrPayload'>) {
  const now = new Date().toISOString();
  const matchingPreset =
    existingPresets.find(
      (preset) =>
        preset.label.toLowerCase() === alarmLike.label.toLowerCase() &&
        preset.expectedQrPayload === alarmLike.expectedQrPayload
    ) ?? null;

  if (matchingPreset) {
    return sortCheckpointPresets(
      existingPresets.map((preset) =>
        preset.id === matchingPreset.id
          ? {
              ...preset,
              label: alarmLike.label,
              expectedQrPayload: alarmLike.expectedQrPayload,
              lastUsedAt: now,
            }
          : preset
      )
    );
  }

  return sortCheckpointPresets([
    {
      id: `preset-${Date.now()}`,
      label: alarmLike.label,
      expectedQrPayload: alarmLike.expectedQrPayload,
      createdAt: now,
      lastUsedAt: now,
    },
    ...existingPresets,
  ]);
}

async function writeAlarmStore(store: AlarmStore) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export async function readAlarmStore(): Promise<AlarmStore> {
  const rawValue = await AsyncStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return createDefaultStore();
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AlarmStore>;
    const normalizedAlarms = Array.isArray(parsed.alarms)
      ? parsed.alarms.map(normalizeAlarm).filter((alarm): alarm is Alarm => alarm !== null)
      : [];
    const normalizedFailureHistory = Array.isArray(parsed.failureHistory)
      ? parsed.failureHistory
          .map(normalizeFailureEntry)
          .filter((entry): entry is FailureHistoryEntry => entry !== null)
      : [];
    const normalizedSuccessHistory = Array.isArray(parsed.successHistory)
      ? parsed.successHistory
          .map(normalizeSuccessEntry)
          .filter((entry): entry is SuccessHistoryEntry => entry !== null)
      : [];
    const normalizedCheckpointPresets = Array.isArray(parsed.checkpointPresets)
      ? parsed.checkpointPresets
          .map(normalizeCheckpointPreset)
          .filter((preset): preset is CheckpointPreset => preset !== null)
      : [];

    return {
      alarms: sortAlarms(normalizedAlarms),
      lifetimeAlarmCreations:
        typeof parsed.lifetimeAlarmCreations === 'number' ? parsed.lifetimeAlarmCreations : 0,
      currentStreak: typeof parsed.currentStreak === 'number' ? Math.max(0, parsed.currentStreak) : 0,
      longestStreak: typeof parsed.longestStreak === 'number' ? Math.max(0, parsed.longestStreak) : 0,
      failureHistory: sortFailureHistory(normalizedFailureHistory),
      successHistory: sortSuccessHistory(normalizedSuccessHistory),
      checkpointPresets: sortCheckpointPresets(normalizedCheckpointPresets),
    };
  } catch {
    return createDefaultStore();
  }
}

export async function getAlarms() {
  const store = await readAlarmStore();
  return sortAlarms(store.alarms);
}

export async function resetAlarmStore() {
  await AsyncStorage.removeItem(STORAGE_KEY);
  return createDefaultStore();
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
    ...store,
    alarms: sortAlarms([alarm, ...store.alarms]),
    lifetimeAlarmCreations: store.lifetimeAlarmCreations + 1,
    checkpointPresets: upsertCheckpointPreset(store.checkpointPresets, alarm),
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
    checkpointPresets: upsertCheckpointPreset(store.checkpointPresets, updatedAlarm),
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

export async function resolveAlarm(id: string, outcome: AlarmOutcome) {
  const store = await readAlarmStore();
  const alarm = store.alarms.find((candidate) => candidate.id === id) ?? null;

  if (!alarm) {
    return null;
  }

  if (!alarm.isActive) {
    return alarm;
  }

  const updatedAlarm: Alarm = {
    ...alarm,
    isActive: false,
    notificationIds: undefined,
    lastOutcome: outcome,
  };

  const resolvedAt = new Date().toISOString();
  const resolvedTimestamp = new Date(resolvedAt).getTime();
  const scheduledTimestamp = alarm.scheduledFor ? new Date(alarm.scheduledFor).getTime() : resolvedTimestamp;
  const nextCurrentStreak = outcome === 'confirmed' ? store.currentStreak + 1 : 0;
  const failureEntry: FailureHistoryEntry | null =
    outcome === 'missed'
      ? {
          alarmId: alarm.id,
          label: alarm.label,
          scheduledFor: alarm.scheduledFor,
          failedAt: resolvedAt,
        }
      : null;
  const successEntry: SuccessHistoryEntry | null =
    outcome === 'confirmed'
      ? {
          alarmId: alarm.id,
          label: alarm.label,
          scheduledFor: alarm.scheduledFor,
          confirmedAt: resolvedAt,
          timeToScanSeconds: Math.min(
            alarm.gracePeriodSeconds,
            Math.max(0, Math.round((resolvedTimestamp - scheduledTimestamp) / 1000))
          ),
          gracePeriodSeconds: alarm.gracePeriodSeconds,
        }
      : null;

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms(
      store.alarms.map((candidate) => (candidate.id === updatedAlarm.id ? updatedAlarm : candidate))
    ),
    currentStreak: nextCurrentStreak,
    longestStreak: outcome === 'confirmed' ? Math.max(store.longestStreak, nextCurrentStreak) : store.longestStreak,
    failureHistory: failureEntry
      ? sortFailureHistory([failureEntry, ...store.failureHistory])
      : store.failureHistory,
    successHistory: successEntry
      ? sortSuccessHistory([successEntry, ...store.successHistory])
      : store.successHistory,
  };

  await writeAlarmStore(nextStore);
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

export function createNextAlarmDateForSchedule(
  hour: number,
  minute: number,
  repeatSchedule: RepeatSchedule,
  now = new Date()
) {
  const scheduledFor = createNextAlarmDate(hour, minute, now);

  if (repeatSchedule !== 'weekdays') {
    return scheduledFor;
  }

  while (scheduledFor.getDay() === 0 || scheduledFor.getDay() === 6) {
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

export function formatRepeatSchedule(repeatSchedule: RepeatSchedule) {
  if (repeatSchedule === 'daily') {
    return 'Every day';
  }

  if (repeatSchedule === 'weekdays') {
    return 'Weekdays';
  }

  return 'One time';
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
