-- Rollback for 20260824220827_add_canonical_movie_foundation.
--
-- Destructive effects:
-- - Canonical movie rows and their refreshed TMDB metadata are deleted.
-- - Queue, session and current-Journal canonical UUID links are removed.
-- - Existing snapshot columns and all manual/historical display data remain.
-- - Imported journal_archive_entries are unaffected because the migration did
--   not attach identities to title/year-only archive rows.

begin;

drop trigger if exists journal_entries_link_movie on public.journal_entries;
drop trigger if exists movie_sessions_link_movie on public.movie_sessions;
drop trigger if exists queue_items_validate_movie on public.queue_items;

drop function if exists private.link_journal_entry_movie();
drop function if exists private.link_movie_session_movie();
drop function if exists private.validate_queue_item_movie();

alter table public.journal_entries
  drop column if exists movie_id;

alter table public.movie_sessions
  drop column if exists selected_movie_id;

alter table public.queue_items
  drop column if exists movie_id;

drop policy if exists movies_select_approved_members on public.movies;
drop table if exists public.movies;

drop function if exists private.has_approved_membership();

commit;
