-- Scope group visibility so plain workspace members only see groups they
-- belong to. Workspace admins/owners continue to see every group in their
-- workspace. There is no "viewer" tier — a workspace member who isn't in
-- a group must not see it in their sidebar at all.

drop policy if exists "workspace members read groups" on public.groups;

create policy "workspace admins or group members read groups"
  on public.groups for select to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    or public.is_group_member(id)
  );
