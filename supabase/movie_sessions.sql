begin;

create table public.movie_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  mode text not null check (mode in ('Consensus Sprint', 'Queue Roulette', 'Reel Bracket')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONFIRMED', 'ENDED')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  selected_queue_item_id uuid references public.queue_items(id) on delete set null,
  selected_title text check (selected_title is null or char_length(selected_title) between 1 and 200),
  selected_release_year integer check (selected_release_year is null or selected_release_year between 1888 and 2200),
  selected_tmdb_id bigint check (selected_tmdb_id is null or selected_tmdb_id > 0),
  selected_poster_path text check (selected_poster_path is null or char_length(selected_poster_path) <= 300),
  selected_runtime_minutes integer check (selected_runtime_minutes is null or selected_runtime_minutes between 1 and 1440),
  selected_genres text[] not null default '{}',
  selected_overview text check (selected_overview is null or char_length(selected_overview) <= 4000),
  game_state jsonb not null default '{}'::jsonb check (jsonb_typeof(game_state) = 'object'),
  started_at timestamptz not null default now(),
  confirmed_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint movie_sessions_confirmed_selection check (status <> 'CONFIRMED' or selected_title is not null)
);

create table public.movie_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.movie_sessions(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name_snapshot text not null check (char_length(trim(display_name_snapshot)) between 1 and 40),
  added_at timestamptz not null default now(),
  unique (session_id, profile_id)
);

create index movie_sessions_group_started_idx
  on public.movie_sessions (group_id, started_at desc);

create index movie_sessions_created_by_idx
  on public.movie_sessions (created_by, started_at desc);

create index movie_sessions_selected_queue_item_idx
  on public.movie_sessions (selected_queue_item_id)
  where selected_queue_item_id is not null;

create unique index movie_sessions_one_open_per_group_idx
  on public.movie_sessions (group_id)
  where status in ('ACTIVE', 'CONFIRMED');

create index movie_session_participants_session_idx
  on public.movie_session_participants (session_id);

create index movie_session_participants_profile_idx
  on public.movie_session_participants (profile_id)
  where profile_id is not null;

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

revoke all on function private.validate_movie_session() from public, anon, authenticated;

create trigger movie_sessions_validate
before insert or update on public.movie_sessions
for each row execute function private.validate_movie_session();

create trigger movie_sessions_set_updated_at
before update on public.movie_sessions
for each row execute function private.set_updated_at();

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

  select count(*)
  into valid_participants
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

revoke all on function public.create_movie_session(uuid, text, uuid[], integer, jsonb) from public, anon;
grant execute on function public.create_movie_session(uuid, text, uuid[], integer, jsonb) to authenticated;

alter table public.movie_sessions enable row level security;
alter table public.movie_session_participants enable row level security;

create policy movie_sessions_select_group
on public.movie_sessions for select
to authenticated
using (private.is_group_member(group_id));

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

create policy movie_session_participants_select_group
on public.movie_session_participants for select
to authenticated
using (
  exists (
    select 1
    from public.movie_sessions session
    where session.id = movie_session_participants.session_id
      and private.is_group_member(session.group_id)
  )
);

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

revoke all on table public.movie_sessions from anon;
revoke all on table public.movie_session_participants from anon;

grant select, insert, update, delete on table public.movie_sessions to authenticated;
grant select, insert, delete on table public.movie_session_participants to authenticated;

comment on table public.movie_sessions is 'Persistent website movie-night sessions. This table has no Discord integration.';
comment on column public.movie_sessions.game_state is 'Website decision-game state used to resume an active session after refresh.';
comment on table public.movie_session_participants is 'Approved website members who attended a movie-night session, with display-name snapshots.';

commit;
