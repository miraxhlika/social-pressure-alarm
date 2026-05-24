import {
  AlarmStore,
  FailureHistoryEntry,
  MAX_FAILURE_HISTORY,
  MAX_SUCCESS_HISTORY,
  SuccessHistoryEntry,
} from '@/types/alarm';
import { getSocialSession, getSupabaseClient } from '@/lib/social/client';

type AlarmEventProgressRow = {
  alarm_id: string;
  alarm_label: string;
  outcome: 'confirmed' | 'missed';
  resolved_at: string;
  scheduled_for?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AccountProgressState = Pick<
  AlarmStore,
  'currentStreak' | 'longestStreak' | 'failureHistory' | 'successHistory'
>;

type CheckpointStreakState = {
  currentStreakByAlarmId: Map<string, number>;
  latestAlarmId: string | null;
  longestStreak: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getBoundedNumber(value: unknown) {
  return typeof value === 'number' && !Number.isNaN(value) ? Math.max(0, Math.trunc(value)) : 0;
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

function mapSuccessEntry(row: AlarmEventProgressRow): SuccessHistoryEntry | null {
  if (row.outcome !== 'confirmed') {
    return null;
  }

  const metadata = isRecord(row.metadata) ? row.metadata : {};

  return {
    alarmId: row.alarm_id,
    label: row.alarm_label,
    scheduledFor: row.scheduled_for ?? undefined,
    confirmedAt: row.resolved_at,
    timeToScanSeconds: getBoundedNumber(metadata.timeToScanSeconds),
    gracePeriodSeconds: Math.max(15, getBoundedNumber(metadata.gracePeriodSeconds) || 120),
  };
}

function mapFailureEntry(row: AlarmEventProgressRow): FailureHistoryEntry | null {
  if (row.outcome !== 'missed') {
    return null;
  }

  return {
    alarmId: row.alarm_id,
    label: row.alarm_label,
    scheduledFor: row.scheduled_for ?? undefined,
    failedAt: row.resolved_at,
  };
}

function buildCheckpointStreakState(rows: AlarmEventProgressRow[]): CheckpointStreakState {
  const currentStreakByAlarmId = new Map<string, number>();
  let latestAlarmId: string | null = null;
  let longestStreak = 0;

  for (const row of rows) {
    const previousStreak = currentStreakByAlarmId.get(row.alarm_id) ?? 0;
    const nextStreak = row.outcome === 'confirmed' ? previousStreak + 1 : 0;

    currentStreakByAlarmId.set(row.alarm_id, nextStreak);
    latestAlarmId = row.alarm_id;
    longestStreak = Math.max(longestStreak, nextStreak);
  }

  return {
    currentStreakByAlarmId,
    latestAlarmId,
    longestStreak,
  };
}

export function buildAccountProgressState(rows: AlarmEventProgressRow[]): AccountProgressState {
  const chronologicalRows = [...rows].sort(
    (left, right) => new Date(left.resolved_at).getTime() - new Date(right.resolved_at).getTime()
  );
  const streakState = buildCheckpointStreakState(chronologicalRows);

  return {
    currentStreak: streakState.latestAlarmId
      ? streakState.currentStreakByAlarmId.get(streakState.latestAlarmId) ?? 0
      : 0,
    longestStreak: streakState.longestStreak,
    successHistory: sortSuccessHistory(
      rows.map(mapSuccessEntry).filter((entry): entry is SuccessHistoryEntry => entry !== null)
    ),
    failureHistory: sortFailureHistory(
      rows.map(mapFailureEntry).filter((entry): entry is FailureHistoryEntry => entry !== null)
    ),
  };
}

export async function listMyAlarmEventHistory(limitCount = 250) {
  const client = getSupabaseClient();
  const session = await getSocialSession();

  if (!client || !session?.user) {
    return [] as AlarmEventProgressRow[];
  }

  const { data, error } = await client
    .from('alarm_events')
    .select('alarm_id, alarm_label, outcome, resolved_at, scheduled_for, metadata')
    .eq('user_id', session.user.id)
    .order('resolved_at', { ascending: false })
    .limit(Math.max(1, Math.min(500, Math.trunc(limitCount))));

  if (error) {
    throw error;
  }

  return (data ?? []) as AlarmEventProgressRow[];
}

export async function getMyAccountProgressState(limitCount = 250) {
  const rows = await listMyAlarmEventHistory(limitCount);
  return buildAccountProgressState(rows);
}
