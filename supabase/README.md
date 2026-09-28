# Discordians Supabase setup

Project: `tbmxxdodprmynyiiaofj`

The migrations back the canonical movie catalogue, private Journal, The Discordians server-profile synchronisation and explicit webhook publishing. Discord OAuth requests only `guilds.members.read` beyond normal sign-in, and TMDB/webhook credentials remain only in Supabase Edge Function secrets.

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
- Canonical movie metadata is readable by approved members but writable only by the protected `movie-lookup` Edge Function. Queue items, sessions and current Journal entries link to it without replacing their historical snapshots.
- Only the session host or a website administrator may edit or cancel a session. Once a watched session is linked to a Journal entry, changes that also touch that entry require its creator or a website administrator. Only administrators may transfer the host role. A session can be deleted only after its linked Journal entry has been deleted, so a Discord publication is never silently orphaned; deleting an unlinked session also removes its derived participants and clears the shared watched flag when no watched session remains for that film.
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

The Members screen has a one-time repair action for the legacy `cameron_brown00` profile. It moves that member's shared queue suggestions to the current administrator, transfers any still-open sessions using the existing member-removal rule, then removes only the old account's Cine-Cord group membership. The profile, Auth account, private history and watched-session audit data remain intact; other members cannot read those private rows.

The administrator-only **Cine-Cord hub** publishes one persistent Discord message with link buttons for the live site, Sessions, Journal and My Cinema. It uses a separate webhook so the Journal publisher and the server entrance cannot overwrite each other. Configure it with the production site URL and a webhook created for the chosen hub channel, then deploy the function:

```bash
supabase secrets set DISCORD_CINE_CORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." CINE_CORD_SITE_URL="https://cambo2k20.github.io/moviepicker/" --project-ref tbmxxdodprmynyiiaofj
supabase functions deploy publish-cine-cord-hub --no-verify-jwt --project-ref tbmxxdodprmynyiiaofj
```

Only an approved group administrator can publish or update the message. Repeating the action edits the recorded Discord message rather than creating another hub post. The webhook URL remains in Edge Function secrets and is never sent to the browser.

## Canonical movie foundation

`20260824220827_add_canonical_movie_foundation.sql` creates `public.movies`, with one UUID-backed row per TMDB movie. The catalogue stores safe display metadata only: title, original title/language, release date/year, poster path, runtime, genres and overview. Approved members can read it through RLS; browser roles cannot insert, update or delete it. `service_role` receives only `SELECT`, `INSERT` and `UPDATE`, which is the exact surface required by the protected lookup's PostgREST upsert.

The existing `movie-lookup` Edge Function remains the only browser route to TMDB. Its `details` action fetches TMDB server-side, upserts the canonical row with `SUPABASE_SECRET_KEYS.default` (or the documented local/legacy fallback), and returns the safe metadata plus `movieId`. Neither the TMDB token nor a Supabase secret enters `app.js`.

`queue_items.movie_id`, `movie_sessions.selected_movie_id` and `journal_entries.movie_id` are nullable compatibility bridges. Existing TMDB-backed queue/session snapshots are backfilled; session-linked current Journal entries inherit the session identity. Old frontend builds that send only `tmdb_id` are auto-linked when that canonical row exists, and genuinely manual queue rows remain valid with no identity. The immutable `journal_archive_entries` table is deliberately untouched: title/year-only history is not reliable enough for automatic matching.

Release order matters:

1. Apply the database migration so `movies` and its compatibility columns exist.
2. Deploy `movie-lookup`, which begins upserting and returning canonical UUIDs.
3. Publish the frontend, which writes those UUIDs into queue items and sessions.

The frontend remains compatible with the previous function response because a missing `movieId` is written as null. Deploying the new Edge Function before the migration is not compatible: its canonical upsert would fail because `public.movies` would not exist.

## Phase 2A personal-film foundation

`20260825132802_add_personal_films.sql` begins the Phase 2A implementation. It creates one owner-private `personal_films` row per member and canonical movie, containing only the current state, one nullable 1–5 enjoyment rating and the independent Favourite marker. Reviews, private notes and personal-list membership remain later migrations; viewing events are handled by the Phase 2B foundation below.

The table is owner-only through RLS and also requires the owner to retain approved group membership. Administrators cannot inspect another member's rows. Membership removal hides retained data immediately, while Auth-account deletion cascades through `profiles` and removes the personal rows. Browser privileges are column-limited: members cannot rewrite ownership, canonical identity or audit timestamps.

Rating insertion or change atomically marks the film `WATCHED` unless `DID_NOT_FINISH` is explicit. Clearing a rating leaves state and Favourite unchanged. Personal-film writes never add to or alter `queue_items`, so Suggest for Cine-Cord remains a separate future action.

The Phase 2A migration and its user-facing My Films flows are deployed in production. Their authenticated database, unit, build, responsive Playwright and production migration-parity gates passed before publication on 13 September 2026.

## Phase 2B viewing-event foundation

`20260913114500_add_personal_viewing_events.sql` adds the first deployed Phase 2B foundation. `personal_viewing_events` stores owner-private Finished or Did Not Finish history against canonical movie identity, independently from `personal_films`, so current state, rating or Favourite removal cannot silently erase history. Manual events may repeat for rewatches and may omit their watched date.

The table also reserves a nullable current-Journal source. A partial unique index prevents one Journal entry from generating duplicate history for one owner. Source-linked facts cannot be edited or deleted through the personal browser surface: the owner may only hide or reveal the derived event, while shared corrections remain in the authorised Journal flow. Deleting the Journal source removes its derived event. This migration does not create source-linked rows; verified current-Journal synchronisation is a separate reviewed patch, and imported archive names remain ineligible for automatic linking.

RLS requires both ownership and approved membership, including for administrators. Column privileges keep ownership, movie identity, source identity and audit timestamps immutable. Direct table deletion is withheld; `delete_manual_personal_viewing_event` deletes only the caller's manual rows. Membership removal hides retained events immediately, while Auth-account deletion cascades through the owner profile and removes them.

The Phase 2B migration was applied to the hosted project on 13 September 2026. Its migration-ledger statement matches the checked-in SQL exactly, and merge commit `521ea03` passed authenticated integration tests, production migration parity, unit tests, build and Playwright before GitHub Pages deployment. It adds no frontend history surface, note, review or automatic Journal linking.

`20260913141314_sync_current_journal_viewing_events.sql` is the Phase 2B.1 follow-up for current-Journal synchronisation. When applied, a current `journal_entries` row creates or updates an owner-private event only for viewers represented by a real `entry_viewers.profile_id` and only when the entry has a verified canonical `movie_id`. `FINISHED` maps to `FINISHED`, `DNF` maps to `DID_NOT_FINISH`, and `watched_at` becomes `watched_on`. Removing a current viewer or canonical link removes only that reproducible derived event; deleting the current Journal source retains the foundation's cascade behavior.

The trigger is deferred until transaction end because the existing Journal editor replaces its viewer rows within one transaction. Synchronisation therefore observes the final viewer set and preserves the event ID and the owner's private `is_hidden` choice. It does not update `personal_films`: that table has no provenance field that can distinguish an older Journal-derived state from a newer deliberate member choice, so automating current state would risk overwriting the member's intent.

The migration and backfill never read from or write to `journal_archive_entries`, never match free-text archive viewer names, and never call the Discord publication function or webhook. Imported historic Discord entries and their original messages remain unchanged. Its rollback stops future synchronisation and restores the foundation's update guard without deleting already-derived events or their private hidden choices; those rows remain frozen until the migration is reapplied. Manual events, current Journal rows, archive rows and Discord content also remain intact.

The synchronisation migration was applied to the hosted project on 13 September 2026 and its migration-ledger statement matches the checked-in SQL. Release verification found no currently eligible verified viewer/movie pairs, so the safe backfill created no source-linked rows; the existing archive row count remained unchanged. Merge commit `27d5d92` passed the database, migration-parity, unit, build and Playwright gates before release.

## Phase 2C personal reviews and publications

`20260927120000_add_personal_reviews.sql` separates owner-private drafts in `personal_reviews` from deliberate approved-group snapshots in `published_reviews`. This split is a privacy boundary: another member can select a published snapshot without receiving the author's later unpublished draft through the same row. Each member may keep one review of up to 1,000 characters per canonical movie and may mark it as containing spoilers.

A rating is optional. `publish_personal_review` copies the current draft, spoiler choice and any current rating into the published table. Later draft or rating edits do not change that snapshot until the author publishes again. Clearing or deleting the personal rating removes only the published rating value immediately; the text review stays visible. `unpublish_personal_review` removes the snapshot while retaining the draft, and deleting the draft cascades to its publication.

Private-draft RLS requires ownership and approved membership. Published-review RLS requires the reader and author to share a current approved group, so removing the author from Cine-Cord hides their retained publication immediately. Auth-account deletion removes both records. Browser roles receive owner-limited draft columns, read-only access to RLS-visible publications and only the two reviewed publication functions; they cannot write snapshot rows directly.

The migration applies cleanly to the isolated local Supabase stack, and the complete 82-test authenticated integration suite passes with multiple member identities. The hosted migration and production release remain explicit later gates.

This migration is additive and has a matching rollback. It is implemented in this checkout but has not been applied to the hosted project.

`20260928210000_add_member_profiles.sql` adds the first curated Member Profiles slice and canonical TMDB backdrop storage. A member edits an owner-private introduction, ordered Top Five, Top Five-derived banner choice and two publication toggles, where every featured film must already be in that member's private My Cinema. `save_member_profile_draft` stores those edits privately; `publish_member_profile` copies the selected movie metadata, four aggregate statistics and optional snapshots of up to five visible recent watches and three finished-film genre counts into separate group-visible rows. Hidden viewing events are excluded, readers never receive source private rows and later private changes do not alter the snapshot until republished. `unpublish_member_profile` removes only the published snapshot. `get_member_profiles` is the only public profile feed and requires current approved membership, so removing either the reader or publisher hides the snapshot immediately. The migration exposes owner-limited draft reads and the four reviewed RPCs to authenticated users but withholds direct browser writes to all draft and publication tables. Reward cosmetics remain a later slice.

`20260928220000_add_archive_match_candidates.sql` adds an administrator-only cache of ranked TMDB suggestions for imported Discord Journal rows. The matching function normalises punctuation and accents, permits a five-year release window, scores title and year agreement, and labels candidates as strong, review or ambiguous. `get_archive_history_match_candidates` exposes only the candidates for the current administrator's group. The `match-archive-history` Edge Function performs the TMDB search server-side, caches at most five candidates per row and never creates a canonical movie or private viewing event; an administrator must still approve the final match, individually or through the strict batch dry run described below. Deploy it after applying the migration:

```bash
supabase functions deploy match-archive-history --no-verify-jwt --project-ref tbmxxdodprmynyiiaofj
```

The function requires the existing `TMDB_READ_ACCESS_TOKEN`, Supabase publishable key and secret-key environment variables. The gateway is disabled for the same reason as the other browser-invoked functions; the handler validates the signed-in user and administrator membership itself.

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

Current Cine-Cord entries can also be permanently deleted by their creator or a website administrator, including entries whose original watch session is missing. The same authenticated Edge Function handles deletion: when a confirmed Discord message exists, it deletes that exact webhook message first and stops without touching Supabase if Discord refuses. It then deletes the Journal row with the caller's Authorization header, so the existing Row Level Security policy remains authoritative; dependent viewer and publication rows cascade automatically. A linked watched session remains and its retained Journal draft is cleared when the caller may still manage that session; sessionless entries simply skip that optional cleanup. Entry numbers are never rewound or reused. Imported archive entries remain immutable and are never offered this action.

## Master Journal and historical import

The `journal_catalog` security-invoker view combines current `journal_entries` with immutable `journal_archive_entries`. Every row keeps its source volume and original Discord message URL. The archive whitelist is fixed to the three established channels in guild `272427070779293697`; `webhooktest` and any other channel are excluded.

The importer reads the backups without changing them and defaults to a dry run:

```powershell
npm run journal:import -- --source "C:\Users\Cambo\Documents\2. Programming GameDEV\Scripts\Discord Bot\backups\272427070779293697"
```

To test an actual import against the local Supabase stack, set its loopback URL and service-role key, then add `--apply`. Re-running is idempotent because rows are upserted by Discord message ID. The script refuses a hosted URL unless `--allow-hosted` is also supplied; that flag is an explicit production-data approval gate, not part of normal validation.

The historical import also backfills private viewing events for confirmed account
aliases. `Cambo`, `Camebo` and `Cameron` resolve to the current `Cambo` profile;
`Dean` resolves to `deanshelton17`. The resolver scans compacted viewer text for
those exact names, so a line such as `Cameron Dean Andrew` produces one private
event for each confirmed account and does not assign the unmatched names. An
event is created only when the target profile exists and the archive title/year
matches exactly one canonical movie. The archive row remains immutable, and the
event keeps `source_archive_entry_id` so it stays owner-private, idempotent and
auditable. Unmatched profiles, missing years and ambiguous or missing canonical
movies are reported rather than guessed.

The inspected backup currently yields 1,371 entries: 1,365 parsed and six retained with `REVIEW` status for a source anomaly. Fifteen divider/conversation messages are skipped. A single Discord message may contain multiple numbered entries; those are stored as separate immutable archive rows with the original message ID plus a one-based `entry_index`. No imported row is editable on the website.

Administrators can use the Members page's Journal history reconciliation tool to preview imported rows against the canonical `movies` table. Titles are normalised across punctuation and ampersands, and a close candidate may be surfaced when its release year is within five years of the archive year. Approximate matches remain review-only: the closest canonical film is shown, but an administrator must confirm the film and viewers before it can be applied. `public.apply_archive_history_reconciliation()` processes exact unique title/year matches with a recognised current Cambo or Dean viewer, plus explicit administrator-approved review decisions saved by `public.save_archive_history_reconciliation_review()`. The review decision layer keeps imported rows immutable while recording the chosen canonical movie and selected current viewer keys. It can also mark an entry skipped without creating history. Approved matches create or update owner-private `personal_viewing_events` with `source_archive_entry_id`; the existing trigger then promotes each owner to `WATCHED` or `DID_NOT_FINISH`. The tool is idempotent, leaves `queue_items` unchanged, and reports ambiguous, unmatched, incomplete or unresolved-viewer rows without guessing. The preview, review and apply RPCs are authenticated administrator-only functions; they do not expose one member's private events to another member.

`20260928230000_add_archive_bulk_approval.sql` adds an administrator-only dry run and confirmed batch approval for clear imported matches. `preview_archive_history_bulk_approval` considers only parsed FINISHED/DNF rows with a watch date, release year, recognised current Cambo/Dean accounts, exactly one matching account per viewer name, no prior review and no existing private source event. A cached TMDB candidate must match the normalised archive title and exact release year with perfect title/overall scores and no close alternative; a previously approved film identity can be reused for the same archive title/year if no cached or canonical identity conflicts. The preview returns the exact film/viewer proposals and a change token. `apply_archive_history_bulk_approval` recalculates those proposals, rejects stale tokens, creates only missing canonical films and records approval decisions atomically. It does **not** create private history: the administrator must separately run the existing Sync action. Uncertain rows remain in the individual review queue. Both RPCs require a current group administrator; browser roles have no direct candidate/review table writes. The rollback removes the RPCs while preserving previously approved records.

`20260928230001_speed_up_archive_history_preview.sql` limits fuzzy title scoring to entries that the exact preview reports as `NO_CANONICAL_MOVIE`, and normalises each eligible archive/canonical title once per preview. Previously the fallback scored every archive entry against every canonical film within five years, including already-approved entries, so the larger catalog could exceed PostgREST's statement timeout. The RPC signature, administrator gate, matching threshold and review-only handling of approximate matches are unchanged. Its rollback restores the former query; it does not alter archive, review or private-history rows.

`20260928230002_rank_archive_bulk_review.sql` adds a separate administrator-only bulk review path, leaving the older exact-only RPCs intact. The new dry run ranks previously approved identities, exact TMDB hits and strong cached TMDB hits. A strong hit must have a score and title score of at least 0.90, a release-year difference of at most two, and no alternative candidate within 0.15 of its score. The existing parsed-record, confirmed Cambo/Dean account, canonical-conflict and unsynced-source checks still apply. The administrator selects specific proposals; `apply_archive_history_bulk_review` rechecks the complete preview token and selection before atomically saving only those review decisions. It creates no private events; Sync remains separate. Entries without a confirmed current viewer/account stay unassigned. Its rollback removes only the new RPCs and helpers, without changing approved records.

Because the group's numbering continues a Discord history that predates the website, `entry_number` is `generated by default as identity`: an explicitly typed number is accepted but does not advance the sequence on its own. `20260824031432_harden_journal_entry_numbering.sql` calls `private.sync_journal_entry_number_sequence()` after any explicitly numbered save, which moves the sequence forward past the highest number in use and never backwards. A number that is already taken is refused by name ("Journal entry #1318 already exists in this group") instead of surfacing a raw unique-constraint error. One caveat remains: `public.create_journal_entry` is still granted to `authenticated` and is no longer called by the frontend, so it can create entries that are not linked to a session. Those entries remain visible in the master Journal and may be edited or deleted there, but cannot be reached from Sessions. The function always uses the sequence, so it cannot itself desynchronise the numbering.

## Setting up a project

Apply everything in `migrations/`, in timestamp order. That chain builds a complete, current database on its own and is what `supabase db reset` and `supabase start` use.

The canonical files in this directory (`schema.sql`, `member_management.sql`, `movie_metadata.sql`, `movie_sessions.sql`) are kept as readable documentation of how the schema was originally assembled. **They are no longer sufficient on their own**: they predate `20260823214112_add_session_planning_and_watch_state.sql`, so a database built only from them has no `host_id`, `watch_date`, `watched_at`, `journal_draft` or `journal_entries.movie_session_id`, and the current frontend cannot confirm, complete or journal a session against it. Use them to read, and the migrations to build.

## Existing-project migrations

Additive changes for the existing hosted project live under `migrations/` and must be reviewed and applied in timestamp order. Each has a matching script in `rollback/`.

The nine hosted migrations that predate this checkout have been restored under `migrations/` from the authoritative `supabase_migrations.schema_migrations` records. Each restored file preserves its original timestamp and name, and its SHA-256 digest was verified byte-for-byte against the SQL stored by Supabase. The standalone CLI token still receives HTTP 403 from the platform login-role endpoint, so `supabase migration list` and `supabase db push` require a project owner or a CLI profile with sufficient project privileges. This is now a CLI credential limitation, not missing local migration history; do not replace the restored files with generated placeholders.

`20260823001826_harden_authenticated_table_privileges.sql` removes historical automatic table and sequence grants from `anon` and `authenticated`, opts future `postgres`-owned tables, sequences and public functions out of those defaults, then restores only Cine-Cord's required authenticated operations. The hosted project's current public tables are all owned by `postgres`; that role is not a member of the Supabase-managed `supabase_admin` role, so the migration deliberately does not attempt to alter `supabase_admin` defaults. The migration was applied to the hosted project on 2026-08-23. Post-application verification found all ten public tables still protected by RLS, exactly the required 32 authenticated table grants, no anonymous table grants, no unexpected API table or sequence grants, and no unsafe `postgres` default ACLs or public/anonymous routine grants.

`20260824031315_add_discord_journal_publications.sql`, `20260824031432_harden_journal_entry_numbering.sql`, `20260824031434_protect_sessions_on_member_removal.sql` and `20260824085556_grant_discord_journal_publisher_privileges.sql` were applied to the hosted project on 2026-08-24 and verified against the local Supabase stack. The final publisher grant was also verified directly against the hosted role privileges after application. Their timestamps match the hosted migration history.

`20260824122806_add_master_journal_and_discord_identities.sql` supplies the Phase 1 master Journal and original identity cache. `20260824143921_use_discord_server_profiles.sql` is the server-profile cutover: it clears those cached account-wide identity rows, removes the old metadata-derived RPC and requires each member to authorise one fresh server-profile sync. Apply that migration and deploy both Edge Functions before publishing the matching frontend; production application and deployment remain explicit approval gates. The canonical movie migration has its own database → `movie-lookup` → frontend release order documented above and the same explicit production gate.

The Dashboard-only **Leaked password protection** setting is also not changed by repository code.

## Local verification

`tests/integration/` runs the session RPCs and the Row Level Security boundary against a real local Postgres, using several genuinely authenticated identities with different roles. The Playwright suite cannot reach any of this: it runs entirely in `?design-preview`, where every Supabase write is short-circuited in `app.js`.

```bash
npx supabase start
npm run test:db
```

Fixture setup and ground-truth reads go through `psql` as `postgres` rather than a service-role PostgREST client. The local baseline gives `service_role` non-DML privileges such as `TRUNCATE`, `REFERENCES` and `TRIGGER` on `postgres`-owned public tables; the Discord publisher migration deliberately adds its tested SELECT and publication INSERT/UPDATE surface, but not the broad fixture privileges required across the rest of the schema.

The harness refuses non-loopback API URLs and derives the database container name from this repository's `project_id`. This is deliberate: the fixtures truncate application tables and delete local Auth users, so `test:db` must never be pointed at a hosted project or an arbitrary Docker container.

The suite runs in both pull-request CI and the Pages deployment workflow. Each job starts this repository's isolated loopback Supabase stack, applies the complete migration chain and stops the containers afterward. Keep running it locally before changing anything under `supabase/`; CI is a second gate, not a substitute for inspecting the database behavior you changed.

`config.toml` was added so the stack can be started at all. Two deliberate choices in it:

- **Ports are in the 545xx range** (API `54521`, database `54522`), not Supabase's 543xx defaults, so this stack can run alongside other local Supabase projects without colliding.
- **Only the database, Auth and the REST API are enabled.** Studio, Storage, Realtime, Analytics, the Edge Runtime and the local mail catcher are turned off to keep startup fast and the container count small. Re-enable any of them by setting `enabled = true` in its section — you will want the Edge Runtime to exercise `movie-lookup` locally, and Realtime if live session sync is ever built.

## Current persistence boundary

The canonical movie catalogue, movie list, voting, sessions, watch history, Journal drafts, current Journal entries, the historical Journal catalog, Discord server identities, explicit Discord Journal publications, owner-private personal films and owner-private viewing events are persistent in hosted production. Current Journal entries can be reached from watched sessions or the top-level Journal. My Films exposes current states, ratings, Favourites and the deployed viewing-history controls. Verified current Journal entries synchronise owner-private source events when both viewer and movie identities are canonical; the imported archive remains excluded. Personal reviews and their explicit group-visible snapshots are implemented in this checkout but are not hosted or released yet. Private notes are deferred, and personal lists remain unbuilt. Discord slash-command editing and modals, live multiplayer presence and Wrapped calculations remain outside this phase.
