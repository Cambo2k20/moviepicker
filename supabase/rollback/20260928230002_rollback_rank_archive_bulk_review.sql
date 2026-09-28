begin;

drop function if exists public.apply_archive_history_bulk_review(uuid, text, uuid[]);
drop function if exists public.preview_archive_history_bulk_review(uuid);
drop function if exists private.archive_history_bulk_review_snapshot(uuid);
drop function if exists private.archive_history_bulk_review_proposals(uuid);

commit;
