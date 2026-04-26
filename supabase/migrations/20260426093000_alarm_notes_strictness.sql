alter table public.user_alarms
add column if not exists notes text;

alter table public.user_alarms
add column if not exists proof_strictness text not null default 'strict';

alter table public.user_alarms
drop constraint if exists user_alarms_proof_strictness_check;

alter table public.user_alarms
add constraint user_alarms_proof_strictness_check
check (proof_strictness in ('standard', 'strict'));
