import { getSocialSession, getSupabaseClient } from '@/lib/social/client';
import { normalizeUseCaseType } from '@/lib/checkpoint-templates';
import { AlarmDefinition, AlarmSocialSettings, RepeatSchedule } from '@/types/alarm';

type RemoteAlarmRow = {
  id: string;
  user_id: string;
  label: string;
  expected_qr_payload: string;
  hour: number;
  minute: number;
  use_case_type: string;
  place_object?: string | null;
  notes?: string | null;
  repeat_schedule: RepeatSchedule;
  grace_period_seconds: number;
  is_active: boolean;
  scheduled_for?: string | null;
  last_outcome?: 'confirmed' | 'missed' | null;
  social_settings?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function mapSocialSettings(value: unknown): AlarmSocialSettings | undefined {
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

function mapRemoteAlarmRow(row: RemoteAlarmRow): AlarmDefinition {
  return {
    id: row.id,
    clientId: row.id,
    hour: row.hour,
    minute: row.minute,
    label: row.label,
    useCaseType: normalizeUseCaseType(row.use_case_type),
    placeObject: row.place_object ?? undefined,
    notes: row.notes ?? undefined,
    expectedQrPayload: row.expected_qr_payload,
    repeatSchedule: row.repeat_schedule,
    gracePeriodSeconds: row.grace_period_seconds,
    isActive: row.is_active,
    createdAt: row.created_at,
    scheduledFor: row.scheduled_for ?? undefined,
    socialSettings: mapSocialSettings(row.social_settings),
    lastOutcome: row.last_outcome ?? undefined,
    updatedAt: row.updated_at,
  };
}

function mapAlarmDefinitionForWrite(alarm: AlarmDefinition, userId: string) {
  return {
    id: alarm.id,
    user_id: userId,
    label: alarm.label,
    expected_qr_payload: alarm.expectedQrPayload,
    place_object: alarm.placeObject ?? null,
    notes: alarm.notes ?? null,
    hour: alarm.hour,
    minute: alarm.minute,
    use_case_type: alarm.useCaseType,
    repeat_schedule: alarm.repeatSchedule,
    grace_period_seconds: alarm.gracePeriodSeconds,
    is_active: alarm.isActive,
    scheduled_for: alarm.scheduledFor ?? null,
    last_outcome: alarm.lastOutcome ?? null,
    social_settings: alarm.socialSettings ?? {},
    created_at: alarm.createdAt,
  };
}

async function getRequiredAlarmSyncContext() {
  const client = getSupabaseClient();
  const session = await getSocialSession();

  if (!client || !session?.user) {
    throw new Error('Sign in to sync account checkpoints.');
  }

  return {
    client,
    user: session.user,
  };
}

export async function listMyRemoteAlarms() {
  const { client, user } = await getRequiredAlarmSyncContext();
  const { data, error } = await client
    .from('user_alarms')
    .select(
      'id, user_id, label, expected_qr_payload, place_object, notes, hour, minute, use_case_type, repeat_schedule, grace_period_seconds, is_active, scheduled_for, last_outcome, social_settings, created_at, updated_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RemoteAlarmRow[]).map(mapRemoteAlarmRow);
}

export async function upsertMyRemoteAlarm(alarm: AlarmDefinition) {
  const { client, user } = await getRequiredAlarmSyncContext();
  const { data, error } = await client
    .from('user_alarms')
    .upsert(mapAlarmDefinitionForWrite(alarm, user.id), {
      onConflict: 'user_id,id',
    })
    .select(
      'id, user_id, label, expected_qr_payload, place_object, notes, hour, minute, use_case_type, repeat_schedule, grace_period_seconds, is_active, scheduled_for, last_outcome, social_settings, created_at, updated_at'
    )
    .single();

  if (error) {
    throw error;
  }

  return mapRemoteAlarmRow(data as RemoteAlarmRow);
}

export async function upsertMyRemoteAlarms(alarms: AlarmDefinition[]) {
  if (alarms.length === 0) {
    return [] as AlarmDefinition[];
  }

  const { client, user } = await getRequiredAlarmSyncContext();
  const { data, error } = await client
    .from('user_alarms')
    .upsert(
      alarms.map((alarm) => mapAlarmDefinitionForWrite(alarm, user.id)),
      {
        onConflict: 'user_id,id',
      }
    )
    .select(
      'id, user_id, label, expected_qr_payload, place_object, notes, hour, minute, use_case_type, repeat_schedule, grace_period_seconds, is_active, scheduled_for, last_outcome, social_settings, created_at, updated_at'
    );

  if (error) {
    throw error;
  }

  return ((data ?? []) as RemoteAlarmRow[]).map(mapRemoteAlarmRow);
}

export async function deleteMyRemoteAlarm(alarmId: string) {
  const { client, user } = await getRequiredAlarmSyncContext();
  const { error } = await client.from('user_alarms').delete().eq('user_id', user.id).eq('id', alarmId);

  if (error) {
    throw error;
  }
}

export async function clearMyRemoteAlarms() {
  const { client, user } = await getRequiredAlarmSyncContext();
  const { error } = await client.from('user_alarms').delete().eq('user_id', user.id);

  if (error) {
    throw error;
  }
}

export async function clearMyRemoteCheckpointData() {
  const { client, user } = await getRequiredAlarmSyncContext();
  const { error: historyError } = await client.from('alarm_events').delete().eq('user_id', user.id);

  if (historyError) {
    throw historyError;
  }

  const { error: alarmsError } = await client.from('user_alarms').delete().eq('user_id', user.id);

  if (alarmsError) {
    throw alarmsError;
  }
}
