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
- Legacy Journal entries may be edited or deleted only by their creator or a group administrator. Entries linked to a movie session follow that session's host-or-administrator permission boundary.
- A watched session's Journal entry and viewers are written atomically by `save_movie_session_journal`; each session can create at most one entry.
- Member approvals, role changes and removals are restricted to group administrators.
- Movie-night sessions, participants, selected-film snapshots and resumable game state are stored separately from the Journal.
- Only the session host or a website administrator may edit or cancel a session. Only administrators may transfer the host role; a non-admin host's transfer attempt is stopped by the `movie_sessions` UPDATE policy's `WITH CHECK`, which currently surfaces Postgres's own row-level-security message rather than a written explanation.
- A session host who is later removed from the group keeps their place in that session's history. `private.validate_movie_session()` checks host membership when the host is assigned, not on every update, so an administrator can still repair or annotate the session afterwards. Removing a member first transfers any `ACTIVE` or `CONFIRMED` session they host to the administrator performing the removal, in the same transaction.
- The Discord Journal template is generated in the browser from the saved Journal entry and copied manually. No Discord API, webhook or automatic posting is involved.

## Approving the first administrator

1. In the Supabase Dashboard, open **Authentication → Users**.
2. Invite or create the user's email/password account.
3. Sign in once through the website so the `profiles` trigger creates their profile.
4. Add that profile to `The Discordians` in `group_memberships` with role `admin`.

## Member onboarding

`member_management.sql` documents the access-request table, the secure member-management functions and the policies used by the Members screen. The same objects are created by `migrations/20260822104103_add_private_member_management.sql`; build from the migrations, and read this file to understand them.

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

`movie_sessions.sql` documents the original persistent Sessions baseline. Existing and CLI-created projects must also apply `migrations/20260823214112_add_session_planning_and_watch_state.sql` before using the current frontend. One session may remain open per group. Starting a session records its host and approved participants; Queue Roulette saves its filters, veto use and result so the room can be resumed after a refresh.

Confirming a film stores a snapshot of its title, year, artwork and metadata and creates a `CONFIRMED` session. It does not mark the film watched and does not create a Journal entry. The host or an administrator reviews the final watch date, host and participants before `mark_movie_session_watched` atomically changes the session to `WATCHED` and updates the queue item's watched state. Cancelling moves the session to `ENDED`, which is hidden from the normal history.

The optional Journal appears only after a session is watched. Drafts are saved on the session, and **Copy for Discord** first saves one real Journal entry with its viewers and then puts the resulting text on the clipboard. Entry numbers are generated by Postgres but may be corrected before saving. Nothing is posted to Discord automatically.

`20260824031315_add_discord_journal_publications.sql` adds an explicit publication record for the optional **Post to Discord** action. The browser never receives the webhook: `publish-journal-to-discord` authenticates the caller again, requires the saved Journal to belong to a watched session, checks that the caller is its host or an administrator, and builds the embed from canonical database values. Runtime, genres, viewers, status and the optional comment are included; Discord mentions are disabled. A unique row per Journal entry prevents ordinary duplicate posts. Manual **Copy for Discord** remains available.

Set the webhook in the hosted project's Edge Function secrets, then deploy the function with the platform JWT gateway disabled:

```bash
supabase secrets set DISCORD_JOURNAL_WEBHOOK_URL="https://discord.com/api/webhooks/..." --project-ref tbmxxdodprmynyiiaofj
supabase functions deploy publish-journal-to-discord --no-verify-jwt --project-ref tbmxxdodprmynyiiaofj
```

This does not make Journal publishing anonymous. The handler rejects requests without a valid Supabase user session, reloads that user through `/auth/v1/user`, and then requires the caller to be the session host or a website administrator. The gateway is disabled because `sb_publishable_...` API keys are not JWTs; the browser keeps the publishable key in `apikey` and sends the signed-in user's token in `Authorization`.

Do not place the webhook URL in `app.js`, a committed environment file, GitHub Actions output or screenshots. A failed Discord request leaves the Journal entry intact and makes the publication retryable. Editing an entry after it has posted does not edit the Discord message in this phase.

Because the group's numbering continues a Discord history that predates the website, `entry_number` is `generated by default as identity`: an explicitly typed number is accepted but does not advance the sequence on its own. `20260824031432_harden_journal_entry_numbering.sql` calls `private.sync_journal_entry_number_sequence()` after any explicitly numbered save, which moves the sequence forward past the highest number in use and never backwards. A number that is already taken is refused by name ("Journal entry #1318 already exists in this group") instead of surfacing a raw unique-constraint error. One caveat remains: `public.create_journal_entry` is still granted to `authenticated` and is no longer called by the frontend, so it can create entries that are not linked to a session and are invisible in the app. It always uses the sequence, so it cannot itself desynchronise the numbering.

## Setting up a project

Apply everything in `migrations/`, in timestamp order. That chain builds a complete, current database on its own and is what `supabase db reset` and `supabase start` use.

The canonical files in this directory (`schema.sql`, `member_management.sql`, `movie_metadata.sql`, `movie_sessions.sql`) are kept as readable documentation of how the schema was originally assembled. **They are no longer sufficient on their own**: they predate `20260823214112_add_session_planning_and_watch_state.sql`, so a database built only from them has no `host_id`, `watch_date`, `watched_at`, `journal_draft` or `journal_entries.movie_session_id`, and the current frontend cannot confirm, complete or journal a session against it. Use them to read, and the migrations to build.

## Existing-project migrations

Additive changes for the existing hosted project live under `migrations/` and must be reviewed and applied in timestamp order. Each has a matching script in `rollback/`.

The nine hosted migrations that predate this checkout have been restored under `migrations/` from the authoritative `supabase_migrations.schema_migrations` records. Each restored file preserves its original timestamp and name, and its SHA-256 digest was verified byte-for-byte against the SQL stored by Supabase. The standalone CLI token still receives HTTP 403 from the platform login-role endpoint, so `supabase migration list` and `supabase db push` require a project owner or a CLI profile with sufficient project privileges. This is now a CLI credential limitation, not missing local migration history; do not replace the restored files with generated placeholders.

`20260823001826_harden_authenticated_table_privileges.sql` removes historical automatic table and sequence grants from `anon` and `authenticated`, opts future `postgres`-owned tables, sequences and public functions out of those defaults, then restores only Cine-Cord's required authenticated operations. The hosted project's current public tables are all owned by `postgres`; that role is not a member of the Supabase-managed `supabase_admin` role, so the migration deliberately does not attempt to alter `supabase_admin` defaults. The migration was applied to the hosted project on 2026-08-23. Post-application verification found all ten public tables still protected by RLS, exactly the required 32 authenticated table grants, no anonymous table grants, no unexpected API table or sequence grants, and no unsafe `postgres` default ACLs or public/anonymous routine grants.

`20260824031315_add_discord_journal_publications.sql`, `20260824031432_harden_journal_entry_numbering.sql` and `20260824031434_protect_sessions_on_member_removal.sql` were verified against the local Supabase stack and applied to the hosted project on 2026-08-24. Their timestamps match the hosted migration history.

The Dashboard-only **Leaked password protection** setting is also not changed by repository code.

## Local verification

`tests/integration/` runs the session RPCs and the Row Level Security boundary against a real local Postgres, using several genuinely authenticated identities with different roles. The Playwright suite cannot reach any of this: it runs entirely in `?design-preview`, where every Supabase write is short-circuited in `app.js`.

```bash
npx supabase start
npm run test:db
```

Fixture setup and ground-truth reads go through `psql` as `postgres` rather than a service-role PostgREST client, because Supabase's local baseline grants `service_role` only `TRUNCATE`, `REFERENCES` and `TRIGGER` on `postgres`-owned tables in `public`. That is a property of the local stack, not of this repository's migrations — an unrelated local project shows the same default ACL. Granting `service_role` more would change the very privilege surface these tests exist to check.

The harness refuses non-loopback API URLs and derives the database container name from this repository's `project_id`. This is deliberate: the fixtures truncate application tables and delete local Auth users, so `test:db` must never be pointed at a hosted project or an arbitrary Docker container.

The suite is not wired into CI, because CI has no database service. Run it locally before changing anything under `supabase/`.

`config.toml` was added so the stack can be started at all. Two deliberate choices in it:

- **Ports are in the 545xx range** (API `54521`, database `54522`), not Supabase's 543xx defaults, so this stack can run alongside other local Supabase projects without colliding.
- **Only the database, Auth and the REST API are enabled.** Studio, Storage, Realtime, Analytics, the Edge Runtime and the local mail catcher are turned off to keep startup fast and the container count small. Re-enable any of them by setting `enabled = true` in its section — you will want the Edge Runtime to exercise `movie-lookup` locally, and Realtime if live session sync is ever built.

## Current persistence boundary

The movie list, voting, sessions, watch history, Journal drafts, Journal entries, entry viewers and explicit Discord Journal publications are persistent and active. The Journal is reached from a watched session rather than a separate top-level screen. Discord message editing, live multiplayer presence and Wrapped calculations remain outside this phase.
