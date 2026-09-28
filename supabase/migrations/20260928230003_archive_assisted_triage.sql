begin;

create function private.archive_history_triage_proposals(p_group_id uuid)
returns table (
  archive_entry_id uuid,
  entry_label text,
  archive_title text,
  archive_year integer,
  match_status text,
  match_reason text,
  viewer_keys text[],
  tmdb_id bigint,
  movie_title text,
  movie_year integer,
  poster_path text,
  overview text,
  match_score numeric,
  title_score numeric,
  year_delta integer,
  category text,
  can_approve boolean
)
language sql
stable
set search_path = ''
as $$
  with preview as (
    select row.*
    from public.preview_archive_history_reconciliation(p_group_id) row
    where row.review_decision is null
      and row.match_status in ('NEEDS_REVIEW', 'NO_CANONICAL_MOVIE', 'AMBIGUOUS_MOVIE')
  ), choices as (
    select
      row.*,
      candidate.tmdb_id as candidate_tmdb_id,
      candidate.title as candidate_title,
      candidate.release_year as candidate_year,
      candidate.poster_path as candidate_poster_path,
      candidate.overview as candidate_overview,
      candidate.score as candidate_score,
      candidate.title_score as candidate_title_score,
      candidate.year_delta as candidate_year_delta,
      candidate.source as candidate_source,
      pg_catalog.array_remove(array[
        case when exists (
          select 1 from pg_catalog.unnest(row.target_viewers) as viewer(name)
          where pg_catalog.lower(viewer.name) = 'cambo'
        ) then 'cambo' end,
        case when exists (
          select 1 from pg_catalog.unnest(row.target_viewers) as viewer(name)
          where pg_catalog.lower(viewer.name) = 'deanshelton17'
        ) then 'dean' end
      ]::text[], null) as selected_viewer_keys
    from preview row
    left join public.archive_history_match_candidates candidate
      on candidate.archive_entry_id = row.archive_entry_id
      and candidate.candidate_rank = 1
  ), ranked as (
    select
      choice.*,
      (
        choice.parser_status = 'PARSED'
        and choice.watched_at is not null
        and choice.archive_status in ('FINISHED', 'DNF')
        and choice.release_year between 1888 and 2200
        and choice.candidate_tmdb_id is not null
        and choice.candidate_source = 'TMDB'
        and choice.candidate_year is not null
        and choice.candidate_score >= 0.75
        and choice.candidate_title_score >= 0.70
        and choice.candidate_year_delta between 0 and 5
        and choice.candidate_year_delta = pg_catalog.abs(choice.candidate_year - choice.release_year)
        and choice.candidate_count <= 1
        and pg_catalog.cardinality(choice.selected_viewer_keys) > 0
        and pg_catalog.cardinality(choice.selected_viewer_keys) = pg_catalog.cardinality(choice.target_viewers)
        and (choice.movie_id is null or exists (
          select 1 from public.movies movie
          where movie.id = choice.movie_id and movie.tmdb_id = choice.candidate_tmdb_id
        ))
        and not exists (
          select 1 from public.archive_history_match_candidates alternative
          where alternative.archive_entry_id = choice.archive_entry_id
            and alternative.tmdb_id <> choice.candidate_tmdb_id
            and alternative.score >= choice.candidate_score - 0.12
        )
        and not exists (
          select 1 from pg_catalog.unnest(choice.selected_viewer_keys) as selected(viewer_key)
          where (
            select count(*)
            from public.group_memberships membership
            join public.profiles profile on profile.id = membership.user_id
            where membership.group_id = p_group_id
              and pg_catalog.lower(profile.display_name) = case selected.viewer_key
                when 'cambo' then 'cambo' when 'dean' then 'deanshelton17'
              end
          ) <> 1
        )
      ) as eligible
    from choices choice
  )
  select
    row.archive_entry_id,
    row.entry_label,
    row.title,
    row.release_year,
    row.match_status,
    row.match_reason,
    row.selected_viewer_keys,
    row.candidate_tmdb_id,
    row.candidate_title,
    row.candidate_year,
    row.candidate_poster_path,
    row.candidate_overview,
    row.candidate_score,
    row.candidate_title_score,
    row.candidate_year_delta,
    case when row.eligible then 'SUGGESTED'
      when row.candidate_tmdb_id is not null then 'MANUAL'
      else 'NO_CANDIDATE' end,
    row.eligible
  from ranked row
  order by row.archive_entry_id;
$$;

revoke all on function private.archive_history_triage_proposals(uuid)
  from public, anon, authenticated, service_role;

create function public.preview_archive_history_triage(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  proposals jsonb;
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can preview Journal triage.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row) order by
    case row.category when 'SUGGESTED' then 0 when 'NO_CANDIDATE' then 1 else 2 end,
    row.match_score desc nulls last,
    row.archive_entry_id), '[]'::jsonb)
  into proposals
  from private.archive_history_triage_proposals(p_group_id) row;

  return pg_catalog.jsonb_build_object(
    'token', pg_catalog.md5(proposals::text),
    'proposals', proposals,
    'suggestedCount', (select count(*) from pg_catalog.jsonb_array_elements(proposals) as item(value)
      where item.value ->> 'category' = 'SUGGESTED'),
    'noCandidateCount', (select count(*) from pg_catalog.jsonb_array_elements(proposals) as item(value)
      where item.value ->> 'category' = 'NO_CANDIDATE'),
    'manualCount', (select count(*) from pg_catalog.jsonb_array_elements(proposals) as item(value)
      where item.value ->> 'category' = 'MANUAL')
  );
end;
$$;

revoke all on function public.preview_archive_history_triage(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_archive_history_triage(uuid)
  to authenticated;

create function public.apply_archive_history_triage(
  p_group_id uuid,
  p_expected_token text,
  p_approved_ids uuid[] default '{}'::uuid[],
  p_skipped_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_preview jsonb;
  proposals jsonb;
  approved jsonb;
  skipped jsonb;
  approved_count integer;
  skipped_count integer;
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can save Journal triage.';
  end if;

  approved_count := pg_catalog.cardinality(coalesce(p_approved_ids, '{}'::uuid[]));
  skipped_count := pg_catalog.cardinality(coalesce(p_skipped_ids, '{}'::uuid[]));
  if approved_count + skipped_count = 0 or approved_count + skipped_count > 100
    or pg_catalog.array_position(p_approved_ids, null) is not null
    or pg_catalog.array_position(p_skipped_ids, null) is not null
    or (select count(distinct id) from pg_catalog.unnest(coalesce(p_approved_ids, '{}'::uuid[]) || coalesce(p_skipped_ids, '{}'::uuid[])) as selected(id))
      <> approved_count + skipped_count then
    raise exception 'Select one to 100 unique Journal entries to review.';
  end if;

  current_preview := public.preview_archive_history_triage(p_group_id);
  if p_expected_token is null or p_expected_token <> current_preview ->> 'token' then
    raise exception 'The triage preview has changed. Preview again before saving.';
  end if;
  proposals := current_preview -> 'proposals';

  select coalesce(pg_catalog.jsonb_agg(item.value), '[]'::jsonb)
  into approved
  from pg_catalog.jsonb_array_elements(proposals) as item(value)
  where (item.value ->> 'archive_entry_id')::uuid = any(p_approved_ids)
    and item.value ->> 'category' = 'SUGGESTED'
    and item.value ->> 'can_approve' = 'true';

  select coalesce(pg_catalog.jsonb_agg(item.value), '[]'::jsonb)
  into skipped
  from pg_catalog.jsonb_array_elements(proposals) as item(value)
  where (item.value ->> 'archive_entry_id')::uuid = any(p_skipped_ids);

  if pg_catalog.jsonb_array_length(approved) <> approved_count
    or pg_catalog.jsonb_array_length(skipped) <> skipped_count then
    raise exception 'The selection contains an ineligible Journal entry. Preview again.';
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

  get diagnostics approved_count = row_count;
  if approved_count <> pg_catalog.jsonb_array_length(approved) then
    raise exception 'The approvals changed while saving. No reviews were saved; preview again.';
  end if;

  insert into public.archive_history_reconciliation_reviews (
    archive_entry_id, movie_id, viewer_keys, decision, reviewed_by
  )
  select row.archive_entry_id, null, '{}'::text[], 'SKIPPED', (select auth.uid())
  from pg_catalog.jsonb_to_recordset(skipped) as row(archive_entry_id uuid)
  on conflict (archive_entry_id) do nothing;

  get diagnostics skipped_count = row_count;
  if skipped_count <> pg_catalog.jsonb_array_length(skipped) then
    raise exception 'The skips changed while saving. No reviews were saved; preview again.';
  end if;

  return pg_catalog.jsonb_build_object(
    'approvedCount', approved_count,
    'skippedCount', skipped_count,
    'eventsCreated', 0
  );
end;
$$;

revoke all on function public.apply_archive_history_triage(uuid, text, uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.apply_archive_history_triage(uuid, text, uuid[], uuid[])
  to authenticated;

commit;
