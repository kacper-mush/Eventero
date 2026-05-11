-- Core data model for the Eventero MVP.
-- Tables: workspaces, workspace_memberships, groups, group_memberships,
--         channels, messages, tasks, invitations.
-- Authorization: RLS-first. SECURITY DEFINER helper functions look up
-- memberships without triggering recursive policy evaluation.

-- =====================================================================
-- Helper functions
-- =====================================================================

create or replace function public.is_workspace_member(_workspace_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.workspace_memberships
    where workspace_id = _workspace_id and user_id = auth.uid()
  );
end;
$$;

create or replace function public.is_workspace_member(_workspace_id uuid, _user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.workspace_memberships
    where workspace_id = _workspace_id and user_id = _user_id
  );
end;
$$;

create or replace function public.is_workspace_admin(_workspace_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.workspace_memberships
    where workspace_id = _workspace_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
end;
$$;

create or replace function public.is_workspace_owner(_workspace_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.workspace_memberships
    where workspace_id = _workspace_id
      and user_id = auth.uid()
      and role = 'owner'
  );
end;
$$;

create or replace function public.is_group_member(_group_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.group_memberships
    where group_id = _group_id and user_id = auth.uid()
  );
end;
$$;

create or replace function public.is_group_manager(_group_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.group_memberships
    where group_id = _group_id
      and user_id = auth.uid()
      and role = 'manager'
  );
end;
$$;

-- =====================================================================
-- workspaces
-- =====================================================================

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
grant select, insert, update, delete on public.workspaces to authenticated;

create policy "members read their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

create policy "authenticated users create workspaces"
  on public.workspaces for insert to authenticated
  with check (created_by = auth.uid());

create policy "admins update their workspaces"
  on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy "owners delete their workspaces"
  on public.workspaces for delete to authenticated
  using (public.is_workspace_owner(id));

-- =====================================================================
-- workspace_memberships
-- =====================================================================

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_memberships_user_idx
  on public.workspace_memberships(user_id);

create unique index workspace_memberships_one_owner_per_workspace_idx
  on public.workspace_memberships(workspace_id)
  where role = 'owner';

alter table public.workspace_memberships enable row level security;
grant select, insert, update, delete on public.workspace_memberships to authenticated;

create policy "read workspace memberships"
  on public.workspace_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  );

create policy "admins add workspace members"
  on public.workspace_memberships for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    and role in ('admin', 'member')
  );

create policy "admins update workspace members"
  on public.workspace_memberships for update to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and role <> 'owner'
  )
  with check (
    public.is_workspace_admin(workspace_id)
    and role <> 'owner'
  );

create policy "admins remove non-owner workspace members"
  on public.workspace_memberships for delete to authenticated
  using (public.is_workspace_admin(workspace_id) and role <> 'owner');

-- Workspace creator becomes owner. Bypasses the membership INSERT policy
-- (which requires admin) via SECURITY DEFINER.
create or replace function public.add_workspace_owner_membership()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger workspaces_after_insert_add_owner
  after insert on public.workspaces
  for each row execute function public.add_workspace_owner_membership();

-- =====================================================================
-- groups
-- =====================================================================

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create index groups_workspace_idx on public.groups(workspace_id);
-- Required for channels(group_id, workspace_id) composite foreign key.
create unique index groups_id_workspace_idx on public.groups(id, workspace_id);

alter table public.groups enable row level security;
grant select, insert, update, delete on public.groups to authenticated;

create policy "workspace members read groups"
  on public.groups for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace admins create groups"
  on public.groups for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));

create policy "workspace admins update groups"
  on public.groups for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy "workspace admins delete groups"
  on public.groups for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- =====================================================================
-- group_memberships
-- =====================================================================

create table public.group_memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('manager', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_memberships_user_idx on public.group_memberships(user_id);

alter table public.group_memberships enable row level security;
grant select, insert, update, delete on public.group_memberships to authenticated;

create policy "read group memberships"
  on public.group_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_member(group_id)
    or exists (
      select 1 from public.groups g
      where g.id = group_memberships.group_id
        and public.is_workspace_admin(g.workspace_id)
    )
  );

create policy "managers and workspace admins add group members"
  on public.group_memberships for insert to authenticated
  with check (
    (
      public.is_group_manager(group_id)
      or exists (
        select 1 from public.groups g
        where g.id = group_memberships.group_id
          and public.is_workspace_admin(g.workspace_id)
      )
    )
    and exists (
      select 1 from public.groups g
      where g.id = group_memberships.group_id
        and public.is_workspace_member(g.workspace_id, group_memberships.user_id)
    )
  );

create policy "managers and workspace admins update group memberships"
  on public.group_memberships for update to authenticated
  using (
    public.is_group_manager(group_id)
    or exists (
      select 1 from public.groups g
      where g.id = group_memberships.group_id
        and public.is_workspace_admin(g.workspace_id)
    )
  )
  with check (
    (
      public.is_group_manager(group_id)
      or exists (
        select 1 from public.groups g
        where g.id = group_memberships.group_id
          and public.is_workspace_admin(g.workspace_id)
      )
    )
    and exists (
      select 1 from public.groups g
      where g.id = group_memberships.group_id
        and public.is_workspace_member(g.workspace_id, group_memberships.user_id)
    )
  );

create policy "managers and workspace admins remove group members"
  on public.group_memberships for delete to authenticated
  using (
    public.is_group_manager(group_id)
    or exists (
      select 1 from public.groups g
      where g.id = group_memberships.group_id
        and public.is_workspace_admin(g.workspace_id)
    )
  );

-- =====================================================================
-- channels
-- =====================================================================
-- group_id null => workspace-wide channel.
-- group_id set  => visible only to that group's members.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  constraint channels_group_workspace_fk
    foreign key (group_id, workspace_id)
    references public.groups(id, workspace_id)
    on delete cascade
);

create index channels_workspace_idx on public.channels(workspace_id);
create index channels_group_idx on public.channels(group_id);

alter table public.channels enable row level security;
grant select, insert, update, delete on public.channels to authenticated;

create policy "members read accessible channels"
  on public.channels for select to authenticated
  using (
    (group_id is null and public.is_workspace_member(workspace_id))
    or (group_id is not null and public.is_group_member(group_id))
  );

create policy "workspace admins create channels"
  on public.channels for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));

create policy "workspace admins update channels"
  on public.channels for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy "workspace admins delete channels"
  on public.channels for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- =====================================================================
-- messages
-- =====================================================================

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) > 0),
  created_at timestamptz not null default now()
);

create index messages_channel_created_idx
  on public.messages(channel_id, created_at desc);

alter table public.messages enable row level security;
grant select, insert, delete on public.messages to authenticated;
grant usage, select on sequence public.messages_id_seq to authenticated;

create policy "members read messages in accessible channels"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and (
          (c.group_id is null and public.is_workspace_member(c.workspace_id))
          or (c.group_id is not null and public.is_group_member(c.group_id))
        )
    )
  );

create policy "members send messages to accessible channels"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and (
          (c.group_id is null and public.is_workspace_member(c.workspace_id))
          or (c.group_id is not null and public.is_group_member(c.group_id))
        )
    )
  );

create policy "authors delete their messages"
  on public.messages for delete to authenticated
  using (author_id = auth.uid());

-- =====================================================================
-- tasks
-- =====================================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  assignee_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done')),
  due_date date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index tasks_group_status_idx on public.tasks(group_id, status);
create index tasks_assignee_idx on public.tasks(assignee_id);

alter table public.tasks enable row level security;
grant select, insert, update, delete on public.tasks to authenticated;

create policy "group members read tasks"
  on public.tasks for select to authenticated
  using (public.is_group_member(group_id));

create policy "group members create tasks"
  on public.tasks for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_group_member(group_id)
  );

create policy "group members update tasks"
  on public.tasks for update to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "group managers delete tasks"
  on public.tasks for delete to authenticated
  using (public.is_group_manager(group_id));

-- =====================================================================
-- invitations
-- =====================================================================
-- Email-keyed, single-use, 7-day TTL. Consumption (converting to membership
-- rows) is handled by a SECURITY DEFINER RPC added when the accept flow lands.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  workspace_role text not null default 'member'
    check (workspace_role in ('admin', 'member')),
  group_role text check (group_role in ('manager', 'member')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '7 days'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Group invites require a group_role; workspace-only invites must not have one.
  check ((group_id is null and group_role is null)
      or (group_id is not null and group_role is not null))
);

-- At most one pending invite per (workspace, group, email).
create unique index invitations_unique_pending
  on public.invitations(
    workspace_id,
    coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(email)
  )
  where consumed_at is null;

create index invitations_pending_email_idx
  on public.invitations(lower(email))
  where consumed_at is null;

alter table public.invitations enable row level security;
grant select, insert, update, delete on public.invitations to authenticated;

create policy "workspace admins read invitations"
  on public.invitations for select to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy "invitees read their own pending invitations"
  on public.invitations for select to authenticated
  using (
    consumed_at is null
    and lower(email) = lower((auth.jwt() ->> 'email'))
  );

create policy "workspace admins create invitations"
  on public.invitations for insert to authenticated
  with check (
    invited_by = auth.uid()
    and public.is_workspace_admin(workspace_id)
    and (
      group_id is null
      or exists (
        select 1 from public.groups g
        where g.id = invitations.group_id
          and g.workspace_id = invitations.workspace_id
      )
    )
  );

create policy "workspace admins update invitations"
  on public.invitations for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy "workspace admins delete invitations"
  on public.invitations for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- =====================================================================
-- Realtime publication
-- =====================================================================
-- Surfaces that need live updates subscribe via Postgres CDC. RLS still
-- gates what each client receives.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
