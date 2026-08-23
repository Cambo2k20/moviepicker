begin;

-- Supabase's historical default ACLs can grant every table privilege to API
-- roles. RLS does not govern TRUNCATE, REFERENCES, TRIGGER or MAINTAIN, so
-- replace inherited grants with the application's explicit Data API surface.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

grant select on table public.groups to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.group_memberships to authenticated;
grant select, insert, update, delete on table public.group_join_requests to authenticated;
grant select, insert, update, delete on table public.journal_entries to authenticated;
grant select, insert, delete on table public.entry_viewers to authenticated;
grant select, insert, update, delete on table public.queue_items to authenticated;
grant select, insert, delete on table public.queue_votes to authenticated;
grant select, insert, update, delete on table public.movie_sessions to authenticated;
grant select, insert, delete on table public.movie_session_participants to authenticated;
grant usage, select on sequence public.journal_entries_entry_number_seq to authenticated;

commit;
