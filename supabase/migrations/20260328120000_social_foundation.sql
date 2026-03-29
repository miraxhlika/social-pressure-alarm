create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  handle text not null unique,
  avatar_url text,
  timezone text not null,
  allow_circle_notifications boolean not null default true,
  allow_missed_alarm_alerts boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  invite_code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.circle_memberships (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  notifications_enabled boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (circle_id, user_id)
);

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  expo_push_token text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.alarm_events (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  alarm_id text not null,
  alarm_label text not null,
  scheduled_for timestamptz,
  outcome text not null check (outcome in ('confirmed', 'missed')),
  resolved_at timestamptz not null,
  source text not null default 'device',
  circle_id uuid references public.circles (id) on delete set null,
  share_successes boolean not null default false,
  share_misses boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.proof_shares (
  id uuid primary key default gen_random_uuid(),
  alarm_event_id text not null references public.alarm_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (alarm_event_id, circle_id)
);

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_circles_updated_at
before update on public.circles
for each row
execute function public.set_updated_at();

create trigger set_circle_memberships_updated_at
before update on public.circle_memberships
for each row
execute function public.set_updated_at();

create trigger set_device_push_tokens_updated_at
before update on public.device_push_tokens
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_memberships enable row level security;
alter table public.device_push_tokens enable row level security;
alter table public.alarm_events enable row level security;
alter table public.proof_shares enable row level security;

create policy "profiles_select_self"
on public.profiles
for select
using (auth.uid() = id);

create policy "profiles_insert_self"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles_update_self"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "circles_select_members"
on public.circles
for select
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.circle_memberships memberships
    where memberships.circle_id = circles.id
      and memberships.user_id = auth.uid()
  )
);

create policy "circles_insert_owner"
on public.circles
for insert
with check (owner_id = auth.uid());

create policy "circles_update_owner"
on public.circles
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "circle_memberships_select_members"
on public.circle_memberships
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.circle_memberships peer_memberships
    where peer_memberships.circle_id = circle_memberships.circle_id
      and peer_memberships.user_id = auth.uid()
  )
);

create policy "circle_memberships_insert_self_or_owner"
on public.circle_memberships
for insert
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.circles owned_circles
    where owned_circles.id = circle_memberships.circle_id
      and owned_circles.owner_id = auth.uid()
  )
);

create policy "circle_memberships_update_self_or_owner"
on public.circle_memberships
for update
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.circles owned_circles
    where owned_circles.id = circle_memberships.circle_id
      and owned_circles.owner_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.circles owned_circles
    where owned_circles.id = circle_memberships.circle_id
      and owned_circles.owner_id = auth.uid()
  )
);

create policy "device_push_tokens_select_self"
on public.device_push_tokens
for select
using (user_id = auth.uid());

create policy "device_push_tokens_insert_self"
on public.device_push_tokens
for insert
with check (user_id = auth.uid());

create policy "device_push_tokens_update_self"
on public.device_push_tokens
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "alarm_events_select_owner_or_circle"
on public.alarm_events
for select
using (
  user_id = auth.uid()
  or (
    circle_id is not null
    and exists (
      select 1
      from public.circle_memberships memberships
      where memberships.circle_id = alarm_events.circle_id
        and memberships.user_id = auth.uid()
    )
  )
);

create policy "alarm_events_insert_self"
on public.alarm_events
for insert
with check (user_id = auth.uid());

create policy "alarm_events_update_self"
on public.alarm_events
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "proof_shares_select_owner_or_circle"
on public.proof_shares
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.circle_memberships memberships
    where memberships.circle_id = proof_shares.circle_id
      and memberships.user_id = auth.uid()
  )
);

create policy "proof_shares_insert_self"
on public.proof_shares
for insert
with check (user_id = auth.uid());
