begin;

-- One TMDB identity now has one durable metadata row. Queue items, sessions and
-- Journal entries keep their existing snapshots so historical display does not
-- change when this catalogue is refreshed.
create table public.movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id bigint not null unique check (tmdb_id > 0),
  title text not null check (char_length(trim(title)) between 1 and 200),
  original_title text check (original_title is null or char_length(trim(original_title)) between 1 and 200),
  release_date date,
  release_year integer check (release_year is null or release_year between 1888 and 2200),
  original_language text check (original_language is null or char_length(trim(original_language)) between 2 and 12),
  poster_path text check (poster_path is null or char_length(poster_path) <= 300),
  runtime_minutes integer check (runtime_minutes is null or runtime_minutes between 1 and 1440),
  genres text[] not null default '{}'::text[] check (cardinality(genres) <= 12),
  overview text check (overview is null or char_length(overview) <= 4000),
  metadata_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.movies is
  'Canonical, membership-private movie metadata. The protected movie-lookup Edge Function upserts one row per TMDB ID.';
comment on column public.movies.tmdb_id is
  'Stable TMDB movie identifier. Browser code never receives the TMDB secret used to refresh this metadata.';
comment on column public.movies.metadata_updated_at is
  'When the protected movie lookup last refreshed this canonical metadata from TMDB.';

create trigger movies_set_updated_at
before update on public.movies
for each row execute function private.set_updated_at();

-- A movie is not owned by one group, but it is still private to approved
-- Cine-Cord members. This helper avoids recursively querying memberships
-- through their own Row Level Security policy.
create or replace function private.has_approved_membership()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.group_memberships membership
      where membership.user_id = (select auth.uid())
    );
$$;

revoke all on function private.has_approved_membership() from public, anon, authenticated;
grant execute on function private.has_approved_membership() to authenticated;

alter table public.movies enable row level security;

create policy movies_select_approved_members
on public.movies for select
to authenticated
using ((select private.has_approved_membership()));

-- Browser roles may only read canonical metadata. The Edge Function's server
-- key receives precisely the operations required by PostgREST upsert.
revoke all on table public.movies from public, anon, authenticated, service_role;
grant select on table public.movies to authenticated;
grant select, insert, update on table public.movies to service_role;

-- Nullable bridges preserve every existing/manual row while allowing new and
-- backfilled TMDB-backed records to share one canonical identity.
alter table public.queue_items
  add column movie_id uuid references public.movies(id) on delete set null;

alter table public.movie_sessions
  add column selected_movie_id uuid references public.movies(id) on delete set null;

alter table public.journal_entries
  add column movie_id uuid references public.movies(id) on delete set null;

create index queue_items_movie_id_idx
  on public.queue_items (movie_id)
  where movie_id is not null;

create index movie_sessions_selected_movie_id_idx
  on public.movie_sessions (selected_movie_id)
  where selected_movie_id is not null;

create index journal_entries_movie_id_idx
  on public.journal_entries (movie_id)
  where movie_id is not null;

comment on column public.queue_items.movie_id is
  'Canonical movie identity when this queue item was matched through the protected TMDB lookup. Null for manual entries.';
comment on column public.movie_sessions.selected_movie_id is
  'Canonical identity for the selected film; selected_* snapshot columns remain the historical display source.';
comment on column public.journal_entries.movie_id is
  'Canonical identity inherited from a linked movie session when available. Imported archive rows are intentionally not guessed by title/year.';

-- Prefer the freshest queue snapshot when the same TMDB film appears more
-- than once. Existing snapshots are copied; no external request is made here.
insert into public.movies (
  tmdb_id,
  title,
  release_year,
  poster_path,
  runtime_minutes,
  genres,
  overview,
  metadata_updated_at,
  created_at,
  updated_at
)
select
  source.tmdb_id,
  source.title,
  source.release_year,
  source.poster_path,
  source.runtime_minutes,
  coalesce(source.genres[1:12], '{}'::text[]),
  source.overview,
  coalesce(source.metadata_updated_at, source.updated_at, source.created_at, now()),
  source.created_at,
  source.updated_at
from (
  select distinct on (item.tmdb_id)
    item.tmdb_id,
    item.title,
    item.release_year,
    item.poster_path,
    item.runtime_minutes,
    item.genres,
    item.overview,
    item.metadata_updated_at,
    item.created_at,
    item.updated_at
  from public.queue_items item
  where item.tmdb_id is not null
  order by
    item.tmdb_id,
    item.metadata_updated_at desc nulls last,
    item.updated_at desc,
    item.created_at desc
) source;

-- A historical session can outlive its queue row. Seed any remaining TMDB
-- identities from the stored selection snapshot without replacing fresher
-- queue metadata.
insert into public.movies (
  tmdb_id,
  title,
  release_year,
  poster_path,
  runtime_minutes,
  genres,
  overview,
  metadata_updated_at,
  created_at,
  updated_at
)
select
  source.selected_tmdb_id,
  source.selected_title,
  source.selected_release_year,
  source.selected_poster_path,
  source.selected_runtime_minutes,
  coalesce(source.selected_genres[1:12], '{}'::text[]),
  source.selected_overview,
  source.updated_at,
  source.started_at,
  source.updated_at
from (
  select distinct on (session.selected_tmdb_id)
    session.selected_tmdb_id,
    session.selected_title,
    session.selected_release_year,
    session.selected_poster_path,
    session.selected_runtime_minutes,
    session.selected_genres,
    session.selected_overview,
    session.started_at,
    session.updated_at
  from public.movie_sessions session
  where session.selected_tmdb_id is not null
    and nullif(trim(session.selected_title), '') is not null
  order by session.selected_tmdb_id, session.updated_at desc, session.started_at desc
) source
on conflict (tmdb_id) do nothing;

update public.queue_items item
set movie_id = movie.id
from public.movies movie
where item.movie_id is null
  and item.tmdb_id = movie.tmdb_id;

-- The session's own TMDB snapshot is more authoritative than the queue row,
-- which may have been edited after the watch.
update public.movie_sessions session
set selected_movie_id = movie.id
from public.movies movie
where session.selected_movie_id is null
  and session.selected_tmdb_id = movie.tmdb_id;

update public.movie_sessions session
set selected_movie_id = item.movie_id
from public.queue_items item
where session.selected_movie_id is null
  and session.selected_queue_item_id = item.id
  and item.movie_id is not null;

update public.journal_entries entry
set movie_id = session.selected_movie_id
from public.movie_sessions session
where entry.movie_id is null
  and entry.movie_session_id = session.id
  and session.selected_movie_id is not null;

-- Old frontend builds can keep writing only tmdb_id. They are linked whenever
-- the Edge Function has already created the canonical row. Manual rows remain
-- valid with both identity columns null.
create or replace function private.validate_queue_item_movie()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  canonical_movie_id uuid;
  canonical_tmdb_id bigint;
begin
  if new.movie_id is null and new.tmdb_id is not null then
    select movie.id
    into canonical_movie_id
    from public.movies movie
    where movie.tmdb_id = new.tmdb_id;

    new.movie_id = canonical_movie_id;
  end if;

  if new.movie_id is not null then
    select movie.tmdb_id
    into canonical_tmdb_id
    from public.movies movie
    where movie.id = new.movie_id;

    if canonical_tmdb_id is null then
      raise exception 'Choose a valid canonical movie.';
    end if;

    if new.tmdb_id is null then
      new.tmdb_id = canonical_tmdb_id;
    elsif new.tmdb_id <> canonical_tmdb_id then
      raise exception 'The queue item TMDB ID must match its canonical movie.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_queue_item_movie() from public, anon, authenticated;

create trigger queue_items_validate_movie
before insert or update on public.queue_items
for each row execute function private.validate_queue_item_movie();

-- Sessions prefer their immutable selection snapshot, then fall back to the
-- selected queue row. Contradictory IDs are rejected when a selection is made,
-- while later edits to the queue cannot rewrite historical sessions.
create or replace function private.link_movie_session_movie()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  queue_movie_id uuid;
  canonical_movie_id uuid;
  canonical_tmdb_id bigint;
  selection_changed boolean;
begin
  if tg_op = 'INSERT' then
    selection_changed := true;
  else
    selection_changed := new.selected_queue_item_id is distinct from old.selected_queue_item_id
      or new.selected_movie_id is distinct from old.selected_movie_id
      or new.selected_tmdb_id is distinct from old.selected_tmdb_id;
  end if;

  if new.selected_movie_id is null and new.selected_tmdb_id is not null then
    select movie.id
    into canonical_movie_id
    from public.movies movie
    where movie.tmdb_id = new.selected_tmdb_id;

    new.selected_movie_id = canonical_movie_id;
  end if;

  if new.selected_queue_item_id is not null then
    select item.movie_id
    into queue_movie_id
    from public.queue_items item
    where item.id = new.selected_queue_item_id
      and item.group_id = new.group_id;

    if new.selected_movie_id is null then
      new.selected_movie_id = queue_movie_id;
    elsif selection_changed
      and queue_movie_id is not null
      and new.selected_movie_id <> queue_movie_id
    then
      raise exception 'The selected canonical movie must match the selected queue item.';
    end if;
  end if;

  if new.selected_movie_id is not null then
    select movie.tmdb_id
    into canonical_tmdb_id
    from public.movies movie
    where movie.id = new.selected_movie_id;

    if canonical_tmdb_id is null then
      raise exception 'Choose a valid canonical movie for this session.';
    end if;

    if new.selected_tmdb_id is null then
      new.selected_tmdb_id = canonical_tmdb_id;
    elsif new.selected_tmdb_id <> canonical_tmdb_id then
      raise exception 'The session TMDB ID must match its canonical movie.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.link_movie_session_movie() from public, anon, authenticated;

create trigger movie_sessions_link_movie
before insert or update on public.movie_sessions
for each row execute function private.link_movie_session_movie();

-- A session-linked Journal entry always inherits that session's canonical
-- identity. Standalone current entries remain nullable; imported archive rows
-- live in a different table and are deliberately untouched.
create or replace function private.link_journal_entry_movie()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_movie_id uuid;
begin
  if new.movie_session_id is not null then
    select session.selected_movie_id
    into session_movie_id
    from public.movie_sessions session
    where session.id = new.movie_session_id
      and session.group_id = new.group_id;

    if found then
      new.movie_id = session_movie_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.link_journal_entry_movie() from public, anon, authenticated;

create trigger journal_entries_link_movie
before insert or update on public.journal_entries
for each row execute function private.link_journal_entry_movie();

commit;
