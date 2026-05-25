import { getSocialSession, getSupabaseClient } from '@/lib/social/client';
import { hasSocialBackendConfig } from '@/lib/social/config';
import {
  GUEST_STORAGE_SCOPE,
  readScopedStorageValue,
  readScopedStorageValueForScope,
  removeScopedStorageValue,
  writeScopedStorageValue,
  writeScopedStorageValueForScope,
} from '@/lib/storage';
import { SocialQueueSummary, SocialRuntimeSnapshot } from '@/lib/social/types';
import {
  AlarmEventRecord,
  AlarmOutcome,
  AlarmSocialSettings,
  QueuedAlarmEvent,
} from '@/types/alarm';

const ALARM_EVENT_QUEUE_KEY = 'social-pressure-alarm/social/alarm-event-queue';
const SOCIAL_SYNC_META_KEY = 'social-pressure-alarm/social/sync-meta';

type SocialSyncMeta = {
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  latestError?: string;
};

type FlushAlarmEventQueueResult = {
  processed: number;
  delivered: number;
  remaining: number;
  reason: 'disabled' | 'signed_out' | 'idle' | 'synced' | 'partial';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function getOptionalIsoString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
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

function normalizeOutcome(value: unknown): AlarmOutcome | null {
  return value === 'confirmed' || value === 'missed' ? value : null;
}

function getAlarmOutcomeIdempotencyKey(alarmId: string, scheduledFor: string | undefined, outcome: AlarmOutcome) {
  return `${alarmId}::${scheduledFor ?? 'unscheduled'}::${outcome}`;
}

function normalizeQueuedAlarmEvent(value: unknown): QueuedAlarmEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = getTrimmedString(value.id);
  const alarmId = getTrimmedString(value.alarmId);
  const alarmLabel = getTrimmedString(value.alarmLabel);
  const resolvedAt = getOptionalIsoString(value.resolvedAt);
  const outcome = normalizeOutcome(value.outcome);
  const sharePayload = isRecord(value.sharePayload) ? value.sharePayload : null;

  if (!id || !alarmId || !alarmLabel || !resolvedAt || !outcome || !sharePayload) {
    return null;
  }

  const currentStreak =
    typeof sharePayload.currentStreak === 'number' ? Math.max(0, sharePayload.currentStreak) : null;
  const longestStreak =
    typeof sharePayload.longestStreak === 'number' ? Math.max(0, sharePayload.longestStreak) : null;
  const gracePeriodSeconds =
    typeof sharePayload.gracePeriodSeconds === 'number'
      ? Math.max(0, sharePayload.gracePeriodSeconds)
      : null;
  const weeklyCompletionRate =
    typeof sharePayload.weeklyCompletionRate === 'number'
      ? Math.max(0, sharePayload.weeklyCompletionRate)
      : null;
  const weeklySuccesses =
    typeof sharePayload.weeklySuccesses === 'number' ? Math.max(0, sharePayload.weeklySuccesses) : null;
  const weeklyFailures =
    typeof sharePayload.weeklyFailures === 'number' ? Math.max(0, sharePayload.weeklyFailures) : null;

  if (
    currentStreak === null ||
    longestStreak === null ||
    gracePeriodSeconds === null ||
    weeklyCompletionRate === null ||
    weeklySuccesses === null ||
    weeklyFailures === null
  ) {
    return null;
  }

  return {
    id,
    alarmId,
    alarmLabel,
    scheduledFor: getOptionalIsoString(value.scheduledFor),
    outcome,
    resolvedAt,
    source: 'device',
    clientId: getTrimmedString(value.clientId) ?? id,
    idempotencyKey: getTrimmedString(value.idempotencyKey) ?? id,
    socialSettings: normalizeSocialSettings(value.socialSettings),
    sharePayload: {
      currentStreak,
      longestStreak,
      gracePeriodSeconds,
      timeToScanSeconds:
        typeof sharePayload.timeToScanSeconds === 'number'
          ? Math.max(0, sharePayload.timeToScanSeconds)
          : undefined,
      weeklyCompletionRate,
      weeklySuccesses,
      weeklyFailures,
    },
    attempts: typeof value.attempts === 'number' ? Math.max(0, Math.trunc(value.attempts)) : 0,
    lastAttemptAt: getOptionalIsoString(value.lastAttemptAt),
    lastSyncError: getTrimmedString(value.lastSyncError),
  };
}

function normalizeSocialSyncMeta(value: unknown): SocialSyncMeta {
  if (!isRecord(value)) {
    return {};
  }

  return {
    lastAttemptAt: getOptionalIsoString(value.lastAttemptAt),
    lastSuccessfulSyncAt: getOptionalIsoString(value.lastSuccessfulSyncAt),
    latestError: getTrimmedString(value.latestError),
  };
}

async function readAlarmEventQueueStorage() {
  const scopedQueue = await readScopedStorageValue(ALARM_EVENT_QUEUE_KEY);
  return parseAlarmEventQueueStorage(scopedQueue.value);
}

async function readAlarmEventQueueStorageForScope(scope: string) {
  const scopedQueue = await readScopedStorageValueForScope(ALARM_EVENT_QUEUE_KEY, scope);
  return parseAlarmEventQueueStorage(scopedQueue.value);
}

function parseAlarmEventQueueStorage(rawValue: string | null) {
  if (!rawValue) {
    return [] as QueuedAlarmEvent[];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown[];
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeQueuedAlarmEvent)
          .filter((event): event is QueuedAlarmEvent => event !== null)
      : [];
  } catch {
    return [];
  }
}

async function writeAlarmEventQueueStorage(queue: QueuedAlarmEvent[]) {
  await writeScopedStorageValue(ALARM_EVENT_QUEUE_KEY, JSON.stringify(queue));
}

async function writeAlarmEventQueueStorageForScope(scope: string, queue: QueuedAlarmEvent[]) {
  await writeScopedStorageValueForScope(ALARM_EVENT_QUEUE_KEY, scope, JSON.stringify(queue));
}

async function readSocialSyncMetaStorage() {
  const scopedMeta = await readScopedStorageValue(SOCIAL_SYNC_META_KEY);
  const rawValue = scopedMeta.value;

  if (!rawValue) {
    return {} as SocialSyncMeta;
  }

  try {
    return normalizeSocialSyncMeta(JSON.parse(rawValue));
  } catch {
    return {};
  }
}

async function writeSocialSyncMetaStorage(meta: SocialSyncMeta) {
  await writeScopedStorageValue(SOCIAL_SYNC_META_KEY, JSON.stringify(meta));
}

function mapQueuedAlarmEventForSync(event: QueuedAlarmEvent, userId: string) {
  const idempotencyKey = event.idempotencyKey ?? event.clientId ?? event.id;

  return {
    id: idempotencyKey,
    user_id: userId,
    alarm_id: event.alarmId,
    alarm_label: event.alarmLabel,
    scheduled_for: event.scheduledFor ?? null,
    outcome: event.outcome,
    resolved_at: event.resolvedAt,
    source: event.source,
    circle_id: event.socialSettings?.circleId ?? null,
    share_successes: event.socialSettings?.shareSuccesses ?? false,
    share_misses: event.socialSettings?.shareMisses ?? false,
    metadata: {
      ...event.sharePayload,
      clientId: event.clientId ?? event.id,
      idempotencyKey,
    },
  };
}

function shouldCreateProofShare(event: QueuedAlarmEvent) {
  return Boolean(
    event.socialSettings?.circleId &&
      ((event.outcome === 'confirmed' && event.socialSettings.shareSuccesses) ||
        (event.outcome === 'missed' && event.socialSettings.shareMisses))
  );
}

async function upsertProofShareForEvent(event: QueuedAlarmEvent, userId: string) {
  const client = getSupabaseClient();
  const circleId = event.socialSettings?.circleId;
  const alarmEventId = event.idempotencyKey ?? event.clientId ?? event.id;

  if (!client || !circleId || !shouldCreateProofShare(event)) {
    return;
  }

  const { error } = await client.from('proof_shares').upsert(
    {
      alarm_event_id: alarmEventId,
      user_id: userId,
      circle_id: circleId,
      payload: {
        alarmId: event.alarmId,
        alarmLabel: event.alarmLabel,
        scheduledFor: event.scheduledFor ?? null,
        outcome: event.outcome,
        resolvedAt: event.resolvedAt,
        sharePayload: event.sharePayload,
      },
    },
    {
      onConflict: 'alarm_event_id,circle_id',
      ignoreDuplicates: true,
    }
  );

  if (error) {
    throw error;
  }
}

export async function enqueueAlarmEvent(event: AlarmEventRecord) {
  const queue = await readAlarmEventQueueStorage();
  const idempotencyKey = event.idempotencyKey ?? event.clientId ?? event.id;
  const nextQueue: QueuedAlarmEvent[] = [
    {
      ...event,
      id: idempotencyKey,
      clientId: event.clientId ?? event.id,
      idempotencyKey,
      attempts: 0,
    },
    ...queue.filter((queuedEvent) => (queuedEvent.idempotencyKey ?? queuedEvent.id) !== idempotencyKey),
  ];

  await writeAlarmEventQueueStorage(nextQueue);

  return nextQueue[0];
}

export async function readAlarmEventQueue() {
  return readAlarmEventQueueStorage();
}

export async function migrateGuestAlarmEventQueueToScope(
  targetScope: string,
  alarmIdMap: Map<string, string>
) {
  if (targetScope === GUEST_STORAGE_SCOPE) {
    return {
      importedCount: 0,
    };
  }

  const [guestQueue, targetQueue] = await Promise.all([
    readAlarmEventQueueStorageForScope(GUEST_STORAGE_SCOPE),
    readAlarmEventQueueStorageForScope(targetScope),
  ]);

  if (guestQueue.length === 0) {
    return {
      importedCount: 0,
    };
  }

  const existingKeys = new Set(targetQueue.map((event) => event.idempotencyKey ?? event.id));
  const importedEvents = guestQueue
    .map((event) => {
      const alarmId = alarmIdMap.get(event.alarmId) ?? event.alarmId;
      const idempotencyKey = getAlarmOutcomeIdempotencyKey(alarmId, event.scheduledFor, event.outcome);

      return {
        ...event,
        id: idempotencyKey,
        alarmId,
        clientId: event.clientId ?? event.id,
        idempotencyKey,
        lastSyncError: event.lastSyncError,
      };
    })
    .filter((event) => !existingKeys.has(event.idempotencyKey ?? event.id));

  if (importedEvents.length === 0) {
    return {
      importedCount: 0,
    };
  }

  await writeAlarmEventQueueStorageForScope(targetScope, [...importedEvents, ...targetQueue]);

  return {
    importedCount: importedEvents.length,
  };
}

export async function getSocialQueueSummary(): Promise<SocialQueueSummary> {
  const [queuedEvents, meta] = await Promise.all([
    readAlarmEventQueueStorage(),
    readSocialSyncMetaStorage(),
  ]);

  return {
    pendingCount: queuedEvents.length,
    failedCount: queuedEvents.filter((event) => Boolean(event.lastSyncError)).length,
    queuedEvents,
    lastAttemptAt: meta.lastAttemptAt,
    lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt,
    latestError: meta.latestError,
  };
}

export async function getSocialRuntimeSnapshot(): Promise<SocialRuntimeSnapshot> {
  const [queue, session] = await Promise.all([
    getSocialQueueSummary(),
    getSocialSession().catch(() => null),
  ]);

  return {
    configured: hasSocialBackendConfig(),
    authenticated: Boolean(session?.user),
    queue,
  };
}

export async function flushAlarmEventQueue(): Promise<FlushAlarmEventQueueResult> {
  const [queue, meta] = await Promise.all([
    readAlarmEventQueueStorage(),
    readSocialSyncMetaStorage(),
  ]);

  if (queue.length === 0) {
    return {
      processed: 0,
      delivered: 0,
      remaining: 0,
      reason: 'idle',
    };
  }

  const attemptedAt = new Date().toISOString();

  await writeSocialSyncMetaStorage({
    ...meta,
    lastAttemptAt: attemptedAt,
  });

  if (!hasSocialBackendConfig()) {
    return {
      processed: 0,
      delivered: 0,
      remaining: queue.length,
      reason: 'disabled',
    };
  }

  const client = getSupabaseClient();
  const session = await getSocialSession().catch(() => null);

  if (!client || !session?.user) {
    return {
      processed: 0,
      delivered: 0,
      remaining: queue.length,
      reason: 'signed_out',
    };
  }

  const remainingQueue: QueuedAlarmEvent[] = [];
  let deliveredCount = 0;
  let latestError: string | undefined;

  for (const event of queue) {
    try {
      const { error } = await client
        .from('alarm_events')
        .upsert(mapQueuedAlarmEventForSync(event, session.user.id), {
          onConflict: 'id',
        });

      if (error) {
        throw error;
      }

      await upsertProofShareForEvent(event, session.user.id);

      deliveredCount += 1;
    } catch (error) {
      latestError = error instanceof Error ? error.message : 'Alarm event sync failed.';
      remainingQueue.push({
        ...event,
        attempts: event.attempts + 1,
        lastAttemptAt: attemptedAt,
        lastSyncError: latestError,
      });
    }
  }

  await Promise.all([
    writeAlarmEventQueueStorage(remainingQueue),
    writeSocialSyncMetaStorage({
      lastAttemptAt: attemptedAt,
      lastSuccessfulSyncAt: deliveredCount > 0 ? attemptedAt : meta.lastSuccessfulSyncAt,
      latestError,
    }),
  ]);

  return {
    processed: queue.length,
    delivered: deliveredCount,
    remaining: remainingQueue.length,
    reason:
      deliveredCount === 0
        ? latestError
          ? 'partial'
          : 'idle'
        : remainingQueue.length === 0
          ? 'synced'
          : 'partial',
  };
}

export async function resetSocialSyncState() {
  await Promise.all([
    removeScopedStorageValue(ALARM_EVENT_QUEUE_KEY),
    removeScopedStorageValue(SOCIAL_SYNC_META_KEY),
  ]);
}
