begin;

-- A human can confirm cached TMDB candidates that were deliberately excluded
-- from automatic triage. The preview token fixes the exact candidate/viewers.
create function public.apply_archive_history_manual_approvals(
  p_group_id uuid,
  p_expected_token text,
  p_approved_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_preview jsonb;
  approved jsonb;
  requested_count integer;
  valid_count integer;
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can approve Journal matches.';
  end if;

  requested_count := pg_catalog.cardinality(coalesce(p_approved_ids, '{}'::uuid[]));
  if requested_count < 1 or requested_count > 100
    or pg_catalog.array_position(p_approved_ids, null) is not null
    or (select count(distinct id) from pg_catalog.unnest(coalesce(p_approved_ids, '{}'::uuid[])) as selected(id)) <> requested_count then
    raise exception 'Select one to 100 unique Journal entries to approve.';
  end if;

  current_preview := public.preview_archive_history_triage(p_group_id);
  if p_expected_token is null or p_expected_token <> current_preview ->> 'token' then
    raise exception 'The triage preview has changed. Preview again before saving.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(item.value), '[]'::jsonb)
  into approved
  from pg_catalog.jsonb_array_elements(current_preview -> 'proposals') as item(value)
  where (item.value ->> 'archive_entry_id')::uuid = any(p_approved_ids)
    and item.value ->> 'category' = 'MANUAL';

  if pg_catalog.jsonb_array_length(approved) <> requested_count then
    raise exception 'The selection contains an ineligible Journal entry. Preview again.';
  end if;

  select count(*) into valid_count
  from pg_catalog.jsonb_to_recordset(approved) as proposal(
    archive_entry_id uuid, tmdb_id bigint, movie_title text,
    movie_year integer, poster_path text, archive_year integer,
    viewer_keys text[]
  )
  join public.preview_archive_history_reconciliation(p_group_id) as history
    on history.archive_entry_id = proposal.archive_entry_id
  join public.archive_history_match_candidates candidate
    on candidate.archive_entry_id = proposal.archive_entry_id
    and candidate.candidate_rank = 1
    and candidate.tmdb_id = proposal.tmdb_id
  where history.review_decision is null
    and history.parser_status = 'PARSED'
    and history.watched_at is not null
    and history.archive_status in ('FINISHED', 'DNF')
    and history.release_year between 1888 and 2200
    and candidate.source = 'TMDB'
    and candidate.release_year between 1888 and 2200
    and pg_catalog.abs(candidate.release_year - history.release_year) <= 5
    and proposal.movie_title = candidate.title
    and proposal.movie_year = candidate.release_year
    and proposal.archive_year = history.release_year
    and proposal.poster_path = candidate.poster_path
    and pg_catalog.length(pg_catalog.btrim(candidate.poster_path)) > 0
    and pg_catalog.cardinality(proposal.viewer_keys) > 0
    and pg_catalog.cardinality(proposal.viewer_keys) = pg_catalog.cardinality(history.target_viewers)
    and not exists (
      select 1
      from pg_catalog.unnest(history.target_viewers) as viewer(name)
      where (case pg_catalog.lower(viewer.name)
        when 'cambo' then 'cambo'
        when 'deanshelton17' then 'dean'
        else null end) is null
        or not ((case pg_catalog.lower(viewer.name)
          when 'cambo' then 'cambo'
          when 'deanshelton17' then 'dean'
          else null end) = any(proposal.viewer_keys))
    )
    and not exists (
      select 1
      from pg_catalog.unnest(proposal.viewer_keys) as selected(viewer_key)
      where (
        select count(*)
        from public.group_memberships membership
        join public.profiles profile on profile.id = membership.user_id
        where membership.group_id = p_group_id
          and pg_catalog.lower(profile.display_name) = case selected.viewer_key
            when 'cambo' then 'cambo' when 'dean' then 'deanshelton17'
          end
      ) <> 1
    );

  if valid_count <> requested_count then
    raise exception 'One or more entries need individual review: check source, poster, year and current viewers.';
  end if;

  insert into public.movies (tmdb_id, title, release_year, poster_path, overview)
  select distinct on (row.tmdb_id)
    row.tmdb_id, row.movie_title, row.movie_year,
    pg_catalog.left(row.poster_path, 300), pg_catalog.left(row.overview, 4000)
  from pg_catalog.jsonb_to_recordset(approved) as row(
    tmdb_id bigint, movie_title text, movie_year integer, poster_path text, overview text
  )
  order by row.tmdb_id
  on conflict (tmdb_id) do nothing;

  insert into public.archive_history_reconciliation_reviews (
    archive_entry_id, movie_id, viewer_keys, decision, reviewed_by
  )
  select row.archive_entry_id, movie.id, row.viewer_keys, 'APPROVED', (select auth.uid())
  from pg_catalog.jsonb_to_recordset(approved) as row(
    archive_entry_id uuid, tmdb_id bigint, viewer_keys text[]
  )
  join public.movies movie on movie.tmdb_id = row.tmdb_id
  on conflict (archive_entry_id) do nothing;

  get diagnostics valid_count = row_count;
  if valid_count <> requested_count then
    raise exception 'The approvals changed while saving. No reviews were saved; preview again.';
  end if;

  return pg_catalog.jsonb_build_object('approvedCount', valid_count, 'eventsCreated', 0);
end;
$$;

revoke all on function public.apply_archive_history_manual_approvals(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.apply_archive_history_manual_approvals(uuid, text, uuid[])
  to authenticated;

commit;
