begin;

-- A current Journal event is authoritative for the viewer's current state,
-- while their rating and Favourite remain independent private choices.
create or replace function private.sync_personal_film_state_from_viewing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_journal_entry_id is null then
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

revoke all on function private.sync_personal_film_state_from_viewing_event()
  from public, anon, authenticated, service_role;

create trigger personal_viewing_events_sync_personal_film_state
after insert or update of movie_id, outcome, source_journal_entry_id
on public.personal_viewing_events
for each row execute function private.sync_personal_film_state_from_viewing_event();

comment on function private.sync_personal_film_state_from_viewing_event() is
  'Promotes current Journal viewing events into each viewer''s private current film state without changing rating or Favourite.';

commit;
