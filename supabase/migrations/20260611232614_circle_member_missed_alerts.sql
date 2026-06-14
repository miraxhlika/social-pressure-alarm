create table if not exists public.circle_nudges (
  id uuid primary key default gen_random_uuid(),
  alarm_event_id text not null references public.alarm_events (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  message_key text not null default 'check_in',
  created_at timestamptz not null default timezone('utc', now()),
  unique (alarm_event_id, sender_user_id)
);

create index if not exists circle_nudges_circle_id_created_at_idx
on public.circle_nudges (circle_id, created_at desc);

create index if not exists circle_nudges_recipient_user_id_created_at_idx
on public.circle_nudges (recipient_user_id, created_at desc);

alter table public.circle_nudges enable row level security;

drop policy if exists "device_push_tokens_delete_self" on public.device_push_tokens;
create policy "device_push_tokens_delete_self"
on public.device_push_tokens
for delete
using (user_id = auth.uid());

drop policy if exists "circle_nudges_select_circle_members" on public.circle_nudges;
create policy "circle_nudges_select_circle_members"
on public.circle_nudges
for select
using (
  sender_user_id = auth.uid()
  or recipient_user_id = auth.uid()
  or exists (
    select 1
    from public.circle_memberships memberships
    where memberships.circle_id = circle_nudges.circle_id
      and memberships.user_id = auth.uid()
  )
);

drop policy if exists "circle_nudges_insert_sender" on public.circle_nudges;
create policy "circle_nudges_insert_sender"
on public.circle_nudges
for insert
with check (
  sender_user_id = auth.uid()
  and recipient_user_id <> auth.uid()
  and exists (
    select 1
    from public.circle_memberships memberships
    where memberships.circle_id = circle_nudges.circle_id
      and memberships.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.alarm_events events
    where events.id = circle_nudges.alarm_event_id
      and events.circle_id = circle_nudges.circle_id
      and events.user_id = circle_nudges.recipient_user_id
      and events.outcome = 'missed'
      and events.share_misses
  )
);

create or replace function public.register_device_push_token(
  platform_input text,
  expo_push_token_input text
)
returns public.device_push_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_platform text;
  normalized_token text;
  registered_token public.device_push_tokens%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to register this device for alerts.';
  end if;

  normalized_platform := lower(trim(coalesce(platform_input, '')));
  normalized_token := trim(coalesce(expo_push_token_input, ''));

  if normalized_platform = '' then
    raise exception 'Device platform is required.';
  end if;

  if normalized_token = '' then
    raise exception 'Expo push token is required.';
  end if;

  insert into public.device_push_tokens (user_id, platform, expo_push_token)
  values (auth.uid(), normalized_platform, normalized_token)
  on conflict (expo_push_token) do update
  set
    user_id = excluded.user_id,
    platform = excluded.platform,
    updated_at = timezone('utc', now())
  returning *
  into registered_token;

  return registered_token;
end;
$$;

revoke all on function public.register_device_push_token(text, text) from public;
grant execute on function public.register_device_push_token(text, text) to authenticated;

create or replace function public.unregister_device_push_token(expo_push_token_input text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to unregister this device for alerts.';
  end if;

  normalized_token := trim(coalesce(expo_push_token_input, ''));

  if normalized_token = '' then
    return;
  end if;

  delete from public.device_push_tokens
  where user_id = auth.uid()
    and expo_push_token = normalized_token;
end;
$$;

revoke all on function public.unregister_device_push_token(text) from public;
grant execute on function public.unregister_device_push_token(text) to authenticated;
