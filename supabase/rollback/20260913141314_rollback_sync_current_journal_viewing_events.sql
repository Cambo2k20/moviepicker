begin;

drop trigger if exists journal_entries_sync_personal_viewing_events
  on public.journal_entries;

drop function if exists private.sync_current_journal_viewing_events_trigger();
drop function if exists private.sync_current_journal_viewing_events(uuid);

-- Keep already-derived rows, including each owner's private hidden choice. They
-- remain valid source-linked foundation rows but stop changing until this
-- migration is reapplied. No Journal, archive or Discord data is changed.

-- Restore the Phase 2B foundation's browser-only update guard.
create or replace function private.protect_personal_viewing_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.movie_id is distinct from old.movie_id
    or new.source_journal_entry_id is distinct from old.source_journal_entry_id
  then
    raise exception 'Viewing-event ownership, movie and source are immutable.';
  end if;

  if old.source_journal_entry_id is null then
    if new.is_hidden is distinct from old.is_hidden then
      raise exception 'Manual viewing events cannot be hidden; delete them instead.';
    end if;
  elsif new.outcome is distinct from old.outcome
    or new.watched_on is distinct from old.watched_on
  then
    raise exception 'Correct source-linked viewing facts through the Journal.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_personal_viewing_event_update()
  from public, anon, authenticated, service_role;

commit;
