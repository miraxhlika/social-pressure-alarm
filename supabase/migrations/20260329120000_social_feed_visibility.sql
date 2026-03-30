create index if not exists alarm_events_circle_id_resolved_at_idx
on public.alarm_events (circle_id, resolved_at desc);

alter policy "alarm_events_select_owner_or_circle"
on public.alarm_events
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
    and (
      (outcome = 'confirmed' and share_successes)
      or (outcome = 'missed' and share_misses)
    )
  )
);

alter policy "alarm_events_insert_self"
on public.alarm_events
with check (
  user_id = auth.uid()
  and (
    circle_id is null
    or exists (
      select 1
      from public.circle_memberships memberships
      where memberships.circle_id = alarm_events.circle_id
        and memberships.user_id = auth.uid()
    )
  )
);

alter policy "alarm_events_update_self"
on public.alarm_events
with check (
  user_id = auth.uid()
  and (
    circle_id is null
    or exists (
      select 1
      from public.circle_memberships memberships
      where memberships.circle_id = alarm_events.circle_id
        and memberships.user_id = auth.uid()
    )
  )
);

create or replace function public.list_visible_alarm_events(limit_count integer default 20)
returns table (
  event_id text,
  alarm_id text,
  alarm_label text,
  outcome text,
  resolved_at timestamptz,
  scheduled_for timestamptz,
  circle_id uuid,
  circle_name text,
  actor_id uuid,
  actor_display_name text,
  actor_handle text,
  is_own_event boolean,
  metadata jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    alarm_events.id as event_id,
    alarm_events.alarm_id,
    alarm_events.alarm_label,
    alarm_events.outcome,
    alarm_events.resolved_at,
    alarm_events.scheduled_for,
    alarm_events.circle_id,
    circles.name as circle_name,
    alarm_events.user_id as actor_id,
    coalesce(nullif(profiles.display_name, ''), nullif(profiles.handle, ''), 'Circle member') as actor_display_name,
    coalesce(nullif(profiles.handle, ''), 'member') as actor_handle,
    alarm_events.user_id = auth.uid() as is_own_event,
    alarm_events.metadata
  from public.alarm_events
  left join public.circles
    on circles.id = alarm_events.circle_id
  left join public.profiles
    on profiles.id = alarm_events.user_id
  where (
    alarm_events.user_id = auth.uid()
    or (
      alarm_events.circle_id is not null
      and exists (
        select 1
        from public.circle_memberships memberships
        where memberships.circle_id = alarm_events.circle_id
          and memberships.user_id = auth.uid()
      )
      and (
        (alarm_events.outcome = 'confirmed' and alarm_events.share_successes)
        or (alarm_events.outcome = 'missed' and alarm_events.share_misses)
      )
    )
  )
  order by alarm_events.resolved_at desc
  limit greatest(1, least(coalesce(limit_count, 20), 50));
$$;

revoke all on function public.list_visible_alarm_events(integer) from public;
grant execute on function public.list_visible_alarm_events(integer) to authenticated;
