-- Fix: the channel_mentions INSERT policy verified the recipient's workspace
-- membership with an inline subquery against `workspace_memberships`, which is
-- itself RLS-gated to "your own row, or any row if you're an admin". So a
-- non-admin author mentioning anyone (or anyone mentioning a non-admin) had
-- the `with check` evaluate to false and the insert was silently rejected.
--
-- Use the `SECURITY DEFINER` helper `is_workspace_member(workspace_id, user_id)`
-- for the recipient check so it bypasses that RLS, exactly the pattern the
-- rest of the schema already uses for membership predicates.

drop policy "authors insert channel mentions for their messages"
  on public.channel_mentions;

create policy "authors insert channel mentions for their messages"
  on public.channel_mentions for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = channel_mentions.channel_id
        and c.group_id is null
        and public.is_workspace_member(c.workspace_id)
        and public.is_workspace_member(
          c.workspace_id, channel_mentions.mentioned_user_id
        )
    )
    and exists (
      select 1 from public.messages m
      where m.id = channel_mentions.message_id
        and m.author_id = auth.uid()
    )
  );
