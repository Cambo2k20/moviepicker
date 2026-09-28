begin;

-- Cache ranked TMDB suggestions separately from immutable imported Discord rows.
-- A suggestion is never a private-history link until an administrator approves it.
create table public.archive_history_match_candidates (
  archive_entry_id uuid not null
    references public.journal_archive_entries(id) on delete cascade,
  tmdb_id bigint not null check (tmdb_id > 0),
  title text not null,
  release_year integer,
  poster_path text,
  overview text,
  score numeric(5,4) not null check (score >= 0 and score <= 1),
  title_score numeric(5,4) not null check (title_score >= 0 and title_score <= 1),
  year_delta integer,
  match_band text not null check (match_band in ('STRONG', 'REVIEW', 'AMBIGUOUS')),
  candidate_rank smallint not null check (candidate_rank > 0 and candidate_rank <= 10),
  search_query text not null,
  source text not null default 'TMDB' check (source in ('TMDB', 'ALIAS')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (archive_entry_id, tmdb_id)
);

create index archive_history_match_candidates_entry_rank_idx
  on public.archive_history_match_candidates (archive_entry_id, candidate_rank);

create trigger archive_history_match_candidates_set_updated_at
before update on public.archive_history_match_candidates
for each row execute function private.set_updated_at();

alter table public.archive_history_match_candidates enable row level security;
revoke all on table public.archive_history_match_candidates
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.archive_history_match_candidates
  to service_role;

create or replace function public.get_archive_history_match_candidates(
  p_group_id uuid,
  p_archive_entry_ids uuid[] default null
)
returns table (
  archive_entry_id uuid,
  tmdb_id bigint,
  title text,
  release_year integer,
  poster_path text,
  overview text,
  score numeric,
  title_score numeric,
  year_delta integer,
  match_band text,
  candidate_rank smallint,
  search_query text,
  source text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can view archive match candidates.';
  end if;

  return query
  select
    candidate.archive_entry_id,
    candidate.tmdb_id,
    candidate.title,
    candidate.release_year,
    candidate.poster_path,
    candidate.overview,
    candidate.score,
    candidate.title_score,
    candidate.year_delta,
    candidate.match_band,
    candidate.candidate_rank,
    candidate.search_query,
    candidate.source,
    candidate.updated_at
  from public.archive_history_match_candidates candidate
  join public.journal_archive_entries entry
    on entry.id = candidate.archive_entry_id
   and entry.group_id = p_group_id
  where p_archive_entry_ids is null
     or candidate.archive_entry_id = any(p_archive_entry_ids)
  order by candidate.archive_entry_id, candidate.candidate_rank;
end;
$$;

revoke all on function public.get_archive_history_match_candidates(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_archive_history_match_candidates(uuid, uuid[])
  to authenticated;

commit;
