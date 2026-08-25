begin;

-- One row describes one member's current private relationship with one
-- canonical movie. Viewing events, reviews and custom-list membership arrive
-- in later Phase 2 slices and deliberately do not live in this first table.
create table public.personal_films (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete restrict,
  state text check (state is null or state in ('WANT_TO_WATCH', 'WATCHED', 'DID_NOT_FINISH')),
  rating smallint check (rating is null or rating between 1 and 5),
  is_favourite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_films_owner_movie_key unique (owner_id, movie_id),
  constraint personal_films_rating_state_check check (
    rating is null or state in ('WATCHED', 'DID_NOT_FINISH')
  )
);

comment on table public.personal_films is
  'Owner-private current state, five-level enjoyment rating and Favourite marker for one canonical movie.';
comment on column public.personal_films.state is
  'Current state: WANT_TO_WATCH, WATCHED, DID_NOT_FINISH or null. Rewatches are separate future viewing events.';
comment on column public.personal_films.rating is
  'One current editable enjoyment reaction from 1 to 5. Clearing it does not change state or Favourite.';
comment on column public.personal_films.is_favourite is
  'Independent personal Favourite marker; it is not inferred from rating 5.';

-- The owner/movie uniqueness index serves owner-scoped reads and RLS checks.
-- These additional indexes cover canonical-film joins and recently-added
-- ordering without creating one index for every future UI filter.
create index personal_films_movie_id_idx
  on public.personal_films (movie_id);

create index personal_films_owner_created_idx
  on public.personal_films (owner_id, created_at desc);

-- Selecting a rating is one atomic operation. It normally marks the film
-- Watched, but an explicit DNF state wins. Clearing the rating leaves every
-- other field unchanged. The table constraint keeps a later direct state edit
-- from turning a rated film back into Want to Watch or unset.
create or replace function private.apply_personal_film_rating_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rating is not null then
    if tg_op = 'INSERT' then
      if new.state is distinct from 'DID_NOT_FINISH' then
        new.state = 'WATCHED';
      end if;
    elsif new.rating is distinct from old.rating
      and new.state is distinct from 'DID_NOT_FINISH'
    then
      new.state = 'WATCHED';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_personal_film_rating_state()
  from public, anon, authenticated, service_role;

create trigger personal_films_apply_rating_state
before insert or update on public.personal_films
for each row execute function private.apply_personal_film_rating_state();

create trigger personal_films_set_updated_at
before update on public.personal_films
for each row execute function private.set_updated_at();

alter table public.personal_films enable row level security;

-- Administrators do not gain access to somebody else's private activity.
-- Removing group membership hides the retained row immediately; deleting the
-- Auth account cascades through profiles and removes it permanently.
create policy personal_films_select_owner
on public.personal_films for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy personal_films_insert_owner
on public.personal_films for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy personal_films_update_owner
on public.personal_films for update
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
)
with check (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy personal_films_delete_owner
on public.personal_films for delete
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

-- The browser may read and remove its visible rows, create only the fields
-- needed for a new personal film, and update only the three current signals.
-- Ownership, canonical identity and audit timestamps cannot be rewritten.
revoke all on table public.personal_films
  from public, anon, authenticated, service_role;

grant select, delete on table public.personal_films to authenticated;
grant insert (owner_id, movie_id, state, rating, is_favourite)
  on table public.personal_films to authenticated;
grant update (state, rating, is_favourite)
  on table public.personal_films to authenticated;

commit;
