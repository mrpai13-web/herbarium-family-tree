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

-- Signed-in people may use the tables at all (newer Supabase projects don't grant this
-- automatically); the row-level rules below still decide which rows each one sees.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trees, public.tree_members to authenticated;
grant select, insert, update on public.records to authenticated;
grant usage, select on sequence public.records_seq to authenticated;
grant execute on function public.tree_role(uuid), public.is_member(uuid), public.is_editor(uuid), public.is_owner(uuid) to authenticated;

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

-- ------------------------------------------------------------ activity log and reminders
--
-- member_activity: when each member last opened a tree and last exported a backup (the app
-- calls note_activity). Sign-ins come from auth.users, edits from records.updated_at, so
-- nothing else needs logging. Nobody reads these tables directly: the owner sees their own
-- tree's log through tree_activity(), and the daily reminder job reads dates only through
-- monitor_report(), which needs a secret token (its SHA-256 lives in monitor_settings).

create table if not exists public.member_activity (
  tree_id uuid not null references public.trees (id) on delete cascade,
  user_id uuid not null,
  email text not null,
  last_seen timestamptz,
  last_export timestamptz,
  primary key (tree_id, user_id)
);
create table if not exists public.monitor_settings (
  name text primary key,
  value text not null
);
alter table public.member_activity enable row level security;
alter table public.monitor_settings enable row level security;
revoke all on public.member_activity, public.monitor_settings from anon, authenticated;

-- A member opened the tree ('visit') or exported a backup of it ('export').
create or replace function public.note_activity(p_tree uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('visit', 'export') then raise exception 'unknown activity'; end if;
  if not public.is_member(p_tree) then return; end if;
  insert into member_activity (tree_id, user_id, email, last_seen, last_export)
  values (p_tree, auth.uid(), lower(coalesce(auth.jwt() ->> 'email', '')), now(), case when p_kind = 'export' then now() end)
  on conflict (tree_id, user_id) do update
    set last_seen = now(), email = excluded.email,
        last_export = coalesce(excluded.last_export, member_activity.last_export);
end $$;
revoke execute on function public.note_activity(uuid, text) from public, anon;
grant execute on function public.note_activity(uuid, text) to authenticated;

-- The owner's activity log for one tree: everyone with access and when they last signed in,
-- opened it, edited it and exported a backup. Other callers get no rows.
create or replace function public.tree_activity(p_tree uuid)
returns table (email text, role text, last_sign_in timestamptz, last_seen timestamptz, last_edit timestamptz, last_export timestamptz)
language sql stable security definer set search_path = public as $$
  with people as (
    select u.id as uid, lower(u.email) as email, 'owner'::text as role
      from trees t join auth.users u on u.id = t.owner where t.id = p_tree
    union all
    select u.id, m.email, m.role
      from tree_members m left join auth.users u on lower(u.email) = m.email where m.tree_id = p_tree
  )
  select p.email, p.role, u.last_sign_in_at, a.last_seen,
         (select max(r.updated_at) from records r where r.tree_id = p_tree and r.updated_by = p.uid),
         a.last_export
    from people p
    left join auth.users u on u.id = p.uid
    left join member_activity a on a.tree_id = p_tree and a.user_id = p.uid
   where public.is_owner(p_tree);
$$;
revoke execute on function public.tree_activity(uuid) from public, anon;
grant execute on function public.tree_activity(uuid) to authenticated;

-- For the daily reminder job: dates and counts only (no names of people, no emails).
create or replace function public.monitor_report(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from monitor_settings
                 where name = 'report_token_sha256'
                   and value = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')) then
    raise exception 'not allowed';
  end if;
  return jsonb_build_object(
    'now', now(),
    'last_edit', (select max(updated_at) from records),
    'last_visit', (select max(last_seen) from member_activity),
    'last_sign_in', (select max(last_sign_in_at) from auth.users),
    'owner_last_sign_in', (select max(u.last_sign_in_at) from trees t join auth.users u on u.id = t.owner),
    'owner_last_visit', (select max(a.last_seen) from member_activity a join trees t on t.id = a.tree_id and a.user_id = t.owner),
    'last_export', (select max(last_export) from member_activity),
    'trees', (select coalesce(jsonb_agg(jsonb_build_object(
                'name', t.name,
                'last_edit', (select max(r.updated_at) from records r where r.tree_id = t.id),
                'people', (select count(*) from records r where r.tree_id = t.id and r.tbl = 'people' and not r.deleted),
                'members', (select count(*) from tree_members m where m.tree_id = t.id) + 1)), '[]'::jsonb)
              from trees t)
  );
end $$;
revoke execute on function public.monitor_report(text) from public;
grant execute on function public.monitor_report(text) to anon, authenticated;
