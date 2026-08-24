-- Rollback for 20260823214112_add_session_planning_and_watch_state.
--
-- Destructive effects:
-- - WATCHED sessions become ENDED because restoring them as CONFIRMED could
--   violate the one-open-session-per-group index.
-- - host transfers, watch dates and Journal drafts are lost.
-- - linked Journal entries are retained, but are unlinked from their sessions.
-- - queue_items.watched is retained because it may predate this migration.

begin;

drop function if exists public.group_watch_counts(uuid);
drop function if exists public.save_movie_session_journal(uuid, text, integer, text, text, bigint);
drop function if exists public.mark_movie_session_watched(uuid, date, uuid, uuid[]);
drop function if exists private.mark_movie_session_watched(uuid, date, uuid, uuid[]);
drop function if exists public.save_movie_session_details(uuid, date, uuid, uuid[]);

drop policy if exists entry_viewers_delete_owner_or_admin on public.entry_viewers;
drop policy if exists entry_viewers_insert_owner_or_admin on public.entry_viewers;
drop policy if exists journal_entries_delete_owner_or_admin on public.journal_entries;
drop policy if exists journal_entries_update_owner_or_admin on public.journal_entries;
drop policy if exists journal_entries_insert_member on public.journal_entries;
drop policy if exists movie_session_participants_delete_host_or_admin on public.movie_session_participants;
drop policy if exists movie_session_participants_insert_host_or_admin on public.movie_session_participants;
drop policy if exists movie_sessions_delete_host_or_admin on public.movie_sessions;
drop policy if exists movie_sessions_update_host_or_admin on public.movie_sessions;
drop policy if exists movie_sessions_insert_host on public.movie_sessions;

drop index if exists public.journal_entries_movie_session_idx;
drop index if exists public.movie_sessions_watched_identity_idx;
drop index if exists public.movie_sessions_host_idx;
drop index if exists public.movie_sessions_group_watch_date_idx;

update public.movie_sessions
set status = 'ENDED',
    ended_at = coalesce(watched_at, confirmed_at, started_at)
where status = 'WATCHED';

alter table public.movie_sessions
  drop constraint movie_sessions_confirmed_selection;

alter table public.movie_sessions
  add constraint movie_sessions_confirmed_selection
  check (status <> 'CONFIRMED' or selected_title is not null);

alter table public.journal_entries
  drop column if exists movie_session_id;

alter table public.movie_sessions
  drop column if exists journal_draft,
  drop column if exists watched_at,
  drop column if exists watch_date,
  drop column if exists host_id;

alter table public.movie_sessions
  drop constraint movie_sessions_status_check;

alter table public.movie_sessions
  add constraint movie_sessions_status_check
  check (status in ('ACTIVE', 'CONFIRMED', 'ENDED'));

drop index if exists public.movie_sessions_one_open_per_group_idx;
create unique index movie_sessions_one_open_per_group_idx
  on public.movie_sessions (group_id)
  where status in ('ACTIVE', 'CONFIRMED');

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

create or replace function public.create_movie_session(
  p_group_id uuid,
  p_mode text,
  p_participant_ids uuid[],
  p_candidate_count integer,
  p_game_state jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_session_id uuid;
  requested_participants integer;
  valid_participants integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to create a movie session.';
  end if;

  requested_participants := coalesce(array_length(p_participant_ids, 1), 0);
  if requested_participants = 0 then
    raise exception 'Choose at least one participant.';
  end if;

  if requested_participants <> (
    select count(distinct participant_id)
    from unnest(p_participant_ids) as participant_id
  ) then
    raise exception 'Each participant may only be added once.';
  end if;

  select count(*) into valid_participants
  from public.group_memberships membership
  where membership.group_id = p_group_id
    and membership.user_id = any(p_participant_ids);

  if valid_participants <> requested_participants then
    raise exception 'Every participant must be an approved member of this group.';
  end if;

  insert into public.movie_sessions (
    group_id,
    created_by,
    mode,
    candidate_count,
    game_state
  ) values (
    p_group_id,
    (select auth.uid()),
    trim(p_mode),
    greatest(coalesce(p_candidate_count, 0), 0),
    coalesce(p_game_state, '{}'::jsonb)
  )
  returning id into new_session_id;

  insert into public.movie_session_participants (
    session_id,
    profile_id,
    display_name_snapshot
  )
  select
    new_session_id,
    profile.id,
    profile.display_name
  from public.profiles profile
  where profile.id = any(p_participant_ids);

  return new_session_id;
end;
$$;

create policy movie_sessions_insert_host
on public.movie_sessions for insert
to authenticated
with check (
  private.is_group_member(group_id)
  and created_by = (select auth.uid())
);

create policy movie_sessions_update_host_or_admin
on public.movie_sessions for update
to authenticated
using (created_by = (select auth.uid()) or private.is_group_admin(group_id))
with check (
  private.is_group_member(group_id)
  and (created_by = (select auth.uid()) or private.is_group_admin(group_id))
);

create policy movie_sessions_delete_host_or_admin
on public.movie_sessions for delete
to authenticated
using (created_by = (select auth.uid()) or private.is_group_admin(group_id));

create policy movie_session_participants_insert_host_or_admin
on public.movie_session_participants for insert
to authenticated
with check (
  profile_id is not null
  and exists (
    select 1
    from public.movie_sessions session
    join public.group_memberships membership
      on membership.group_id = session.group_id
     and membership.user_id = movie_session_participants.profile_id
    where session.id = movie_session_participants.session_id
      and (session.created_by = (select auth.uid()) or private.is_group_admin(session.group_id))
  )
);

create policy movie_session_participants_delete_host_or_admin
on public.movie_session_participants for delete
to authenticated
using (
  exists (
    select 1
    from public.movie_sessions session
    where session.id = movie_session_participants.session_id
      and (session.created_by = (select auth.uid()) or private.is_group_admin(session.group_id))
  )
);

create policy journal_entries_insert_member
on public.journal_entries for insert
to authenticated
with check (
  private.is_group_member(group_id)
  and created_by = (select auth.uid())
);

create policy journal_entries_update_owner_or_admin
on public.journal_entries for update
to authenticated
using (created_by = (select auth.uid()) or private.is_group_admin(group_id))
with check (
  private.is_group_member(group_id)
  and (created_by = (select auth.uid()) or private.is_group_admin(group_id))
);

create policy journal_entries_delete_owner_or_admin
on public.journal_entries for delete
to authenticated
using (created_by = (select auth.uid()) or private.is_group_admin(group_id));

create policy entry_viewers_insert_owner_or_admin
on public.entry_viewers for insert
to authenticated
with check (
  exists (
    select 1
    from public.journal_entries entry
    where entry.id = entry_viewers.entry_id
      and (entry.created_by = (select auth.uid()) or private.is_group_admin(entry.group_id))
  )
);

create policy entry_viewers_delete_owner_or_admin
on public.entry_viewers for delete
to authenticated
using (
  exists (
    select 1
    from public.journal_entries entry
    where entry.id = entry_viewers.entry_id
      and (entry.created_by = (select auth.uid()) or private.is_group_admin(entry.group_id))
  )
);

commit;
