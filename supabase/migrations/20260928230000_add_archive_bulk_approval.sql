begin;

-- Proposals are derived afresh from the immutable archive, existing reviews,
-- and server-written TMDB suggestions. Nothing here changes viewing history.
create function private.archive_history_bulk_proposals(p_group_id uuid)
returns table (
  archive_entry_id uuid,
  entry_label text,
  archive_title text,
  archive_year integer,
  tmdb_id bigint,
  movie_title text,
  movie_year integer,
  poster_path text,
  overview text,
  viewer_keys text[],
  source text
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
      and row.parser_status = 'PARSED'
      and row.watched_at is not null
      and row.release_year between 1888 and 2200
      and row.archive_status in ('FINISHED', 'DNF')
      and pg_catalog.cardinality(row.target_viewers) > 0
      and pg_catalog.cardinality(row.already_synced_viewers) = 0
  ),
  approved_identity as (
    select
      private.normalise_archive_title(entry.title) as normalised_title,
      entry.release_year,
      count(distinct movie.tmdb_id) as identity_count,
      (pg_catalog.array_agg(movie.tmdb_id order by movie.tmdb_id))[1] as tmdb_id,
      (pg_catalog.array_agg(movie.title order by movie.tmdb_id))[1] as movie_title,
      (pg_catalog.array_agg(movie.release_year order by movie.tmdb_id))[1] as movie_year,
      (pg_catalog.array_agg(movie.poster_path order by movie.tmdb_id))[1] as poster_path,
      (pg_catalog.array_agg(movie.overview order by movie.tmdb_id))[1] as overview
    from public.archive_history_reconciliation_reviews review
    join public.journal_archive_entries entry on entry.id = review.archive_entry_id
      and entry.group_id = p_group_id
    join public.movies movie on movie.id = review.movie_id
    where review.decision = 'APPROVED'
      and entry.release_year is not null
    group by private.normalise_archive_title(entry.title), entry.release_year
  ),
  choices as (
    select
      row.*,
      identity.identity_count,
      identity.tmdb_id as approved_tmdb_id,
      identity.movie_title as approved_title,
      identity.movie_year as approved_year,
      identity.poster_path as approved_poster_path,
      identity.overview as approved_overview,
      candidate.tmdb_id as candidate_tmdb_id,
      candidate.title as candidate_title,
      candidate.release_year as candidate_year,
      candidate.poster_path as candidate_poster_path,
      candidate.overview as candidate_overview,
      candidate.score as candidate_score,
      candidate.title_score,
      candidate.year_delta,
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
    left join approved_identity identity
      on identity.normalised_title = private.normalise_archive_title(row.title)
      and identity.release_year = row.release_year
    left join public.archive_history_match_candidates candidate
      on candidate.archive_entry_id = row.archive_entry_id
      and candidate.candidate_rank = 1
  )
  select
    choice.archive_entry_id,
    choice.entry_label,
    choice.title,
    choice.release_year,
    coalesce(choice.approved_tmdb_id, choice.candidate_tmdb_id),
    coalesce(choice.approved_title, choice.candidate_title),
    coalesce(choice.approved_year, choice.candidate_year),
    coalesce(choice.approved_poster_path, choice.candidate_poster_path),
    coalesce(choice.approved_overview, choice.candidate_overview),
    choice.selected_viewer_keys,
    case when choice.approved_tmdb_id is not null then 'EXISTING_REVIEW' else 'TMDB_EXACT' end
  from choices choice
  where pg_catalog.cardinality(choice.selected_viewer_keys) = pg_catalog.cardinality(choice.target_viewers)
    and not exists (
      select 1
      from pg_catalog.unnest(choice.selected_viewer_keys) as selected(viewer_key)
      where (
        select count(*)
        from public.group_memberships membership
        join public.profiles profile on profile.id = membership.user_id
        where membership.group_id = p_group_id
          and pg_catalog.lower(profile.display_name) = case selected.viewer_key
            when 'cambo' then 'cambo'
            when 'dean' then 'deanshelton17'
          end
      ) <> 1
    )
    and choice.candidate_count <= 1
    and (choice.identity_count is null or choice.identity_count = 1)
    and (choice.movie_id is null or exists (
      select 1 from public.movies existing
      where existing.id = choice.movie_id
        and existing.tmdb_id = coalesce(choice.approved_tmdb_id, choice.candidate_tmdb_id)
    ))
    and (
      (
        choice.approved_tmdb_id is not null
        and (choice.candidate_tmdb_id is null or choice.candidate_tmdb_id = choice.approved_tmdb_id)
      )
      or (
        choice.approved_tmdb_id is null
        and choice.candidate_source = 'TMDB'
        and choice.candidate_score = 1
        and choice.title_score = 1
        and choice.year_delta = 0
        and choice.candidate_year = choice.release_year
        and pg_catalog.length(choice.candidate_title) <= 200
        and private.normalise_archive_title(choice.candidate_title) = private.normalise_archive_title(choice.title)
        and not exists (
          select 1
          from public.archive_history_match_candidates alternative
          where alternative.archive_entry_id = choice.archive_entry_id
            and alternative.tmdb_id <> choice.candidate_tmdb_id
            and alternative.score >= choice.candidate_score - 0.15
        )
      )
    )
  order by choice.archive_entry_id;
$$;

revoke all on function private.archive_history_bulk_proposals(uuid)
  from public, anon, authenticated, service_role;

create function public.preview_archive_history_bulk_approval(p_group_id uuid)
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
    raise exception 'Only a group administrator can preview bulk Journal approval.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(proposal) order by proposal.archive_entry_id), '[]'::jsonb)
  into proposals
  from private.archive_history_bulk_proposals(p_group_id) proposal;

  return pg_catalog.jsonb_build_object(
    'eligibleCount', pg_catalog.jsonb_array_length(proposals),
    'reusedCount', (select count(*) from pg_catalog.jsonb_array_elements(proposals) as item(value)
      where item.value ->> 'source' = 'EXISTING_REVIEW'),
    'tmdbCount', (select count(*) from pg_catalog.jsonb_array_elements(proposals) as item(value)
      where item.value ->> 'source' = 'TMDB_EXACT'),
    'token', pg_catalog.md5(proposals::text),
    'proposals', proposals
  );
end;
$$;

revoke all on function public.preview_archive_history_bulk_approval(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_archive_history_bulk_approval(uuid)
  to authenticated;

create function public.apply_archive_history_bulk_approval(
  p_group_id uuid,
  p_expected_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposals jsonb;
  expected_count integer;
  inserted_count integer;
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can approve bulk Journal matches.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(proposal) order by proposal.archive_entry_id), '[]'::jsonb)
  into proposals
  from private.archive_history_bulk_proposals(p_group_id) proposal;

  expected_count := pg_catalog.jsonb_array_length(proposals);
  if expected_count = 0 then
    raise exception 'There are no clear matches to approve.';
  end if;
  if p_expected_token is null or p_expected_token <> pg_catalog.md5(proposals::text) then
    raise exception 'The bulk preview has changed. Preview the matches again before approving.';
  end if;

  insert into public.movies (tmdb_id, title, release_year, poster_path, overview)
  select distinct on (proposal.tmdb_id)
    proposal.tmdb_id,
    proposal.movie_title,
    proposal.movie_year,
    pg_catalog.left(proposal.poster_path, 300),
    pg_catalog.left(proposal.overview, 4000)
  from pg_catalog.jsonb_to_recordset(proposals) as proposal(
    tmdb_id bigint, movie_title text, movie_year integer,
    poster_path text, overview text
  )
  order by proposal.tmdb_id
  on conflict (tmdb_id) do nothing;

  insert into public.archive_history_reconciliation_reviews (
    archive_entry_id, movie_id, viewer_keys, decision, reviewed_by
  )
  select proposal.archive_entry_id, movie.id, proposal.viewer_keys, 'APPROVED', (select auth.uid())
  from pg_catalog.jsonb_to_recordset(proposals) as proposal(
    archive_entry_id uuid, tmdb_id bigint, viewer_keys text[]
  )
  join public.movies movie on movie.tmdb_id = proposal.tmdb_id
  on conflict (archive_entry_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count <> expected_count then
    raise exception 'The bulk approval changed while saving. No reviews were saved; preview again.';
  end if;

  return pg_catalog.jsonb_build_object('approvedCount', inserted_count, 'eventsCreated', 0);
end;
$$;

revoke all on function public.apply_archive_history_bulk_approval(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_archive_history_bulk_approval(uuid, text)
  to authenticated;

commit;
