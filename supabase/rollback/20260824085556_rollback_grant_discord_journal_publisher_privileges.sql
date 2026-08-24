begin;

revoke select on table
  public.journal_entries,
  public.movie_sessions,
  public.group_memberships,
  public.movie_session_participants,
  public.profiles,
  public.discord_publications
from service_role;

revoke insert, update on table public.discord_publications from service_role;

commit;
