begin;

-- Private review drafts and group-visible publications are separate records so
-- RLS can never expose a later unpublished edit through a published row.
create table public.personal_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete restrict,
  body text not null,
  contains_spoilers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_reviews_owner_movie_key unique (owner_id, movie_id),
  constraint personal_reviews_body_check check (
    char_length(btrim(body)) between 1 and 1000
  )
);

create table public.published_reviews (
  review_id uuid primary key references public.personal_reviews(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete restrict,
  body text not null,
  contains_spoilers boolean not null default false,
  rating smallint check (rating is null or rating between 1 and 5),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_reviews_owner_movie_key unique (owner_id, movie_id),
  constraint published_reviews_body_check check (
    char_length(btrim(body)) between 1 and 1000
  )
);

comment on table public.personal_reviews is
  'Owner-private short review drafts for canonical movies.';
comment on table public.published_reviews is
  'Explicit review snapshots visible only to approved members who share a group with the author.';
comment on column public.published_reviews.rating is
  'Optional rating snapshot copied when the review is published; a review never requires a rating.';

create index personal_reviews_movie_id_idx on public.personal_reviews (movie_id);
create index published_reviews_movie_published_idx
  on public.published_reviews (movie_id, published_at desc);
create index published_reviews_owner_id_idx on public.published_reviews (owner_id);

create trigger personal_reviews_set_updated_at
before update on public.personal_reviews
for each row execute function private.set_updated_at();

create trigger published_reviews_set_updated_at
before update on public.published_reviews
for each row execute function private.set_updated_at();

alter table public.personal_reviews enable row level security;
alter table public.published_reviews enable row level security;

create policy personal_reviews_select_owner
on public.personal_reviews for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy personal_reviews_insert_owner
on public.personal_reviews for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy personal_reviews_update_owner
on public.personal_reviews for update
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
)
with check (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy personal_reviews_delete_owner
on public.personal_reviews for delete
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

create policy published_reviews_select_shared_group
on public.published_reviews for select
to authenticated
-- The existing security-definer helper checks both membership rows without
-- recursing through group_memberships RLS. Removing either member therefore
-- hides the publication immediately.
using ((select private.shares_group_with(owner_id)));

-- Publishing copies the current private text into a distinct snapshot. The
-- current rating is copied when one exists, but text-only reviews are valid.
create or replace function public.publish_personal_review(p_review_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  draft public.personal_reviews%rowtype;
  current_rating smallint;
begin
  if caller_id is null or not (select private.has_approved_membership()) then
    raise exception 'Approved membership is required.';
  end if;

  select review.* into draft
  from public.personal_reviews review
  where review.id = p_review_id
    and review.owner_id = caller_id;

  if not found then
    return false;
  end if;

  select film.rating into current_rating
  from public.personal_films film
  where film.owner_id = caller_id
    and film.movie_id = draft.movie_id;

  insert into public.published_reviews (
    review_id,
    owner_id,
    movie_id,
    body,
    contains_spoilers,
    rating,
    published_at
  ) values (
    draft.id,
    draft.owner_id,
    draft.movie_id,
    btrim(draft.body),
    draft.contains_spoilers,
    current_rating,
    now()
  )
  on conflict (review_id) do update set
    body = excluded.body,
    contains_spoilers = excluded.contains_spoilers,
    rating = excluded.rating,
    published_at = excluded.published_at;

  return true;
end;
$$;

create or replace function public.unpublish_personal_review(p_review_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not (select private.has_approved_membership()) then
    raise exception 'Approved membership is required.';
  end if;

  delete from public.published_reviews publication
  using public.personal_reviews review
  where publication.review_id = p_review_id
    and review.id = publication.review_id
    and review.owner_id = caller_id;

  return found;
end;
$$;

revoke all on function public.publish_personal_review(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.unpublish_personal_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_personal_review(uuid) to authenticated;
grant execute on function public.unpublish_personal_review(uuid) to authenticated;

-- A cleared or deleted private rating must disappear from the publication
-- immediately, but the text review remains published because ratings are
-- optional. Other rating changes wait for an explicit republish.
create or replace function private.remove_cleared_published_review_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or (old.rating is not null and new.rating is null) then
    update public.published_reviews publication
    set rating = null
    where publication.owner_id = old.owner_id
      and publication.movie_id = old.movie_id
      and publication.rating is not null;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.remove_cleared_published_review_rating()
  from public, anon, authenticated, service_role;

create trigger personal_films_remove_cleared_published_review_rating
after update of rating or delete on public.personal_films
for each row execute function private.remove_cleared_published_review_rating();

revoke all on table public.personal_reviews
  from public, anon, authenticated, service_role;
revoke all on table public.published_reviews
  from public, anon, authenticated, service_role;

grant select, delete on table public.personal_reviews to authenticated;
grant insert (owner_id, movie_id, body, contains_spoilers)
  on table public.personal_reviews to authenticated;
grant update (body, contains_spoilers)
  on table public.personal_reviews to authenticated;
grant select on table public.published_reviews to authenticated;

commit;
