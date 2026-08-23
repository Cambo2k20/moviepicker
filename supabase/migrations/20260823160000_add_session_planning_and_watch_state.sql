begin;

-- A movie session currently ends the moment it is confirmed: there is nowhere to
-- record which night it is for, and no way to tell a planned watch from one that
-- has happened. Both are needed before a session can stay editable long enough
-- for the Journal entry to be written after the film, rather than before it.

alter table public.movie_sessions
  drop constraint movie_sessions_status_check;

alter table public.movie_sessions
  add constraint movie_sessions_status_check
  check (status in ('ACTIVE', 'CONFIRMED', 'WATCHED', 'ENDED'));

alter table public.movie_sessions
  add column planned_for date not null default current_date,
  add column watched_at timestamptz,
  -- The Journal post is prepared in the browser and copied by hand. Keeping the
  -- draft here means it survives a refresh and can be finished after the film.
  add column journal_draft jsonb not null default '{}'::jsonb
    check (jsonb_typeof(journal_draft) = 'object');

comment on column public.movie_sessions.planned_for is
  'The night this session is for. Editable, because the host may confirm a film days ahead.';
comment on column public.movie_sessions.watched_at is
  'Set when the group marks the session watched. Null means planned but not yet watched.';

-- A watched session is no longer open, so it stops blocking the next one while
-- remaining readable and editable in history.
drop index if exists public.movie_sessions_one_open_per_group_idx;
create unique index movie_sessions_one_open_per_group_idx
  on public.movie_sessions (group_id)
  where status in ('ACTIVE', 'CONFIRMED');

create index movie_sessions_group_planned_idx
  on public.movie_sessions (group_id, planned_for desc);

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

-- A watched session still requires a selected film, the same as a confirmed one.
alter table public.movie_sessions
  drop constraint movie_sessions_confirmed_selection;

alter table public.movie_sessions
  add constraint movie_sessions_confirmed_selection
  check (status not in ('CONFIRMED', 'WATCHED') or selected_title is not null);

commit;
