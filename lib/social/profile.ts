import { getSupabaseClient, getSocialSession } from '@/lib/social/client';
import { SocialProfile, UpsertSocialProfileInput } from '@/lib/social/types';

function mapProfileRow(row: Record<string, unknown>): SocialProfile {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ''),
    handle: String(row.handle ?? ''),
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    timezone: String(row.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
    allowCircleNotifications:
      typeof row.allow_circle_notifications === 'boolean' ? row.allow_circle_notifications : true,
    allowMissedAlarmAlerts:
      typeof row.allow_missed_alarm_alerts === 'boolean' ? row.allow_missed_alarm_alerts : true,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

export async function getMySocialProfile() {
  const client = getSupabaseClient();
  const session = await getSocialSession();

  if (!client || !session?.user) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapProfileRow(data) : null;
}

export async function upsertMySocialProfile(input: UpsertSocialProfileInput) {
  const client = getSupabaseClient();
  const session = await getSocialSession();

  if (!client || !session?.user) {
    throw new Error('No authenticated social session found.');
  }

  const payload = {
    id: session.user.id,
    display_name: input.displayName.trim(),
    handle: input.handle.trim().toLowerCase(),
    avatar_url: input.avatarUrl ?? null,
    timezone: input.timezone,
    allow_circle_notifications: input.allowCircleNotifications,
    allow_missed_alarm_alerts: input.allowMissedAlarmAlerts,
  };

  const { data, error } = await client.from('profiles').upsert(payload).select('*').single();

  if (error) {
    throw error;
  }

  return mapProfileRow(data);
}
