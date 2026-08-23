# Discordians Supabase setup

Project: `tbmxxdodprmynyiiaofj`

The schema in `schema.sql` backs the private Journal. Discord OAuth may authenticate a user, but the schema contains no Discord webhooks, bot tokens, posting integration or server permissions.

## Access model

- The frontend uses only the project's publishable key.
- Anonymous roles have no table or Journal-function privileges.
- Authenticated roles receive only the explicit table operations listed in the SQL files; RLS then restricts the rows within that surface.
- Every exposed table has Row Level Security enabled.
- Signing in is not enough to read data: a user must also have a row in `group_memberships`.
- Signed-in non-members may only see the group name and their own access request. Journal data remains hidden by RLS.
- Journal entries may be edited or deleted only by their creator or a group administrator.
- New Journal entries and their viewers are written atomically by `create_journal_entry`.
- Member approvals, role changes and removals are restricted to group administrators.
- Movie-night sessions, participants, selected-film snapshots and resumable game state are stored separately from the Journal.
- Only the session host or a website administrator may change or end a session.
- The Discord Journal template is generated in the browser for manual copying; no Discord API, webhook or Journal-table write is involved.

## Approving the first administrator

1. In the Supabase Dashboard, open **Authentication → Users**.
2. Invite or create the user's email/password account.
3. Sign in once through the website so the `profiles` trigger creates their profile.
4. Add that profile to `The Discordians` in `group_memberships` with role `admin`.

## Member onboarding

Apply `member_management.sql` after the base schema. It adds the access-request table, secure member-management functions and the policies used by the Members screen.

1. A friend signs in with Discord or creates an email/password account and confirms their email if required.
2. They request access with the display name they use in the Journal.
3. An administrator opens **Members** and approves or declines the request.
4. Approval creates the profile/membership and removes the pending request in one database transaction.

Authentication does not grant Journal access. A removed member immediately loses access through RLS. Discord OAuth identifies the user only; the same administrator approval and RLS boundary applies to every provider.

## Discord OAuth sign-in

The login screen checks Supabase's public Auth settings and shows **Continue with Discord** only when the provider is genuinely enabled. Email/password remains available. Discord sign-in does not inspect guild membership and does not bypass the access-request waiting room.

The live Discord application is **DiscCompanion** with public client ID `1540885444076638308`. Its client secret is stored only in the Supabase Auth provider configuration and must never be added to this repository.

1. Create a Discord Application in the Discord Developer Portal.
2. Add this redirect URI to its OAuth2 settings:

   `https://tbmxxdodprmynyiiaofj.supabase.co/auth/v1/callback`

3. In Supabase, open **Authentication → Sign In / Providers → Discord**, enable it, and enter the Discord Client ID and Client Secret.
4. Keep the website URL below in **Authentication → URL Configuration** as both the Site URL and an allowed redirect URL.

Never place the Discord Client Secret in `app.js`, a local screenshot, a committed environment file or GitHub Pages. Supabase stores the secret server-side. Supabase automatically links an OAuth identity to an existing user when the provider returns the same verified email; otherwise it creates a new Auth user that must request approval.

In **Authentication → URL Configuration**, set the Site URL and an allowed redirect URL to:

`https://cambo2k20.github.io/moviepicker/`

For stronger password screening, enable **Leaked password protection** in the Supabase Auth password settings.

## Movie-night sessions

Apply `movie_sessions.sql` to add the persistent Sessions feature. One session may remain open per group. Starting a session records its host and approved participants; Queue Roulette saves its filters, veto use and result so the room can be resumed after a refresh.

Confirming a film stores a snapshot of its title, year, artwork and metadata. This keeps the session history understandable even if the corresponding list item is removed later. Ending a session moves it to website session history without marking the film watched.

The optional **Copy for Discord** form is deliberately client-side. The entry number, viewers, status and comment are editable, and the resulting text is placed on the clipboard only after the user presses the copy button.

## Existing-project migrations

Canonical setup files are kept readable for a fresh project. Additive changes for the existing hosted project live under `migrations/` and must be reviewed and applied in timestamp order.

The nine hosted migrations that predate this checkout have been restored under `migrations/` from the authoritative `supabase_migrations.schema_migrations` records. Each restored file preserves its original timestamp and name, and its SHA-256 digest was verified byte-for-byte against the SQL stored by Supabase. The standalone CLI token still receives HTTP 403 from the platform login-role endpoint, so `supabase migration list` and `supabase db push` require a project owner or a CLI profile with sufficient project privileges. This is now a CLI credential limitation, not missing local migration history; do not replace the restored files with generated placeholders.

`20260823001826_harden_authenticated_table_privileges.sql` removes historical automatic table and sequence grants from `anon` and `authenticated`, opts future `postgres`-owned tables, sequences and public functions out of those defaults, then restores only Cine-Cord's required authenticated operations. The hosted project's current public tables are all owned by `postgres`; that role is not a member of the Supabase-managed `supabase_admin` role, so the migration deliberately does not attempt to alter `supabase_admin` defaults. The migration was applied to the hosted project on 2026-08-23. Post-application verification found all ten public tables still protected by RLS, exactly the required 32 authenticated table grants, no anonymous table grants, no unexpected API table or sequence grants, and no unsafe `postgres` default ACLs or public/anonymous routine grants.

The Dashboard-only **Leaked password protection** setting is also not changed by repository code.

## Current persistence boundary

Journal entries and viewers are persistent at the database layer, but the active frontend does not currently expose a Journal screen or write flow. The movie list, voting and movie-night sessions are persistent and active. Discord posting, live multiplayer presence and Wrapped calculations remain outside this phase.
