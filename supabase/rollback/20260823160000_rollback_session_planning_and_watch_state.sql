-- Rollback for 20260823160000_add_session_planning_and_watch_state.
--
-- Run only if the migration must be undone. It is destructive in one specific
-- way, called out below, so read that note before running it.
--
-- WHAT IS LOST: planned_for, watched_at and journal_draft are dropped, and any
-- session already marked WATCHED is moved back to CONFIRMED. Sessions cannot
-- hold more than one open session per group, so if more than one session was
-- marked watched for a group, moving them all back to CONFIRMED would violate
-- movie_sessions_one_open_per_group_idx. The script therefore moves watched
-- sessions to ENDED instead, which preserves them in history. Films marked
-- watched on queue_items stay watched; that flag predates this migration and
-- is not safe to reverse automatically.

begin;

drop function if exists public.group_watch_counts(uuid);
drop function if exists public.mark_movie_session_watched(uuid, date, uuid[]);
drop function if exists public.save_movie_session_details(uuid, date, uuid[]);

drop index if exists public.movie_sessions_watched_identity_idx;
drop index if exists public.movie_sessions_group_planned_idx;

-- Watched sessions become ended, so exactly one open session per group holds.
update public.movie_sessions
set status = 'ENDED',
    ended_at = coalesce(watched_at, confirmed_at, started_at)
where status = 'WATCHED';

alter table public.movie_sessions
  drop constraint movie_sessions_confirmed_selection;

alter table public.movie_sessions
  add constraint movie_sessions_confirmed_selection
  check (status <> 'CONFIRMED' or selected_title is not null);

alter table public.movie_sessions
  drop column if exists journal_draft,
  drop column if exists watched_at,
  drop column if exists planned_for;

alter table public.movie_sessions
  drop constraint movie_sessions_status_check;

alter table public.movie_sessions
  add constraint movie_sessions_status_check
  check (status in ('ACTIVE', 'CONFIRMED', 'ENDED'));

drop index if exists public.movie_sessions_one_open_per_group_idx;
create unique index movie_sessions_one_open_per_group_idx
  on public.movie_sessions (group_id)
  where status in ('ACTIVE', 'CONFIRMED');

-- Restore the pre-migration trigger body.
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
    new.ended_at = null;
  elsif new.status = 'ACTIVE' then
    new.confirmed_at = null;
    new.ended_at = null;
  elsif new.status = 'ENDED' then
    new.ended_at = coalesce(new.ended_at, now());
  end if;

  return new;
end;
$$;

commit;
