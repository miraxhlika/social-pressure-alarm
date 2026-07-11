import {
  Alarm,
  AlarmDefinition,
  AlarmEventRecord,
  AlarmOutcome,
  AlarmRuntimeMetadata,
  AlarmSocialSettings,
  AlarmStore,
  CheckpointPreset,
  FailureHistoryEntry,
  MAX_CHECKPOINT_PRESETS,
  MAX_FAILURE_HISTORY,
  MAX_SUCCESS_HISTORY,
  RepeatSchedule,
  SuccessHistoryEntry,
} from '@/types/alarm';
import { normalizeUseCaseType } from '@/lib/checkpoint-templates';
import { getWeeklyCompletionStats } from '@/lib/progress';
import { hasSocialBackendConfig } from '@/lib/social/config';
import {
  clearMyRemoteAlarms,
  deleteMyRemoteAlarm,
  listMyRemoteAlarms,
  upsertMyRemoteAlarm,
  upsertMyRemoteAlarms,
} from '@/lib/social/alarms';
import { getMyAccountProgressState } from '@/lib/social/progress';
import {
  enqueueAlarmEvent,
  flushAlarmEventQueue,
  migrateGuestAlarmEventQueueToScope,
} from '@/lib/social/queue';
import {
  GUEST_STORAGE_SCOPE,
  getActiveStorageScope,
  readScopedStorageValue,
  readScopedStorageValueForScope,
  removeScopedStorageValueForScope,
  writeScopedStorageValue,
  writeScopedStorageValueForScope,
} from '@/lib/storage';

const STORAGE_KEY = 'social-pressure-alarm/store';
const RUNTIME_STORAGE_KEY = 'social-pressure-alarm/runtime';
const GUEST_MIGRATION_STATE_KEY = 'social-pressure-alarm/guest-migration-state';
export const ALARM_RUNTIME_CACHE_MAX_AGE_MS = 45_000;

type HydrateAlarmRuntimeOptions = {
  force?: boolean;
  maxAgeMs?: number;
};

let hydratedAlarmStoreCache: {
  scope: string;
  store: AlarmStore;
  updatedAt: number;
} | null = null;
let hydrateAlarmRuntimeRequest: {
  promise: Promise<AlarmStore>;
  scope: string;
} | null = null;

type LegacyAlarmInput = Partial<Alarm> & {
  title?: unknown;
  qrValue?: unknown;
  contactName?: unknown;
  message?: unknown;
  notificationId?: unknown;
};

type AlarmRuntimeStore = {
  alarms: Record<string, AlarmRuntimeMetadata>;
  pendingUpserts: string[];
  pendingDeletes: string[];
};

type GuestMigrationState = {
  guestFingerprint: string;
  migratedAt: string;
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

function createDefaultRuntimeStore(): AlarmRuntimeStore {
  return {
    alarms: {},
    pendingUpserts: [],
    pendingDeletes: [],
  };
}

type AlarmAttemptHistoryEntry = {
  alarmId: string;
  outcome: AlarmOutcome;
  resolvedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeGuestMigrationState(value: unknown): GuestMigrationState | null {
  if (!isRecord(value)) {
    return null;
  }

  const guestFingerprint = getTrimmedString(value.guestFingerprint);
  const migratedAt = getOptionalIsoString(value.migratedAt);

  if (!guestFingerprint || !migratedAt) {
    return null;
  }

  return {
    guestFingerprint,
    migratedAt,
  };
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

function getAlarmAttemptHistory(successHistory: SuccessHistoryEntry[], failureHistory: FailureHistoryEntry[]) {
  const successAttempts = successHistory.map<AlarmAttemptHistoryEntry>((entry) => ({
    alarmId: entry.alarmId,
    outcome: 'confirmed',
    resolvedAt: entry.confirmedAt,
  }));
  const failureAttempts = failureHistory.map<AlarmAttemptHistoryEntry>((entry) => ({
    alarmId: entry.alarmId,
    outcome: 'missed',
    resolvedAt: entry.failedAt,
  }));

  return [...successAttempts, ...failureAttempts].sort(
    (left, right) => new Date(left.resolvedAt).getTime() - new Date(right.resolvedAt).getTime()
  );
}

function getCheckpointStreakStats(
  successHistory: SuccessHistoryEntry[],
  failureHistory: FailureHistoryEntry[],
  activeAlarmId: string
) {
  const currentStreakByAlarmId = new Map<string, number>();
  let activeAlarmCurrentStreak = 0;
  let longestStreak = 0;

  for (const attempt of getAlarmAttemptHistory(successHistory, failureHistory)) {
    const previousStreak = currentStreakByAlarmId.get(attempt.alarmId) ?? 0;
    const nextStreak = attempt.outcome === 'confirmed' ? previousStreak + 1 : 0;

    currentStreakByAlarmId.set(attempt.alarmId, nextStreak);
    longestStreak = Math.max(longestStreak, nextStreak);

    if (attempt.alarmId === activeAlarmId) {
      activeAlarmCurrentStreak = nextStreak;
    }
  }

  return {
    currentStreak: activeAlarmCurrentStreak,
    longestStreak,
  };
}

function normalizeSocialSettings(value: unknown): AlarmSocialSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const circleId = getTrimmedString(value.circleId);
  const shareSuccesses = typeof value.shareSuccesses === 'boolean' ? value.shareSuccesses : false;
  const shareMisses = typeof value.shareMisses === 'boolean' ? value.shareMisses : false;

  if (!circleId && !shareSuccesses && !shareMisses) {
    return undefined;
  }

  return {
    circleId,
    shareSuccesses,
    shareMisses,
  };
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
    clientId: getTrimmedString(legacyAlarm.clientId) ?? id,
    hour: getBoundedNumber(legacyAlarm.hour, 0, 23, 7),
    minute: getBoundedNumber(legacyAlarm.minute, 0, 59, 0),
    label:
      getTrimmedString(legacyAlarm.label) ??
      getTrimmedString(legacyAlarm.title) ??
      getTrimmedString(legacyAlarm.contactName) ??
      'Checkpoint',
    useCaseType: normalizeUseCaseType(legacyAlarm.useCaseType),
    placeObject: getTrimmedString(legacyAlarm.placeObject),
    notes: getTrimmedString(legacyAlarm.notes),
    expectedQrPayload,
    repeatSchedule: getRepeatSchedule(legacyAlarm.repeatSchedule),
    gracePeriodSeconds: getBoundedNumber(legacyAlarm.gracePeriodSeconds, 15, 3600, 120),
    isActive: typeof legacyAlarm.isActive === 'boolean' ? legacyAlarm.isActive : true,
    createdAt: getRequiredIsoString(legacyAlarm.createdAt, new Date().toISOString()),
    updatedAt: getOptionalIsoString(legacyAlarm.updatedAt) ?? getOptionalIsoString(legacyAlarm.createdAt),
    scheduledFor: getOptionalIsoString(legacyAlarm.scheduledFor),
    notificationIds: Array.isArray(legacyAlarm.notificationIds)
      ? legacyAlarm.notificationIds
          .map((value) => getTrimmedString(value))
          .filter((value): value is string => Boolean(value))
      : getTrimmedString(legacyAlarm.notificationId)
        ? [getTrimmedString(legacyAlarm.notificationId) as string]
        : undefined,
    socialSettings: normalizeSocialSettings(legacyAlarm.socialSettings),
    lastOutcome,
  };
}

function normalizeRuntimeMetadata(rawValue: unknown): AlarmRuntimeMetadata | null {
  if (!isRecord(rawValue)) {
    return null;
  }

  const scheduledFor = getOptionalIsoString(rawValue.scheduledFor);
  const notificationStrategyKey = getTrimmedString(rawValue.notificationStrategyKey);
  const notificationIds = Array.isArray(rawValue.notificationIds)
    ? rawValue.notificationIds
        .map((value) => getTrimmedString(value))
        .filter((value): value is string => Boolean(value))
    : [];

  if (notificationIds.length === 0 && !scheduledFor) {
    return null;
  }

  return {
    notificationIds,
    scheduledFor,
    notificationStrategyKey,
  };
}

function normalizeRuntimeStore(rawValue: unknown): AlarmRuntimeStore {
  if (!isRecord(rawValue)) {
    return createDefaultRuntimeStore();
  }

  const alarms = isRecord(rawValue.alarms)
    ? Object.entries(rawValue.alarms).reduce<Record<string, AlarmRuntimeMetadata>>((result, [alarmId, value]) => {
        const normalizedMetadata = normalizeRuntimeMetadata(value);

        if (normalizedMetadata) {
          result[alarmId] = normalizedMetadata;
        }

        return result;
      }, {})
    : {};

  return {
    alarms,
    pendingUpserts: Array.isArray(rawValue.pendingUpserts)
      ? rawValue.pendingUpserts
          .map((value) => getTrimmedString(value))
          .filter((value): value is string => Boolean(value))
      : [],
    pendingDeletes: Array.isArray(rawValue.pendingDeletes)
      ? rawValue.pendingDeletes
          .map((value) => getTrimmedString(value))
          .filter((value): value is string => Boolean(value))
      : [],
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
    label: getTrimmedString(rawEntry.label) ?? 'Checkpoint',
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
    label: getTrimmedString(rawEntry.label) ?? 'Checkpoint',
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

function normalizeTimestampKey(timestamp?: string) {
  if (!timestamp) {
    return undefined;
  }

  const timestampMs = new Date(timestamp).getTime();

  return Number.isNaN(timestampMs) ? timestamp.trim() : new Date(timestampMs).toISOString();
}

function getAlarmOccurrenceKey(scheduledFor?: string) {
  return normalizeTimestampKey(scheduledFor) ?? 'unscheduled';
}

export function createAlarmOutcomeIdempotencyKey(
  alarmId: string,
  scheduledFor: string | undefined,
  outcome: AlarmOutcome
) {
  return `${alarmId}::${getAlarmOccurrenceKey(scheduledFor)}::${outcome}`;
}

function hasFailureHistoryForOccurrence(
  failureHistory: FailureHistoryEntry[],
  alarmId: string,
  scheduledFor?: string
) {
  const occurrenceKey = getAlarmOccurrenceKey(scheduledFor);

  return failureHistory.some(
    (entry) => entry.alarmId === alarmId && getAlarmOccurrenceKey(entry.scheduledFor) === occurrenceKey
  );
}

function hasSuccessHistoryForOccurrence(
  successHistory: SuccessHistoryEntry[],
  alarmId: string,
  scheduledFor?: string
) {
  const occurrenceKey = getAlarmOccurrenceKey(scheduledFor);

  return successHistory.some(
    (entry) => entry.alarmId === alarmId && getAlarmOccurrenceKey(entry.scheduledFor) === occurrenceKey
  );
}

type ResolveAlarmOutcomeInStoreOptions = {
  resolvedAt?: string;
  scheduledFor?: string;
  nextScheduledFor?: string;
  isActive?: boolean;
};

export type ResolveAlarmOutcomeInStoreResult = {
  store: AlarmStore;
  alarm: Alarm;
  eventRecord: AlarmEventRecord | null;
  didRecordOutcome: boolean;
};

export function resolveAlarmOutcomeInStore(
  store: AlarmStore,
  alarmId: string,
  outcome: AlarmOutcome,
  options: ResolveAlarmOutcomeInStoreOptions = {}
): ResolveAlarmOutcomeInStoreResult | null {
  const alarm = store.alarms.find((candidate) => candidate.id === alarmId) ?? null;

  if (!alarm) {
    return null;
  }

  const resolvedAt = options.resolvedAt ?? new Date().toISOString();
  const resolvedTimestamp = new Date(resolvedAt).getTime();
  const scheduledFor = options.scheduledFor ?? alarm.scheduledFor;
  const scheduledTimestamp = scheduledFor ? new Date(scheduledFor).getTime() : resolvedTimestamp;
  const nextScheduledFor = options.nextScheduledFor ?? alarm.scheduledFor;
  const updatedAlarm: Alarm = {
    ...alarm,
    clientId: alarm.clientId ?? alarm.id,
    isActive: options.isActive ?? false,
    notificationIds: undefined,
    notificationStrategyKey: undefined,
    scheduledFor: nextScheduledFor,
    lastOutcome: outcome,
    updatedAt: resolvedAt,
  };
  const didRecordOutcome =
    outcome === 'missed'
      ? !hasFailureHistoryForOccurrence(store.failureHistory, alarm.id, scheduledFor)
      : !hasSuccessHistoryForOccurrence(store.successHistory, alarm.id, scheduledFor);
  const failureEntry: FailureHistoryEntry | null =
    didRecordOutcome && outcome === 'missed'
      ? {
          alarmId: alarm.id,
          label: alarm.label,
          scheduledFor,
          failedAt: resolvedAt,
        }
      : null;
  const successEntry: SuccessHistoryEntry | null =
    didRecordOutcome && outcome === 'confirmed'
      ? {
          alarmId: alarm.id,
          label: alarm.label,
          scheduledFor,
          confirmedAt: resolvedAt,
          timeToScanSeconds: Math.min(
            alarm.gracePeriodSeconds,
            Math.max(0, Math.round((resolvedTimestamp - scheduledTimestamp) / 1000))
          ),
          gracePeriodSeconds: alarm.gracePeriodSeconds,
        }
      : null;
  const nextFailureHistory = failureEntry
    ? sortFailureHistory([failureEntry, ...store.failureHistory])
    : store.failureHistory;
  const nextSuccessHistory = successEntry
    ? sortSuccessHistory([successEntry, ...store.successHistory])
    : store.successHistory;
  const checkpointStreakStats = getCheckpointStreakStats(nextSuccessHistory, nextFailureHistory, alarm.id);
  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms(
      store.alarms.map((candidate) =>
        candidate.id === updatedAlarm.id ? stripAlarmRuntimeMetadata(updatedAlarm) : candidate
      )
    ),
    currentStreak: checkpointStreakStats.currentStreak,
    longestStreak: Math.max(store.longestStreak, checkpointStreakStats.longestStreak),
    failureHistory: nextFailureHistory,
    successHistory: nextSuccessHistory,
  };

  if (!didRecordOutcome) {
    return {
      store: nextStore,
      alarm: updatedAlarm,
      eventRecord: null,
      didRecordOutcome,
    };
  }

  const weeklyStats = getWeeklyCompletionStats(nextStore, resolvedTimestamp);
  const idempotencyKey = createAlarmOutcomeIdempotencyKey(alarm.id, scheduledFor, outcome);
  const eventRecord: AlarmEventRecord = {
    id: idempotencyKey,
    clientId: createAlarmOutcomeIdempotencyKey(alarm.clientId ?? alarm.id, scheduledFor, outcome),
    idempotencyKey,
    alarmId: alarm.id,
    alarmLabel: alarm.label,
    scheduledFor,
    outcome,
    resolvedAt,
    source: 'device',
    socialSettings: alarm.socialSettings,
    sharePayload: {
      currentStreak: nextStore.currentStreak,
      longestStreak: nextStore.longestStreak,
      gracePeriodSeconds: alarm.gracePeriodSeconds,
      timeToScanSeconds: successEntry?.timeToScanSeconds,
      weeklyCompletionRate: weeklyStats.completionRate,
      weeklySuccesses: weeklyStats.successes,
      weeklyFailures: weeklyStats.failures,
    },
  };

  return {
    store: nextStore,
    alarm: updatedAlarm,
    eventRecord,
    didRecordOutcome,
  };
}

export type ReconcileOverdueAlarmOutcomesInStoreResult = {
  store: AlarmStore;
  eventRecords: AlarmEventRecord[];
  dirtyAlarmIds: string[];
  resolvedCount: number;
};

export function reconcileOverdueAlarmOutcomesInStore(
  store: AlarmStore,
  now = Date.now()
): ReconcileOverdueAlarmOutcomesInStoreResult {
  const resolvedAt = new Date(now).toISOString();
  let nextStore = store;
  const eventRecords: AlarmEventRecord[] = [];
  const dirtyAlarmIds: string[] = [];
  let resolvedCount = 0;

  for (const alarm of store.alarms) {
    if (!alarm.isActive || !alarm.scheduledFor) {
      continue;
    }

    const deadlineTimestamp = getAlarmDeadlineTimestamp(alarm);

    if (!deadlineTimestamp || deadlineTimestamp >= now) {
      continue;
    }

    const nextScheduledFor =
      alarm.repeatSchedule === 'once'
        ? alarm.scheduledFor
        : createNextAlarmDateForSchedule(alarm.hour, alarm.minute, alarm.repeatSchedule, new Date(now)).toISOString();
    const resolution = resolveAlarmOutcomeInStore(nextStore, alarm.id, 'missed', {
      resolvedAt,
      scheduledFor: alarm.scheduledFor,
      nextScheduledFor,
      isActive: alarm.repeatSchedule !== 'once',
    });

    if (!resolution) {
      continue;
    }

    nextStore = resolution.store;
    dirtyAlarmIds.push(alarm.id);
    resolvedCount += 1;

    if (resolution.eventRecord) {
      eventRecords.push(resolution.eventRecord);
    }
  }

  return {
    store: nextStore,
    eventRecords,
    dirtyAlarmIds: [...new Set(dirtyAlarmIds)],
    resolvedCount,
  };
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

function stripAlarmRuntimeMetadata(alarm: Alarm): AlarmDefinition {
  const { notificationIds: _notificationIds, notificationStrategyKey: _notificationStrategyKey, ...alarmDefinition } = alarm;
  return alarmDefinition;
}

function mergeAlarmWithRuntimeMetadata(alarm: AlarmDefinition, runtimeMetadata?: AlarmRuntimeMetadata): Alarm {
  return {
    ...alarm,
    notificationIds: runtimeMetadata?.notificationIds,
  };
}

async function writeAlarmStoreForScope(scope: string, store: AlarmStore) {
  await writeScopedStorageValueForScope(
    STORAGE_KEY,
    scope,
    JSON.stringify({
      ...store,
      alarms: store.alarms.map(stripAlarmRuntimeMetadata),
    })
  );
}

async function writeRuntimeStore(runtimeStore: AlarmRuntimeStore) {
  await writeScopedStorageValue(RUNTIME_STORAGE_KEY, JSON.stringify(runtimeStore));
}

async function writeRuntimeStoreForScope(scope: string, runtimeStore: AlarmRuntimeStore) {
  await writeScopedStorageValueForScope(RUNTIME_STORAGE_KEY, scope, JSON.stringify(runtimeStore));
}

async function readGuestMigrationStateForScope(scope: string) {
  const scopedValue = await readScopedStorageValueForScope(GUEST_MIGRATION_STATE_KEY, scope);

  if (!scopedValue.value) {
    return null;
  }

  try {
    return normalizeGuestMigrationState(JSON.parse(scopedValue.value));
  } catch {
    return null;
  }
}

async function writeGuestMigrationStateForScope(scope: string, state: GuestMigrationState) {
  await writeScopedStorageValueForScope(GUEST_MIGRATION_STATE_KEY, scope, JSON.stringify(state));
}

async function readPersistedAlarmStore() {
  const scopedStore = await readScopedStorageValue(STORAGE_KEY);
  return parsePersistedAlarmStore(scopedStore.value);
}

async function readPersistedAlarmStoreForScope(scope: string) {
  const scopedStore = await readScopedStorageValueForScope(STORAGE_KEY, scope);
  return parsePersistedAlarmStore(scopedStore.value);
}

function parsePersistedAlarmStore(rawValue: string | null) {
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

async function readPersistedRuntimeStore() {
  const scopedRuntime = await readScopedStorageValue(RUNTIME_STORAGE_KEY);
  return parsePersistedRuntimeStore(scopedRuntime.value);
}

async function readPersistedRuntimeStoreForScope(scope: string) {
  const scopedRuntime = await readScopedStorageValueForScope(RUNTIME_STORAGE_KEY, scope);
  return parsePersistedRuntimeStore(scopedRuntime.value);
}

function parsePersistedRuntimeStore(rawValue: string | null) {
  if (!rawValue) {
    return createDefaultRuntimeStore();
  }

  try {
    return normalizeRuntimeStore(JSON.parse(rawValue));
  } catch {
    return createDefaultRuntimeStore();
  }
}

async function readLocalAlarmState() {
  const [store, runtimeStore] = await Promise.all([readPersistedAlarmStore(), readPersistedRuntimeStore()]);
  return migrateAlarmRuntimeMetadata(store, runtimeStore, writeLocalAlarmState);
}

async function readLocalAlarmStateForScope(scope: string) {
  const [store, runtimeStore] = await Promise.all([
    readPersistedAlarmStoreForScope(scope),
    readPersistedRuntimeStoreForScope(scope),
  ]);
  return migrateAlarmRuntimeMetadata(store, runtimeStore, (nextStore, nextRuntimeStore) =>
    writeLocalAlarmStateForScope(scope, nextStore, nextRuntimeStore)
  );
}

async function migrateAlarmRuntimeMetadata(
  store: AlarmStore,
  runtimeStore: AlarmRuntimeStore,
  writeState: (store: AlarmStore, runtimeStore: AlarmRuntimeStore) => Promise<void>
) {
  let nextRuntimeStore = runtimeStore;
  let didMigrateRuntimeMetadata = false;

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms(
      store.alarms.map((alarm) => {
        if (alarm.notificationIds?.length) {
          nextRuntimeStore = {
            ...nextRuntimeStore,
            alarms: {
              ...nextRuntimeStore.alarms,
              [alarm.id]: {
                notificationIds: alarm.notificationIds,
                scheduledFor: alarm.scheduledFor,
              },
            },
          };
          didMigrateRuntimeMetadata = true;
        }

        return mergeAlarmWithRuntimeMetadata(
          stripAlarmRuntimeMetadata(alarm),
          nextRuntimeStore.alarms[alarm.id]
        );
      })
    ),
  };

  if (didMigrateRuntimeMetadata) {
    await writeState(nextStore, nextRuntimeStore);
  }

  return {
    store: nextStore,
    runtimeStore: nextRuntimeStore,
  };
}

async function writeLocalAlarmState(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  const scope = await getActiveStorageScope();
  await writeLocalAlarmStateForScope(scope, store, runtimeStore);
  hydratedAlarmStoreCache = {
    scope,
    store,
    updatedAt: Date.now(),
  };
}

async function writeLocalAlarmStateForScope(scope: string, store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  await Promise.all([writeAlarmStoreForScope(scope, store), writeRuntimeStoreForScope(scope, runtimeStore)]);
}

function shouldSyncRemoteAlarms() {
  return hasSocialBackendConfig();
}

async function flushPendingAlarmSync(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  if (!shouldSyncRemoteAlarms()) {
    return runtimeStore;
  }

  let nextRuntimeStore = runtimeStore;

  for (const alarmId of runtimeStore.pendingDeletes) {
    try {
      await deleteMyRemoteAlarm(alarmId);
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingDeletes: nextRuntimeStore.pendingDeletes.filter((candidate) => candidate !== alarmId),
      };
    } catch {
      // Keep pending deletes for the next sync attempt.
    }
  }

  for (const alarmId of runtimeStore.pendingUpserts) {
    const alarm = store.alarms.find((candidate) => candidate.id === alarmId);

    if (!alarm) {
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter((candidate) => candidate !== alarmId),
      };
      continue;
    }

    try {
      await upsertMyRemoteAlarm(stripAlarmRuntimeMetadata(alarm));
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter((candidate) => candidate !== alarmId),
      };
    } catch {
      // Keep pending upserts for the next sync attempt.
    }
  }

  if (
    nextRuntimeStore.pendingDeletes.length !== runtimeStore.pendingDeletes.length ||
    nextRuntimeStore.pendingUpserts.length !== runtimeStore.pendingUpserts.length
  ) {
    await writeRuntimeStore(nextRuntimeStore);
  }

  return nextRuntimeStore;
}

async function reconcileOverdueAlarmOutcomesForState(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  const outcomeState = reconcileOverdueAlarmOutcomesInStore(store);

  if (outcomeState.resolvedCount === 0) {
    return {
      store,
      runtimeStore,
      resolvedCount: 0,
    };
  }

  let nextRuntimeStore = runtimeStore;

  if (outcomeState.dirtyAlarmIds.length > 0 && shouldSyncRemoteAlarms()) {
    const dirtyAlarms = outcomeState.store.alarms
      .filter((alarm) => outcomeState.dirtyAlarmIds.includes(alarm.id))
      .map(stripAlarmRuntimeMetadata);

    try {
      await upsertMyRemoteAlarms(dirtyAlarms);
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter(
          (alarmId) => !outcomeState.dirtyAlarmIds.includes(alarmId)
        ),
      };
    } catch {
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: [...new Set([...nextRuntimeStore.pendingUpserts, ...outcomeState.dirtyAlarmIds])],
      };
    }
  }

  for (const eventRecord of outcomeState.eventRecords) {
    await enqueueAlarmEvent(eventRecord);
  }

  if (outcomeState.eventRecords.length > 0) {
    void flushAlarmEventQueue();
  }

  return {
    store: outcomeState.store,
    runtimeStore: nextRuntimeStore,
    resolvedCount: outcomeState.resolvedCount,
  };
}

async function reconcileAlarmOutcomesAndSchedules(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  // A checkpoint is semantically unique by its proof, time, and recurrence. Repair
  // older duplicate creations before reconciling notifications so the discarded
  // checkpoint's scheduled notifications are cancelled as orphans below.
  const deduplicatedAlarms = mergeAlarmDefinitions([], store.alarms, []).alarms;
  const retainedAlarmIds = new Set(deduplicatedAlarms.map((alarm) => alarm.id));
  const duplicateAlarmIds = store.alarms
    .filter((alarm) => !retainedAlarmIds.has(alarm.id))
    .map((alarm) => alarm.id);
  const normalizedStore =
    deduplicatedAlarms.length === store.alarms.length
      ? store
      : {
          ...store,
          alarms: deduplicatedAlarms,
        };
  const normalizedRuntimeStore =
    duplicateAlarmIds.length === 0 || !shouldSyncRemoteAlarms()
      ? runtimeStore
      : {
          ...runtimeStore,
          pendingDeletes: [...new Set([...runtimeStore.pendingDeletes, ...duplicateAlarmIds])],
        };
  const outcomeState = await reconcileOverdueAlarmOutcomesForState(normalizedStore, normalizedRuntimeStore);

  if (outcomeState.resolvedCount > 0) {
    await writeLocalAlarmState(outcomeState.store, outcomeState.runtimeStore);
  }

  return reconcileAlarmSchedules(outcomeState.store, outcomeState.runtimeStore);
}

async function reconcileAlarmSchedules(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  const {
    cancelAlarmNotificationAsync,
    getAlarmNotificationStrategyKey,
    isNotificationPermissionRequiredError,
    readNotificationPreferences,
    scheduleAlarmNotificationAsync,
  } = await import('@/lib/notifications');
  const knownAlarmIds = new Set(store.alarms.map((alarm) => alarm.id));
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: { ...runtimeStore.alarms },
  };
  let nextAlarms = [...store.alarms];
  const alarmsToSyncRemotely = [] as AlarmDefinition[];
  const now = Date.now();
  const notificationPreferences = await readNotificationPreferences();

  for (const [alarmId, metadata] of Object.entries(runtimeStore.alarms)) {
    if (knownAlarmIds.has(alarmId)) {
      continue;
    }

    if (metadata.notificationIds?.length) {
      await cancelAlarmNotificationAsync(metadata.notificationIds);
    }

    delete nextRuntimeStore.alarms[alarmId];
  }

  for (const alarm of nextAlarms) {
    const runtimeMetadata = nextRuntimeStore.alarms[alarm.id];

    if (!alarm.isActive) {
      if (runtimeMetadata?.notificationIds?.length) {
        await cancelAlarmNotificationAsync(runtimeMetadata.notificationIds);
      }

      delete nextRuntimeStore.alarms[alarm.id];
      continue;
    }

    const scheduledForTimestamp = alarm.scheduledFor ? new Date(alarm.scheduledFor).getTime() : null;

    if (scheduledForTimestamp !== null && scheduledForTimestamp <= now) {
      continue;
    }

    const strategyKey = getAlarmNotificationStrategyKey(
      alarm,
      notificationPreferences,
      alarm.scheduledFor ? new Date(alarm.scheduledFor) : createNextAlarmDateForSchedule(alarm.hour, alarm.minute, alarm.repeatSchedule)
    );

    if (runtimeMetadata?.notificationIds?.length) {
      if (
        runtimeMetadata.scheduledFor === alarm.scheduledFor &&
        runtimeMetadata.notificationStrategyKey === strategyKey
      ) {
        continue;
      }

      await cancelAlarmNotificationAsync(runtimeMetadata.notificationIds);
    }

    let scheduled: Awaited<ReturnType<typeof scheduleAlarmNotificationAsync>>;

    try {
      scheduled = await scheduleAlarmNotificationAsync(alarm, {
        scheduledFor: alarm.scheduledFor,
      });
    } catch (error) {
      if (isNotificationPermissionRequiredError(error)) {
        delete nextRuntimeStore.alarms[alarm.id];
        continue;
      }

      throw error;
    }

    nextRuntimeStore.alarms[alarm.id] = {
      notificationIds: scheduled.notificationIds,
      scheduledFor: scheduled.scheduledFor,
      notificationStrategyKey: scheduled.strategyKey,
    };

    if (scheduled.scheduledFor !== alarm.scheduledFor) {
      const nextAlarm = {
        ...alarm,
        scheduledFor: scheduled.scheduledFor,
        updatedAt: new Date(now).toISOString(),
      };

      nextAlarms = nextAlarms.map((candidate) => (candidate.id === alarm.id ? nextAlarm : candidate));
      alarmsToSyncRemotely.push(stripAlarmRuntimeMetadata(nextAlarm));
    }
  }

  if (alarmsToSyncRemotely.length > 0 && shouldSyncRemoteAlarms()) {
    try {
      await upsertMyRemoteAlarms(alarmsToSyncRemotely);
    } catch {
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: [
          ...new Set([...nextRuntimeStore.pendingUpserts, ...alarmsToSyncRemotely.map((alarm) => alarm.id)]),
        ],
      };
    }
  }

  return {
    store: {
      ...store,
      alarms: sortAlarms(nextAlarms),
    },
    runtimeStore: nextRuntimeStore,
  };
}

function getAlarmUpdatedTimestamp(alarm: AlarmDefinition) {
  return new Date(alarm.updatedAt ?? alarm.scheduledFor ?? alarm.createdAt).getTime();
}

function getAlarmSemanticKey(alarm: AlarmDefinition) {
  return [
    alarm.label.trim().toLowerCase(),
    alarm.expectedQrPayload.trim(),
    alarm.hour,
    alarm.minute,
    alarm.repeatSchedule,
  ].join('::');
}

function mergeAlarmDefinition(existing: AlarmDefinition, incoming: AlarmDefinition) {
  if (getAlarmUpdatedTimestamp(incoming) <= getAlarmUpdatedTimestamp(existing)) {
    return existing;
  }

  return {
    ...incoming,
    id: existing.id,
    clientId: existing.clientId ?? incoming.clientId ?? incoming.id,
    createdAt: existing.createdAt,
  };
}

function mergeAlarmDefinitions(
  remoteAlarms: AlarmDefinition[],
  localAlarms: AlarmDefinition[],
  guestAlarms: AlarmDefinition[]
) {
  const mergedAlarms = [] as AlarmDefinition[];
  const alarmIdMap = new Map<string, string>();
  const dirtyAlarmIds = new Set<string>();
  let importedAlarmCount = 0;
  let mergedAlarmCount = 0;

  const upsertAlarm = (alarm: AlarmDefinition, source: 'remote' | 'local' | 'guest') => {
    const incomingAlarm = {
      ...alarm,
      clientId: alarm.clientId ?? alarm.id,
      updatedAt: alarm.updatedAt ?? alarm.createdAt,
    };
    const semanticKey = getAlarmSemanticKey(incomingAlarm);
    const existingIndex = mergedAlarms.findIndex(
      (candidate) =>
        candidate.id === incomingAlarm.id ||
        candidate.clientId === incomingAlarm.clientId ||
        getAlarmSemanticKey(candidate) === semanticKey
    );

    if (existingIndex === -1) {
      mergedAlarms.push(incomingAlarm);
      alarmIdMap.set(alarm.id, incomingAlarm.id);

      if (source !== 'remote') {
        dirtyAlarmIds.add(incomingAlarm.id);
      }

      if (source === 'guest') {
        importedAlarmCount += 1;
      }

      return;
    }

    const existingAlarm = mergedAlarms[existingIndex];
    const nextAlarm = mergeAlarmDefinition(existingAlarm, incomingAlarm);
    mergedAlarms[existingIndex] = nextAlarm;

    if (source !== 'remote' && nextAlarm !== existingAlarm) {
      dirtyAlarmIds.add(nextAlarm.id);
    }

    if (source !== 'remote') {
      alarmIdMap.set(alarm.id, nextAlarm.id);
    }

    if (source === 'guest') {
      mergedAlarmCount += 1;
    }
  };

  remoteAlarms.forEach((alarm) => upsertAlarm(alarm, 'remote'));
  localAlarms.forEach((alarm) => upsertAlarm(alarm, 'local'));
  guestAlarms.forEach((alarm) => upsertAlarm(alarm, 'guest'));

  return {
    alarms: sortAlarms(mergedAlarms),
    alarmIdMap,
    dirtyAlarmIds,
    importedAlarmCount,
    mergedAlarmCount,
  };
}

function mergeRuntimeStoresForMergedAlarms(
  localRuntimeStore: AlarmRuntimeStore,
  guestRuntimeStore: AlarmRuntimeStore,
  alarmIdMap: Map<string, string>,
  knownAlarmIds: Set<string>,
  dirtyAlarmIds: Set<string>
) {
  const alarms = { ...localRuntimeStore.alarms };

  for (const [guestAlarmId, metadata] of Object.entries(guestRuntimeStore.alarms)) {
    const alarmId = alarmIdMap.get(guestAlarmId) ?? guestAlarmId;

    if (!knownAlarmIds.has(alarmId) || alarms[alarmId]) {
      continue;
    }

    alarms[alarmId] = metadata;
  }

  return {
    ...localRuntimeStore,
    alarms: Object.fromEntries(Object.entries(alarms).filter(([alarmId]) => knownAlarmIds.has(alarmId))),
    pendingUpserts: [...new Set([...localRuntimeStore.pendingUpserts, ...dirtyAlarmIds])],
  };
}

function getAlarmHistoryOccurrenceKey(
  alarmId: string,
  scheduledFor: string | undefined,
  outcome: AlarmOutcome,
  resolvedAt: string
) {
  return `${alarmId}::${normalizeTimestampKey(scheduledFor) ?? `resolved:${normalizeTimestampKey(resolvedAt) ?? 'unknown'}`}::${outcome}`;
}

function shouldPreferHistoryEntry(existingResolvedAt: string, incomingResolvedAt: string) {
  return new Date(incomingResolvedAt).getTime() < new Date(existingResolvedAt).getTime();
}

function getFailureHistoryKey(entry: FailureHistoryEntry) {
  return getAlarmHistoryOccurrenceKey(entry.alarmId, entry.scheduledFor, 'missed', entry.failedAt);
}

function getSuccessHistoryKey(entry: SuccessHistoryEntry) {
  return getAlarmHistoryOccurrenceKey(entry.alarmId, entry.scheduledFor, 'confirmed', entry.confirmedAt);
}

function remapFailureHistoryEntry(entry: FailureHistoryEntry, alarmIdMap: Map<string, string>) {
  return {
    ...entry,
    alarmId: alarmIdMap.get(entry.alarmId) ?? entry.alarmId,
  };
}

function remapSuccessHistoryEntry(entry: SuccessHistoryEntry, alarmIdMap: Map<string, string>) {
  return {
    ...entry,
    alarmId: alarmIdMap.get(entry.alarmId) ?? entry.alarmId,
  };
}

function mergeProgressHistories(
  localStore: AlarmStore,
  guestStore: AlarmStore,
  remoteProgress: Awaited<ReturnType<typeof getMyAccountProgressState>> | null,
  alarmIdMap: Map<string, string>
) {
  const failureHistoryByKey = new Map<string, FailureHistoryEntry>();
  const successHistoryByKey = new Map<string, SuccessHistoryEntry>();

  for (const entry of [
    ...(remoteProgress?.failureHistory ?? []),
    ...localStore.failureHistory.map((entry) => remapFailureHistoryEntry(entry, alarmIdMap)),
    ...guestStore.failureHistory.map((entry) => remapFailureHistoryEntry(entry, alarmIdMap)),
  ]) {
    const historyKey = getFailureHistoryKey(entry);
    const existingEntry = failureHistoryByKey.get(historyKey);

    if (!existingEntry || shouldPreferHistoryEntry(existingEntry.failedAt, entry.failedAt)) {
      failureHistoryByKey.set(historyKey, entry);
    }
  }

  for (const entry of [
    ...(remoteProgress?.successHistory ?? []),
    ...localStore.successHistory.map((entry) => remapSuccessHistoryEntry(entry, alarmIdMap)),
    ...guestStore.successHistory.map((entry) => remapSuccessHistoryEntry(entry, alarmIdMap)),
  ]) {
    const historyKey = getSuccessHistoryKey(entry);
    const existingEntry = successHistoryByKey.get(historyKey);

    if (!existingEntry || shouldPreferHistoryEntry(existingEntry.confirmedAt, entry.confirmedAt)) {
      successHistoryByKey.set(historyKey, entry);
    }
  }

  const failureHistory = sortFailureHistory([...failureHistoryByKey.values()]);
  const successHistory = sortSuccessHistory([...successHistoryByKey.values()]);
  const attemptHistory = getAlarmAttemptHistory(successHistory, failureHistory);
  const latestAttempt = attemptHistory[attemptHistory.length - 1];
  const checkpointStreakStats = latestAttempt
    ? getCheckpointStreakStats(successHistory, failureHistory, latestAttempt.alarmId)
    : { currentStreak: 0, longestStreak: 0 };

  return {
    currentStreak: checkpointStreakStats.currentStreak,
    longestStreak: Math.max(
      localStore.longestStreak,
      guestStore.longestStreak,
      remoteProgress?.longestStreak ?? 0,
      checkpointStreakStats.longestStreak
    ),
    failureHistory,
    successHistory,
  };
}

function mergeCheckpointPresets(localStore: AlarmStore, guestStore: AlarmStore) {
  const presetsByKey = new Map<string, CheckpointPreset>();

  for (const preset of [...localStore.checkpointPresets, ...guestStore.checkpointPresets]) {
    const key = `${preset.label.trim().toLowerCase()}::${preset.expectedQrPayload}`;
    const existingPreset = presetsByKey.get(key);

    if (!existingPreset || new Date(preset.lastUsedAt).getTime() > new Date(existingPreset.lastUsedAt).getTime()) {
      presetsByKey.set(key, preset);
    }
  }

  return sortCheckpointPresets([...presetsByKey.values()]);
}

function hasMigratableGuestStoreData(store: AlarmStore) {
  return store.alarms.length > 0 || store.failureHistory.length > 0 || store.successHistory.length > 0;
}

function getGuestStoreFingerprint(store: AlarmStore) {
  return JSON.stringify({
    alarms: store.alarms
      .map((alarm) => `${alarm.id}:${alarm.updatedAt ?? alarm.createdAt}`)
      .sort(),
    failures: store.failureHistory.map(getFailureHistoryKey).sort(),
    successes: store.successHistory.map(getSuccessHistoryKey).sort(),
  });
}

async function enqueueRecentGuestHistoryForSync(
  guestStore: AlarmStore,
  mergedStore: AlarmStore,
  alarmIdMap: Map<string, string>
) {
  let importedHistoryCount = 0;

  for (const entry of guestStore.failureHistory) {
    const alarmId = alarmIdMap.get(entry.alarmId) ?? entry.alarmId;
    const alarm = mergedStore.alarms.find((candidate) => candidate.id === alarmId);
    const idempotencyKey = createAlarmOutcomeIdempotencyKey(alarmId, entry.scheduledFor, 'missed');

    await enqueueAlarmEvent({
      id: idempotencyKey,
      clientId: createAlarmOutcomeIdempotencyKey(entry.alarmId, entry.scheduledFor, 'missed'),
      idempotencyKey,
      alarmId,
      alarmLabel: entry.label,
      scheduledFor: entry.scheduledFor,
      outcome: 'missed',
      resolvedAt: entry.failedAt,
      source: 'device',
      socialSettings: alarm?.socialSettings,
      sharePayload: {
        currentStreak: mergedStore.currentStreak,
        longestStreak: mergedStore.longestStreak,
        gracePeriodSeconds: alarm?.gracePeriodSeconds ?? 120,
        weeklyCompletionRate: 0,
        weeklySuccesses: 0,
        weeklyFailures: 0,
      },
    });
    importedHistoryCount += 1;
  }

  for (const entry of guestStore.successHistory) {
    const alarmId = alarmIdMap.get(entry.alarmId) ?? entry.alarmId;
    const alarm = mergedStore.alarms.find((candidate) => candidate.id === alarmId);
    const idempotencyKey = createAlarmOutcomeIdempotencyKey(alarmId, entry.scheduledFor, 'confirmed');

    await enqueueAlarmEvent({
      id: idempotencyKey,
      clientId: createAlarmOutcomeIdempotencyKey(entry.alarmId, entry.scheduledFor, 'confirmed'),
      idempotencyKey,
      alarmId,
      alarmLabel: entry.label,
      scheduledFor: entry.scheduledFor,
      outcome: 'confirmed',
      resolvedAt: entry.confirmedAt,
      source: 'device',
      socialSettings: alarm?.socialSettings,
      sharePayload: {
        currentStreak: mergedStore.currentStreak,
        longestStreak: mergedStore.longestStreak,
        gracePeriodSeconds: entry.gracePeriodSeconds,
        timeToScanSeconds: entry.timeToScanSeconds,
        weeklyCompletionRate: 0,
        weeklySuccesses: 0,
        weeklyFailures: 0,
      },
    });
    importedHistoryCount += 1;
  }

  return importedHistoryCount;
}

async function hydrateAlarmRuntimeForCurrentUserUncached() {
  const localState = await readLocalAlarmState();

  if (!shouldSyncRemoteAlarms()) {
    const reconciledState = await reconcileAlarmOutcomesAndSchedules(localState.store, localState.runtimeStore);
    await writeLocalAlarmState(reconciledState.store, reconciledState.runtimeStore);
    return reconciledState.store;
  }

  const activeScope = await getActiveStorageScope();
  let nextRuntimeStore = await flushPendingAlarmSync(localState.store, localState.runtimeStore);

  try {
    const [remoteAlarms, remoteProgress, rawGuestState, guestMigrationState] = await Promise.all([
      listMyRemoteAlarms(),
      getMyAccountProgressState().catch(() => null),
      activeScope === GUEST_STORAGE_SCOPE
        ? Promise.resolve({
            store: createDefaultStore(),
            runtimeStore: createDefaultRuntimeStore(),
          })
        : readLocalAlarmStateForScope(GUEST_STORAGE_SCOPE),
      activeScope === GUEST_STORAGE_SCOPE ? Promise.resolve(null) : readGuestMigrationStateForScope(activeScope),
    ]);
    const guestFingerprint = getGuestStoreFingerprint(rawGuestState.store);
    const shouldMigrateGuestState =
      activeScope !== GUEST_STORAGE_SCOPE &&
      hasMigratableGuestStoreData(rawGuestState.store) &&
      guestMigrationState?.guestFingerprint !== guestFingerprint;
    const guestState = shouldMigrateGuestState
      ? rawGuestState
      : {
          store: createDefaultStore(),
          runtimeStore: createDefaultRuntimeStore(),
        };
    const mergedAlarmState = mergeAlarmDefinitions(
      remoteAlarms,
      localState.store.alarms,
      guestState.store.alarms
    );
    const knownAlarmIds = new Set(mergedAlarmState.alarms.map((alarm) => alarm.id));
    nextRuntimeStore = mergeRuntimeStoresForMergedAlarms(
      nextRuntimeStore,
      guestState.runtimeStore,
      mergedAlarmState.alarmIdMap,
      knownAlarmIds,
      mergedAlarmState.dirtyAlarmIds
    );

    let syncedRemoteAlarms = remoteAlarms;

    if (mergedAlarmState.dirtyAlarmIds.size > 0) {
      try {
        syncedRemoteAlarms = await upsertMyRemoteAlarms(
          mergedAlarmState.alarms
            .filter((alarm) => mergedAlarmState.dirtyAlarmIds.has(alarm.id))
            .map(stripAlarmRuntimeMetadata)
        );
        nextRuntimeStore = {
          ...nextRuntimeStore,
          pendingUpserts: nextRuntimeStore.pendingUpserts.filter(
            (alarmId) => !syncedRemoteAlarms.some((alarm) => alarm.id === alarmId)
          ),
        };
      } catch {
        // Keep merged local data visible and mark account-scope writes as unsynced for retry.
      }
    }

    const progressState = mergeProgressHistories(
      localState.store,
      guestState.store,
      remoteProgress,
      mergedAlarmState.alarmIdMap
    );
    const mergedStore: AlarmStore = {
      ...localState.store,
      alarms: mergedAlarmState.alarms,
      lifetimeAlarmCreations: Math.max(
        localState.store.lifetimeAlarmCreations,
        guestState.store.lifetimeAlarmCreations,
        mergedAlarmState.alarms.length
      ),
      currentStreak: progressState.currentStreak,
      longestStreak: progressState.longestStreak,
      failureHistory: progressState.failureHistory,
      successHistory: progressState.successHistory,
      checkpointPresets: mergeCheckpointPresets(localState.store, guestState.store),
    };

    const reconciledState = await reconcileAlarmOutcomesAndSchedules(mergedStore, nextRuntimeStore);
    await writeLocalAlarmState(reconciledState.store, reconciledState.runtimeStore);

    if (shouldMigrateGuestState) {
      await migrateGuestAlarmEventQueueToScope(activeScope, mergedAlarmState.alarmIdMap);
      await enqueueRecentGuestHistoryForSync(guestState.store, reconciledState.store, mergedAlarmState.alarmIdMap);
      await writeGuestMigrationStateForScope(activeScope, {
        guestFingerprint,
        migratedAt: new Date().toISOString(),
      });
      void flushAlarmEventQueue();
    }

    return reconciledState.store;
  } catch {
    const reconciledState = await reconcileAlarmOutcomesAndSchedules(localState.store, nextRuntimeStore);
    await writeLocalAlarmState(reconciledState.store, reconciledState.runtimeStore);
    return reconciledState.store;
  }
}

export async function hydrateAlarmRuntimeForCurrentUser(options: HydrateAlarmRuntimeOptions = {}) {
  const maxAgeMs = options.maxAgeMs ?? 0;
  const activeScope = await getActiveStorageScope();

  if (!options.force && maxAgeMs > 0 && hydratedAlarmStoreCache?.scope === activeScope) {
    const cacheAgeMs = Date.now() - hydratedAlarmStoreCache.updatedAt;

    if (cacheAgeMs < maxAgeMs) {
      return hydratedAlarmStoreCache.store;
    }
  }

  if (!options.force && hydrateAlarmRuntimeRequest?.scope === activeScope) {
    return hydrateAlarmRuntimeRequest.promise;
  }

  const nextPromise = hydrateAlarmRuntimeForCurrentUserUncached();
  hydrateAlarmRuntimeRequest = {
    promise: nextPromise,
    scope: activeScope,
  };

  try {
    return await nextPromise;
  } finally {
    if (hydrateAlarmRuntimeRequest?.promise === nextPromise) {
      hydrateAlarmRuntimeRequest = null;
    }
  }
}

export async function readLocalAlarmStore(): Promise<AlarmStore> {
  const localState = await readLocalAlarmState();
  return localState.store;
}

export async function readAlarmStore(): Promise<AlarmStore> {
  const localState = await readLocalAlarmState();

  if (!shouldSyncRemoteAlarms()) {
    return localState.store;
  }

  const activeScope = await getActiveStorageScope();

  if (activeScope === 'guest' || localState.store.alarms.length > 0) {
    return localState.store;
  }

  return hydrateAlarmRuntimeForCurrentUser();
}

export async function getAlarms() {
  const store = await readAlarmStore();
  return sortAlarms(store.alarms);
}

export async function resetAlarmStore() {
  const activeScope = await getActiveStorageScope();
  const defaultStore = createDefaultStore();

  hydrateAlarmRuntimeRequest = null;
  hydratedAlarmStoreCache = {
    scope: activeScope,
    store: defaultStore,
    updatedAt: Date.now(),
  };

  await Promise.all([
    removeScopedStorageValueForScope(STORAGE_KEY, activeScope),
    removeScopedStorageValueForScope(RUNTIME_STORAGE_KEY, activeScope),
  ]);

  if (shouldSyncRemoteAlarms()) {
    try {
      await clearMyRemoteAlarms();
    } catch {
      // Clearing local demo data should still succeed offline.
    }
  }

  return defaultStore;
}

export async function clearUnusedCheckpointPresets() {
  const { store, runtimeStore } = await readLocalAlarmState();
  const linkedPresetKeys = new Set(
    store.alarms.map((alarm) => `${alarm.label.trim().toLowerCase()}::${alarm.expectedQrPayload}`)
  );
  const nextCheckpointPresets = store.checkpointPresets.filter((preset) =>
    linkedPresetKeys.has(`${preset.label.trim().toLowerCase()}::${preset.expectedQrPayload}`)
  );
  const removedCount = store.checkpointPresets.length - nextCheckpointPresets.length;

  if (removedCount > 0) {
    await writeLocalAlarmState(
      {
        ...store,
        checkpointPresets: nextCheckpointPresets,
      },
      runtimeStore
    );
  }

  return {
    removedCount,
    remainingCount: nextCheckpointPresets.length,
  };
}

export async function getAlarmById(id: string) {
  const alarms = await getAlarms();
  return alarms.find((alarm) => alarm.id === id) ?? null;
}

export async function saveNewAlarm(alarm: Alarm) {
  const { store, runtimeStore } = await readLocalAlarmState();
  const now = new Date().toISOString();
  const alarmToSave: Alarm = {
    ...alarm,
    clientId: alarm.clientId ?? alarm.id,
    updatedAt: alarm.updatedAt ?? now,
  };
  const isExistingCreation = store.alarms.some(
    (candidate) =>
      candidate.id === alarmToSave.id ||
      (candidate.clientId !== undefined && candidate.clientId === alarmToSave.clientId)
  );

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms([
      stripAlarmRuntimeMetadata(alarmToSave),
      ...store.alarms.filter(
        (candidate) =>
          candidate.id !== alarmToSave.id &&
          (candidate.clientId === undefined || candidate.clientId !== alarmToSave.clientId)
      ),
    ]),
    lifetimeAlarmCreations: store.lifetimeAlarmCreations + (isExistingCreation ? 0 : 1),
    checkpointPresets: upsertCheckpointPreset(store.checkpointPresets, alarmToSave),
  };
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: {
      ...runtimeStore.alarms,
      [alarmToSave.id]: {
        notificationIds: alarmToSave.notificationIds,
        scheduledFor: alarmToSave.scheduledFor,
        notificationStrategyKey: alarmToSave.notificationStrategyKey,
      },
    },
    pendingUpserts: shouldSyncRemoteAlarms()
      ? [...new Set([...runtimeStore.pendingUpserts, alarmToSave.id])]
      : runtimeStore.pendingUpserts,
    pendingDeletes: runtimeStore.pendingDeletes.filter((candidate) => candidate !== alarmToSave.id),
  };

  await writeLocalAlarmState(nextStore, nextRuntimeStore);

  if (shouldSyncRemoteAlarms()) {
    try {
      await upsertMyRemoteAlarm(stripAlarmRuntimeMetadata(alarmToSave));
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter((candidate) => candidate !== alarmToSave.id),
      };
      await writeRuntimeStore(nextRuntimeStore);
    } catch {
      // Keep the checkpoint cached locally and retry its remote write later.
    }
  }

  return nextStore;
}

export async function updateAlarm(updatedAlarm: Alarm) {
  const { store, runtimeStore } = await readLocalAlarmState();
  const now = new Date().toISOString();
  const alarmToSave: Alarm = {
    ...updatedAlarm,
    clientId: updatedAlarm.clientId ?? updatedAlarm.id,
    updatedAt: now,
  };

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms(
      store.alarms.map((alarm) =>
        alarm.id === alarmToSave.id ? stripAlarmRuntimeMetadata(alarmToSave) : alarm
      )
    ),
    checkpointPresets: upsertCheckpointPreset(store.checkpointPresets, alarmToSave),
  };
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: {
      ...runtimeStore.alarms,
      [alarmToSave.id]: {
        notificationIds: alarmToSave.notificationIds,
        scheduledFor: alarmToSave.scheduledFor,
        notificationStrategyKey: alarmToSave.notificationStrategyKey,
      },
    },
    pendingUpserts: shouldSyncRemoteAlarms()
      ? [...new Set([...runtimeStore.pendingUpserts, alarmToSave.id])]
      : runtimeStore.pendingUpserts,
    pendingDeletes: runtimeStore.pendingDeletes.filter((candidate) => candidate !== alarmToSave.id),
  };

  if (!alarmToSave.notificationIds?.length) {
    delete nextRuntimeStore.alarms[alarmToSave.id];
  }

  await writeLocalAlarmState(nextStore, nextRuntimeStore);

  if (shouldSyncRemoteAlarms()) {
    try {
      await upsertMyRemoteAlarm(stripAlarmRuntimeMetadata(alarmToSave));
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter((candidate) => candidate !== alarmToSave.id),
      };
      await writeRuntimeStore(nextRuntimeStore);
    } catch {
      // Keep the update queued for the next hydration pass.
    }
  }

  return alarmToSave;
}

export async function rescheduleAlarm(
  alarmOrId: Alarm | string,
  options?: {
    scheduledFor?: string;
  }
) {
  const alarm = typeof alarmOrId === 'string' ? await getAlarmById(alarmOrId) : alarmOrId;

  if (!alarm) {
    return null;
  }

  const { cancelAlarmNotificationAsync, scheduleAlarmNotificationAsync } = await import('@/lib/notifications');
  let scheduledNotificationIds: string[] | undefined;

  try {
    const scheduled = await scheduleAlarmNotificationAsync(
      {
        ...alarm,
        isActive: true,
        lastOutcome: undefined,
      },
      {
        scheduledFor: options?.scheduledFor,
      }
    );

    scheduledNotificationIds = scheduled.notificationIds;

    const nextAlarm = await updateAlarm({
      ...alarm,
      isActive: true,
      lastOutcome: undefined,
      notificationIds: scheduled.notificationIds,
      scheduledFor: scheduled.scheduledFor,
      notificationStrategyKey: scheduled.strategyKey,
    });

    await cancelAlarmNotificationAsync(alarm.notificationIds).catch(() => null);
    return nextAlarm;
  } catch (error) {
    if (scheduledNotificationIds) {
      await cancelAlarmNotificationAsync(scheduledNotificationIds).catch(() => null);
    }

    throw error;
  }
}

export async function deleteAlarm(id: string) {
  const { store, runtimeStore } = await readLocalAlarmState();

  const nextStore: AlarmStore = {
    ...store,
    alarms: store.alarms.filter((alarm) => alarm.id !== id),
  };
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: Object.fromEntries(
      Object.entries(runtimeStore.alarms).filter(([alarmId]) => alarmId !== id)
    ),
    pendingUpserts: runtimeStore.pendingUpserts.filter((candidate) => candidate !== id),
    pendingDeletes: shouldSyncRemoteAlarms()
      ? [...new Set([...runtimeStore.pendingDeletes, id])]
      : runtimeStore.pendingDeletes,
  };

  await writeLocalAlarmState(nextStore, nextRuntimeStore);

  if (shouldSyncRemoteAlarms()) {
    try {
      await deleteMyRemoteAlarm(id);
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingDeletes: nextRuntimeStore.pendingDeletes.filter((candidate) => candidate !== id),
      };
      await writeRuntimeStore(nextRuntimeStore);
    } catch {
      // Keep the delete queued for future hydration.
    }
  }

  return nextStore;
}

export async function resolveAlarm(
  id: string,
  outcome: AlarmOutcome,
  options?: {
    scheduledFor?: string;
  }
) {
  const { store, runtimeStore } = await readLocalAlarmState();
  const alarm = store.alarms.find((candidate) => candidate.id === id) ?? null;

  if (!alarm) {
    return null;
  }

  if (options?.scheduledFor && alarm.scheduledFor !== options.scheduledFor) {
    return null;
  }

  if (!alarm.isActive) {
    return options?.scheduledFor ? null : alarm;
  }

  const resolution = resolveAlarmOutcomeInStore(store, alarm.id, outcome);

  if (!resolution) {
    return null;
  }

  const updatedAlarm = resolution.alarm;
  const nextStore = resolution.store;
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: {
      ...runtimeStore.alarms,
      [updatedAlarm.id]: {
        notificationIds: updatedAlarm.notificationIds,
        scheduledFor: updatedAlarm.scheduledFor,
        notificationStrategyKey: updatedAlarm.notificationStrategyKey,
      },
    },
    pendingUpserts: shouldSyncRemoteAlarms()
      ? [...new Set([...runtimeStore.pendingUpserts, updatedAlarm.id])]
      : runtimeStore.pendingUpserts,
  };

  if (!updatedAlarm.notificationIds?.length) {
    delete nextRuntimeStore.alarms[updatedAlarm.id];
  }

  await writeLocalAlarmState(nextStore, nextRuntimeStore);

  if (shouldSyncRemoteAlarms()) {
    try {
      await upsertMyRemoteAlarm(stripAlarmRuntimeMetadata(updatedAlarm));
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter((candidate) => candidate !== updatedAlarm.id),
      };
      await writeRuntimeStore(nextRuntimeStore);
    } catch {
      // Keep the remote alarm state dirty while the local alarm flow continues.
    }
  }

  if (resolution.eventRecord) {
    await enqueueAlarmEvent(resolution.eventRecord);
    void flushAlarmEventQueue();
  }

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
    .filter((alarm) => alarm.isActive && alarm.scheduledFor && getAlarmPhase(alarm, now) === 'ringing')
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

export function formatAlarmRuntimeTime(
  alarm: Pick<Alarm, 'hour' | 'minute' | 'isActive' | 'scheduledFor'>
) {
  if (alarm.isActive && alarm.scheduledFor) {
    const scheduledDate = new Date(alarm.scheduledFor);

    if (!Number.isNaN(scheduledDate.getTime())) {
      return scheduledDate.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }

  return formatAlarmTime(alarm.hour, alarm.minute);
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
