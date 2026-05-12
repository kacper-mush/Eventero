-- Workspace-wide "general" channel: exactly one per workspace, auto-created
-- by trigger so the invariant holds regardless of which code path inserts the
-- workspace (mirrors the group <-> channel trigger from the chat migration).
--
-- @mentions in the global channel get their own per-channel "drawer mailbox"
-- — `channel_mentions` — exactly analogous to `group_notifications` for group
-- chats. They are workspace-scoped events, so they do NOT go into the global
-- `notifications` inbox (that surface is for account-level / cross-workspace
-- things like invitations).
--
-- Forward-compatibility:
--   * The trigger backfills via a one-shot statement at the bottom, so
--     existing workspaces get their channel before the deploy switches the
--     workspace landing route over to the chat view.

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
-- channel_mentions
-- =====================================================================
-- Per-recipient row: one @mention in a workspace's global channel = one
-- notification for one user. Same shape as the original group_mentions.

create table public.channel_mentions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index channel_mentions_recipient_idx
  on public.channel_mentions(mentioned_user_id, created_at desc);
create index channel_mentions_channel_idx
  on public.channel_mentions(channel_id);

alter table public.channel_mentions enable row level security;
grant select, insert, update, delete on public.channel_mentions to authenticated;

-- Recipients see and mutate their own mentions only.
create policy "users read their own channel mentions"
  on public.channel_mentions for select to authenticated
  using (mentioned_user_id = auth.uid());

create policy "users update their own channel mentions"
  on public.channel_mentions for update to authenticated
  using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

create policy "users delete their own channel mentions"
  on public.channel_mentions for delete to authenticated
  using (mentioned_user_id = auth.uid());

-- Authors insert mentions for their own messages in a global channel,
-- targeted at members of that channel's workspace. RLS-only — the author is
-- always the caller, so no SECURITY DEFINER needed.
create policy "authors insert channel mentions for their messages"
  on public.channel_mentions for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = channel_mentions.channel_id
        and c.group_id is null
        and public.is_workspace_member(c.workspace_id)
        and exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = c.workspace_id
            and wm.user_id = channel_mentions.mentioned_user_id
        )
    )
    and exists (
      select 1 from public.messages m
      where m.id = channel_mentions.message_id
        and m.author_id = auth.uid()
    )
  );

-- =====================================================================
-- Realtime publication
-- =====================================================================

alter publication supabase_realtime add table public.channel_mentions;
