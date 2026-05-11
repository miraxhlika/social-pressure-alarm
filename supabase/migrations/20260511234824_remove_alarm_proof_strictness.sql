alter table public.user_alarms
drop constraint if exists user_alarms_proof_strictness_check;

alter table public.user_alarms
drop column if exists proof_strictness;
