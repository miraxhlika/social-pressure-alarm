-- Checkpoints can now be completed by confirming in the app or by scanning a
-- linked code. Existing rows all have a linked code, so they default to scan.
alter table public.user_alarms
add column if not exists completion_method text not null default 'scan';

alter table public.user_alarms
drop constraint if exists user_alarms_completion_method_check;

alter table public.user_alarms
add constraint user_alarms_completion_method_check
check (completion_method in ('confirm', 'scan'));

-- Confirm checkpoints store an empty code.
update public.user_alarms
set completion_method = 'confirm'
where length(btrim(expected_qr_payload)) = 0;

alter table public.user_alarms
drop constraint if exists user_alarms_scan_requires_code_check;

alter table public.user_alarms
add constraint user_alarms_scan_requires_code_check
check (completion_method <> 'scan' or length(btrim(expected_qr_payload)) > 0);

alter table public.user_alarms
add column if not exists proof_code_type text;

alter table public.user_alarms
drop constraint if exists user_alarms_proof_code_type_check;

alter table public.user_alarms
add constraint user_alarms_proof_code_type_check
check (proof_code_type is null or proof_code_type in ('qr', 'barcode'));

alter table public.user_alarms
add column if not exists checklist_items jsonb not null default '[]'::jsonb;

alter table public.user_alarms
drop constraint if exists user_alarms_checklist_items_check;

alter table public.user_alarms
add constraint user_alarms_checklist_items_check
check (jsonb_typeof(checklist_items) = 'array' and jsonb_array_length(checklist_items) <= 6);
