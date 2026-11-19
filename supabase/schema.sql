-- Herbarium shared trees: run once in the Supabase SQL editor (Dashboard > SQL > New query).
-- Safe to run again: everything is "if not exists" / "or replace".
--
-- Model
--   trees         one row per shared tree; the owner is whoever uploaded it.
--   tree_members  emails the owner invited to edit.
--   records       every person, parent link, union, group and media caption as one JSON row
--                 (soft-deleted, last write wins). Photos/audio live in the storage bucket
--                 "family-media" at <tree id>/<media id>/blob and /thumb.
--
-- Access ("view link + edit sign-in")
--   Anyone with the link can read a tree, but only through pull_tree(tree id), so nobody
--   can list other people's trees. Writing needs a signed-in owner or invited member.

create table if not exists public.trees (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Family tree',
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tree_members (
  tree_id uuid not null references public.trees (id) on delete cascade,
  email text not null,
  added_at timestamptz not null default now(),
  primary key (tree_id, email)
);

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
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- Owner or invited (by the email they signed in with).
create or replace function public.is_editor(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trees t where t.id = p_tree and t.owner = auth.uid())
      or exists (select 1 from tree_members m
                 where m.tree_id = p_tree and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.is_owner(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trees t where t.id = p_tree and t.owner = auth.uid());
$$;

alter table public.trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.records enable row level security;

drop policy if exists trees_insert on public.trees;
create policy trees_insert on public.trees for insert to authenticated with check (owner = auth.uid());
drop policy if exists trees_select on public.trees;
create policy trees_select on public.trees for select to authenticated using (public.is_editor(id));
drop policy if exists trees_update on public.trees;
create policy trees_update on public.trees for update to authenticated using (owner = auth.uid());
drop policy if exists trees_delete on public.trees;
create policy trees_delete on public.trees for delete to authenticated using (owner = auth.uid());

drop policy if exists members_select on public.tree_members;
create policy members_select on public.tree_members for select to authenticated using (public.is_editor(tree_id));
drop policy if exists members_insert on public.tree_members;
create policy members_insert on public.tree_members for insert to authenticated with check (public.is_owner(tree_id));
drop policy if exists members_delete on public.tree_members;
create policy members_delete on public.tree_members for delete to authenticated using (public.is_owner(tree_id));

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated using (public.is_editor(tree_id));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated with check (public.is_editor(tree_id));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated using (public.is_editor(tree_id)) with check (public.is_editor(tree_id));

-- Read a tree by its id (the id in the share link is the "key"). Paged by seq.
create or replace function public.pull_tree(p_tree uuid, p_since bigint default 0, p_limit int default 1000)
returns table (tbl text, id text, data jsonb, deleted boolean, seq bigint, client text)
language sql stable security definer set search_path = public as $$
  select r.tbl, r.id, r.data, r.deleted, r.seq, r.client
  from records r
  where r.tree_id = p_tree and r.seq > p_since
  order by r.seq
  limit least(greatest(p_limit, 1), 5000);
$$;

-- Does the tree exist, what is it called, and may the caller edit / manage it?
create or replace function public.tree_info(p_tree uuid)
returns table (name text, can_edit boolean, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select t.name, public.is_editor(t.id), public.is_owner(t.id) from trees t where t.id = p_tree;
$$;

grant execute on function public.pull_tree(uuid, bigint, int) to anon, authenticated;
grant execute on function public.tree_info(uuid) to anon, authenticated;

-- Photos and voice memories. Public bucket: files are readable by anyone who knows the
-- path (tree id + media id, both random), which the share link already gives.
insert into storage.buckets (id, name, public)
values ('family-media', 'family-media', true)
on conflict (id) do update set public = true;

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'family-media' and public.is_editor(((storage.foldername(name))[1])::uuid));
drop policy if exists media_select on storage.objects;
create policy media_select on storage.objects for select to authenticated
  using (bucket_id = 'family-media' and public.is_editor(((storage.foldername(name))[1])::uuid));
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'family-media' and public.is_editor(((storage.foldername(name))[1])::uuid));
