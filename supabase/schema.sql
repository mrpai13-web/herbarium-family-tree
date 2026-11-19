-- Herbarium shared trees. Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again: everything is "if not exists" / "or replace".
--
-- Model
--   trees         one row per shared tree; the owner is whoever put it online.
--   tree_members  people the owner invited, by email, as 'viewer' or 'editor'.
--   records       every person, parent link, union, group and media caption as one JSON row.
--                 Deleting clears the row's data (no copy is kept). Photos and recordings live
--                 in the private storage bucket "family-media" at <tree id>/<media id>/blob|thumb.
--
-- Access: members only. Nobody can read anything (not even that a tree exists) unless they
-- are signed in with an email the owner invited. Viewers read; editors and the owner write;
-- only the owner manages members. Every rule below is enforced by the database itself.

create table if not exists public.trees (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Family tree',
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tree_members (
  tree_id uuid not null references public.trees (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'editor' check (role in ('viewer', 'editor')),
  added_at timestamptz not null default now(),
  primary key (tree_id, email)
);
-- Upgrading from the first version (editors only, no role column).
alter table public.tree_members add column if not exists role text not null default 'editor' check (role in ('viewer', 'editor'));

create sequence if not exists public.records_seq;

create table if not exists public.records (
  tree_id uuid not null references public.trees (id) on delete cascade,
  tbl text not null check (tbl in ('people', 'parentLinks', 'unions', 'groups', 'media')),
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  seq bigint not null default nextval('public.records_seq'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  client text,
  primary key (tree_id, tbl, id)
);
create index if not exists records_tree_seq on public.records (tree_id, seq);

-- Every write gets a fresh sequence number, so readers can ask for "everything after N".
-- A deleted row keeps no data.
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  -- A row never moves to another tree (or changes identity): an editor of two trees
  -- could otherwise take rows out of one without anyone seeing a deletion.
  if tg_op = 'UPDATE' and (new.tree_id, new.tbl, new.id) is distinct from (old.tree_id, old.tbl, old.id) then
    raise exception 'records can''t be moved';
  end if;
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.deleted then new.data := null; end if;
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- The signed-in person's role in a tree: 'owner', 'editor', 'viewer' or null.
create or replace function public.tree_role(p_tree uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from trees t where t.id = p_tree and t.owner = auth.uid()) then 'owner'
    else (select m.role from tree_members m
          where m.tree_id = p_tree and m.email = lower(coalesce(auth.jwt() ->> 'email', '')))
  end;
$$;

create or replace function public.is_member(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tree_role(p_tree) is not null;
$$;

create or replace function public.is_editor(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tree_role(p_tree) in ('owner', 'editor');
$$;

create or replace function public.is_owner(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tree_role(p_tree) = 'owner';
$$;

alter table public.trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.records enable row level security;

-- Nothing is readable without signing in.
revoke all on public.trees, public.tree_members, public.records from anon;

drop policy if exists trees_insert on public.trees;
create policy trees_insert on public.trees for insert to authenticated with check (owner = auth.uid());
drop policy if exists trees_select on public.trees;
create policy trees_select on public.trees for select to authenticated using (public.is_member(id));
drop policy if exists trees_update on public.trees;
create policy trees_update on public.trees for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists trees_delete on public.trees;
create policy trees_delete on public.trees for delete to authenticated using (owner = auth.uid());

-- Only the owner sees the member list (it holds everyone's email address).
drop policy if exists members_select on public.tree_members;
create policy members_select on public.tree_members for select to authenticated using (public.is_owner(tree_id));
drop policy if exists members_insert on public.tree_members;
create policy members_insert on public.tree_members for insert to authenticated with check (public.is_owner(tree_id));
drop policy if exists members_update on public.tree_members;
create policy members_update on public.tree_members for update to authenticated using (public.is_owner(tree_id)) with check (public.is_owner(tree_id));
drop policy if exists members_delete on public.tree_members;
create policy members_delete on public.tree_members for delete to authenticated using (public.is_owner(tree_id));

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated using (public.is_member(tree_id));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated with check (public.is_editor(tree_id));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated using (public.is_editor(tree_id)) with check (public.is_editor(tree_id));
-- No delete policy: rows are cleared (data = null), never removed, so other copies learn of it.

-- The first version let anyone with the link read; remove that if it's there.
drop function if exists public.pull_tree(uuid, bigint, int);

-- Name and your role, for members only (others get no row, the same as "no such tree").
drop function if exists public.tree_info(uuid);
create function public.tree_info(p_tree uuid)
returns table (name text, role text)
language sql stable security definer set search_path = public as $$
  select t.name, public.tree_role(t.id) from trees t where t.id = p_tree and public.is_member(t.id);
$$;
revoke execute on function public.tree_info(uuid) from public, anon;
grant execute on function public.tree_info(uuid) to authenticated;

-- Photos and voice memories: a PRIVATE bucket, readable by members, writable by editors.
insert into storage.buckets (id, name, public)
values ('family-media', 'family-media', false)
on conflict (id) do update set public = false;

drop policy if exists media_select on storage.objects;
create policy media_select on storage.objects for select to authenticated
  using (bucket_id = 'family-media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'family-media' and public.is_editor(((storage.foldername(name))[1])::uuid));
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'family-media' and public.is_editor(((storage.foldername(name))[1])::uuid));
