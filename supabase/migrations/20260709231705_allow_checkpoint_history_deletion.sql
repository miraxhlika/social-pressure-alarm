drop policy if exists "alarm_events_delete_self" on public.alarm_events;

create policy "alarm_events_delete_self"
on public.alarm_events
for delete
using (user_id = auth.uid());
