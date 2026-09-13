begin;

-- Viewing history is independent from the current personal-film row. Removing
-- a rating, Favourite or current state must not silently erase historical
-- events, and one movie may have any number of manual watches or rewatches.
create table public.personal_viewing_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete restrict,
  outcome text not null check (outcome in ('FINISHED', 'DID_NOT_FINISH')),
  watched_on date,
  source_journal_entry_id uuid references public.journal_entries(id) on delete cascade,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_viewing_events_manual_visible_check check (
    source_journal_entry_id is not null or not is_hidden
  )
);

comment on table public.personal_viewing_events is
  'Owner-private finished or did-not-finish history, independent from the current personal film state.';
comment on column public.personal_viewing_events.source_journal_entry_id is
  'Stable current-Journal source when the event is derived from a verified viewer and canonical movie link; null for manual events.';
comment on column public.personal_viewing_events.is_hidden is
  'Owner-controlled visibility for a source-linked event. Hiding never edits the shared Journal source.';

create unique index personal_viewing_events_owner_source_key
  on public.personal_viewing_events (owner_id, source_journal_entry_id)
  where source_journal_entry_id is not null;

create index personal_viewing_events_owner_watched_idx
  on public.personal_viewing_events (owner_id, watched_on desc nulls last, created_at desc);

create index personal_viewing_events_movie_id_idx
  on public.personal_viewing_events (movie_id);

-- Direct browser updates are row-sensitive. Manual events may change their
-- outcome/date but cannot be hidden. Source-linked facts follow the Journal
-- and may only toggle their private hidden state. The later linking migration
-- will add the controlled internal synchronisation path.
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

create trigger personal_viewing_events_protect_update
before update on public.personal_viewing_events
for each row execute function private.protect_personal_viewing_event_update();

create trigger personal_viewing_events_set_updated_at
before update on public.personal_viewing_events
for each row execute function private.set_updated_at();

alter table public.personal_viewing_events enable row level security;

create policy personal_viewing_events_select_owner
on public.personal_viewing_events for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

-- Browser inserts are manual only. Source-linked rows will be created by a
-- later reviewed database path after stable viewer and movie identities have
-- both been verified.
create policy personal_viewing_events_insert_manual_owner
on public.personal_viewing_events for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and source_journal_entry_id is null
  and not is_hidden
  and (select private.has_approved_membership())
);

create policy personal_viewing_events_update_owner
on public.personal_viewing_events for update
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
)
with check (
  owner_id = (select auth.uid())
  and (select private.has_approved_membership())
);

-- DELETE is intentionally withheld from the table. This function permits only
-- the owner of a manual event to delete it and rejects a source-linked event,
-- which must instead be hidden or corrected through its shared Journal source.
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
begin
  if caller_id is null or not (select private.has_approved_membership()) then
    raise exception 'Approved membership is required.';
  end if;

  select event.source_journal_entry_id
  into source_entry_id
  from public.personal_viewing_events event
  where event.id = p_event_id
    and event.owner_id = caller_id;

  if not found then
    return false;
  end if;

  if source_entry_id is not null then
    raise exception 'Source-linked viewing events must be hidden or corrected through the Journal.';
  end if;

  delete from public.personal_viewing_events event
  where event.id = p_event_id
    and event.owner_id = caller_id
    and event.source_journal_entry_id is null;

  return found;
end;
$$;

revoke all on function public.delete_manual_personal_viewing_event(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_manual_personal_viewing_event(uuid)
  to authenticated;

-- Browser roles may read their RLS-visible rows, insert only manual-event
-- fields and update only manual facts or the source-linked hidden flag.
revoke all on table public.personal_viewing_events
  from public, anon, authenticated, service_role;

grant select on table public.personal_viewing_events to authenticated;
grant insert (owner_id, movie_id, outcome, watched_on)
  on table public.personal_viewing_events to authenticated;
grant update (outcome, watched_on, is_hidden)
  on table public.personal_viewing_events to authenticated;

commit;
