create or replace function public.join_circle_with_invite_code(invite_code_input text)
returns table (
  id uuid,
  name text,
  description text,
  invite_code text,
  created_at timestamptz,
  updated_at timestamptz,
  role text,
  notifications_enabled boolean,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_invite_code text;
  target_circle public.circles%rowtype;
  membership_row public.circle_memberships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage accountability circles.';
  end if;

  normalized_invite_code := lower(trim(coalesce(invite_code_input, '')));

  if normalized_invite_code = '' then
    raise exception 'Invite code is required.';
  end if;

  select *
  into target_circle
  from public.circles
  where circles.invite_code = normalized_invite_code;

  if not found then
    raise exception 'No circle matches that invite code.';
  end if;

  insert into public.circle_memberships (circle_id, user_id, role, notifications_enabled)
  values (
    target_circle.id,
    auth.uid(),
    case
      when target_circle.owner_id = auth.uid() then 'owner'
      else 'member'
    end,
    true
  )
  on conflict (circle_id, user_id) do nothing;

  select *
  into membership_row
  from public.circle_memberships
  where circle_id = target_circle.id
    and user_id = auth.uid();

  if not found then
    raise exception 'Unable to join circle right now.';
  end if;

  return query
  select
    target_circle.id,
    target_circle.name,
    target_circle.description,
    target_circle.invite_code,
    target_circle.created_at,
    target_circle.updated_at,
    membership_row.role,
    membership_row.notifications_enabled,
    (
      select count(*)::integer
      from public.circle_memberships memberships
      where memberships.circle_id = target_circle.id
    ) as member_count;
end;
$$;

revoke all on function public.join_circle_with_invite_code(text) from public;
grant execute on function public.join_circle_with_invite_code(text) to authenticated;
