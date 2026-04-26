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
  AlarmProofStrictness,
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
import { enqueueAlarmEvent, flushAlarmEventQueue } from '@/lib/social/queue';
import {
  getActiveStorageScope,
  readScopedStorageValue,
  removeScopedStorageValue,
  writeScopedStorageValue,
} from '@/lib/storage';

const STORAGE_KEY = 'social-pressure-alarm/store';
const RUNTIME_STORAGE_KEY = 'social-pressure-alarm/runtime';

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

function getProofStrictness(value: unknown): AlarmProofStrictness {
  return value === 'standard' ? 'standard' : 'strict';
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
    proofStrictness: getProofStrictness(legacyAlarm.proofStrictness),
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
  const { notificationIds: _notificationIds, ...alarmDefinition } = alarm;
  return alarmDefinition;
}

function mergeAlarmWithRuntimeMetadata(alarm: AlarmDefinition, runtimeMetadata?: AlarmRuntimeMetadata): Alarm {
  return {
    ...alarm,
    notificationIds: runtimeMetadata?.notificationIds,
  };
}

async function writeAlarmStore(store: AlarmStore) {
  await writeScopedStorageValue(
    STORAGE_KEY,
    JSON.stringify({
      ...store,
      alarms: store.alarms.map(stripAlarmRuntimeMetadata),
    })
  );
}

async function writeRuntimeStore(runtimeStore: AlarmRuntimeStore) {
  await writeScopedStorageValue(RUNTIME_STORAGE_KEY, JSON.stringify(runtimeStore));
}

async function readPersistedAlarmStore() {
  const scopedStore = await readScopedStorageValue(STORAGE_KEY);

  if (!scopedStore.value) {
    return createDefaultStore();
  }

  try {
    const parsed = JSON.parse(scopedStore.value) as Partial<AlarmStore>;
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

  if (!scopedRuntime.value) {
    return createDefaultRuntimeStore();
  }

  try {
    return normalizeRuntimeStore(JSON.parse(scopedRuntime.value));
  } catch {
    return createDefaultRuntimeStore();
  }
}

async function readLocalAlarmState() {
  const [store, runtimeStore] = await Promise.all([readPersistedAlarmStore(), readPersistedRuntimeStore()]);
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
    await Promise.all([writeAlarmStore(nextStore), writeRuntimeStore(nextRuntimeStore)]);
  }

  return {
    store: nextStore,
    runtimeStore: nextRuntimeStore,
  };
}

async function writeLocalAlarmState(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  await Promise.all([writeAlarmStore(store), writeRuntimeStore(runtimeStore)]);
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

async function reconcileAlarmSchedules(store: AlarmStore, runtimeStore: AlarmRuntimeStore) {
  const {
    cancelAlarmNotificationAsync,
    getAlarmNotificationStrategyKey,
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

    const scheduled = await scheduleAlarmNotificationAsync(alarm, {
      scheduledFor: alarm.scheduledFor,
    });

    nextRuntimeStore.alarms[alarm.id] = {
      notificationIds: scheduled.notificationIds,
      scheduledFor: scheduled.scheduledFor,
      notificationStrategyKey: scheduled.strategyKey,
    };

    if (scheduled.scheduledFor !== alarm.scheduledFor) {
      const nextAlarm = {
        ...alarm,
        scheduledFor: scheduled.scheduledFor,
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

function applyRemoteProgressState(
  store: AlarmStore,
  progressState: Awaited<ReturnType<typeof getMyAccountProgressState>> | null
) {
  if (!progressState) {
    return store;
  }

  if (progressState.successHistory.length === 0 && progressState.failureHistory.length === 0) {
    return store;
  }

  return {
    ...store,
    currentStreak: progressState.currentStreak,
    longestStreak: progressState.longestStreak,
    failureHistory: progressState.failureHistory,
    successHistory: progressState.successHistory,
  };
}

export async function hydrateAlarmRuntimeForCurrentUser() {
  const localState = await readLocalAlarmState();

  if (!shouldSyncRemoteAlarms()) {
    const reconciledState = await reconcileAlarmSchedules(localState.store, localState.runtimeStore);
    await writeLocalAlarmState(reconciledState.store, reconciledState.runtimeStore);
    return reconciledState.store;
  }

  let nextRuntimeStore = await flushPendingAlarmSync(localState.store, localState.runtimeStore);

  try {
    let remoteAlarms = await listMyRemoteAlarms();

    if (remoteAlarms.length === 0 && localState.store.alarms.length > 0) {
      try {
        remoteAlarms = await upsertMyRemoteAlarms(localState.store.alarms.map(stripAlarmRuntimeMetadata));
        nextRuntimeStore = {
          ...nextRuntimeStore,
          pendingUpserts: nextRuntimeStore.pendingUpserts.filter(
            (alarmId) => !remoteAlarms.some((alarm) => alarm.id === alarmId)
          ),
        };
      } catch {
        remoteAlarms = localState.store.alarms.map(stripAlarmRuntimeMetadata);
      }
    }

    const remoteProgress = await getMyAccountProgressState().catch(() => null);
    const mergedStore = applyRemoteProgressState(
      {
        ...localState.store,
        alarms: sortAlarms(remoteAlarms),
      },
      remoteProgress
    );
    const reconciledState = await reconcileAlarmSchedules(mergedStore, nextRuntimeStore);
    await writeLocalAlarmState(reconciledState.store, reconciledState.runtimeStore);
    return reconciledState.store;
  } catch {
    const reconciledState = await reconcileAlarmSchedules(localState.store, nextRuntimeStore);
    await writeLocalAlarmState(reconciledState.store, reconciledState.runtimeStore);
    return reconciledState.store;
  }
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
  await Promise.all([removeScopedStorageValue(STORAGE_KEY), removeScopedStorageValue(RUNTIME_STORAGE_KEY)]);

  if (shouldSyncRemoteAlarms()) {
    try {
      await clearMyRemoteAlarms();
    } catch {
      // Clearing local demo data should still succeed offline.
    }
  }

  return createDefaultStore();
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

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms([stripAlarmRuntimeMetadata(alarm), ...store.alarms]),
    lifetimeAlarmCreations: store.lifetimeAlarmCreations + 1,
    checkpointPresets: upsertCheckpointPreset(store.checkpointPresets, alarm),
  };
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: {
      ...runtimeStore.alarms,
      [alarm.id]: {
        notificationIds: alarm.notificationIds,
        scheduledFor: alarm.scheduledFor,
        notificationStrategyKey: alarm.notificationStrategyKey,
      },
    },
    pendingUpserts: shouldSyncRemoteAlarms()
      ? [...new Set([...runtimeStore.pendingUpserts, alarm.id])]
      : runtimeStore.pendingUpserts,
    pendingDeletes: runtimeStore.pendingDeletes.filter((candidate) => candidate !== alarm.id),
  };

  await writeLocalAlarmState(nextStore, nextRuntimeStore);

  if (shouldSyncRemoteAlarms()) {
    try {
      await upsertMyRemoteAlarm(stripAlarmRuntimeMetadata(alarm));
      nextRuntimeStore = {
        ...nextRuntimeStore,
        pendingUpserts: nextRuntimeStore.pendingUpserts.filter((candidate) => candidate !== alarm.id),
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

  const nextStore: AlarmStore = {
    ...store,
    alarms: sortAlarms(
      store.alarms.map((alarm) =>
        alarm.id === updatedAlarm.id ? stripAlarmRuntimeMetadata(updatedAlarm) : alarm
      )
    ),
    checkpointPresets: upsertCheckpointPreset(store.checkpointPresets, updatedAlarm),
  };
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
    pendingDeletes: runtimeStore.pendingDeletes.filter((candidate) => candidate !== updatedAlarm.id),
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
      // Keep the update queued for the next hydration pass.
    }
  }

  return updatedAlarm;
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

export async function resolveAlarm(id: string, outcome: AlarmOutcome) {
  const { store, runtimeStore } = await readLocalAlarmState();
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
      store.alarms.map((candidate) =>
        candidate.id === updatedAlarm.id ? stripAlarmRuntimeMetadata(updatedAlarm) : candidate
      )
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
  let nextRuntimeStore: AlarmRuntimeStore = {
    ...runtimeStore,
    alarms: {
      ...runtimeStore.alarms,
      [updatedAlarm.id]: {
        notificationIds: updatedAlarm.notificationIds,
        scheduledFor: updatedAlarm.scheduledFor,
      },
    },
    pendingUpserts: shouldSyncRemoteAlarms()
      ? [...new Set([...runtimeStore.pendingUpserts, updatedAlarm.id])]
      : runtimeStore.pendingUpserts,
  };

  if (!updatedAlarm.notificationIds?.length) {
    delete nextRuntimeStore.alarms[updatedAlarm.id];
  }

  const weeklyStats = getWeeklyCompletionStats(nextStore, resolvedTimestamp);
  const eventRecord: AlarmEventRecord = {
    id: `${alarm.id}-${resolvedAt}`,
    alarmId: alarm.id,
    alarmLabel: alarm.label,
    scheduledFor: alarm.scheduledFor,
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

  await enqueueAlarmEvent(eventRecord);
  void flushAlarmEventQueue();
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
