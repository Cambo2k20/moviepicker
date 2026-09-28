begin;

-- Historical Discord entries are immutable archive records, but confirmed
-- viewer mappings may still produce owner-private history events.
alter table public.personal_viewing_events
  add column source_archive_entry_id uuid
    references public.journal_archive_entries(id) on delete cascade;

alter table public.personal_viewing_events
  add constraint personal_viewing_events_one_source_check
  check (num_nonnulls(source_journal_entry_id, source_archive_entry_id) <= 1);

alter table public.personal_viewing_events
  drop constraint personal_viewing_events_manual_visible_check;

alter table public.personal_viewing_events
  add constraint personal_viewing_events_manual_visible_check
  check (
    source_journal_entry_id is not null
    or source_archive_entry_id is not null
    or not is_hidden
  );

create unique index personal_viewing_events_owner_archive_source_key
  on public.personal_viewing_events (owner_id, source_archive_entry_id)
  where source_archive_entry_id is not null;

comment on column public.personal_viewing_events.source_archive_entry_id is
  'Stable immutable Discord archive source when a confirmed historical viewer and canonical movie match exist.';

create or replace function private.protect_personal_viewing_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'postgres'
    and (old.source_journal_entry_id is not null or old.source_archive_entry_id is not null)
    and new.owner_id is not distinct from old.owner_id
    and new.source_journal_entry_id is not distinct from old.source_journal_entry_id
    and new.source_archive_entry_id is not distinct from old.source_archive_entry_id
    and new.is_hidden is not distinct from old.is_hidden
  then
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id
    or new.movie_id is distinct from old.movie_id
    or new.source_journal_entry_id is distinct from old.source_journal_entry_id
    or new.source_archive_entry_id is distinct from old.source_archive_entry_id
  then
    raise exception 'Viewing-event ownership, movie and source are immutable.';
  end if;

  if old.source_journal_entry_id is null and old.source_archive_entry_id is null then
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

drop function if exists public.delete_manual_personal_viewing_event(uuid);

create or replace function public.delete_manual_personal_viewing_event(
  p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  source_entry_id uuid;
  source_archive_entry_id uuid;
begin
  if caller_id is null or not (select private.has_approved_membership()) then
    raise exception 'Approved membership is required.';
  end if;

  select event.source_journal_entry_id, event.source_archive_entry_id
  into source_entry_id, source_archive_entry_id
  from public.personal_viewing_events event
  where event.id = p_event_id
    and event.owner_id = caller_id;

  if not found then
    return false;
  end if;

  if source_entry_id is not null or source_archive_entry_id is not null then
    raise exception 'Source-linked viewing events must be hidden or corrected through the Journal.';
  end if;

  delete from public.personal_viewing_events event
  where event.id = p_event_id
    and event.owner_id = caller_id
    and event.source_journal_entry_id is null
    and event.source_archive_entry_id is null;

  return found;
end;
$$;

revoke all on function public.delete_manual_personal_viewing_event(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_manual_personal_viewing_event(uuid)
  to authenticated;

drop policy if exists personal_viewing_events_insert_manual_owner
  on public.personal_viewing_events;

create policy personal_viewing_events_insert_manual_owner
on public.personal_viewing_events for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and source_journal_entry_id is null
  and source_archive_entry_id is null
  and not is_hidden
  and (select private.has_approved_membership())
);

grant select, insert, update on table public.personal_viewing_events to service_role;

create or replace function private.sync_personal_film_state_from_viewing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_journal_entry_id is null and new.source_archive_entry_id is null then
    return new;
  end if;

  insert into public.personal_films (owner_id, movie_id, state)
  values (
    new.owner_id,
    new.movie_id,
    case when new.outcome = 'DID_NOT_FINISH' then 'DID_NOT_FINISH' else 'WATCHED' end
  )
  on conflict (owner_id, movie_id)
  do update set state = excluded.state;

  return new;
end;
$$;

drop trigger if exists personal_viewing_events_sync_personal_film_state
  on public.personal_viewing_events;

create trigger personal_viewing_events_sync_personal_film_state
after insert or update of movie_id, outcome, source_journal_entry_id, source_archive_entry_id
on public.personal_viewing_events
for each row execute function private.sync_personal_film_state_from_viewing_event();

comment on function private.sync_personal_film_state_from_viewing_event() is
  'Promotes current or confirmed historical Journal viewing events into each viewer''s private current film state without changing rating or Favourite.';

commit;
