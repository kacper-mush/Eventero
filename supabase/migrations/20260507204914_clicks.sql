-- Public click counter for the landing page.
-- Anonymous visitors can insert a click and read the total count.

create table public.clicks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

alter table public.clicks enable row level security;

grant select, insert on public.clicks to anon, authenticated;
grant usage, select on sequence public.clicks_id_seq to anon, authenticated;

create policy "anyone can read clicks"
  on public.clicks for select
  to anon, authenticated
  using (true);

create policy "anyone can insert clicks"
  on public.clicks for insert
  to anon, authenticated
  with check (true);
