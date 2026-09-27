begin;

drop trigger if exists personal_films_remove_cleared_published_review_rating
  on public.personal_films;
drop function if exists private.remove_cleared_published_review_rating();
drop function if exists public.unpublish_personal_review(uuid);
drop function if exists public.publish_personal_review(uuid);
drop table if exists public.published_reviews;
drop table if exists public.personal_reviews;

commit;
