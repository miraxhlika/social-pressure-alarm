import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type OutboxRow = {
  id: number;
  alarm_event_id: string;
  kind: 'missed_checkpoint' | 'outcome_correction';
  revision: number;
};

type AlarmEventRow = {
  id: string;
  user_id: string;
  alarm_label: string;
  circle_id: string | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKER_SECRET = Deno.env.get('DUE_ALARM_WORKER_SECRET') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SOCIAL_PUSH_CHANNEL_ID = 'social-pressure-social-alerts';

let adminClient: SupabaseClient | null = null;

function getAdmin() {
  adminClient ??= createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return adminClient;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function deliverOutboxItem(admin: SupabaseClient, item: OutboxRow) {
  const { data: eventData, error: eventError } = await admin
    .from('alarm_events')
    .select('id, user_id, alarm_label, circle_id')
    .eq('id', item.alarm_event_id)
    .maybeSingle();

  if (eventError) throw eventError;
  const event = eventData as AlarmEventRow | null;

  if (!event?.circle_id) {
    await admin.from('alarm_notification_outbox').update({ processed_at: new Date().toISOString() }).eq('id', item.id);
    return 0;
  }

  const { data: memberships, error: membershipError } = await admin
    .from('circle_memberships')
    .select('user_id')
    .eq('circle_id', event.circle_id)
    .eq('notifications_enabled', true)
    .neq('user_id', event.user_id);
  if (membershipError) throw membershipError;

  const recipientIds = (memberships ?? []).map((row: { user_id: string }) => row.user_id);
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, handle, allow_circle_notifications, allow_missed_alarm_alerts')
    .in('id', [event.user_id, ...recipientIds]);
  if (profileError) throw profileError;

  const profileById = new Map((profiles ?? []).map((profile: Record<string, unknown>) => [String(profile.id), profile]));
  const actor = profileById.get(event.user_id);
  const actorName =
    (typeof actor?.display_name === 'string' && actor.display_name.trim()) ||
    (typeof actor?.handle === 'string' && actor.handle.trim() ? `@${actor.handle.trim()}` : 'Circle member');
  const eligibleIds = recipientIds.filter((id: string) => {
    const profile = profileById.get(id);
    return profile?.allow_circle_notifications === true && profile.allow_missed_alarm_alerts === true;
  });

  if (eligibleIds.length === 0) {
    await admin.from('alarm_notification_outbox').update({ processed_at: new Date().toISOString() }).eq('id', item.id);
    return 0;
  }

  const [{ data: tokens, error: tokenError }, { data: deliveries, error: deliveryError }] = await Promise.all([
    admin.from('device_push_tokens').select('id, user_id, expo_push_token').in('user_id', eligibleIds),
    admin.from('alarm_notification_deliveries').select('device_push_token_id').eq('outbox_id', item.id),
  ]);
  if (tokenError) throw tokenError;
  if (deliveryError) throw deliveryError;

  const isCorrection = item.kind === 'outcome_correction';
  let eligibleTokens = tokens ?? [];

  if (isCorrection) {
    const { data: missedOutbox, error: missedOutboxError } = await admin
      .from('alarm_notification_outbox')
      .select('id')
      .eq('alarm_event_id', event.id)
      .eq('kind', 'missed_checkpoint')
      .maybeSingle();
    if (missedOutboxError) throw missedOutboxError;

    const { data: originalDeliveries, error: originalDeliveryError } = missedOutbox?.id
      ? await admin
          .from('alarm_notification_deliveries')
          .select('device_push_token_id')
          .eq('outbox_id', missedOutbox.id)
      : { data: [], error: null };
    if (originalDeliveryError) throw originalDeliveryError;
    const originallyNotifiedTokenIds = new Set(
      (originalDeliveries ?? []).map((row: { device_push_token_id: string }) => row.device_push_token_id)
    );
    eligibleTokens = eligibleTokens.filter((token: { id: string }) => originallyNotifiedTokenIds.has(token.id));
  }

  const deliveredTokenIds = new Set((deliveries ?? []).map((row: { device_push_token_id: string }) => row.device_push_token_id));
  const pendingTokens = eligibleTokens.filter((token: { id: string }) => !deliveredTokenIds.has(token.id));
  const messages = pendingTokens.map((token: { expo_push_token: string }) => ({
    to: token.expo_push_token,
    sound: 'default',
    channelId: SOCIAL_PUSH_CHANNEL_ID,
    title: isCorrection ? `${actorName} corrected a checkpoint` : `${actorName} missed a checkpoint`,
    body: isCorrection
      ? `${event.alarm_label || 'Checkpoint'} was completed with valid offline proof.`
      : `${event.alarm_label || 'Checkpoint'} was missed. Check in on them?`,
    data: {
      alarmEventId: event.id,
      circleId: event.circle_id,
      kind: isCorrection ? 'circle-checkpoint-corrected' : 'circle-missed-checkpoint',
    },
  }));

  if (messages.length > 0) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      throw new Error(`Expo push request failed: ${response.status}`);
    }

    const { error: insertError } = await admin.from('alarm_notification_deliveries').upsert(
      pendingTokens.map((token: { id: string }) => ({
        outbox_id: item.id,
        device_push_token_id: token.id,
      })),
      { onConflict: 'outbox_id,device_push_token_id' }
    );
    if (insertError) throw insertError;
  }

  const { error: completeError } = await admin
    .from('alarm_notification_outbox')
    .update({ processed_at: new Date().toISOString(), last_error: null })
    .eq('id', item.id);
  if (completeError) throw completeError;
  return messages.length;
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WORKER_SECRET) {
    return json({ error: 'Worker environment is not configured.' }, 500);
  }

  if (req.headers.get('x-worker-secret') !== WORKER_SECRET) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const admin = getAdmin();

  try {
    const { data: claimed, error: claimError } = await admin.rpc('claim_due_alarm_occurrences', {
      batch_size_input: 100,
    });
    if (claimError) throw claimError;

    const { data, error } = await admin
      .from('alarm_notification_outbox')
      .select('id, alarm_event_id, kind, revision')
      .is('processed_at', null)
      .order('created_at')
      .limit(100);
    if (error) throw error;

    let delivered = 0;
    let failed = 0;

    for (const item of (data ?? []) as OutboxRow[]) {
      try {
        delivered += await deliverOutboxItem(admin, item);
      } catch (error) {
        failed += 1;
        await admin
          .from('alarm_notification_outbox')
          .update({ last_error: error instanceof Error ? error.message : 'Unknown delivery error' })
          .eq('id', item.id);
      }
    }

    return json({ claimed: Number(claimed ?? 0), delivered, failed, processed: (data ?? []).length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Due-alarm processing failed.' }, 500);
  }
});
