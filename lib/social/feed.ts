import { getSocialSession, getSupabaseClient } from '@/lib/social/client';
import { SocialFeedItem } from '@/lib/social/types';

type VisibleAlarmEventRow = {
  event_id: string;
  alarm_id: string;
  alarm_label: string;
  outcome: 'confirmed' | 'missed';
  resolved_at: string;
  scheduled_for?: string | null;
  circle_id: string;
  circle_name: string;
  actor_id: string;
  actor_display_name: string;
  actor_handle: string;
  is_own_event: boolean;
  metadata: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOptionalIsoString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

function getBoundedNumber(value: unknown) {
  return typeof value === 'number' && !Number.isNaN(value) ? Math.max(0, value) : null;
}

function mapVisibleAlarmEventRow(row: VisibleAlarmEventRow): SocialFeedItem | null {
  const metadata = isRecord(row.metadata) ? row.metadata : null;

  if (!metadata) {
    return null;
  }

  const currentStreak = getBoundedNumber(metadata.currentStreak);
  const longestStreak = getBoundedNumber(metadata.longestStreak);
  const gracePeriodSeconds = getBoundedNumber(metadata.gracePeriodSeconds);
  const weeklyCompletionRate = getBoundedNumber(metadata.weeklyCompletionRate);
  const weeklySuccesses = getBoundedNumber(metadata.weeklySuccesses);
  const weeklyFailures = getBoundedNumber(metadata.weeklyFailures);

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
    id: row.event_id,
    alarmId: row.alarm_id,
    alarmLabel: row.alarm_label,
    outcome: row.outcome,
    resolvedAt: row.resolved_at,
    scheduledFor: row.scheduled_for ?? undefined,
    circleId: row.circle_id,
    circleName: row.circle_name,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    actorHandle: row.actor_handle,
    isOwnEvent: row.is_own_event,
    sharePayload: {
      currentStreak,
      longestStreak,
      gracePeriodSeconds,
      timeToScanSeconds:
        typeof metadata.timeToScanSeconds === 'number' ? Math.max(0, metadata.timeToScanSeconds) : undefined,
      weeklyCompletionRate,
      weeklySuccesses,
      weeklyFailures,
    },
  };
}

export async function listVisibleSocialFeed(limitCount = 8) {
  const client = getSupabaseClient();
  const session = await getSocialSession().catch(() => null);

  if (!client || !session?.user) {
    return [] as SocialFeedItem[];
  }

  const { data, error } = await client.rpc('list_visible_alarm_events', {
    limit_count: Math.max(1, Math.min(50, Math.trunc(limitCount))),
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as VisibleAlarmEventRow[])
    .map(mapVisibleAlarmEventRow)
    .filter((item): item is SocialFeedItem => item !== null)
    .map((item) => ({
      ...item,
      alarmLabel: getTrimmedString(item.alarmLabel) || 'Checkpoint alarm',
      circleName: getTrimmedString(item.circleName) || 'Accountability circle',
      actorDisplayName: getTrimmedString(item.actorDisplayName) || 'Circle member',
      actorHandle: getTrimmedString(item.actorHandle) || 'member',
      resolvedAt: getOptionalIsoString(item.resolvedAt) ?? new Date().toISOString(),
      scheduledFor: getOptionalIsoString(item.scheduledFor),
    }));
}
