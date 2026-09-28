begin;

drop function if exists public.get_archive_history_match_candidates(uuid, uuid[]);
drop table if exists public.archive_history_match_candidates;

commit;
