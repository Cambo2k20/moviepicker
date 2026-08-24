begin;

-- The Discord publisher authenticates callers itself, then uses Supabase's
-- server-only secret key for the database work below. The secret key bypasses
-- RLS, but PostgreSQL still requires explicit table privileges.
grant select on table
  public.journal_entries,
  public.movie_sessions,
  public.group_memberships,
  public.movie_session_participants,
  public.profiles,
  public.discord_publications
to service_role;

-- Publication delivery state is the only data this integration may create or
-- change. It does not need to mutate sessions, Journals, members or profiles.
grant insert, update on table public.discord_publications to service_role;

commit;
