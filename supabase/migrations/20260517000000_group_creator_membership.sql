-- Group creator becomes a manager. Without this, a workspace admin can create
-- a group (RLS allows it) but has no row in group_memberships, so policies
-- gated on is_group_member (tasks insert, messages insert, ...) reject them
-- in the group they just made. Mirrors workspaces_after_insert_add_owner.

create or replace function public.add_group_creator_membership()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  insert into public.group_memberships (group_id, user_id, role)
  values (new.id, auth.uid(), 'manager')
  on conflict do nothing;
  return new;
end;
$$;

create trigger groups_after_insert_add_creator
  after insert on public.groups
  for each row execute function public.add_group_creator_membership();
