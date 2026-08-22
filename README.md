# Discordians / Cine-Cord

A private, membership-gated movie list and movie-night companion for the Discordians. The active application is a Vite-powered vanilla JavaScript frontend backed by Supabase Auth, Postgres, Row Level Security and an authenticated movie-lookup Edge Function.

## Current product boundary

- Email/password authentication with administrator-approved group membership.
- A persistent poster-led movie list with metadata lookup, voting and watched status.
- Persistent movie-night sessions with participants, selected-film snapshots and resumable state.
- Queue Roulette with truthful runtime/genre filters, age weighting and one veto per participant.
- An editable **Copy for Discord** result; nothing posts to Discord automatically.
- Responsive phone, tablet and desktop layouts.
- List-based statistics that are explicitly not Journal statistics.

Consensus Sprint and Reel Bracket are visible as **Coming soon** and cannot create sessions. The database contains Journal tables and secure write functions, but the active frontend does not currently provide a Journal screen or Journal write flow. Wrapped/challenge calculations also remain future work.

There is deliberately no Discord bot, webhook, OAuth connection or automatic posting.

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

## Validation

```bash
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

- `test:unit` covers Roulette filtering, weighting, duplicate display-name vetoes and state recovery.
- `build` creates `dist/` and fails if a bundled local asset is missing or an unbundled source path remains.
- `test:e2e` runs the available-mode, image and overflow checks at `390 × 844`, `768 × 1024`, `1142 × 912` and `1440 × 900`.

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
| `tests/` | Node unit tests and Playwright responsive tests |
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

For a fresh Supabase environment, review and apply the canonical SQL in order:

1. `supabase/schema.sql`
2. `supabase/member_management.sql`
3. `supabase/movie_metadata.sql`
4. `supabase/movie_sessions.sql`

The nine earlier hosted migrations are present locally under `supabase/migrations/`, restored from Supabase's authoritative migration records and SHA-256 verified byte-for-byte. The standalone CLI profile still receives HTTP 403 from the platform login-role endpoint, so linked CLI commands require a project owner or a profile with sufficient project privileges. The migration baseline itself is reconciled; the privilege-hardening migration in this branch remains staged locally and is not applied to production by a build, test or GitHub Pages deployment.

Deploy the `movie-lookup` Edge Function and store its external movie-database credential as a server-side Supabase secret. Never place service-role keys or external API secrets in the browser bundle.

## Development workflow

Start from an up-to-date `main`, inspect unmerged work, then create a focused `feature/`, `fix/` or `codex/` branch. Do not commit directly to `main`, and do not merge, rebase, delete or force-update branches without Cameron's explicit instruction.
