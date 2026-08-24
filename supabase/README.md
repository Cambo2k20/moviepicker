# Discordians Supabase setup

Project: `tbmxxdodprmynyiiaofj`

The migrations back the private Journal, The Discordians server-profile synchronisation and explicit webhook publishing. Discord OAuth requests only `guilds.members.read` beyond normal sign-in, and webhook credentials remain only in Supabase Edge Function secrets.

## Access model

- The frontend uses only the project's publishable key.
- Anonymous roles have no table or Journal-function privileges.
- Authenticated roles receive only the explicit table operations listed in the SQL files; RLS then restricts the rows within that surface.
- Every exposed table has Row Level Security enabled.
- Signing in is not enough to read data: a user must also have a row in `group_memberships`.
- Signed-in non-members may only see the group name and their own access request. Journal data remains hidden by RLS.
- Current Journal entries may be edited only by their creator or a group administrator. Imported Discord history is immutable to website users.
- A watched session's Journal entry and viewers are written atomically by `save_movie_session_journal`; each session can create at most one entry.
- Member approvals, role changes and removals are restricted to group administrators.
- Movie-night sessions, participants, selected-film snapshots and resumable game state are stored separately from the Journal.
- Only the session host or a website administrator may edit or cancel a session. Once a watched session is linked to a Journal entry, changes that also touch that entry require its creator or a website administrator. Only administrators may transfer the host role.
- A session host who is later removed from the group keeps their place in that session's history. `private.validate_movie_session()` checks host membership when the host is assigned, not on every update, so an administrator can still repair or annotate the session afterwards. Removing a member first transfers any `ACTIVE` or `CONFIRMED` session they host to the administrator performing the removal, in the same transaction.
- The Discord Journal template can still be generated in the browser and copied manually. Explicit **Post to Discord** and **Update Discord post** actions use an authenticated Edge Function; the webhook remains server-side.

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

Authentication does not grant Journal access. A removed member immediately loses access through RLS. Discord OAuth identifies the user only; the same administrator approval and RLS boundary applies to every provider. After approval, `sync-discord-server-profile` verifies the signed-in Discord account, fetches its guild-member record for The Discordians and stores only the effective server display name/avatar. Account-wide Discord identity fields are not kept as a second profile. Members can read safe display fields for their group, but browser roles cannot read the Discord ID or write identity rows.

## Discord OAuth sign-in

The login screen checks Supabase's public Auth settings and shows **Continue with Discord** only when the provider is genuinely enabled. Email/password remains available. Discord sign-in requests `guilds.members.read`, but belonging to the Discord server still does not bypass the website access-request waiting room. Only approved website members can exchange the temporary provider token for a server-profile refresh.

The live Discord application is **DiscCompanion** with public client ID `1540885444076638308`. Its client secret is stored only in the Supabase Auth provider configuration and must never be added to this repository.

1. Create a Discord Application in the Discord Developer Portal.
2. Add this redirect URI to its OAuth2 settings:

   `https://tbmxxdodprmynyiiaofj.supabase.co/auth/v1/callback`

3. In Supabase, open **Authentication → Sign In / Providers → Discord**, enable it, and enter the Discord Client ID and Client Secret.
4. Keep the website URL below in **Authentication → URL Configuration** as both the Site URL and an allowed redirect URL.

Never place the Discord Client Secret or provider token in `app.js`, a local screenshot, a committed environment file or GitHub Pages. Supabase stores the client secret server-side. Cine-Cord sends the callback's provider token directly to the authenticated Edge Function and does not separately persist or log it; the database stores only the verified server profile. Supabase automatically links an OAuth identity to an existing user when the provider returns the same verified email; otherwise it creates a new Auth user that must request approval.

In **Authentication → URL Configuration**, set the Site URL and an allowed redirect URL to:

`https://cambo2k20.github.io/moviepicker/`

For stronger password screening, enable **Leaked password protection** in the Supabase Auth password settings.

## Movie-night sessions

`movie_sessions.sql` documents the original persistent Sessions baseline. Existing and CLI-created projects must also apply `migrations/20260823214112_add_session_planning_and_watch_state.sql` before using the current frontend. One session may remain open per group. Starting a session records its host and approved participants; Queue Roulette saves its filters, veto use and result so the room can be resumed after a refresh.

Confirming a film stores a snapshot of its title, year, artwork and metadata and creates a `CONFIRMED` session. It does not mark the film watched and does not create a Journal entry. The host or an administrator reviews the final watch date, host and participants before `mark_movie_session_watched` atomically changes the session to `WATCHED` and updates the queue item's watched state. Cancelling moves the session to `ENDED`, which is hidden from the normal history.

The optional Journal appears only after a session is watched. Drafts are saved on the session, and **Copy for Discord** first saves one real Journal entry with its viewers and then puts the resulting text on the clipboard. Entry numbers are generated by Postgres but may be corrected before saving. **Post to Discord** is a separate, explicit action; saving or copying never posts automatically.

`20260824031315_add_discord_journal_publications.sql` adds the original publication record. `20260824122806_add_master_journal_and_discord_identities.sql` extends it for Phase 1, and `20260824143921_use_discord_server_profiles.sql` replaces the original account-wide identity cache with the verified The Discordians server profile. The caller must be the entry creator or an administrator; a new webhook post requires that caller's synchronised server display name/avatar, while later updates PATCH the stored Discord message ID without changing its original author. A unique row per Journal entry and the stored Discord message ID prevent ordinary duplicate posts. Runtime, genres, current viewers, status and the optional comment are built from canonical database values; Discord mentions are disabled. Manual **Copy for Discord** remains available even when a server profile has not been connected.

Set the webhook in the hosted project's Edge Function secrets, then deploy the function with the platform JWT gateway disabled:

```bash
supabase secrets set DISCORD_JOURNAL_WEBHOOK_URL="https://discord.com/api/webhooks/..." --project-ref tbmxxdodprmynyiiaofj
supabase functions deploy sync-discord-server-profile --no-verify-jwt --project-ref tbmxxdodprmynyiiaofj
supabase functions deploy publish-journal-to-discord --no-verify-jwt --project-ref tbmxxdodprmynyiiaofj
```

This does not make either function anonymous. Each handler rejects requests without a valid Supabase user session and reloads that user through `/auth/v1/user`. The profile handler additionally requires approved membership and checks that Discord returned the same Discord account attached to the Supabase user. The publisher then requires the caller to be the entry creator or a website administrator. The gateway is disabled because `sb_publishable_...` API keys are not JWTs; the browser keeps the publishable key in `apikey` and sends the signed-in user's token in `Authorization`.

For privileged database reads and writes, both functions require `SUPABASE_SECRET_KEYS.default` when the hosted named-key environment is available, then fall back to the local `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY` variable. Modern `sb_secret_...` keys are sent only in `apikey`; unlike legacy service-role JWTs, they must not be placed in `Authorization`. `20260824085556_grant_discord_journal_publisher_privileges.sql` and the Phase 1 migration give `service_role` SELECT access to the canonical tables used to build and authorise a post, plus INSERT/UPDATE access to `discord_publications`. The server-profile migration adds only the Discord identity columns required for INSERT/UPDATE and explicitly keeps DELETE unavailable. These grants do not add writes to Journals, sessions, members or profiles. Secret keys bypass RLS, but PostgreSQL table privileges are still required.

Do not place the webhook URL in `app.js`, a committed environment file, GitHub Actions output or screenshots. A failed Discord request leaves the Journal entry intact. Editing an entry after posting marks the Discord copy out of date; nothing changes in Discord until an authorised member presses **Update Discord post**. That action edits the existing message and never creates a replacement.

Current Cine-Cord entries can also be permanently deleted by their creator or a website administrator. The same authenticated Edge Function handles deletion: when a confirmed Discord message exists, it deletes that exact webhook message first and stops without touching Supabase if Discord refuses. It then deletes the Journal row with the caller's Authorization header, so the existing Row Level Security policy remains authoritative; dependent viewer and publication rows cascade automatically. The watched session remains, its retained Journal draft is cleared when the caller may still manage that session, and entry numbers are never rewound or reused. Imported archive entries remain immutable and are never offered this action.

## Master Journal and historical import

The `journal_catalog` security-invoker view combines current `journal_entries` with immutable `journal_archive_entries`. Every row keeps its source volume and original Discord message URL. The archive whitelist is fixed to the three established channels in guild `272427070779293697`; `webhooktest` and any other channel are excluded.

The importer reads the backups without changing them and defaults to a dry run:

```powershell
npm run journal:import -- --source "C:\Users\Cambo\Documents\2. Programming GameDEV\Scripts\Discord Bot\backups\272427070779293697"
```

To test an actual import against the local Supabase stack, set its loopback URL and service-role key, then add `--apply`. Re-running is idempotent because rows are upserted by Discord message ID. The script refuses a hosted URL unless `--allow-hosted` is also supplied; that flag is an explicit production-data approval gate, not part of normal validation.

The inspected backup currently yields 1,347 entries: 1,341 parsed and six retained with `REVIEW` status for a source anomaly. Fifteen divider/conversation messages are skipped. No imported row is editable on the website.

Because the group's numbering continues a Discord history that predates the website, `entry_number` is `generated by default as identity`: an explicitly typed number is accepted but does not advance the sequence on its own. `20260824031432_harden_journal_entry_numbering.sql` calls `private.sync_journal_entry_number_sequence()` after any explicitly numbered save, which moves the sequence forward past the highest number in use and never backwards. A number that is already taken is refused by name ("Journal entry #1318 already exists in this group") instead of surfacing a raw unique-constraint error. One caveat remains: `public.create_journal_entry` is still granted to `authenticated` and is no longer called by the frontend, so it can create entries that are not linked to a session and are invisible in the app. It always uses the sequence, so it cannot itself desynchronise the numbering.

## Setting up a project

Apply everything in `migrations/`, in timestamp order. That chain builds a complete, current database on its own and is what `supabase db reset` and `supabase start` use.

The canonical files in this directory (`schema.sql`, `member_management.sql`, `movie_metadata.sql`, `movie_sessions.sql`) are kept as readable documentation of how the schema was originally assembled. **They are no longer sufficient on their own**: they predate `20260823214112_add_session_planning_and_watch_state.sql`, so a database built only from them has no `host_id`, `watch_date`, `watched_at`, `journal_draft` or `journal_entries.movie_session_id`, and the current frontend cannot confirm, complete or journal a session against it. Use them to read, and the migrations to build.

## Existing-project migrations

Additive changes for the existing hosted project live under `migrations/` and must be reviewed and applied in timestamp order. Each has a matching script in `rollback/`.

The nine hosted migrations that predate this checkout have been restored under `migrations/` from the authoritative `supabase_migrations.schema_migrations` records. Each restored file preserves its original timestamp and name, and its SHA-256 digest was verified byte-for-byte against the SQL stored by Supabase. The standalone CLI token still receives HTTP 403 from the platform login-role endpoint, so `supabase migration list` and `supabase db push` require a project owner or a CLI profile with sufficient project privileges. This is now a CLI credential limitation, not missing local migration history; do not replace the restored files with generated placeholders.

`20260823001826_harden_authenticated_table_privileges.sql` removes historical automatic table and sequence grants from `anon` and `authenticated`, opts future `postgres`-owned tables, sequences and public functions out of those defaults, then restores only Cine-Cord's required authenticated operations. The hosted project's current public tables are all owned by `postgres`; that role is not a member of the Supabase-managed `supabase_admin` role, so the migration deliberately does not attempt to alter `supabase_admin` defaults. The migration was applied to the hosted project on 2026-08-23. Post-application verification found all ten public tables still protected by RLS, exactly the required 32 authenticated table grants, no anonymous table grants, no unexpected API table or sequence grants, and no unsafe `postgres` default ACLs or public/anonymous routine grants.

`20260824031315_add_discord_journal_publications.sql`, `20260824031432_harden_journal_entry_numbering.sql`, `20260824031434_protect_sessions_on_member_removal.sql` and `20260824085556_grant_discord_journal_publisher_privileges.sql` were applied to the hosted project on 2026-08-24 and verified against the local Supabase stack. The final publisher grant was also verified directly against the hosted role privileges after application. Their timestamps match the hosted migration history.

`20260824122806_add_master_journal_and_discord_identities.sql` supplies the Phase 1 master Journal and original identity cache. `20260824143921_use_discord_server_profiles.sql` is the server-profile cutover: it clears those cached account-wide identity rows, removes the old metadata-derived RPC and requires each member to authorise one fresh server-profile sync. Apply that migration and deploy both Edge Functions before publishing the matching frontend; production application and deployment remain explicit approval gates.

The Dashboard-only **Leaked password protection** setting is also not changed by repository code.

## Local verification

`tests/integration/` runs the session RPCs and the Row Level Security boundary against a real local Postgres, using several genuinely authenticated identities with different roles. The Playwright suite cannot reach any of this: it runs entirely in `?design-preview`, where every Supabase write is short-circuited in `app.js`.

```bash
npx supabase start
npm run test:db
```

Fixture setup and ground-truth reads go through `psql` as `postgres` rather than a service-role PostgREST client. The local baseline gives `service_role` non-DML privileges such as `TRUNCATE`, `REFERENCES` and `TRIGGER` on `postgres`-owned public tables; the Discord publisher migration deliberately adds its tested SELECT and publication INSERT/UPDATE surface, but not the broad fixture privileges required across the rest of the schema.

The harness refuses non-loopback API URLs and derives the database container name from this repository's `project_id`. This is deliberate: the fixtures truncate application tables and delete local Auth users, so `test:db` must never be pointed at a hosted project or an arbitrary Docker container.

The suite is not wired into CI, because CI has no database service. Run it locally before changing anything under `supabase/`.

`config.toml` was added so the stack can be started at all. Two deliberate choices in it:

- **Ports are in the 545xx range** (API `54521`, database `54522`), not Supabase's 543xx defaults, so this stack can run alongside other local Supabase projects without colliding.
- **Only the database, Auth and the REST API are enabled.** Studio, Storage, Realtime, Analytics, the Edge Runtime and the local mail catcher are turned off to keep startup fast and the container count small. Re-enable any of them by setting `enabled = true` in its section — you will want the Edge Runtime to exercise `movie-lookup` locally, and Realtime if live session sync is ever built.

## Current persistence boundary

The movie list, voting, sessions, watch history, Journal drafts, current Journal entries, the historical Journal catalog, Discord server identities and explicit Discord Journal publications are persistent and active. Current entries can be reached from watched sessions or the top-level Journal. Discord slash-command editing and modals, live multiplayer presence and Wrapped calculations remain outside this phase.
