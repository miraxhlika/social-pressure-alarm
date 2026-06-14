import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type AlertAction = 'missed_checkpoint' | 'nudge';

type AlarmEventRow = {
  id: string;
  user_id: string;
  alarm_label: string;
  outcome: 'confirmed' | 'missed';
  circle_id: string | null;
  share_misses: boolean;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  handle: string | null;
  allow_circle_notifications: boolean;
  allow_missed_alarm_alerts: boolean;
};

type DevicePushTokenRow = {
  user_id: string;
  expo_push_token: string;
};

type ExpoPushMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  channelId: string;
  data: Record<string, string>;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SOCIAL_PUSH_CHANNEL_ID = 'social-pressure-social-alerts';
const NUDGE_MESSAGE_KEY = 'check_in';
const NUDGE_COPY = 'Check back in and reset the next one.';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

let adminClient: SupabaseClient | null = null;

function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  adminClient ??= createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });

  return adminClient;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  });
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getDisplayName(profile: ProfileRow | null | undefined) {
  const handle = getTrimmedString(profile?.handle);

  return getTrimmedString(profile?.display_name) ?? (handle ? `@${handle}` : null) ?? 'Circle member';
}

async function getCaller(req: Request) {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return null;
  }

  const admin = getAdminClient();

  if (!admin) {
    return null;
  }

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

async function getSharedMissedEvent(alarmEventId: string) {
  const admin = getAdminClient();

  if (!admin) {
    throw new Error('Function is missing Supabase environment configuration.');
  }

  const { data, error } = await admin
    .from('alarm_events')
    .select('id, user_id, alarm_label, outcome, circle_id, share_misses')
    .eq('id', alarmEventId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const event = data as AlarmEventRow | null;

  if (!event || event.outcome !== 'missed' || !event.share_misses || !event.circle_id) {
    return null;
  }

  return event;
}

async function getProfilesById(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, ProfileRow>();
  }

  const admin = getAdminClient();

  if (!admin) {
    throw new Error('Function is missing Supabase environment configuration.');
  }

  const { data, error } = await admin
    .from('profiles')
    .select('id, display_name, handle, allow_circle_notifications, allow_missed_alarm_alerts')
    .in('id', userIds);

  if (error) {
    throw error;
  }

  return new Map(((data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
}

async function getEligibleMissedAlertRecipientIds(event: AlarmEventRow) {
  const admin = getAdminClient();

  if (!admin) {
    throw new Error('Function is missing Supabase environment configuration.');
  }

  const { data: memberships, error } = await admin
    .from('circle_memberships')
    .select('user_id')
    .eq('circle_id', event.circle_id)
    .eq('notifications_enabled', true)
    .neq('user_id', event.user_id);

  if (error) {
    throw error;
  }

  const memberIds = ((memberships ?? []) as { user_id: string }[]).map((membership) => membership.user_id);
  const profileById = await getProfilesById(memberIds);

  return memberIds.filter((userId) => {
    const profile = profileById.get(userId);
    return profile?.allow_circle_notifications === true && profile.allow_missed_alarm_alerts === true;
  });
}

async function getPushTokensForUsers(userIds: string[]) {
  if (userIds.length === 0) {
    return [] as DevicePushTokenRow[];
  }

  const admin = getAdminClient();

  if (!admin) {
    throw new Error('Function is missing Supabase environment configuration.');
  }

  const { data, error } = await admin
    .from('device_push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds);

  if (error) {
    throw error;
  }

  return (data ?? []) as DevicePushTokenRow[];
}

async function sendExpoPushes(messages: ExpoPushMessage[]) {
  if (messages.length === 0) {
    return {
      sent: 0,
    };
  }

  const response = await fetch(EXPO_PUSH_URL, {
    body: JSON.stringify(messages),
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Expo push request failed: ${response.status} ${detail}`);
  }

  return {
    sent: messages.length,
  };
}

async function handleMissedCheckpointAlert(alarmEventId: string, callerId: string) {
  const event = await getSharedMissedEvent(alarmEventId);

  if (!event) {
    return jsonResponse({ delivered: 0, reason: 'not_shared_miss' });
  }

  if (event.user_id !== callerId) {
    return jsonResponse({ error: 'Only the checkpoint owner can fan out this miss alert.' }, 403);
  }

  const profileById = await getProfilesById([event.user_id]);
  const actorName = getDisplayName(profileById.get(event.user_id));
  const recipientIds = await getEligibleMissedAlertRecipientIds(event);
  const pushTokens = await getPushTokensForUsers(recipientIds);
  const messages = pushTokens.map<ExpoPushMessage>((token) => ({
    to: token.expo_push_token,
    sound: 'default',
    title: `${actorName} missed a checkpoint`,
    body: `${event.alarm_label || 'Checkpoint'} was missed. Check in on them?`,
    channelId: SOCIAL_PUSH_CHANNEL_ID,
    data: {
      alarmEventId: event.id,
      circleId: event.circle_id ?? '',
      kind: 'circle-missed-checkpoint',
    },
  }));
  const result = await sendExpoPushes(messages);

  return jsonResponse({
    delivered: result.sent,
    recipients: recipientIds.length,
  });
}

async function handleNudge(alarmEventId: string, callerId: string) {
  const event = await getSharedMissedEvent(alarmEventId);

  if (!event) {
    return jsonResponse({ error: 'That shared miss is no longer available.' }, 404);
  }

  if (event.user_id === callerId) {
    return jsonResponse({ error: 'You cannot nudge yourself.' }, 400);
  }

  const admin = getAdminClient();

  if (!admin) {
    throw new Error('Function is missing Supabase environment configuration.');
  }

  const { data: memberships, error: membershipError } = await admin
    .from('circle_memberships')
    .select('user_id, notifications_enabled')
    .eq('circle_id', event.circle_id)
    .in('user_id', [callerId, event.user_id]);

  if (membershipError) {
    throw membershipError;
  }

  const typedMemberships = (memberships ?? []) as { user_id: string; notifications_enabled: boolean }[];
  const senderMembership = typedMemberships.find((membership) => membership.user_id === callerId);
  const recipientMembership = typedMemberships.find((membership) => membership.user_id === event.user_id);

  if (!senderMembership) {
    return jsonResponse({ error: 'Only circle members can send a nudge.' }, 403);
  }

  const { data: nudge, error: nudgeError } = await admin
    .from('circle_nudges')
    .insert({
      alarm_event_id: event.id,
      circle_id: event.circle_id,
      message_key: NUDGE_MESSAGE_KEY,
      recipient_user_id: event.user_id,
      sender_user_id: callerId,
    })
    .select('id')
    .maybeSingle();

  if (nudgeError) {
    if (nudgeError.code === '23505') {
      return jsonResponse({ delivered: 0, duplicate: true });
    }

    throw nudgeError;
  }

  const profileById = await getProfilesById([callerId, event.user_id]);
  const recipientProfile = profileById.get(event.user_id);

  if (recipientProfile?.allow_circle_notifications !== true || recipientMembership?.notifications_enabled !== true) {
    return jsonResponse({ delivered: 0, nudgeId: nudge?.id ?? null, reason: 'recipient_opted_out' });
  }

  const senderName = getDisplayName(profileById.get(callerId));
  const pushTokens = await getPushTokensForUsers([event.user_id]);
  const messages = pushTokens.map<ExpoPushMessage>((token) => ({
    to: token.expo_push_token,
    sound: 'default',
    title: `${senderName} checked in`,
    body: NUDGE_COPY,
    channelId: SOCIAL_PUSH_CHANNEL_ID,
    data: {
      alarmEventId: event.id,
      circleId: event.circle_id ?? '',
      kind: 'circle-nudge',
      nudgeId: String(nudge?.id ?? ''),
    },
  }));
  const result = await sendExpoPushes(messages);

  return jsonResponse({
    delivered: result.sent,
    nudgeId: nudge?.id ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Function is missing Supabase environment configuration.' }, 500);
  }

  try {
    const caller = await getCaller(req);

    if (!caller) {
      return jsonResponse({ error: 'Authentication required.' }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = getTrimmedString(body.action) as AlertAction | null;
    const alarmEventId = getTrimmedString(body.alarmEventId);

    if (!alarmEventId) {
      return jsonResponse({ error: 'alarmEventId is required.' }, 400);
    }

    if (action === 'missed_checkpoint') {
      return await handleMissedCheckpointAlert(alarmEventId, caller.id);
    }

    if (action === 'nudge') {
      return await handleNudge(alarmEventId, caller.id);
    }

    return jsonResponse({ error: 'Unsupported alert action.' }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Circle alert could not be sent.',
      },
      500
    );
  }
});
