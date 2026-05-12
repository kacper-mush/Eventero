-- Realtime DELETE events only carry the columns in a table's replica identity,
-- which defaults to the primary key. The chat client subscribes to DELETE on
-- public.messages with a `channel_id=eq.…` filter; without the column present
-- the realtime server rejects the binding ("invalid column for filter
-- channel_id"), which fails the whole channel and kills live INSERT/UPDATE too.
--
-- REPLICA IDENTITY FULL makes the full old row available on DELETE so the
-- filter can be evaluated.
alter table public.messages replica identity full;
