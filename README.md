# Discordians / Cine-Cord

A private, membership-gated movie list and movie-night companion for the Discordians. The active application is a Vite-powered vanilla JavaScript frontend backed by Supabase Auth, Postgres, Row Level Security and an authenticated movie-lookup Edge Function.

## Current product boundary

- Email/password authentication plus Discord OAuth, both protected by administrator-approved group membership. Discord sign-in securely synchronises the member's Discord display name and avatar without exposing their Discord ID to the browser.
- A persistent poster-led movie list with metadata lookup, voting and watched status.
- Persistent movie-night sessions with participants, selected-film snapshots and resumable state.
- Queue Roulette with truthful runtime/genre filters, age weighting and one veto per participant.
- A top-level Journal that searches new Cine-Cord entries together with the read-only history imported from the three existing Discord Journal channels.
- Creator/admin editing for current entries, plus explicit **Post to Discord** and **Update Discord post** actions that reuse the same Discord message. **Copy for Discord** remains available and nothing posts automatically.
- Responsive phone, tablet and desktop layouts.
- List-based statistics that are explicitly not Journal statistics.

Consensus Sprint and Reel Bracket are visible as **Coming soon** and cannot create sessions. Historical Discord entries remain read-only, and the Journal delivery does not add `/journal edit` or Discord modals. Wrapped/challenge calculations also remain future work.

Discord OAuth does not grant website membership or request bot/server permissions. An authenticated profile sync reads only the signed-in member's own Discordians server display record, while administrator approval remains the website access gate. The only Discord write integration is the server-side Journal webhook, and it runs solely after an authorised member presses a posting or update button.

## Product documentation

- [Project context](docs/PROJECT_CONTEXT.md) records the current architecture
  and implemented product boundary in this checkout.
- [Product direction](docs/PRODUCT_DIRECTION.md) records the approved future
  direction for My Cinema, Discover and curated profiles.

Approved direction is not shipped behaviour and is not blanket permission to
implement, migrate, deploy or merge the roadmap.

## Local development

Node.js 24 is used in CI.

```bash
npm install
npm run dev
```

Vite serves the project below its production base path. Open:

```text
http://localhost:5173/moviepicker/?design-preview
```

The `design-preview` query loads representative local data without using a live account.

To review the optional Discord sign-in UI before the provider is enabled, open `http://localhost:5173/moviepicker/?discord-auth-preview`. The flag only works on local hostnames; it does not bypass authentication or prove that the Discord provider and callback credentials are configured.

## Validation

```bash
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

- `test:unit` covers Roulette rules, the Discord OAuth and sign-in boundary,
  Discord server-profile safety, Discord Journal payload safety and the
  historical Journal parser.
- `build` creates `dist/` and fails if a bundled local asset is missing or an unbundled source path remains.
- `test:e2e` runs the available-mode, image and overflow checks at `390 × 844`, `768 × 1024`, `1142 × 912` and `1440 × 900`. It runs entirely in `?design-preview`, so it proves the interface, not the database.
- `test:db` runs the Supabase integration suite. It needs a local database and is therefore not part of `npm test` or CI:

```bash
npx supabase start
npm run test:db
```

  It exercises the session RPCs, Discord identity boundary, unified Journal catalog, creator/admin edit rules, publication freshness and Row Level Security against real Postgres, using several genuinely authenticated identities with different roles.

## Deployment

`vite.config.js` builds for the GitHub Pages base path `/moviepicker/`. The `Deploy GitHub Pages` workflow validates the project, uploads `dist/` and deploys it on pushes to `main` or a manual workflow dispatch.

GitHub repository settings must use **Pages → Build and deployment → Source: GitHub Actions** before that workflow can replace the older raw-source Pages deployment. Adding the workflow does not change the live site by itself.

Configured site:

```text
https://cambo2k20.github.io/moviepicker/
```

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Active application shell and dialogs |
| `app.js` | Active UI, authentication, state and Supabase integration |
| `roulette-core.js` | Pure Queue Roulette rules and state compatibility |
| `styles.css` | Active visual system and responsive behavior |
| `assets/` | Versioned application images and avatars |
| `tests/` | Node unit tests, Playwright responsive tests and Supabase integration tests |
| `supabase/rollback/` | Reverse scripts matching the additive migrations |
| `scripts/import-discord-journal.mjs` | Dry-run-first importer for the three preserved Discord Journal exports |
| `scripts/verify-dist.mjs` | Production artifact asset verification |
| `.github/workflows/` | Pull-request validation and GitHub Pages deployment |
| `supabase/schema.sql` | Base profiles, groups and Journal backend schema |
| `supabase/member_management.sql` | Access requests and member administration |
| `supabase/movie_metadata.sql` | Persistent movie metadata additions |
| `supabase/movie_sessions.sql` | Persistent movie-night sessions and game state |
| `supabase/migrations/` | Additive migrations for an existing hosted project |
| `supabase/functions/movie-lookup/` | Protected server-side movie metadata lookup |
| `supabase/README.md` | Backend setup, access model and migration notes |
| `Movie Picker.dc.html` | Legacy generated design reference; do not edit |
| `support.js` | Legacy generated runtime; do not edit |

## Supabase setup

For a fresh Supabase environment, apply everything in `supabase/migrations/` in timestamp order. That chain builds a complete, current database, and is what `supabase db reset` and `supabase start` use.

The canonical files (`supabase/schema.sql`, `member_management.sql`, `movie_metadata.sql`, `movie_sessions.sql`) remain as readable documentation of how the schema was first assembled. They predate the session-planning work and are **not** sufficient to run the current frontend on their own; see `supabase/README.md` for what they are missing.

The earlier hosted migrations are present locally under `supabase/migrations/`, restored from Supabase's authoritative migration records and SHA-256 verified byte-for-byte. The standalone CLI profile still receives HTTP 403 from the platform login-role endpoint, so linked CLI commands require a project owner or a profile with sufficient project privileges. The master-Journal migration, historical import and updated Edge Function in this branch are not applied to production by a build, test or GitHub Pages deployment.

Deploy the `movie-lookup` Edge Function and store its external movie-database credential as a server-side Supabase secret. Never place service-role keys or external API secrets in the browser bundle.

## Development workflow

Start from an up-to-date `main`, inspect unmerged work, then create a focused `feature/`, `fix/` or `codex/` branch. Do not commit directly to `main`, and do not merge, rebase, delete or force-update branches without Cameron's explicit instruction.
