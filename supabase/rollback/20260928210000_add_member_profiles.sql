begin;

drop function if exists public.get_member_profiles(uuid);
drop function if exists public.unpublish_member_profile(uuid);
drop function if exists public.publish_member_profile(uuid);
drop function if exists public.save_member_profile_draft(uuid, text, uuid[], uuid, boolean, boolean);

drop table if exists public.member_profile_publication_genres;
drop table if exists public.member_profile_publication_recent_watches;
drop table if exists public.member_profile_publication_films;
drop table if exists public.member_profile_publications;
drop table if exists public.member_profile_draft_films;
drop table if exists public.member_profile_drafts;

alter table public.movies drop column if exists backdrop_path;

commit;
