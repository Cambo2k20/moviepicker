begin;

drop function if exists public.apply_archive_history_triage(uuid, text, uuid[], uuid[]);
drop function if exists public.preview_archive_history_triage(uuid);
drop function if exists private.archive_history_triage_proposals(uuid);

commit;
