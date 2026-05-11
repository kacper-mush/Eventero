-- Post-review hardening for the Groups & invitations slice.
--
-- Each block addresses a specific review finding (numbered in comments).
-- The migration is idempotent on a fresh DB and forward-compatible on top
-- of the earlier ROADMAP-4-migr migrations.

-- =====================================================================
-- (1) notifications: privilege lockdown + immutability trigger
-- =====================================================================
-- Blanket UPDATE on the table let a user rewrite payload->invitation_id,
-- which the SECURITY DEFINER read helper then joined through to disclose
-- workspace name + inviter email for invitations not addressed to them.
-- Two layers:
--   a. Strip table-level UPDATE; grant column-level UPDATE on `read_at`
--      only. Anything else PostgREST tries to UPDATE fails with a
--      privilege error before policies even run.
--   b. A BEFORE UPDATE trigger that double-checks user_id/type/payload
--      didn't change. Defense in depth: catches direct DB connections,
--      RPC misuse, and any future grant drift.

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notifications_freeze_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'notifications.id is immutable';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'notifications.user_id is immutable';
  end if;
  if new.type is distinct from old.type then
    raise exception 'notifications.type is immutable';
  end if;
  if new.payload is distinct from old.payload then
    raise exception 'notifications.payload is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'notifications.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_freeze_immutable on public.notifications;
create trigger notifications_freeze_immutable
  before update on public.notifications
  for each row execute function public.notifications_freeze_immutable();

-- =====================================================================
-- (2) Resilient payload handling in get_my_notifications + shape check
-- =====================================================================
-- The previous join cast payload->>'invitation_id' straight to uuid. A
-- single bad row (e.g. a future notification type with no invitation_id)
-- would raise and break every recipient's inbox.
--
-- Fix on two fronts:
--   a. A CHECK constraint enforcing payload shape per type. Any row
--      written by the RPCs is well-formed by construction; the check
--      stops a hypothetical buggy future writer from inserting garbage.
--   b. A safe-cast helper used in the read function so a malformed row
--      degrades to "the join didn't match" rather than killing the query.

create or replace function public.try_uuid(_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return _text::uuid;
exception when others then
  return null;
end;
$$;

-- The shape constraint is permissive about *unknown* types so future
-- additions don't need a coordinated migration; for each known type it
-- enforces the keys this slice's code reads.
alter table public.notifications
  drop constraint if exists notifications_payload_shape;

alter table public.notifications
  add constraint notifications_payload_shape check (
    case type
      when 'workspace_invitation' then
        jsonb_typeof(payload) = 'object'
        and (payload ? 'invitation_id')
        and jsonb_typeof(payload->'invitation_id') = 'string'
        and public.try_uuid(payload->>'invitation_id') is not null
      else true
    end
  );

create or replace function public.get_my_notifications()
returns table (
  id uuid,
  type text,
  read_at timestamptz,
  created_at timestamptz,
  invitation_id uuid,
  invitation_status text,
  invitation_expires_at timestamptz,
  invitation_role text,
  workspace_id uuid,
  workspace_name text,
  inviter_email text
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  return query
    select
      n.id,
      n.type,
      n.read_at,
      n.created_at,
      i.id as invitation_id,
      i.status as invitation_status,
      i.expires_at as invitation_expires_at,
      i.workspace_role as invitation_role,
      w.id as workspace_id,
      w.name as workspace_name,
      u.email::text as inviter_email
    from public.notifications n
    left join public.invitations i
      on n.type = 'workspace_invitation'
     and i.id = public.try_uuid(n.payload->>'invitation_id')
    left join public.workspaces w on w.id = i.workspace_id
    left join auth.users u on u.id = i.invited_by
    where n.user_id = _caller
    order by n.created_at desc;
end;
$$;

revoke all on function public.get_my_notifications() from public;
grant execute on function public.get_my_notifications() to authenticated;

-- =====================================================================
-- (3) Auto-expire stale pending invites at send time
-- =====================================================================
-- The (workspace, group, email) WHERE status='pending' partial unique
-- index meant an unaccepted invitation past its TTL blocked re-inviting
-- the same person until someone manually revoked it. The send RPC now
-- flips any such row to 'expired' before its own duplicate check runs.
--
-- (We could schedule a cron to do this for analytics, but the on-write
-- sweep is enough to keep send_workspace_invitation honest, and avoids
-- introducing pg_cron as a dependency.)

create or replace function public.send_workspace_invitation(
  _workspace_id uuid,
  _email text,
  _role text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
  _normalized_email text := lower(trim(_email));
  _target_user_id uuid;
  _existing_role text;
  _invitation_id uuid := gen_random_uuid();
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  if _role not in ('admin', 'member') then
    raise exception 'invalid role: %', _role;
  end if;

  if _normalized_email is null or position('@' in _normalized_email) < 2 then
    raise exception 'invalid email';
  end if;

  if not public.is_workspace_admin(_workspace_id) then
    raise exception 'only workspace admins can send invitations';
  end if;

  -- Reject-if-no-account: target must already exist as an auth user.
  select id into _target_user_id
  from auth.users
  where lower(email) = _normalized_email
  limit 1;

  if _target_user_id is null then
    raise exception 'no_account' using hint = 'No Eventero account is registered with that email.';
  end if;

  if _target_user_id = _caller then
    raise exception 'cannot invite yourself';
  end if;

  select role into _existing_role
  from public.workspace_memberships
  where workspace_id = _workspace_id and user_id = _target_user_id;

  if _existing_role is not null then
    raise exception 'already_member' using hint = 'That user already belongs to this workspace.';
  end if;

  -- Sweep any pending-but-expired invitation for the same target so the
  -- partial unique index doesn't keep us from re-inviting.
  update public.invitations
     set status = 'expired',
         responded_at = now(),
         consumed_at = now()
   where workspace_id = _workspace_id
     and group_id is null
     and lower(email) = _normalized_email
     and status = 'pending'
     and expires_at <= now();

  if exists (
    select 1 from public.invitations
    where workspace_id = _workspace_id
      and group_id is null
      and lower(email) = _normalized_email
      and status = 'pending'
  ) then
    raise exception 'already_invited' using hint = 'A pending invitation for that email already exists.';
  end if;

  insert into public.invitations (
    id, workspace_id, group_id, email, workspace_role, group_role,
    invited_by, invited_user_id, status, expires_at
  )
  values (
    _invitation_id, _workspace_id, null, _normalized_email, _role, null,
    _caller, _target_user_id, 'pending', now() + interval '7 days'
  );

  insert into public.notifications (user_id, type, payload)
  values (
    _target_user_id,
    'workspace_invitation',
    jsonb_build_object('invitation_id', _invitation_id)
  );

  return _invitation_id;
end;
$$;

revoke all on function public.send_workspace_invitation(uuid, text, text) from public;
grant execute on function public.send_workspace_invitation(uuid, text, text) to authenticated;

-- =====================================================================
-- (4) decline_workspace_invitation: enforce TTL
-- =====================================================================
-- Previously you could decline an expired invitation and it would be
-- recorded as 'declined' rather than 'expired'. Inconsistent with accept
-- and breaks the TTL semantic. Mirror the accept flow exactly.

create or replace function public.decline_workspace_invitation(
  _invitation_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
  _inv record;
  _caller_email text;
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  select * into _inv
  from public.invitations
  where id = _invitation_id;

  if not found then
    raise exception 'invitation_not_found';
  end if;

  if _inv.status <> 'pending' then
    raise exception 'invitation_not_pending';
  end if;

  if _inv.expires_at <= now() then
    update public.invitations
       set status = 'expired', responded_at = now(), consumed_at = now()
     where id = _invitation_id;
    raise exception 'invitation_expired';
  end if;

  if _inv.invited_user_id is not null then
    if _inv.invited_user_id <> _caller then
      raise exception 'invitation_not_yours';
    end if;
  else
    select lower(email) into _caller_email from auth.users where id = _caller;
    if _caller_email is null or _caller_email <> lower(_inv.email) then
      raise exception 'invitation_not_yours';
    end if;
  end if;

  update public.invitations
     set status = 'declined', responded_at = now(), consumed_at = now()
   where id = _invitation_id;

  update public.notifications
     set read_at = coalesce(read_at, now())
   where user_id = _caller
     and type = 'workspace_invitation'
     and payload->>'invitation_id' = _invitation_id::text;
end;
$$;

revoke all on function public.decline_workspace_invitation(uuid) from public;
grant execute on function public.decline_workspace_invitation(uuid) to authenticated;

-- =====================================================================
-- (5) accept_workspace_invitation: race-safe membership insert
-- =====================================================================
-- Two simultaneous accept clicks (double-tap, retried request) could
-- both pass the NOT EXISTS check and the second would raise a unique
-- violation. Switch to INSERT ... ON CONFLICT DO NOTHING so the second
-- caller silently no-ops and we still finalise the invitation.

create or replace function public.accept_workspace_invitation(
  _invitation_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
  _inv record;
  _caller_email text;
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  select * into _inv
  from public.invitations
  where id = _invitation_id;

  if not found then
    raise exception 'invitation_not_found';
  end if;

  if _inv.status <> 'pending' then
    raise exception 'invitation_not_pending';
  end if;

  if _inv.expires_at <= now() then
    update public.invitations
       set status = 'expired', responded_at = now(), consumed_at = now()
     where id = _invitation_id;
    raise exception 'invitation_expired';
  end if;

  if _inv.invited_user_id is not null then
    if _inv.invited_user_id <> _caller then
      raise exception 'invitation_not_yours';
    end if;
  else
    select lower(email) into _caller_email from auth.users where id = _caller;
    if _caller_email is null or _caller_email <> lower(_inv.email) then
      raise exception 'invitation_not_yours';
    end if;
  end if;

  -- Idempotent: if a concurrent accept (or a manual admin add) already
  -- created the membership, leave it untouched and continue finalising.
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (_inv.workspace_id, _caller, _inv.workspace_role)
  on conflict (workspace_id, user_id) do nothing;

  update public.invitations
     set status = 'accepted', responded_at = now(), consumed_at = now()
   where id = _invitation_id;

  update public.notifications
     set read_at = coalesce(read_at, now())
   where user_id = _caller
     and type = 'workspace_invitation'
     and payload->>'invitation_id' = _invitation_id::text;

  return _inv.workspace_id;
end;
$$;

revoke all on function public.accept_workspace_invitation(uuid) from public;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;

-- =====================================================================
-- (6) transfer_workspace_ownership: lock rows + verify both updates
-- =====================================================================
-- Without locking, a concurrent UPDATE on workspace_memberships could
-- mutate the new owner's row between our SELECT and our UPDATE, and we
-- have no guarantee the UPDATE actually hit something. We now:
--   a. SELECT ... FOR UPDATE on both relevant rows up front, serialising
--      with anything else trying to change the same memberships.
--   b. GET DIAGNOSTICS row_count after each UPDATE and raise if it's 0,
--      which rolls the whole transaction back rather than committing a
--      half-applied transfer (worst case: ownerless workspace).

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
  _caller_role text;
  _new_owner_role text;
  _affected int;
begin
  if _caller is null then
    raise exception 'authentication required';
  end if;

  if _caller = _new_owner_id then
    raise exception 'cannot transfer ownership to yourself';
  end if;

  -- Lock both rows in a stable order to avoid deadlocks against another
  -- transfer running in the opposite direction.
  select role into _caller_role
  from public.workspace_memberships
  where workspace_id = _workspace_id
    and user_id = least(_caller, _new_owner_id)
  for update;

  select role into _new_owner_role
  from public.workspace_memberships
  where workspace_id = _workspace_id
    and user_id = greatest(_caller, _new_owner_id)
  for update;

  -- Re-read in caller/target form so the subsequent checks read naturally.
  select role into _caller_role
  from public.workspace_memberships
  where workspace_id = _workspace_id and user_id = _caller;

  select role into _new_owner_role
  from public.workspace_memberships
  where workspace_id = _workspace_id and user_id = _new_owner_id;

  if _caller_role is null or _caller_role <> 'owner' then
    raise exception 'only the workspace owner can transfer ownership';
  end if;

  if _new_owner_role is null then
    raise exception 'new owner must already be a workspace member';
  end if;

  if _new_owner_role not in ('admin', 'member') then
    raise exception 'new owner has unexpected role: %', _new_owner_role;
  end if;

  -- Demote the current owner first to keep the partial unique index
  -- (one 'owner' per workspace) satisfied at every step.
  update public.workspace_memberships
    set role = 'admin'
    where workspace_id = _workspace_id and user_id = _caller;
  get diagnostics _affected = row_count;
  if _affected <> 1 then
    raise exception 'failed to demote current owner (affected % rows)', _affected;
  end if;

  update public.workspace_memberships
    set role = 'owner'
    where workspace_id = _workspace_id and user_id = _new_owner_id;
  get diagnostics _affected = row_count;
  if _affected <> 1 then
    raise exception 'failed to promote new owner (affected % rows)', _affected;
  end if;
end;
$$;

revoke all on function public.transfer_workspace_ownership(uuid, uuid) from public;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;

-- =====================================================================
-- (7) groups: managers may only rename, enforced at the DB layer
-- =====================================================================
-- The existing UPDATE policy lets managers update the row, but with the
-- table-level UPDATE grant they could try to mutate workspace_id, id,
-- or created_at. Add a trigger that only lets managers change `name`
-- (admins still have full UPDATE per the workspace-admin policy).

create or replace function public.groups_managers_rename_only()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- Workspace admins (incl. the owner) keep full UPDATE — they're the
  -- ones who legitimately edit other fields if needed.
  if public.is_workspace_admin(old.workspace_id) then
    if new.id is distinct from old.id
       or new.workspace_id is distinct from old.workspace_id
       or new.created_at is distinct from old.created_at then
      raise exception 'groups.id / workspace_id / created_at are immutable';
    end if;
    return new;
  end if;

  if public.is_group_manager(old.id) then
    if new.id is distinct from old.id
       or new.workspace_id is distinct from old.workspace_id
       or new.created_at is distinct from old.created_at then
      raise exception 'group managers may only update the name';
    end if;
    return new;
  end if;

  -- No path; RLS should have blocked this. Belt and suspenders.
  raise exception 'permission denied to update groups';
end;
$$;

drop trigger if exists groups_rename_only on public.groups;
create trigger groups_rename_only
  before update on public.groups
  for each row execute function public.groups_managers_rename_only();

-- =====================================================================
-- (8) Stale group_memberships when a workspace_membership is removed
-- =====================================================================
-- There's no FK from group_memberships → workspace_memberships, so
-- deleting someone from a workspace leaves their group_memberships rows
-- in place. The groups SELECT policy keyed off `is_group_member(id)`,
-- so the orphaned row let them keep seeing groups even after removal.
--
-- Two-pronged fix:
--   a. Trigger on workspace_memberships AFTER DELETE that nukes the
--      same user's group_memberships within that workspace. This is
--      the source-of-truth fix.
--   b. Tighten the groups SELECT policy to require is_workspace_member
--      in addition to is_group_member. Defense in depth — protects
--      against any future path that drops a workspace_membership row
--      without going through the trigger (e.g. raw SQL by an operator).

create or replace function public.workspace_memberships_cleanup_groups()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.group_memberships gm
  using public.groups g
  where gm.group_id = g.id
    and g.workspace_id = old.workspace_id
    and gm.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists workspace_memberships_after_delete_cleanup_groups
  on public.workspace_memberships;
create trigger workspace_memberships_after_delete_cleanup_groups
  after delete on public.workspace_memberships
  for each row execute function public.workspace_memberships_cleanup_groups();

drop policy if exists "workspace admins or group members read groups"
  on public.groups;
create policy "workspace admins or group members read groups"
  on public.groups for select to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    or (
      public.is_workspace_member(workspace_id)
      and public.is_group_member(id)
    )
  );
