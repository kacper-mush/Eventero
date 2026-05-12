-- Workspace-wide "general" channel: exactly one per workspace, auto-created
-- by trigger so the invariant holds regardless of which code path inserts the
-- workspace (mirrors the group <-> channel trigger from the chat migration).
--
-- @mentions in the global channel fan out into the workspace-level
-- notifications inbox (a new `channel_mention` notification type) rather than
-- the group-scoped `group_notifications` table — the global channel has no
-- per-group drawer to surface them in, and the inbox is exactly the
-- "workspace-level events" surface that already exists.
--
-- Forward-compatibility:
--   * The trigger backfills a one-shot statement at the bottom, so existing
--     workspaces get their channel before the deploy switches the workspace
--     landing route over to the chat view.
--   * `get_my_notifications()` gains nullable columns; the older client kept
--     working until the new one ships (only invitation rows existed before).

-- =====================================================================
-- channels: one global (group-less) channel per workspace + backfill
-- =====================================================================

create unique index if not exists channels_workspace_global_unique_idx
  on public.channels(workspace_id)
  where group_id is null;

create or replace function public.create_workspace_default_channel()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.channels (workspace_id, group_id, name)
  values (new.id, null, 'general');
  return new;
end;
$$;

create trigger workspaces_after_insert_create_channel
  after insert on public.workspaces
  for each row execute function public.create_workspace_default_channel();

insert into public.channels (workspace_id, group_id, name)
select w.id, null, 'general'
from public.workspaces w
where not exists (
  select 1 from public.channels c
  where c.workspace_id = w.id and c.group_id is null
);

-- =====================================================================
-- notifications: new `channel_mention` type
-- =====================================================================
-- payload shape: { message_id, channel_id, workspace_id, author_id }

alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('workspace_invitation', 'channel_mention'));

-- Insert path: the message author calls this after posting. Validates the
-- caller authored the message, the message lives in a global channel, and
-- each recipient is a member of that channel's workspace. SECURITY DEFINER
-- because `notifications` has no INSERT grant for `authenticated`.
create or replace function public.notify_channel_mention(
  _message_id bigint,
  _mentioned uuid[]
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  _author uuid := auth.uid();
  _channel_id uuid;
  _workspace_id uuid;
begin
  if _author is null then
    raise exception 'authentication required';
  end if;

  select m.channel_id, c.workspace_id
    into _channel_id, _workspace_id
  from public.messages m
  join public.channels c on c.id = m.channel_id
  where m.id = _message_id
    and m.author_id = _author
    and c.group_id is null;
  -- Not the caller's message, or not a global channel: nothing to do.
  if _channel_id is null then
    return;
  end if;

  insert into public.notifications (user_id, type, payload)
  select
    u,
    'channel_mention',
    jsonb_build_object(
      'message_id', _message_id,
      'channel_id', _channel_id,
      'workspace_id', _workspace_id,
      'author_id', _author
    )
  from unnest(_mentioned) as u
  where u <> _author
    and exists (
      select 1 from public.workspace_memberships wm
      where wm.workspace_id = _workspace_id and wm.user_id = u
    );
end;
$$;

revoke all on function public.notify_channel_mention(bigint, uuid[]) from public;
grant execute on function public.notify_channel_mention(bigint, uuid[]) to authenticated;

-- =====================================================================
-- get_my_notifications: enrich channel-mention rows
-- =====================================================================
-- Return type changes (added columns), so drop-then-recreate.

drop function if exists public.get_my_notifications();

create function public.get_my_notifications()
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
  inviter_email text,
  message_id bigint,
  message_body text,
  mention_author_email text
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
      coalesce(iw.id, mw.id) as workspace_id,
      coalesce(iw.name, mw.name) as workspace_name,
      iu.email::text as inviter_email,
      msg.id as message_id,
      msg.body as message_body,
      mu.email::text as mention_author_email
    from public.notifications n
    left join public.invitations i
      on n.type = 'workspace_invitation'
     and i.id = (n.payload->>'invitation_id')::uuid
    left join public.workspaces iw on iw.id = i.workspace_id
    left join auth.users iu on iu.id = i.invited_by
    left join public.messages msg
      on n.type = 'channel_mention'
     and msg.id = (n.payload->>'message_id')::bigint
    left join public.workspaces mw
      on n.type = 'channel_mention'
     and mw.id = (n.payload->>'workspace_id')::uuid
    left join auth.users mu
      on n.type = 'channel_mention'
     and mu.id = (n.payload->>'author_id')::uuid
    where n.user_id = _caller
    order by n.created_at desc;
end;
$$;

revoke all on function public.get_my_notifications() from public;
grant execute on function public.get_my_notifications() to authenticated;
