create table if not exists public.user_alarms (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  label text not null,
  expected_qr_payload text not null,
  hour integer not null check (hour between 0 and 23),
  minute integer not null check (minute between 0 and 59),
  repeat_schedule text not null check (repeat_schedule in ('once', 'daily', 'weekdays')),
  grace_period_seconds integer not null check (grace_period_seconds between 15 and 3600),
  is_active boolean not null default true,
  scheduled_for timestamptz,
  last_outcome text check (last_outcome in ('confirmed', 'missed')),
  social_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, id)
);

create index if not exists user_alarms_user_id_updated_at_idx
on public.user_alarms (user_id, updated_at desc);

create trigger set_user_alarms_updated_at
before update on public.user_alarms
for each row
execute function public.set_updated_at();

alter table public.user_alarms enable row level security;

create policy "user_alarms_select_self"
on public.user_alarms
for select
using (user_id = auth.uid());

create policy "user_alarms_insert_self"
on public.user_alarms
for insert
with check (user_id = auth.uid());

create policy "user_alarms_update_self"
on public.user_alarms
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "user_alarms_delete_self"
on public.user_alarms
for delete
using (user_id = auth.uid());
