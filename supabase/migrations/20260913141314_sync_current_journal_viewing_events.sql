begin;

-- Browser updates keep the existing row-sensitive rules. The trusted Journal
-- synchroniser runs as postgres and may refresh only the source-owned facts;
-- it cannot change ownership, source identity or the member's hidden choice.
create or replace function private.protect_personal_viewing_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'postgres'
    and old.source_journal_entry_id is not null
    and new.owner_id is not distinct from old.owner_id
    and new.source_journal_entry_id is not distinct from old.source_journal_entry_id
    and new.is_hidden is not distinct from old.is_hidden
  then
    return new;
  end if;

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

-- Only current Cine-Cord Journal entries participate. The immutable imported
-- Discord archive lives in public.journal_archive_entries and is intentionally
-- absent from this function.
create or replace function private.sync_current_journal_viewing_events(
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_entry public.journal_entries%rowtype;
begin
  select entry.*
  into source_entry
  from public.journal_entries entry
  where entry.id = p_entry_id;

  if not found then
    return;
  end if;

  -- Remove a derived event when its verified current viewer or canonical movie
  -- link no longer exists. Manual events and every archive row are untouched.
  delete from public.personal_viewing_events event
  where event.source_journal_entry_id = source_entry.id
    and (
      source_entry.movie_id is null
      or not exists (
        select 1
        from public.entry_viewers viewer
        where viewer.entry_id = source_entry.id
          and viewer.profile_id = event.owner_id
      )
    );

  if source_entry.movie_id is null then
    return;
  end if;

  insert into public.personal_viewing_events (
    owner_id,
    movie_id,
    outcome,
    watched_on,
    source_journal_entry_id
  )
  select
    viewer.profile_id,
    source_entry.movie_id,
    case
      when source_entry.status = 'DNF' then 'DID_NOT_FINISH'
      else 'FINISHED'
    end,
    source_entry.watched_at,
    source_entry.id
  from public.entry_viewers viewer
  where viewer.entry_id = source_entry.id
  on conflict (owner_id, source_journal_entry_id)
    where source_journal_entry_id is not null
  do update
  set movie_id = excluded.movie_id,
      outcome = excluded.outcome,
      watched_on = excluded.watched_on;
end;
$$;

revoke all on function private.sync_current_journal_viewing_events(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_current_journal_viewing_events_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_current_journal_viewing_events(new.id);
  return new;
end;
$$;

revoke all on function private.sync_current_journal_viewing_events_trigger()
  from public, anon, authenticated, service_role;

-- Viewer writes already touch journal_entries.updated_at. Deferring this trigger
-- until transaction end means public.update_journal_entry may replace all viewer
-- rows without briefly deleting and recreating their private source events.
create constraint trigger journal_entries_sync_personal_viewing_events
after insert or update on public.journal_entries
deferrable initially deferred
for each row execute function private.sync_current_journal_viewing_events_trigger();

-- Backfill only current entries with both database-backed identities required
-- for a trustworthy link. No title/year matching and no archive-name matching.
do $$
declare
  source_entry_id uuid;
begin
  for source_entry_id in
    select distinct entry.id
    from public.journal_entries entry
    join public.entry_viewers viewer on viewer.entry_id = entry.id
    where entry.movie_id is not null
  loop
    perform private.sync_current_journal_viewing_events(source_entry_id);
  end loop;
end;
$$;

comment on function private.sync_current_journal_viewing_events(uuid) is
  'Synchronises owner-private viewing events from one verified current Journal entry. Imported Discord archive rows are never read or changed.';

commit;
