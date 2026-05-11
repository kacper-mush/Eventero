-- Workspace policy now: no one leaves. Removal is the only way out, and
-- workspace_memberships DELETE is admin-only by RLS already. Drop the
-- self-service RPC so it can't be called from anywhere.
--
-- A sole owner who wants to back out uses Delete workspace instead, which
-- already cascades through groups/channels/messages/tasks.

drop function if exists public.leave_workspace(uuid);
