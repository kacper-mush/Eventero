-- Workspace lifecycle RPCs: ownership transfer and leaving.
--
-- The workspace_memberships RLS policies forbid creating, updating, or
-- deleting rows where role = 'owner'. These two operations need to mutate
-- those rows safely, so they run as SECURITY DEFINER and verify the
-- caller's role explicitly before any write.

create or replace function public.transfer_workspace_ownership(
  _workspace_id uuid,
  _new_owner_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
  _new_owner_role text;
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  if _caller = _new_owner_id then
    raise exception 'cannot transfer ownership to yourself';
  end if;

  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = _workspace_id
      and user_id = _caller
      and role = 'owner'
  ) then
    raise exception 'only the workspace owner can transfer ownership';
  end if;

  select role into _new_owner_role
  from public.workspace_memberships
  where workspace_id = _workspace_id and user_id = _new_owner_id;

  if _new_owner_role is null then
    raise exception 'new owner must already be a workspace member';
  end if;

  if _new_owner_role not in ('admin', 'member') then
    raise exception 'new owner has unexpected role: %', _new_owner_role;
  end if;

  -- Demote the current owner first so the partial unique index
  -- (one 'owner' per workspace) is satisfied at every step.
  update public.workspace_memberships
    set role = 'admin'
    where workspace_id = _workspace_id and user_id = _caller;

  update public.workspace_memberships
    set role = 'owner'
    where workspace_id = _workspace_id and user_id = _new_owner_id;
end;
$$;

revoke all on function public.transfer_workspace_ownership(uuid, uuid) from public;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;

-- Leaving a workspace:
--   * non-owner: drop the membership row.
--   * owner with other members: refuse — they must transfer first.
--   * sole owner: delete the workspace (cascades remove everything inside).
create or replace function public.leave_workspace(_workspace_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
  _caller_role text;
  _member_count int;
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  select role into _caller_role
  from public.workspace_memberships
  where workspace_id = _workspace_id and user_id = _caller;

  if _caller_role is null then
    raise exception 'you are not a member of this workspace';
  end if;

  if _caller_role = 'owner' then
    select count(*) into _member_count
    from public.workspace_memberships
    where workspace_id = _workspace_id;

    if _member_count > 1 then
      raise exception 'transfer ownership before leaving';
    end if;

    delete from public.workspaces where id = _workspace_id;
  else
    delete from public.workspace_memberships
    where workspace_id = _workspace_id and user_id = _caller;
  end if;
end;
$$;

revoke all on function public.leave_workspace(uuid) from public;
grant execute on function public.leave_workspace(uuid) to authenticated;

-- Member identities (email) for UIs that need to name people, e.g. the
-- transfer-ownership dropdown. The 'read workspace memberships' RLS policy
-- already exposes user_ids to fellow members; this function only adds the
-- email join from auth.users, which is otherwise unreachable from PostgREST.
-- Callers must themselves be a member of the workspace.
create or replace function public.get_workspace_members(_workspace_id uuid)
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_workspace_member(_workspace_id) then
    raise exception 'not a member of this workspace';
  end if;

  return query
    select m.user_id, u.email::text, m.role
    from public.workspace_memberships m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = _workspace_id
    order by
      case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
      u.email;
end;
$$;

revoke all on function public.get_workspace_members(uuid) from public;
grant execute on function public.get_workspace_members(uuid) to authenticated;
