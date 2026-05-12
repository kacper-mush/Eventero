-- Widen task deletion to workspace admins/owners alongside group managers.
--
-- The core schema set DELETE = group managers only. Workspace owners/admins
-- already have wide write access (groups, members) so they should also be
-- able to remove tasks. We swap the policy in place.

drop policy if exists "group managers delete tasks" on public.tasks;

create policy "managers and admins delete tasks"
  on public.tasks for delete to authenticated
  using (
    public.is_group_manager(group_id)
    or public.is_workspace_admin(public.group_workspace_id(group_id))
  );
