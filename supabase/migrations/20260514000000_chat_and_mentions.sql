-- Live chat channels inside groups + @mention notifications.
--
-- Design decisions:
--   * 1:1 group <-> channel. Each group gets exactly one channel, auto-created
--     by trigger so the invariant holds regardless of which code path inserts
--     the group. A partial unique index enforces it at the DB level.
--   * Messages are editable + deletable by their author. An `edited_at`
--     timestamp drives the Slack-style "(edited)" marker; NULL = not edited.
--   * Mentions live in a dedicated `group_mentions` table (not the workspace-
--     wide `notifications` table). They're scoped to the group view and the
--     UI only ever shows the last 5 — keeping them out of the global mailbox
--     keeps that surface focused on workspace-level events (invitations).
--
-- Forward-compatibility:
--   * `edited_at` is nullable so existing rows (none in prod yet, but the
--     convention matters) and existing code paths keep working.
--   * The channel auto-create trigger backfills via a one-shot statement at
--     the bottom of this migration; pre-existing groups get a channel before
--     the deploy switches the route over to the chat view.

-- =====================================================================
-- messages: edited_at + UPDATE policy for authors
-- =====================================================================

alter table public.messages
  add column if not exists edited_at timestamptz;

grant update on public.messages to authenticated;

create policy "authors edit their own messages"
  on public.messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- =====================================================================
-- channels: 1:1 with group + auto-create + backfill
-- =====================================================================

create unique index if not exists channels_group_unique_idx
  on public.channels(group_id)
  where group_id is not null;

create or replace function public.create_group_default_channel()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.channels (workspace_id, group_id, name)
  values (new.workspace_id, new.id, new.name);
  return new;
end;
$$;

create trigger groups_after_insert_create_channel
  after insert on public.groups
  for each row execute function public.create_group_default_channel();

-- Backfill: every existing group without a channel gets one now.
insert into public.channels (workspace_id, group_id, name)
select g.workspace_id, g.id, g.name
from public.groups g
where not exists (
  select 1 from public.channels c where c.group_id = g.id
);

-- =====================================================================
-- group_mentions
-- =====================================================================
-- Per-recipient row: one mention = one notification for one user.

create table public.group_mentions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index group_mentions_recipient_idx
  on public.group_mentions(mentioned_user_id, created_at desc);
create index group_mentions_group_idx
  on public.group_mentions(group_id);

alter table public.group_mentions enable row level security;
grant select, insert, update, delete on public.group_mentions to authenticated;

-- Recipients see and mutate their own mentions only.
create policy "users read their own mentions"
  on public.group_mentions for select to authenticated
  using (mentioned_user_id = auth.uid());

create policy "users update their own mentions"
  on public.group_mentions for update to authenticated
  using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

create policy "users delete their own mentions"
  on public.group_mentions for delete to authenticated
  using (mentioned_user_id = auth.uid());

-- Authors insert mentions for their own messages, targeted at users who are
-- members of the same group. RLS-only — no SECURITY DEFINER needed because
-- the author is always the caller.
create policy "authors insert mentions for their messages"
  on public.group_mentions for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = group_mentions.group_id
        and gm.user_id = group_mentions.mentioned_user_id
    )
    and exists (
      select 1 from public.messages m
      where m.id = group_mentions.message_id
        and m.author_id = auth.uid()
    )
  );

-- =====================================================================
-- Realtime publication
-- =====================================================================

alter publication supabase_realtime add table public.group_mentions;
