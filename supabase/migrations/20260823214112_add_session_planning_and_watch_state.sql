begin;

-- A Roulette round becomes a confirmed watch session, then a watched session.
-- The creator remains immutable audit data; host_id is the editable owner used
-- by the application and RLS after an administrator transfers responsibility.

-- ---------------------------------------------------------------- status and identity
alter table public.movie_sessions
  drop constraint movie_sessions_status_check;

alter table public.movie_sessions
  add constraint movie_sessions_status_check
  check (status in ('ACTIVE', 'CONFIRMED', 'WATCHED', 'ENDED'));

alter table public.movie_sessions
  add column host_id uuid references public.profiles(id) on delete restrict,
  add column watch_date date,
  add column watched_at timestamptz,
  add column journal_draft jsonb not null default '{}'::jsonb
    check (jsonb_typeof(journal_draft) = 'object');

update public.movie_sessions
set host_id = created_by,
    watch_date = (coalesce(confirmed_at, started_at) at time zone 'UTC')::date
where host_id is null or watch_date is null;

alter table public.movie_sessions
  alter column host_id set not null,
  alter column watch_date set default current_date,
  alter column watch_date set not null;

alter table public.journal_entries
  add column movie_session_id uuid
  references public.movie_sessions(id) on delete cascade;

comment on column public.movie_sessions.created_by is
  'Immutable audit identity for the member who started the Roulette round.';
comment on column public.movie_sessions.host_id is
  'Member responsible for the session. Only an administrator may transfer it.';
comment on column public.movie_sessions.watch_date is
  'The intended watch date before completion and the actual watch date afterward.';
comment on column public.movie_sessions.watched_at is
  'Audit timestamp derived from watch_date when the session is marked watched.';
comment on column public.movie_sessions.journal_draft is
  'In-progress Journal post retained until the optional Discord handoff is completed.';
comment on column public.journal_entries.movie_session_id is
  'The watched website session that produced this Journal entry. One entry per session.';

drop index if exists public.movie_sessions_one_open_per_group_idx;
create unique index movie_sessions_one_open_per_group_idx
  on public.movie_sessions (group_id)
  where status in ('ACTIVE', 'CONFIRMED');

create index movie_sessions_group_watch_date_idx
  on public.movie_sessions (group_id, watch_date desc);

create index movie_sessions_host_idx
  on public.movie_sessions (host_id, started_at desc);

create index movie_sessions_watched_identity_idx
  on public.movie_sessions (group_id, selected_tmdb_id, selected_title, selected_release_year)
  where status = 'WATCHED';

create unique index journal_entries_movie_session_idx
  on public.journal_entries (movie_session_id)
  where movie_session_id is not null;

-- ---------------------------------------------------------------- session validation
create or replace function private.validate_movie_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.group_id <> old.group_id
    or new.created_by <> old.created_by
  ) then
    raise exception 'A movie session cannot be moved to another group or change its creator.';
  end if;

  if not exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = new.group_id
      and membership.user_id = new.host_id
  ) then
    raise exception 'The session host must be an approved member of this group.';
  end if;

  if new.selected_queue_item_id is not null and not exists (
    select 1
    from public.queue_items item
    where item.id = new.selected_queue_item_id
      and item.group_id = new.group_id
  ) then
    raise exception 'The selected film must belong to this group.';
  end if;

  if tg_op = 'UPDATE'
    and new.status = 'WATCHED'
    and old.status <> 'WATCHED'
    and coalesce(current_setting('cine_cord.marking_watched', true), '') <> 'true'
  then
    raise exception 'Use mark_movie_session_watched to complete a watch session.';
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
    new.watched_at = new.watch_date::timestamptz;
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

alter table public.movie_sessions
  add constraint movie_sessions_confirmed_selection
  check (status not in ('CONFIRMED', 'WATCHED') or selected_title is not null);

-- The original creator RPC predates host_id. Replace it in the same migration
-- so a newly required host can never make real session creation fail.
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
    host_id,
    mode,
    candidate_count,
    game_state
  ) values (
    p_group_id,
    (select auth.uid()),
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
    requested.id,
    coalesce(profile.display_name, 'Discordian')
  from unnest(p_participant_ids) with ordinality as requested(id, position)
  join public.profiles profile on profile.id = requested.id
  order by requested.position;

  return new_session_id;
end;
$$;

-- ---------------------------------------------------------------- host-aware RLS
drop policy if exists movie_sessions_insert_host on public.movie_sessions;
create policy movie_sessions_insert_host
on public.movie_sessions for insert
to authenticated
with check (
  private.is_group_member(group_id)
  and created_by = (select auth.uid())
  and host_id = (select auth.uid())
);

drop policy if exists movie_sessions_update_host_or_admin on public.movie_sessions;
create policy movie_sessions_update_host_or_admin
on public.movie_sessions for update
to authenticated
using (host_id = (select auth.uid()) or private.is_group_admin(group_id))
with check (
  private.is_group_member(group_id)
  and (host_id = (select auth.uid()) or private.is_group_admin(group_id))
);

drop policy if exists movie_sessions_delete_host_or_admin on public.movie_sessions;
create policy movie_sessions_delete_host_or_admin
on public.movie_sessions for delete
to authenticated
using (host_id = (select auth.uid()) or private.is_group_admin(group_id));

drop policy if exists movie_session_participants_insert_host_or_admin on public.movie_session_participants;
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
      and (session.host_id = (select auth.uid()) or private.is_group_admin(session.group_id))
  )
);

drop policy if exists movie_session_participants_delete_host_or_admin on public.movie_session_participants;
create policy movie_session_participants_delete_host_or_admin
on public.movie_session_participants for delete
to authenticated
using (
  exists (
    select 1
    from public.movie_sessions session
    where session.id = movie_session_participants.session_id
      and (session.host_id = (select auth.uid()) or private.is_group_admin(session.group_id))
  )
);

-- Linked Journal entries follow the session host, while legacy/manual entries
-- keep their original creator-or-admin ownership behavior.
drop policy if exists journal_entries_insert_member on public.journal_entries;
create policy journal_entries_insert_member
on public.journal_entries for insert
to authenticated
with check (
  private.is_group_member(group_id)
  and created_by = (select auth.uid())
  and (
    movie_session_id is null
    or exists (
      select 1
      from public.movie_sessions session
      where session.id = journal_entries.movie_session_id
        and session.group_id = journal_entries.group_id
        and (session.host_id = (select auth.uid()) or private.is_group_admin(session.group_id))
    )
  )
);

drop policy if exists journal_entries_update_owner_or_admin on public.journal_entries;
create policy journal_entries_update_owner_or_admin
on public.journal_entries for update
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_group_admin(group_id)
  or exists (
    select 1
    from public.movie_sessions session
    where session.id = journal_entries.movie_session_id
      and session.group_id = journal_entries.group_id
      and session.host_id = (select auth.uid())
  )
)
with check (
  private.is_group_member(group_id)
  and (
    movie_session_id is null
    or exists (
      select 1
      from public.movie_sessions session
      where session.id = journal_entries.movie_session_id
        and session.group_id = journal_entries.group_id
    )
  )
  and (
    created_by = (select auth.uid())
    or private.is_group_admin(group_id)
    or exists (
      select 1
      from public.movie_sessions session
      where session.id = journal_entries.movie_session_id
        and session.group_id = journal_entries.group_id
        and session.host_id = (select auth.uid())
    )
  )
);

drop policy if exists journal_entries_delete_owner_or_admin on public.journal_entries;
create policy journal_entries_delete_owner_or_admin
on public.journal_entries for delete
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_group_admin(group_id)
  or exists (
    select 1
    from public.movie_sessions session
    where session.id = journal_entries.movie_session_id
      and session.group_id = journal_entries.group_id
      and session.host_id = (select auth.uid())
  )
);

drop policy if exists entry_viewers_insert_owner_or_admin on public.entry_viewers;
create policy entry_viewers_insert_owner_or_admin
on public.entry_viewers for insert
to authenticated
with check (
  exists (
    select 1
    from public.journal_entries entry
    join public.group_memberships membership
      on membership.group_id = entry.group_id
     and membership.user_id = entry_viewers.profile_id
    left join public.movie_sessions session
      on session.id = entry.movie_session_id
    where entry.id = entry_viewers.entry_id
      and (
        entry.created_by = (select auth.uid())
        or private.is_group_admin(entry.group_id)
        or session.host_id = (select auth.uid())
      )
  )
);

drop policy if exists entry_viewers_delete_owner_or_admin on public.entry_viewers;
create policy entry_viewers_delete_owner_or_admin
on public.entry_viewers for delete
to authenticated
using (
  exists (
    select 1
    from public.journal_entries entry
    left join public.movie_sessions session
      on session.id = entry.movie_session_id
    where entry.id = entry_viewers.entry_id
      and (
        entry.created_by = (select auth.uid())
        or private.is_group_admin(entry.group_id)
        or session.host_id = (select auth.uid())
      )
  )
);

-- ---------------------------------------------------------------- atomic detail editing
create or replace function public.save_movie_session_details(
  p_session_id uuid,
  p_watch_date date,
  p_host_id uuid,
  p_participant_ids uuid[]
)
returns public.movie_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.movie_sessions;
  updated public.movie_sessions;
  linked_entry_id uuid;
  requested_participants integer;
  valid_participants integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to edit a movie session.';
  end if;

  if p_watch_date is null then
    raise exception 'Choose a watch date.';
  end if;

  select * into target
  from public.movie_sessions
  where id = p_session_id;

  if target.id is null then
    raise exception 'That session does not exist, or you cannot view it.';
  end if;

  if target.status not in ('CONFIRMED', 'WATCHED') then
    raise exception 'Only confirmed or watched sessions can be edited here.';
  end if;

  if not exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = target.group_id
      and membership.user_id = p_host_id
  ) then
    raise exception 'The host must be an approved member of this group.';
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
  where membership.group_id = target.group_id
    and membership.user_id = any(p_participant_ids);

  if valid_participants <> requested_participants then
    raise exception 'Every participant must be an approved member of this group.';
  end if;

  update public.movie_sessions
  set watch_date = p_watch_date,
      host_id = p_host_id,
      watched_at = case
        when status = 'WATCHED' then p_watch_date::timestamptz
        else watched_at
      end
  where id = p_session_id
  returning * into updated;

  if updated.id is null then
    raise exception 'That session does not exist, or you cannot edit it.';
  end if;

  delete from public.movie_session_participants
  where session_id = p_session_id;

  insert into public.movie_session_participants (
    session_id,
    profile_id,
    display_name_snapshot
  )
  select
    p_session_id,
    requested.id,
    coalesce(profile.display_name, 'Discordian')
  from unnest(p_participant_ids) with ordinality as requested(id, position)
  join public.profiles profile on profile.id = requested.id
  order by requested.position;

  if updated.status = 'WATCHED' then
    select id into linked_entry_id
    from public.journal_entries
    where movie_session_id = p_session_id;

    if linked_entry_id is not null then
      update public.journal_entries
      set watched_at = p_watch_date
      where id = linked_entry_id;

      delete from public.entry_viewers
      where entry_id = linked_entry_id;

      insert into public.entry_viewers (entry_id, profile_id)
      select linked_entry_id, requested.id
      from unnest(p_participant_ids) with ordinality as requested(id, position)
      order by requested.position;
    end if;
  end if;

  return updated;
end;
$$;

-- ---------------------------------------------------------------- atomic watch completion
-- The privileged implementation is kept out of the exposed public schema. It
-- performs its own host/admin checks before bypassing queue_items RLS.
create or replace function private.mark_movie_session_watched(
  p_session_id uuid,
  p_watched_on date,
  p_host_id uuid,
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
  requested_participants integer;
  valid_participants integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to complete a movie session.';
  end if;

  if p_watched_on is null then
    raise exception 'Choose the date the film was watched.';
  end if;

  select * into target
  from public.movie_sessions
  where id = p_session_id
  for update;

  if target.id is null then
    raise exception 'That session does not exist.';
  end if;

  if not (
    target.host_id = (select auth.uid())
    or private.is_group_admin(target.group_id)
  ) then
    raise exception 'Only the session host or a website administrator can mark this session watched.';
  end if;

  if target.status <> 'CONFIRMED' then
    raise exception 'Only a confirmed session can be marked watched.';
  end if;

  if not exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = target.group_id
      and membership.user_id = p_host_id
  ) then
    raise exception 'The host must be an approved member of this group.';
  end if;

  if not private.is_group_admin(target.group_id) and p_host_id <> target.host_id then
    raise exception 'Only a website administrator can transfer the session host.';
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
  where membership.group_id = target.group_id
    and membership.user_id = any(p_participant_ids);

  if valid_participants <> requested_participants then
    raise exception 'Every participant must be an approved member of this group.';
  end if;

  perform set_config('cine_cord.marking_watched', 'true', true);

  update public.movie_sessions
  set status = 'WATCHED',
      host_id = p_host_id,
      watch_date = p_watched_on,
      watched_at = p_watched_on::timestamptz
  where id = p_session_id
  returning * into updated;

  delete from public.movie_session_participants
  where session_id = p_session_id;

  insert into public.movie_session_participants (
    session_id,
    profile_id,
    display_name_snapshot
  )
  select
    p_session_id,
    requested.id,
    coalesce(profile.display_name, 'Discordian')
  from unnest(p_participant_ids) with ordinality as requested(id, position)
  join public.profiles profile on profile.id = requested.id
  order by requested.position;

  if updated.selected_queue_item_id is not null then
    update public.queue_items
    set watched = true
    where id = updated.selected_queue_item_id
      and group_id = updated.group_id;
  end if;

  return updated;
end;
$$;

create or replace function public.mark_movie_session_watched(
  p_session_id uuid,
  p_watched_on date,
  p_host_id uuid,
  p_participant_ids uuid[]
)
returns public.movie_sessions
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.mark_movie_session_watched(
    p_session_id,
    p_watched_on,
    p_host_id,
    p_participant_ids
  );
$$;

-- ---------------------------------------------------------------- one real Journal entry per watched session
create or replace function public.save_movie_session_journal(
  p_session_id uuid,
  p_title text,
  p_release_year integer,
  p_status text,
  p_comment text,
  p_entry_number bigint default null
)
returns public.journal_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.movie_sessions;
  saved public.journal_entries;
  viewer_names text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to save a Journal entry.';
  end if;

  select * into target
  from public.movie_sessions
  where id = p_session_id;

  if target.id is null then
    raise exception 'That session does not exist, or you cannot view it.';
  end if;

  if target.status <> 'WATCHED' then
    raise exception 'The Journal becomes available after the film is marked watched.';
  end if;

  if not (
    target.host_id = (select auth.uid())
    or private.is_group_admin(target.group_id)
  ) then
    raise exception 'Only the session host or a website administrator can save this Journal entry.';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'Enter a Journal title.';
  end if;

  if upper(p_status) not in ('FINISHED', 'DNF') then
    raise exception 'Journal status must be Finished or DNF.';
  end if;

  if p_entry_number is not null and p_entry_number < 1 then
    raise exception 'Entry number must be positive.';
  end if;

  if not exists (
    select 1
    from public.movie_session_participants participant
    where participant.session_id = target.id
  ) then
    raise exception 'The watched session must have at least one participant.';
  end if;

  select string_agg(participant.display_name_snapshot, ', ' order by participant.added_at, participant.id)
  into viewer_names
  from public.movie_session_participants participant
  where participant.session_id = target.id;

  select * into saved
  from public.journal_entries
  where movie_session_id = p_session_id;

  if saved.id is null then
    if p_entry_number is null then
      insert into public.journal_entries (
        group_id,
        movie_session_id,
        title,
        release_year,
        watched_at,
        status,
        comment,
        created_by
      ) values (
        target.group_id,
        target.id,
        trim(p_title),
        p_release_year,
        target.watch_date,
        upper(p_status),
        nullif(trim(p_comment), ''),
        (select auth.uid())
      )
      returning * into saved;
    else
      insert into public.journal_entries (
        group_id,
        movie_session_id,
        entry_number,
        title,
        release_year,
        watched_at,
        status,
        comment,
        created_by
      ) values (
        target.group_id,
        target.id,
        p_entry_number,
        trim(p_title),
        p_release_year,
        target.watch_date,
        upper(p_status),
        nullif(trim(p_comment), ''),
        (select auth.uid())
      )
      returning * into saved;
    end if;
  else
    update public.journal_entries
    set entry_number = coalesce(p_entry_number, entry_number),
        title = trim(p_title),
        release_year = p_release_year,
        watched_at = target.watch_date,
        status = upper(p_status),
        comment = nullif(trim(p_comment), '')
    where id = saved.id
    returning * into saved;
  end if;

  delete from public.entry_viewers
  where entry_id = saved.id;

  insert into public.entry_viewers (entry_id, profile_id)
  select saved.id, participant.profile_id
  from public.movie_session_participants participant
  where participant.session_id = target.id
    and participant.profile_id is not null
  order by participant.added_at, participant.id;

  update public.movie_sessions
  set journal_draft = jsonb_build_object(
    'sessionId', target.id,
    'entryNumber', saved.entry_number::text,
    'title', saved.title,
    'year', coalesce(saved.release_year::text, ''),
    'viewerIds', coalesce((
      select jsonb_agg(participant.profile_id order by participant.added_at, participant.id)
      from public.movie_session_participants participant
      where participant.session_id = target.id
        and participant.profile_id is not null
    ), '[]'::jsonb),
    'viewers', coalesce(viewer_names, ''),
    'status', case when saved.status = 'DNF' then 'DNF' else 'Finished' end,
    'comment', coalesce(saved.comment, '')
  )
  where id = target.id;

  return saved;
end;
$$;

-- ---------------------------------------------------------------- viewing history
create or replace function public.group_watch_counts(p_group_id uuid)
returns table (
  queue_item_id uuid,
  tmdb_id bigint,
  title text,
  release_year integer,
  watch_count bigint,
  last_watched_on date
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
    count(*),
    max(session.watch_date)
  from public.movie_sessions session
  where session.group_id = p_group_id
    and session.status = 'WATCHED'
  group by 1, 2, 3, 4;
$$;

revoke all on function public.save_movie_session_details(uuid, date, uuid, uuid[]) from public, anon;
revoke all on function private.mark_movie_session_watched(uuid, date, uuid, uuid[]) from public, anon;
revoke all on function public.mark_movie_session_watched(uuid, date, uuid, uuid[]) from public, anon;
revoke all on function public.save_movie_session_journal(uuid, text, integer, text, text, bigint) from public, anon;
revoke all on function public.group_watch_counts(uuid) from public, anon;

grant execute on function public.save_movie_session_details(uuid, date, uuid, uuid[]) to authenticated;
grant execute on function private.mark_movie_session_watched(uuid, date, uuid, uuid[]) to authenticated;
grant execute on function public.mark_movie_session_watched(uuid, date, uuid, uuid[]) to authenticated;
grant execute on function public.save_movie_session_journal(uuid, text, integer, text, text, bigint) to authenticated;
grant execute on function public.group_watch_counts(uuid) to authenticated;

commit;
