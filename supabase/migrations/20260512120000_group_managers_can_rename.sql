-- Allow group managers to rename their own group. Workspace admins keep their
-- existing rights. DELETE on groups remains workspace-admin-only (managers can
-- run their team but not dissolve it).

drop policy "workspace admins update groups" on public.groups;

create policy "admins and managers update groups"
  on public.groups for update to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    or public.is_group_manager(id)
  )
  with check (
    public.is_workspace_admin(workspace_id)
    or public.is_group_manager(id)
  );
