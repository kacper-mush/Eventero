-- Tasks Kanban: 3-state status, reporter/description fields, strict permission
-- rules, realtime.
--
-- Design decisions:
--   * Status goes from ('open','done') -> ('TODO','IN_PROGRESS','DONE'). Existing
--     rows are migrated in place ('open' -> 'TODO', 'done' -> 'DONE').
--   * `created_by` is renamed to `reporter_id`. Conceptually the creator is the
--     reporter; reporter handoff (manager -> another manager) is handled via the
--     update trigger, not a separate column.
--   * `due_date` is dropped — unused and not in the Kanban plan.
--   * Field-level UPDATE rules require comparing OLD vs NEW. RLS `WITH CHECK`
--     only sees NEW, so the diff-aware rules live in a BEFORE UPDATE trigger.
--     RLS UPDATE stays coarse (any group member); the trigger raises on any
--     change the caller isn't allowed to make.
--   * INSERT is restricted to Group Managers + Workspace Owners/Admins via a
--     new RLS policy that replaces the old "any group member" rule.
--   * Tasks join the realtime publication so all viewers see live updates.
--
-- Forward-compatibility:
--   * `description` is added nullable; `reporter_id` is filled from `created_by`
--     before the rename so no row is ever NULL on a NOT NULL column.
--   * The status check + default are swapped in a single transaction so no
--     window exists where a new row could fail validation.

-- =====================================================================
-- Schema changes
-- =====================================================================

alter table public.tasks
  add column if not exists description text;

-- Rename created_by -> reporter_id. No app code references created_by today.
alter table public.tasks
  rename column created_by to reporter_id;

-- Drop the old 2-state status check; migrate data; install the 3-state check.
alter table public.tasks
  alter column status drop default;

alter table public.tasks
  drop constraint tasks_status_check;

update public.tasks set status = 'TODO' where status = 'open';
update public.tasks set status = 'DONE' where status = 'done';

alter table public.tasks
  add constraint tasks_status_check
    check (status in ('TODO', 'IN_PROGRESS', 'DONE'));

alter table public.tasks
  alter column status set default 'TODO';

alter table public.tasks
  drop column if exists due_date;

-- Status filtering is the hot path on the Kanban; keep the composite index but
-- recreate it to be safe after the check rewrite (no-op if already valid).
drop index if exists tasks_group_status_idx;
create index tasks_group_status_idx on public.tasks(group_id, status);

-- =====================================================================
-- RLS policies: rebuild INSERT + UPDATE with the stricter rules
-- =====================================================================

drop policy if exists "group members create tasks" on public.tasks;
drop policy if exists "group members update tasks" on public.tasks;

-- Helper: resolve a group's workspace_id without bouncing through RLS. Used by
-- the INSERT policy to check workspace-admin/owner status from a group_id.
create or replace function public.group_workspace_id(_group_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select workspace_id from public.groups where id = _group_id;
$$;

-- INSERT: only group managers OR workspace admins/owners. The reporter must be
-- the caller (creators report their own tasks until handoff).
create policy "managers and admins create tasks"
  on public.tasks for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and (
      public.is_group_manager(group_id)
      or public.is_workspace_admin(public.group_workspace_id(group_id))
    )
  );

-- UPDATE: coarse RLS gate (any group member). Field-level rules live in the
-- BEFORE UPDATE trigger below so we can diff OLD vs NEW.
create policy "group members update tasks"
  on public.tasks for update to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

-- =====================================================================
-- UPDATE trigger: field-level permission enforcement
-- =====================================================================
--
-- Rules (from the Roadmap):
--   * status:       any group member may change.
--   * assignee_id:  members may only set it to themselves AND only when the
--                   slot is currently NULL. Managers/Workspace admins may set
--                   it to any workspace member (or NULL to unassign).
--   * reporter_id:  only group managers may change it, and only to another
--                   group manager.
--   * title/desc:   only managers or the current reporter may change.

create or replace function public.enforce_task_update_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_is_manager boolean;
  v_is_ws_admin boolean;
  v_workspace_id uuid;
begin
  v_workspace_id := public.group_workspace_id(new.group_id);
  v_is_manager := public.is_group_manager(new.group_id);
  v_is_ws_admin := public.is_workspace_admin(v_workspace_id);

  -- group_id and reporter ownership semantics: group_id is immutable.
  if new.group_id is distinct from old.group_id then
    raise exception 'tasks.group_id is immutable' using errcode = '42501';
  end if;

  -- assignee_id changes
  if new.assignee_id is distinct from old.assignee_id then
    if v_is_manager or v_is_ws_admin then
      -- Manager/admin: target (if not NULL) must be a workspace member.
      if new.assignee_id is not null and not exists (
        select 1 from public.workspace_memberships wm
        where wm.workspace_id = v_workspace_id
          and wm.user_id = new.assignee_id
      ) then
        raise exception 'assignee must be a workspace member'
          using errcode = '42501';
      end if;
    else
      -- Plain member: may only self-assign into an empty slot.
      if old.assignee_id is not null then
        raise exception 'only managers can reassign tasks'
          using errcode = '42501';
      end if;
      if new.assignee_id is distinct from auth.uid() then
        raise exception 'members can only assign tasks to themselves'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- reporter_id changes: managers only, target must also be a group manager.
  if new.reporter_id is distinct from old.reporter_id then
    if not v_is_manager then
      raise exception 'only group managers can change the reporter'
        using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.group_memberships gm
      where gm.group_id = new.group_id
        and gm.user_id = new.reporter_id
        and gm.role = 'manager'
    ) then
      raise exception 'reporter must be a group manager'
        using errcode = '42501';
    end if;
  end if;

  -- title / description: managers or the current reporter only.
  if (new.title is distinct from old.title
      or new.description is distinct from old.description) then
    if not v_is_manager and old.reporter_id is distinct from auth.uid() then
      raise exception 'only managers or the reporter can edit title/description'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_before_update_enforce_rules
  before update on public.tasks
  for each row execute function public.enforce_task_update_rules();

-- =====================================================================
-- Realtime publication
-- =====================================================================

alter publication supabase_realtime add table public.tasks;
