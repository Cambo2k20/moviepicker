-- Rollback for 20260824103055_harden_journal_entry_numbering.
--
-- Restores public.save_movie_session_journal exactly as 20260823214112 defined
-- it and drops the sequence helper.
--
-- Destructive effects:
-- - The entry_number identity sequence is NOT moved back. That is deliberate:
--   rewinding it would reintroduce the collision this migration fixed. The only
--   visible consequence is that automatically assigned numbers continue from
--   where the sequence now stands.
-- - Explicitly numbered entries stop advancing the sequence again, so the
--   original duplicate-key failure becomes possible once more.

begin;

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

revoke all on function public.save_movie_session_journal(uuid, text, integer, text, text, bigint) from public, anon;
grant execute on function public.save_movie_session_journal(uuid, text, integer, text, text, bigint) to authenticated;

drop function if exists private.sync_journal_entry_number_sequence();

commit;
