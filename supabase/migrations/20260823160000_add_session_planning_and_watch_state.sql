begin;

-- A movie session ends the moment it is confirmed: there is nowhere to record
-- which night it is for, and no way to tell a planned watch from one that has
-- happened. Both are needed before a session can stay editable long enough for
-- the Journal entry to be written after the film rather than before it.

-- ---------------------------------------------------------------- status
alter table public.movie_sessions
  drop constraint movie_sessions_status_check;

alter table public.movie_sessions
  add constraint movie_sessions_status_check
  check (status in ('ACTIVE', 'CONFIRMED', 'WATCHED', 'ENDED'));

-- ---------------------------------------------------------------- columns
-- planned_for is added nullable and backfilled from each session's own history,
-- so existing sessions keep the night they actually happened rather than all
-- being stamped with the migration date.
alter table public.movie_sessions
  add column planned_for date,
  add column watched_at timestamptz,
  add column journal_draft jsonb not null default '{}'::jsonb
    check (jsonb_typeof(journal_draft) = 'object');

update public.movie_sessions
set planned_for = (coalesce(confirmed_at, started_at) at time zone 'UTC')::date
where planned_for is null;

alter table public.movie_sessions
  alter column planned_for set default current_date,
  alter column planned_for set not null;

comment on column public.movie_sessions.planned_for is
  'The night this session is for, shown as "Session date". Editable: a host may confirm a film days before watching it.';
comment on column public.movie_sessions.watched_at is
  'Set when the group marks the session watched, from the chosen date. Null means confirmed but not yet watched.';
comment on column public.movie_sessions.journal_draft is
  'In-progress Journal post for this session, so it can be finished after the film.';

-- A watched session is no longer open, so it stops blocking the next one while
-- staying readable and editable in history.
drop index if exists public.movie_sessions_one_open_per_group_idx;
create unique index movie_sessions_one_open_per_group_idx
  on public.movie_sessions (group_id)
  where status in ('ACTIVE', 'CONFIRMED');

create index movie_sessions_group_planned_idx
  on public.movie_sessions (group_id, planned_for desc);

-- Viewing counts are read per film, and must survive a queue item being deleted.
create index movie_sessions_watched_identity_idx
  on public.movie_sessions (group_id, selected_tmdb_id, selected_title, selected_release_year)
  where status = 'WATCHED';

-- ---------------------------------------------------------------- trigger
create or replace function private.validate_movie_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.group_id <> old.group_id or new.created_by <> old.created_by) then
    raise exception 'A movie session cannot be moved to another group or host.';
  end if;

  if new.selected_queue_item_id is not null and not exists (
    select 1
    from public.queue_items item
    where item.id = new.selected_queue_item_id
      and item.group_id = new.group_id
  ) then
    raise exception 'The selected film must belong to this group.';
  end if;

  if new.status = 'CONFIRMED' then
    if nullif(trim(new.selected_title), '') is null then
      raise exception 'A confirmed session requires a selected film.';
    end if;
    new.confirmed_at = coalesce(new.confirmed_at, now());
    new.watched_at = null;
    new.ended_at = null;
  elsif new.status = 'WATCHED' then
    if nullif(trim(new.selected_title), '') is null then
      raise exception 'A watched session requires a selected film.';
    end if;
    new.confirmed_at = coalesce(new.confirmed_at, now());
    -- watched_at is supplied from the chosen date; now() is only a fallback.
    new.watched_at = coalesce(new.watched_at, now());
    new.ended_at = null;
  elsif new.status = 'ACTIVE' then
    new.confirmed_at = null;
    new.watched_at = null;
    new.ended_at = null;
  elsif new.status = 'ENDED' then
    new.ended_at = coalesce(new.ended_at, now());
  end if;

  return new;
end;
$$;

alter table public.movie_sessions
  drop constraint movie_sessions_confirmed_selection;

-- Film identity is snapshotted onto the session, so deleting the queue item
-- later (which only nulls selected_queue_item_id) cannot erase what was watched.
alter table public.movie_sessions
  add constraint movie_sessions_confirmed_selection
  check (status not in ('CONFIRMED', 'WATCHED') or selected_title is not null);

-- ---------------------------------------------------------------- details
-- One call from the client, one transaction here, so the session date and the
-- participant list cannot be saved half-way.
create or replace function public.save_movie_session_details(
  p_session_id uuid,
  p_session_date date,
  p_participant_ids uuid[]
)
returns public.movie_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated public.movie_sessions;
begin
  update public.movie_sessions
  set planned_for = p_session_date
  where id = p_session_id
  returning * into updated;

  if updated.id is null then
    raise exception 'That session does not exist, or you cannot edit it.';
  end if;

  delete from public.movie_session_participants where session_id = p_session_id;

  insert into public.movie_session_participants (session_id, profile_id, display_name_snapshot)
  select p_session_id, candidate.id, coalesce(profile.display_name, 'Discordian')
  from unnest(coalesce(p_participant_ids, '{}'::uuid[])) as candidate(id)
  join public.profiles profile on profile.id = candidate.id
  where exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = updated.group_id
      and membership.user_id = candidate.id
  );

  return updated;
end;
$$;

-- ---------------------------------------------------------------- watched
-- security definer, because the host may not have suggested the film and so
-- cannot update queue_items under its own policy. Authorisation is checked
-- explicitly here instead, matching the session update policy.
create or replace function public.mark_movie_session_watched(
  p_session_id uuid,
  p_watched_on date,
  p_participant_ids uuid[]
)
returns public.movie_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.movie_sessions;
  updated public.movie_sessions;
begin
  select * into target from public.movie_sessions where id = p_session_id;

  if target.id is null then
    raise exception 'That session does not exist.';
  end if;

  if not (target.created_by = (select auth.uid()) or private.is_group_admin(target.group_id)) then
    raise exception 'Only the session host or a website administrator can mark this session watched.';
  end if;

  if target.status <> 'CONFIRMED' then
    raise exception 'Only a confirmed session can be marked watched.';
  end if;

  update public.movie_sessions
  set status = 'WATCHED',
      planned_for = p_watched_on,
      watched_at = p_watched_on::timestamptz
  where id = p_session_id
  returning * into updated;

  if p_participant_ids is not null then
    delete from public.movie_session_participants where session_id = p_session_id;

    insert into public.movie_session_participants (session_id, profile_id, display_name_snapshot)
    select p_session_id, candidate.id, coalesce(profile.display_name, 'Discordian')
    from unnest(p_participant_ids) as candidate(id)
    join public.profiles profile on profile.id = candidate.id
    where exists (
      select 1
      from public.group_memberships membership
      where membership.group_id = updated.group_id
        and membership.user_id = candidate.id
    );
  end if;

  if updated.selected_queue_item_id is not null then
    update public.queue_items
    set watched = true
    where id = updated.selected_queue_item_id
      and group_id = updated.group_id;
  end if;

  return updated;
end;
$$;

-- ---------------------------------------------------------------- counts
-- Grouped by the snapshot as well as the queue item, so a film removed from the
-- list keeps the viewings it already has.
create or replace function public.group_watch_counts(p_group_id uuid)
returns table (
  queue_item_id uuid,
  tmdb_id bigint,
  title text,
  release_year integer,
  watch_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  select
    session.selected_queue_item_id,
    session.selected_tmdb_id,
    session.selected_title,
    session.selected_release_year,
    count(*)
  from public.movie_sessions session
  where session.group_id = p_group_id
    and session.status = 'WATCHED'
  group by 1, 2, 3, 4;
$$;

revoke all on function public.save_movie_session_details(uuid, date, uuid[]) from public, anon;
revoke all on function public.mark_movie_session_watched(uuid, date, uuid[]) from public, anon;
revoke all on function public.group_watch_counts(uuid) from public, anon;
grant execute on function public.save_movie_session_details(uuid, date, uuid[]) to authenticated;
grant execute on function public.mark_movie_session_watched(uuid, date, uuid[]) to authenticated;
grant execute on function public.group_watch_counts(uuid) to authenticated;

commit;
