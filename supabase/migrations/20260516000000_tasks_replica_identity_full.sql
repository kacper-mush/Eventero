-- Same reasoning as messages (20260515000000): Realtime DELETE events only
-- carry the table's replica-identity columns (the primary key by default).
-- The kanban client subscribes to tasks DELETE events; with only the PK on the
-- wire Realtime can't evaluate the table's RLS SELECT policy (which keys on
-- group_id) to decide who may see the delete. REPLICA IDENTITY FULL ships the
-- whole old row so RLS is enforced on deletes too.
alter table public.tasks replica identity full;
