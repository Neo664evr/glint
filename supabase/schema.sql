-- Glint database. Run once in Supabase: Dashboard -> SQL Editor -> paste -> Run.
-- One document table. Every document lives at a path like "p/<userId>" or "p/<userId>/m/<mediaId>".
-- The user id in the path is the owner. Only the owner can write; signed-in users can read,
-- except anything under data/users/<id>/ which only that user can read (private settings, keys).

create table if not exists public.docs (
  path       text primary key,
  parent     text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  constraint docs_size check (pg_column_size(data) < 300000)
);
create index if not exists docs_parent_idx on public.docs (parent);

-- realtime needs full rows on delete so clients know which document went away
alter table public.docs replica identity full;

create or replace function public.doc_owner(p text) returns text
language sql immutable as $$
  select case when split_part(p, '/', 1) = 'data' then split_part(p, '/', 3)
              else split_part(p, '/', 2) end
$$;

create or replace function public.doc_allowed_root(p text) returns boolean
language sql immutable as $$
  select split_part(p, '/', 1) in ('u','p','s','sv','l','c','dm')
      or (split_part(p, '/', 1) = 'data' and split_part(p, '/', 2) = 'users')
$$;

alter table public.docs enable row level security;

drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;

create policy docs_read on public.docs for select to authenticated
  using (split_part(path, '/', 1) <> 'data' or split_part(path, '/', 3) = auth.uid()::text);

create policy docs_insert on public.docs for insert to authenticated
  with check (public.doc_allowed_root(path) and public.doc_owner(path) = auth.uid()::text);

create policy docs_update on public.docs for update to authenticated
  using (public.doc_owner(path) = auth.uid()::text)
  with check (public.doc_allowed_root(path) and public.doc_owner(path) = auth.uid()::text);

create policy docs_delete on public.docs for delete to authenticated
  using (public.doc_owner(path) = auth.uid()::text);

-- live updates
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
