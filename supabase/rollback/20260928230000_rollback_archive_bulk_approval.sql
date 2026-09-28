begin;

drop function if exists public.apply_archive_history_bulk_approval(uuid, text);
drop function if exists public.preview_archive_history_bulk_approval(uuid);
drop function if exists private.archive_history_bulk_proposals(uuid);

-- Reviews and canonical films approved before rollback remain intact.
commit;
