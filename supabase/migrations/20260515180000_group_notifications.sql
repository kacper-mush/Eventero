-- Generalize group_mentions -> group_notifications so the same per-group
-- "drawer mailbox" can carry @mentions AND task events (assigned / done).
--
-- Design decisions:
--   * One row per recipient per event. Same shape as before for mentions;
--     task events fill `task_id` instead of `message_id`.
--   * `kind` enum-by-check distinguishes the three event types so the drawer
--     can render an appropriate label/preview.
--   * `message_id` becomes nullable (task events have no message); a check
--     constraint enforces "exactly the right FK is filled for the kind".
--   * Existing rows are mentions; we backfill kind='mention' before adding
--     the NOT NULL on kind and the integrity check.
--
-- Forward-compatibility:
--   * Renaming the table is a hard cutover. To minimize the window where
--     code expects the old name, we ALSO ship the application code changes
--     in the same merge. A migration job and Vercel deploy still run in
--     parallel — but the read/write surface for notifications is narrow
--     (one drawer view, one fan-out path in sendMessage), so the brief
--     window is acceptable for an MVP. If we later need zero-downtime,
--     we'd add a compatibility view named `group_mentions` first.

alter table public.group_mentions rename to group_notifications;
alter index group_mentions_recipient_idx rename to group_notifications_recipient_idx;
alter index group_mentions_group_idx rename to group_notifications_group_idx;

-- New columns
alter table public.group_notifications
  add column if not exists kind text,
  add column if not exists task_id uuid references public.tasks(id) on delete cascade;

-- Backfill: every pre-existing row is a mention.
update public.group_notifications set kind = 'mention' where kind is null;

alter table public.group_notifications
  alter column kind set not null,
  add constraint group_notifications_kind_check
    check (kind in ('mention', 'task_assigned', 'task_done'));

-- message_id can be NULL for task events; relax the NOT NULL.
alter table public.group_notifications
  alter column message_id drop not null;

-- Shape integrity: mentions have a message, task events have a task.
alter table public.group_notifications
  add constraint group_notifications_shape_check
    check (
      (kind = 'mention'        and message_id is not null and task_id is null) or
      (kind = 'task_assigned'  and task_id    is not null and message_id is null) or
      (kind = 'task_done'      and task_id    is not null and message_id is null)
    );

create index if not exists group_notifications_task_idx
  on public.group_notifications(task_id)
  where task_id is not null;

-- Rebuild policies under the new table name (renaming the table doesn't
-- rename the policy names; clean up + recreate keeps them readable).
drop policy if exists "users read their own mentions"   on public.group_notifications;
drop policy if exists "users update their own mentions" on public.group_notifications;
drop policy if exists "users delete their own mentions" on public.group_notifications;
drop policy if exists "authors insert mentions for their messages"
  on public.group_notifications;

create policy "users read their own notifications"
  on public.group_notifications for select to authenticated
  using (mentioned_user_id = auth.uid());

create policy "users update their own notifications"
  on public.group_notifications for update to authenticated
  using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

create policy "users delete their own notifications"
  on public.group_notifications for delete to authenticated
  using (mentioned_user_id = auth.uid());

-- Mentions: author inserts row(s) referencing their own message; recipient
-- must be a group member.
create policy "authors insert mention notifications"
  on public.group_notifications for insert to authenticated
  with check (
    kind = 'mention'
    and author_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = group_notifications.group_id
        and gm.user_id = group_notifications.mentioned_user_id
    )
    and exists (
      select 1 from public.messages m
      where m.id = group_notifications.message_id
        and m.author_id = auth.uid()
    )
  );

-- Task events: any group member may insert a notification tied to a task in
-- their group. The action layer is what decides *when* to insert (status
-- changes / assignee changes); RLS just guards "you can only fan-out events
-- on tasks in groups you belong to".
create policy "members insert task notifications"
  on public.group_notifications for insert to authenticated
  with check (
    kind in ('task_assigned', 'task_done')
    and author_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = group_notifications.group_id
        and gm.user_id = group_notifications.mentioned_user_id
    )
    and exists (
      select 1 from public.tasks t
      where t.id = group_notifications.task_id
        and t.group_id = group_notifications.group_id
    )
  );
