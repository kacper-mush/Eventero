-- Workspace invitation accept/decline flow + a generic notifications table.
--
-- Design decisions baked into this migration:
--   * "In-app only" — no email delivery. The invitee learns about the invite
--     via the notifications panel the next time they sign in.
--   * "Reject if no account" — the inviter must invite an email that already
--     has an auth.users row. The send RPC raises 'no_account' otherwise. This
--     lets us pre-populate invitations.invited_user_id and link a notification
--     row from the moment the invite is created.
--   * "Single-use, 7-day TTL, role locked" — invitations move through a
--     terminal status (accepted / declined / revoked / expired). To edit a
--     pre-assigned role, the admin must revoke and re-send.
--
-- Forward-compatibility:
--   * New columns on invitations are nullable / defaulted; existing inserts
--     (none in production yet, but the convention matters) keep working.
--   * The partial unique index is re-created on the new `status` column;
--     `consumed_at` stays as a kept-in-sync timestamp so any external reader
--     keyed off it continues to see consumed rows.

-- =====================================================================
-- invitations: status + responded_at + invited_user_id
-- =====================================================================

alter table public.invitations
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired'));

alter table public.invitations
  add column if not exists responded_at timestamptz;

-- Populated by send_workspace_invitation; nullable so historical rows (if any)
-- without a resolved auth.users row remain valid.
alter table public.invitations
  add column if not exists invited_user_id uuid
    references auth.users(id) on delete cascade;

-- Swap the partial unique index from consumed_at-null to status='pending'.
drop index if exists public.invitations_unique_pending;
create unique index invitations_unique_pending
  on public.invitations(
    workspace_id,
    coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(email)
  )
  where status = 'pending';

drop index if exists public.invitations_pending_email_idx;
create index invitations_pending_email_idx
  on public.invitations(lower(email))
  where status = 'pending';

create index if not exists invitations_pending_user_idx
  on public.invitations(invited_user_id)
  where status = 'pending';

-- Update the invitee read policy to key off status instead of consumed_at,
-- and to match either email (legacy) or invited_user_id (forward).
drop policy if exists "invitees read their own pending invitations" on public.invitations;
create policy "invitees read their own pending invitations"
  on public.invitations for select to authenticated
  using (
    status = 'pending'
    and (
      invited_user_id = auth.uid()
      or lower(email) = lower((auth.jwt() ->> 'email'))
    )
  );

-- =====================================================================
-- notifications
-- =====================================================================
-- Polymorphic per-user notifications. `type` discriminates payload shape;
-- the source of truth for the underlying object (e.g. invitation status)
-- lives in its own table. A notification is essentially a per-user mailbox
-- entry pointing at something the user should look at.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('workspace_invitation')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

create index notifications_user_unread_idx
  on public.notifications(user_id)
  where read_at is null;

alter table public.notifications enable row level security;
grant select, update on public.notifications to authenticated;
-- Inserts and deletes are RPC-only; no GRANT for INSERT/DELETE.

create policy "users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Only the recipient can mutate, and only to flip read_at — they cannot
-- change user_id, type, or payload. With-check enforces ownership; the
-- read_at-only constraint is conventionally enforced at the action layer
-- (no other column is exposed in the update path).
create policy "users mark their own notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =====================================================================
-- RPC: send_workspace_invitation
-- =====================================================================
-- Admin-only. Resolves the target email to an auth.users id (raises if
-- unknown), guards against duplicate/self/already-member, inserts the
-- invitation, and creates the recipient's notification atomically.

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

  -- Reject-if-no-account: the target must already exist as an auth user.
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

  -- The partial unique index on (workspace, group, email) where status='pending'
  -- prevents duplicate pending invites; surface a friendlier error first.
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
-- RPC: accept_workspace_invitation
-- =====================================================================
-- Invitee only. Verifies the invitation is pending, unexpired, and theirs;
-- inserts the workspace_memberships row (the invitation insert policy
-- forbids non-admins from doing this directly), and finalises the
-- invitation + notification rows.

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

  -- Match on invited_user_id when populated, otherwise fall back to email.
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

  -- Idempotency-ish guard: if a membership row already exists, finalise the
  -- invitation but don't fail loudly. (E.g. admin added them manually.)
  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = _inv.workspace_id and user_id = _caller
  ) then
    insert into public.workspace_memberships (workspace_id, user_id, role)
    values (_inv.workspace_id, _caller, _inv.workspace_role);
  end if;

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
-- RPC: decline_workspace_invitation
-- =====================================================================

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
-- RPC: revoke_workspace_invitation
-- =====================================================================
-- Admin can also just DELETE under the existing policy; revoking instead
-- keeps the audit trail and clears the recipient's notification.

create or replace function public.revoke_workspace_invitation(
  _invitation_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  _caller uuid := auth.uid();
  _inv record;
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

  if not public.is_workspace_admin(_inv.workspace_id) then
    raise exception 'only workspace admins can revoke invitations';
  end if;

  if _inv.status <> 'pending' then
    raise exception 'invitation_not_pending';
  end if;

  update public.invitations
     set status = 'revoked', responded_at = now(), consumed_at = now()
   where id = _invitation_id;

  -- Pull the now-stale notification from the recipient's inbox entirely.
  delete from public.notifications
   where type = 'workspace_invitation'
     and payload->>'invitation_id' = _invitation_id::text;
end;
$$;

revoke all on function public.revoke_workspace_invitation(uuid) from public;
grant execute on function public.revoke_workspace_invitation(uuid) to authenticated;

-- =====================================================================
-- View helper: enriched notifications for the recipient
-- =====================================================================
-- The /notifications page needs to render invitations alongside their
-- workspace name and the inviter's email. auth.users isn't exposed via
-- PostgREST, so callers go through this SECURITY DEFINER function.

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
     and i.id = (n.payload->>'invitation_id')::uuid
    left join public.workspaces w on w.id = i.workspace_id
    left join auth.users u on u.id = i.invited_by
    where n.user_id = _caller
    order by n.created_at desc;
end;
$$;

revoke all on function public.get_my_notifications() from public;
grant execute on function public.get_my_notifications() to authenticated;

-- =====================================================================
-- View helper: pending invitations for a workspace settings page
-- =====================================================================

create or replace function public.get_workspace_pending_invitations(
  _workspace_id uuid
)
returns table (
  id uuid,
  email text,
  workspace_role text,
  expires_at timestamptz,
  created_at timestamptz,
  invited_by_email text
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_workspace_admin(_workspace_id) then
    raise exception 'only workspace admins can view invitations';
  end if;

  return query
    select
      i.id,
      i.email,
      i.workspace_role,
      i.expires_at,
      i.created_at,
      u.email::text as invited_by_email
    from public.invitations i
    left join auth.users u on u.id = i.invited_by
    where i.workspace_id = _workspace_id
      and i.status = 'pending'
      and i.group_id is null
    order by i.created_at desc;
end;
$$;

revoke all on function public.get_workspace_pending_invitations(uuid) from public;
grant execute on function public.get_workspace_pending_invitations(uuid) to authenticated;
