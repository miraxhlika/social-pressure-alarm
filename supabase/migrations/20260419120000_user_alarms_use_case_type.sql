alter table public.user_alarms
add column if not exists use_case_type text;

update public.user_alarms
set use_case_type = 'custom'
where use_case_type is null;

alter table public.user_alarms
alter column use_case_type set default 'custom';

alter table public.user_alarms
alter column use_case_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_alarms_use_case_type_check'
  ) then
    alter table public.user_alarms
    add constraint user_alarms_use_case_type_check
    check (
      use_case_type in (
        'wake_up',
        'medication',
        'study_start',
        'deep_work',
        'leave_home',
        'workout',
        'custom'
      )
    );
  end if;
end
$$;
