begin;

-- The exact preview is also the authority for review decisions and sync state.
-- Only rows it could not match need the more expensive fuzzy pass.
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
  match_reason text,
  review_decision text,
  reviewed_movie_id uuid,
  reviewed_viewer_keys text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as materialized (
    select * from public.preview_archive_history_reconciliation_exact(p_group_id)
  ),
  unresolved as materialized (
    select
      base.archive_entry_id as id,
      base.release_year,
      private.normalise_archive_title(base.title) as title_key
    from base
    where base.match_status = 'NO_CANONICAL_MOVIE'
      and base.release_year is not null
  ),
  canonical as materialized (
    select
      movie.id,
      movie.title,
      movie.release_year,
      private.normalise_archive_title(movie.title) as title_key,
      private.normalise_archive_title(movie.original_title) as original_title_key
    from public.movies movie
    where movie.release_year is not null
  ),
  candidate_matches as (
    select
      entry.id,
      movie.id as movie_id,
      movie.title as canonical_title,
      pg_catalog.abs(movie.release_year - entry.release_year)::integer as year_delta,
      scored.exact_title,
      scored.title_score
    from unresolved entry
    join canonical movie
      on pg_catalog.abs(movie.release_year - entry.release_year) <= 5
    cross join lateral (
      select
        greatest(
          coalesce(extensions.similarity(movie.title_key, entry.title_key), 0::real),
          coalesce(extensions.similarity(movie.original_title_key, entry.title_key), 0::real)
        ) as title_score,
        coalesce(
          movie.title_key = entry.title_key
          or movie.original_title_key = entry.title_key,
          false
        ) as exact_title
    ) scored
    where scored.exact_title
      or scored.title_score >= 0.45
  ),
  candidate_summary as (
    select
      candidates.id,
      pg_catalog.count(*)::integer as candidate_count,
      (pg_catalog.array_agg(candidates.movie_id order by candidates.exact_title desc, candidates.title_score desc, candidates.year_delta asc, candidates.movie_id))[1] as movie_id,
      (pg_catalog.array_agg(candidates.canonical_title order by candidates.exact_title desc, candidates.title_score desc, candidates.year_delta asc, candidates.movie_id))[1] as canonical_title
    from candidate_matches candidates
    group by candidates.id
  )
  select
    base.archive_entry_id,
    base.entry_label,
    base.title,
    base.release_year,
    base.watched_at,
    base.archive_status,
    base.parser_status,
    base.viewer_names,
    base.target_viewers,
    base.already_synced_viewers,
    case
      when candidates.id is not null then candidates.movie_id
      else base.movie_id
    end,
    case
      when candidates.id is not null then candidates.canonical_title
      else base.canonical_title
    end,
    case
      when candidates.id is not null then candidates.candidate_count
      else base.candidate_count
    end,
    case
      when candidates.candidate_count > 1 then 'AMBIGUOUS_MOVIE'
      when candidates.id is not null then 'NEEDS_REVIEW'
      else base.match_status
    end,
    case
      when candidates.candidate_count > 1 then 'Several similar canonical movies were found within five years; the closest match is shown for review.'
      when candidates.id is not null then 'A close title match was found within five years; review the selected film before syncing.'
      else base.match_reason
    end,
    base.review_decision,
    base.reviewed_movie_id,
    base.reviewed_viewer_keys
  from base
  left join candidate_summary candidates
    on candidates.id = base.archive_entry_id;
$$;

revoke all on function public.preview_archive_history_reconciliation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_archive_history_reconciliation(uuid)
  to authenticated;

commit;
