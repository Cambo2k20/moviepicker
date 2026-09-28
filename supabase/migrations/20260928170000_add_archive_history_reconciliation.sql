begin;

-- Historical Discord names are evidence for a private history event only when
-- they resolve to one of the two current Cine-Cord accounts. The archive itself
-- stays immutable and shared; this helper only normalises matching keys.
create or replace function private.normalise_archive_title(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.lower(p_value), '[^a-z0-9]+', '', 'g');
$$;

revoke all on function private.normalise_archive_title(text)
  from public, anon, authenticated, service_role;

create or replace function public.preview_archive_history_reconciliation(
  p_group_id uuid
)
returns table (
  archive_entry_id uuid,
  entry_label text,
  title text,
  release_year integer,
  watched_at date,
  archive_status text,
  parser_status text,
  viewer_names text[],
  target_viewers text[],
  already_synced_viewers text[],
  movie_id uuid,
  canonical_title text,
  candidate_count integer,
  match_status text,
  match_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can reconcile Journal history.';
  end if;

  return query
  with archive as (
    select
      entry.id,
      entry.entry_label,
      entry.title,
      entry.release_year,
      entry.watched_at,
      entry.status,
      entry.parser_status,
      entry.viewer_names
    from public.journal_archive_entries entry
    where entry.group_id = p_group_id
  ),
  target_profiles as (
    select
      membership.user_id as owner_id,
      case pg_catalog.lower(profile.display_name)
        when 'cambo' then 'cambo'
        when 'deanshelton17' then 'dean'
      end as viewer_key,
      profile.display_name
    from public.group_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.group_id = p_group_id
      and pg_catalog.lower(profile.display_name) in ('cambo', 'deanshelton17')
  ),
  archive_viewer_keys as (
    select distinct
      entry.id,
      case
        when token.token in ('cambo', 'camebo', 'cameron') then 'cambo'
        when token.token = 'dean' then 'dean'
      end as viewer_key,
      viewer_name
    from archive entry
    cross join lateral pg_catalog.unnest(entry.viewer_names) as names(viewer_name)
    cross join lateral pg_catalog.regexp_split_to_table(
      pg_catalog.lower(names.viewer_name), '[^a-z0-9]+'
    ) as token(token)
    where token.token in ('cambo', 'camebo', 'cameron', 'dean')
  ),
  archive_viewers as (
    select
      entry.id,
      coalesce(
        pg_catalog.array_agg(distinct profile.display_name order by profile.display_name)
          filter (where profile.owner_id is not null),
        '{}'::text[]
      ) as target_viewers,
      coalesce(
        pg_catalog.array_agg(distinct event.owner_id::text order by event.owner_id::text)
          filter (where event.id is not null),
        '{}'::text[]
      ) as synced_owner_ids,
      count(distinct keys.viewer_key)::integer as confirmed_viewer_count,
      count(distinct profile.viewer_key)::integer as resolved_viewer_count
    from archive entry
    left join archive_viewer_keys keys on keys.id = entry.id
    left join target_profiles profile on profile.viewer_key = keys.viewer_key
    left join public.personal_viewing_events event
      on event.source_archive_entry_id = entry.id
      and event.owner_id = profile.owner_id
    group by entry.id
  ),
  archive_synced_names as (
    select
      entry.id,
      coalesce(
        pg_catalog.array_agg(distinct profile.display_name order by profile.display_name)
          filter (where event.id is not null),
        '{}'::text[]
      ) as already_synced_viewers
    from archive entry
    left join archive_viewer_keys keys on keys.id = entry.id
    left join target_profiles profile on profile.viewer_key = keys.viewer_key
    left join public.personal_viewing_events event
      on event.source_archive_entry_id = entry.id
      and event.owner_id = profile.owner_id
    group by entry.id
  ),
  candidate_summary as (
    select
      entry.id,
      count(movie.id)::integer as candidate_count,
      (pg_catalog.array_agg(movie.id order by movie.id) filter (where movie.id is not null))[1] as movie_id,
      (pg_catalog.array_agg(movie.title order by movie.id) filter (where movie.id is not null))[1] as canonical_title
    from archive entry
    left join public.movies movie
      on movie.release_year = entry.release_year
      and (
        private.normalise_archive_title(movie.title) = private.normalise_archive_title(entry.title)
        or private.normalise_archive_title(movie.original_title) = private.normalise_archive_title(entry.title)
      )
    group by entry.id
  )
  select
    entry.id,
    entry.entry_label,
    entry.title,
    entry.release_year,
    entry.watched_at,
    entry.status,
    entry.parser_status,
    entry.viewer_names,
    viewers.target_viewers,
    synced.already_synced_viewers,
    candidates.movie_id,
    candidates.canonical_title,
    candidates.candidate_count,
    case
      when viewers.confirmed_viewer_count = 0 then 'NO_CONFIRMED_VIEWER'
      when viewers.resolved_viewer_count < viewers.confirmed_viewer_count then 'MISSING_TARGET_PROFILE'
      when entry.parser_status = 'REVIEW'
        or entry.release_year is null
        or entry.watched_at is null
        or entry.status not in ('FINISHED', 'DNF') then 'NEEDS_REVIEW'
      when candidates.candidate_count = 0 then 'NO_CANONICAL_MOVIE'
      when candidates.candidate_count > 1 then 'AMBIGUOUS_MOVIE'
      when pg_catalog.cardinality(synced.already_synced_viewers) = viewers.resolved_viewer_count then 'ALREADY_SYNCED'
      else 'READY'
    end,
    case
      when viewers.confirmed_viewer_count = 0 then 'No Cambo or Dean viewer name was recognised.'
      when viewers.resolved_viewer_count < viewers.confirmed_viewer_count then 'A recognised viewer name has no matching current account.'
      when entry.parser_status = 'REVIEW' then 'The Discord parser flagged this entry for review.'
      when entry.release_year is null then 'The release year is missing.'
      when entry.watched_at is null then 'The watch date is missing.'
      when entry.status not in ('FINISHED', 'DNF') then 'The watch outcome is not confirmed.'
      when candidates.candidate_count = 0 then 'No canonical movie has the same title and release year.'
      when candidates.candidate_count > 1 then 'More than one canonical movie has the same title and release year.'
      when pg_catalog.cardinality(synced.already_synced_viewers) = viewers.resolved_viewer_count then 'Private history already exists for every resolved viewer.'
      else 'Exact title and year match; private history can be created.'
    end
  from archive entry
  join archive_viewers viewers on viewers.id = entry.id
  join archive_synced_names synced on synced.id = entry.id
  join candidate_summary candidates on candidates.id = entry.id
  order by entry.entry_label desc, entry.id;
end;
$$;

revoke all on function public.preview_archive_history_reconciliation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_archive_history_reconciliation(uuid)
  to authenticated;

create or replace function public.apply_archive_history_reconciliation(
  p_group_id uuid,
  p_archive_entry_ids uuid[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate record;
  target record;
  event_was_present boolean;
  events_created integer := 0;
  events_already_present integer := 0;
  entries_applied integer := 0;
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can reconcile Journal history.';
  end if;

  for candidate in
    select preview.*
    from public.preview_archive_history_reconciliation(p_group_id) preview
    where preview.match_status = 'READY'
      and (
        p_archive_entry_ids is null
        or preview.archive_entry_id = any(p_archive_entry_ids)
      )
  loop
    entries_applied := entries_applied + 1;

    for target in
      select
        membership.user_id as owner_id,
        pg_catalog.lower(profile.display_name) as account_key
      from public.group_memberships membership
      join public.profiles profile on profile.id = membership.user_id
      where membership.group_id = p_group_id
        and pg_catalog.lower(profile.display_name) in ('cambo', 'deanshelton17')
        and exists (
          select 1
          from pg_catalog.unnest(candidate.viewer_names) as names(viewer_name)
          cross join lateral pg_catalog.regexp_split_to_table(
            pg_catalog.lower(names.viewer_name), '[^a-z0-9]+'
          ) as token(token)
          where (
            pg_catalog.lower(profile.display_name) = 'cambo'
            and token.token in ('cambo', 'camebo', 'cameron')
          )
          or (
            pg_catalog.lower(profile.display_name) = 'deanshelton17'
            and token.token = 'dean'
          )
        )
    loop
      select exists (
        select 1
        from public.personal_viewing_events event
        where event.owner_id = target.owner_id
          and event.source_archive_entry_id = candidate.archive_entry_id
      ) into event_was_present;

      insert into public.personal_viewing_events (
        owner_id,
        movie_id,
        outcome,
        watched_on,
        source_archive_entry_id
      ) values (
        target.owner_id,
        candidate.movie_id,
        case when candidate.archive_status = 'DNF' then 'DID_NOT_FINISH' else 'FINISHED' end,
        candidate.watched_at,
        candidate.archive_entry_id
      )
      on conflict (owner_id, source_archive_entry_id)
        where source_archive_entry_id is not null
      do update set
        movie_id = excluded.movie_id,
        outcome = excluded.outcome,
        watched_on = excluded.watched_on;

      if event_was_present then
        events_already_present := events_already_present + 1;
      else
        events_created := events_created + 1;
      end if;
    end loop;
  end loop;

  return pg_catalog.jsonb_build_object(
    'entries_applied', entries_applied,
    'events_created', events_created,
    'events_already_present', events_already_present,
    'events_total', events_created + events_already_present
  );
end;
$$;

revoke all on function public.apply_archive_history_reconciliation(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.apply_archive_history_reconciliation(uuid, uuid[])
  to authenticated;

commit;
