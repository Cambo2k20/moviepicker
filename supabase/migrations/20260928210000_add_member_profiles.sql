begin;

alter table public.movies
  add column backdrop_path text
  check (backdrop_path is null or char_length(backdrop_path) <= 300);

-- Member Profiles deliberately separate private editing from the group-visible
-- snapshot. A profile can only feature canonical films already in its owner's
-- private My Cinema, and the published rows never expose the private source row.
create table public.member_profile_drafts (
  group_id uuid not null references public.groups(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  introduction text not null default '' check (char_length(introduction) <= 160),
  banner_movie_id uuid references public.movies(id) on delete set null,
  include_recent_watches boolean not null default false,
  include_genre_breakdown boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, owner_id)
);

create table public.member_profile_draft_films (
  group_id uuid not null,
  owner_id uuid not null,
  slot smallint not null check (slot between 1 and 5),
  movie_id uuid not null references public.movies(id) on delete restrict,
  primary key (group_id, owner_id, slot),
  unique (group_id, owner_id, movie_id),
  foreign key (group_id, owner_id)
    references public.member_profile_drafts(group_id, owner_id)
    on delete cascade
);

create table public.member_profile_publications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  introduction text not null default '' check (char_length(introduction) <= 160),
  banner_movie_id uuid references public.movies(id) on delete set null,
  banner_title text check (banner_title is null or char_length(trim(banner_title)) between 1 and 200),
  banner_backdrop_path text check (banner_backdrop_path is null or char_length(banner_backdrop_path) <= 300),
  banner_poster_path text check (banner_poster_path is null or char_length(banner_poster_path) <= 300),
  films_watched_count integer not null default 0 check (films_watched_count >= 0),
  sessions_attended_count integer not null default 0 check (sessions_attended_count >= 0),
  average_rating numeric(3, 2) check (average_rating is null or average_rating between 1 and 5),
  completion_rate numeric(5, 2) check (completion_rate is null or completion_rate between 0 and 100),
  include_recent_watches boolean not null default false,
  include_genre_breakdown boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, owner_id)
);

create table public.member_profile_publication_films (
  publication_id uuid not null references public.member_profile_publications(id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  movie_id uuid not null references public.movies(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  release_year integer check (release_year is null or release_year between 1888 and 2200),
  tmdb_id bigint not null check (tmdb_id > 0),
  poster_path text,
  rating smallint check (rating is null or rating between 1 and 5),
  primary key (publication_id, slot),
  unique (publication_id, movie_id)
);

create table public.member_profile_publication_recent_watches (
  publication_id uuid not null references public.member_profile_publications(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  movie_id uuid not null references public.movies(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  release_year integer check (release_year is null or release_year between 1888 and 2200),
  tmdb_id bigint not null check (tmdb_id > 0),
  poster_path text,
  watched_on date,
  outcome text not null check (outcome in ('FINISHED', 'DID_NOT_FINISH')),
  rating smallint check (rating is null or rating between 1 and 5),
  session_label text check (session_label is null or char_length(trim(session_label)) between 1 and 100),
  primary key (publication_id, position)
);

create table public.member_profile_publication_genres (
  publication_id uuid not null references public.member_profile_publications(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  genre text not null check (char_length(trim(genre)) between 1 and 60),
  watch_count integer not null check (watch_count > 0),
  primary key (publication_id, position),
  unique (publication_id, genre)
);

create index member_profile_publications_group_idx
  on public.member_profile_publications (group_id, published_at desc);

create trigger member_profile_drafts_set_updated_at
before update on public.member_profile_drafts
for each row execute function private.set_updated_at();

create trigger member_profile_publications_set_updated_at
before update on public.member_profile_publications
for each row execute function private.set_updated_at();

alter table public.member_profile_drafts enable row level security;
alter table public.member_profile_draft_films enable row level security;
alter table public.member_profile_publications enable row level security;
alter table public.member_profile_publication_films enable row level security;
alter table public.member_profile_publication_recent_watches enable row level security;
alter table public.member_profile_publication_genres enable row level security;

create policy member_profile_drafts_select_owner
on public.member_profile_drafts for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.is_group_member(group_id))
);

create policy member_profile_draft_films_select_owner
on public.member_profile_draft_films for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.is_group_member(group_id))
);

-- Published rows are returned through get_member_profiles(), which applies the
-- group check before returning the deliberately small public snapshot.
revoke all on table public.member_profile_drafts,
  public.member_profile_draft_films,
  public.member_profile_publications,
  public.member_profile_publication_films,
  public.member_profile_publication_recent_watches,
  public.member_profile_publication_genres
  from public, anon, authenticated, service_role;
grant select on table public.member_profile_drafts,
  public.member_profile_draft_films
  to authenticated;

create or replace function public.save_member_profile_draft(
  p_group_id uuid,
  p_introduction text,
  p_movie_ids uuid[],
  p_banner_movie_id uuid,
  p_include_recent_watches boolean,
  p_include_genre_breakdown boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  chosen_ids uuid[] := coalesce(p_movie_ids, '{}'::uuid[]);
  selected_count integer := coalesce(cardinality(chosen_ids), 0);
  selected_banner_id uuid;
begin
  if caller_id is null or not (select private.is_group_member(p_group_id)) then
    raise exception 'Approved membership is required.';
  end if;

  if selected_count > 5 then
    raise exception 'A profile can feature up to five films.';
  end if;

  if selected_count <> (
    select count(distinct selected_movie_id)::integer
    from unnest(chosen_ids) as selected(selected_movie_id)
  ) then
    raise exception 'A film can only appear once in Top Five.';
  end if;

  if exists (
    select 1
    from unnest(chosen_ids) as selected(selected_movie_id)
    where not exists (
      select 1
      from public.personal_films personal
      where personal.owner_id = caller_id
        and personal.movie_id = selected.selected_movie_id
    )
  ) then
    raise exception 'Top Five films must already be in your My Cinema.';
  end if;

  if p_banner_movie_id is not null and not (p_banner_movie_id = any(chosen_ids)) then
    raise exception 'The profile banner must use a film from your Top Five.';
  end if;

  selected_banner_id := coalesce(p_banner_movie_id, chosen_ids[1]);

  insert into public.member_profile_drafts (
    group_id,
    owner_id,
    introduction,
    banner_movie_id,
    include_recent_watches,
    include_genre_breakdown
  )
  values (
    p_group_id,
    caller_id,
    left(btrim(coalesce(p_introduction, '')), 160),
    selected_banner_id,
    coalesce(p_include_recent_watches, false),
    coalesce(p_include_genre_breakdown, false)
  )
  on conflict (group_id, owner_id) do update set
    introduction = excluded.introduction,
    banner_movie_id = excluded.banner_movie_id,
    include_recent_watches = excluded.include_recent_watches,
    include_genre_breakdown = excluded.include_genre_breakdown,
    updated_at = now();

  delete from public.member_profile_draft_films
  where group_id = p_group_id and owner_id = caller_id;

  insert into public.member_profile_draft_films (group_id, owner_id, slot, movie_id)
  select p_group_id, caller_id, selected.slot::smallint, selected.movie_id
  from unnest(chosen_ids) with ordinality as selected(movie_id, slot);

  return true;
end;
$$;

create or replace function public.publish_member_profile(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  draft public.member_profile_drafts%rowtype;
  new_publication_id uuid;
  selected_banner public.movies%rowtype;
  watched_count integer := 0;
  attended_count integer := 0;
  rating_average numeric(3, 2);
  finished_rate numeric(5, 2);
begin
  if caller_id is null or not (select private.is_group_member(p_group_id)) then
    raise exception 'Approved membership is required.';
  end if;

  select profile.* into draft
  from public.member_profile_drafts profile
  where profile.group_id = p_group_id
    and profile.owner_id = caller_id;

  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.member_profile_draft_films film
    where film.group_id = p_group_id and film.owner_id = caller_id
  ) then
    raise exception 'Choose at least one film before publishing your profile.';
  end if;

  if exists (
    select 1
    from public.member_profile_draft_films selected
    where selected.group_id = p_group_id
      and selected.owner_id = caller_id
      and not exists (
        select 1 from public.personal_films personal
        where personal.owner_id = caller_id and personal.movie_id = selected.movie_id
      )
  ) then
    raise exception 'Top Five films must already be in your My Cinema.';
  end if;

  select movie.* into selected_banner
  from public.member_profile_draft_films selected
  join public.movies movie on movie.id = selected.movie_id
  where selected.group_id = p_group_id
    and selected.owner_id = caller_id
    and (draft.banner_movie_id is null or selected.movie_id = draft.banner_movie_id)
  order by
    case when selected.movie_id = draft.banner_movie_id then 0 else 1 end,
    selected.slot
  limit 1;

  select count(*)::integer into watched_count
  from (
    select event.movie_id
    from public.personal_viewing_events event
    where event.owner_id = caller_id
      and not event.is_hidden
      and event.outcome = 'FINISHED'
    union
    select personal.movie_id
    from public.personal_films personal
    where personal.owner_id = caller_id
      and personal.state = 'WATCHED'
  ) watched_movies;

  select count(distinct session.id)::integer into attended_count
  from public.movie_sessions session
  join public.movie_session_participants participant on participant.session_id = session.id
  where session.group_id = p_group_id
    and session.status = 'WATCHED'
    and participant.profile_id = caller_id;

  select round(avg(personal.rating)::numeric, 2) into rating_average
  from public.personal_films personal
  where personal.owner_id = caller_id
    and personal.rating is not null;

  select
    case
      when count(*) = 0 then null
      else round(
        100.0 * count(*) filter (where event.outcome = 'FINISHED') / count(*),
        2
      )
    end
  into finished_rate
  from public.personal_viewing_events event
  where event.owner_id = caller_id
    and not event.is_hidden;

  insert into public.member_profile_publications (
    group_id,
    owner_id,
    introduction,
    banner_movie_id,
    banner_title,
    banner_backdrop_path,
    banner_poster_path,
    films_watched_count,
    sessions_attended_count,
    average_rating,
    completion_rate,
    include_recent_watches,
    include_genre_breakdown,
    published_at
  ) values (
    p_group_id,
    caller_id,
    draft.introduction,
    selected_banner.id,
    selected_banner.title,
    selected_banner.backdrop_path,
    selected_banner.poster_path,
    watched_count,
    attended_count,
    rating_average,
    finished_rate,
    draft.include_recent_watches,
    draft.include_genre_breakdown,
    now()
  )
  on conflict (group_id, owner_id) do update set
    introduction = excluded.introduction,
    banner_movie_id = excluded.banner_movie_id,
    banner_title = excluded.banner_title,
    banner_backdrop_path = excluded.banner_backdrop_path,
    banner_poster_path = excluded.banner_poster_path,
    films_watched_count = excluded.films_watched_count,
    sessions_attended_count = excluded.sessions_attended_count,
    average_rating = excluded.average_rating,
    completion_rate = excluded.completion_rate,
    include_recent_watches = excluded.include_recent_watches,
    include_genre_breakdown = excluded.include_genre_breakdown,
    published_at = excluded.published_at,
    updated_at = now()
  returning id into new_publication_id;

  delete from public.member_profile_publication_films
  where member_profile_publication_films.publication_id = new_publication_id;
  delete from public.member_profile_publication_recent_watches
  where member_profile_publication_recent_watches.publication_id = new_publication_id;
  delete from public.member_profile_publication_genres
  where member_profile_publication_genres.publication_id = new_publication_id;

  insert into public.member_profile_publication_films (
    publication_id, slot, movie_id, title, release_year, tmdb_id, poster_path, rating
  )
  select
    new_publication_id,
    selected.slot,
    movie.id,
    movie.title,
    movie.release_year,
    movie.tmdb_id,
    movie.poster_path,
    personal.rating
  from public.member_profile_draft_films selected
  join public.movies movie on movie.id = selected.movie_id
  left join public.personal_films personal
    on personal.owner_id = caller_id
   and personal.movie_id = selected.movie_id
  where selected.group_id = p_group_id
    and selected.owner_id = caller_id;

  insert into public.member_profile_publication_recent_watches (
    publication_id,
    position,
    movie_id,
    title,
    release_year,
    tmdb_id,
    poster_path,
    watched_on,
    outcome,
    rating,
    session_label
  )
  select
    new_publication_id,
    recent.position::smallint,
    recent.movie_id,
    recent.title,
    recent.release_year,
    recent.tmdb_id,
    recent.poster_path,
    recent.watched_on,
    recent.outcome,
    recent.rating,
    recent.session_label
  from (
    select
      row_number() over (
        order by event.watched_on desc nulls last, event.created_at desc, event.id
      ) as position,
      movie.id as movie_id,
      movie.title,
      movie.release_year,
      movie.tmdb_id,
      movie.poster_path,
      event.watched_on,
      event.outcome,
      personal.rating,
      session.mode as session_label
    from public.personal_viewing_events event
    join public.movies movie on movie.id = event.movie_id
    left join public.personal_films personal
      on personal.owner_id = caller_id
     and personal.movie_id = event.movie_id
    left join public.journal_entries entry on entry.id = event.source_journal_entry_id
    left join public.movie_sessions session on session.id = entry.movie_session_id
    where event.owner_id = caller_id
      and not event.is_hidden
  ) recent
  where draft.include_recent_watches
    and recent.position <= 5;

  with genre_counts as (
    select genre, count(*)::integer as watch_count
    from public.personal_viewing_events event
    join public.movies movie on movie.id = event.movie_id
    cross join lateral unnest(movie.genres) as expanded(genre)
    where event.owner_id = caller_id
      and not event.is_hidden
      and event.outcome = 'FINISHED'
    group by genre
  ),
  ranked_genres as (
    select
      row_number() over (order by watch_count desc, genre) as position,
      genre,
      watch_count
    from genre_counts
  )
  insert into public.member_profile_publication_genres (
    publication_id, position, genre, watch_count
  )
  select
    new_publication_id,
    ranked.position::smallint,
    ranked.genre,
    ranked.watch_count
  from ranked_genres ranked
  where draft.include_genre_breakdown
    and ranked.position <= 3;

  return true;
end;
$$;

create or replace function public.unpublish_member_profile(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not (select private.is_group_member(p_group_id)) then
    raise exception 'Approved membership is required.';
  end if;

  delete from public.member_profile_publications
  where group_id = p_group_id and owner_id = caller_id;

  return found;
end;
$$;

create or replace function public.get_member_profiles(p_group_id uuid)
returns table (
  owner_id uuid,
  display_name text,
  avatar_url text,
  introduction text,
  member_since timestamptz,
  published_at timestamptz,
  banner_movie_id uuid,
  banner_title text,
  banner_backdrop_path text,
  banner_poster_path text,
  films_watched_count integer,
  sessions_attended_count integer,
  average_rating numeric,
  completion_rate numeric,
  recent_watches jsonb,
  genre_breakdown jsonb,
  slot smallint,
  movie_id uuid,
  title text,
  release_year integer,
  tmdb_id bigint,
  poster_path text,
  rating smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_group_member(p_group_id)) then
    raise exception 'Approved membership is required.';
  end if;

  return query
  select
    publication.owner_id,
    profile.display_name,
    identity.avatar_url,
    publication.introduction,
    owner_membership.joined_at,
    publication.published_at,
    publication.banner_movie_id,
    publication.banner_title,
    publication.banner_backdrop_path,
    publication.banner_poster_path,
    publication.films_watched_count,
    publication.sessions_attended_count,
    publication.average_rating,
    publication.completion_rate,
    case
      when publication.include_recent_watches then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'position', recent.position,
            'movie_id', recent.movie_id,
            'title', recent.title,
            'release_year', recent.release_year,
            'tmdb_id', recent.tmdb_id,
            'poster_path', recent.poster_path,
            'watched_on', recent.watched_on,
            'outcome', recent.outcome,
            'rating', recent.rating,
            'session_label', recent.session_label
          )
          order by recent.position
        )
        from public.member_profile_publication_recent_watches recent
        where recent.publication_id = publication.id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    case
      when publication.include_genre_breakdown then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'position', genre.position,
            'genre', genre.genre,
            'watch_count', genre.watch_count
          )
          order by genre.position
        )
        from public.member_profile_publication_genres genre
        where genre.publication_id = publication.id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    featured.slot,
    featured.movie_id,
    featured.title,
    featured.release_year,
    featured.tmdb_id,
    featured.poster_path,
    featured.rating
  from public.member_profile_publications publication
  join public.profiles profile on profile.id = publication.owner_id
  join public.group_memberships owner_membership
    on owner_membership.group_id = publication.group_id
   and owner_membership.user_id = publication.owner_id
  left join public.discord_identities identity on identity.profile_id = publication.owner_id
  join public.member_profile_publication_films featured on featured.publication_id = publication.id
  where publication.group_id = p_group_id
  order by publication.published_at desc, publication.owner_id, featured.slot;
end;
$$;

revoke all on function public.save_member_profile_draft(uuid, text, uuid[], uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_member_profile(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.unpublish_member_profile(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_member_profiles(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_member_profile_draft(uuid, text, uuid[], uuid, boolean, boolean) to authenticated;
grant execute on function public.publish_member_profile(uuid) to authenticated;
grant execute on function public.unpublish_member_profile(uuid) to authenticated;
grant execute on function public.get_member_profiles(uuid) to authenticated;

comment on table public.member_profile_drafts is
  'Owner-private Member Profile drafts. Top Five rows are stored separately so unpublished edits cannot leak through a public snapshot.';
comment on table public.member_profile_publications is
  'Explicit group-visible Member Profile snapshots for approved members, including deliberately published aggregate statistics.';
comment on table public.member_profile_publication_recent_watches is
  'Up to five owner-approved viewing-event snapshots copied at profile publication time. Readers never access the private source rows.';
comment on table public.member_profile_publication_genres is
  'Up to three owner-approved genre-count snapshots copied at profile publication time.';
comment on function public.get_member_profiles(uuid) is
  'Returns only published profile snapshots to an approved member of the requested group.';

commit;
