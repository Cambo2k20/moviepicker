# Discordians / Cine-Cord

A private companion website for the Discordians movie group. It combines the shared movie list, member voting, movie-night decision games, resumable sessions, journal records and group statistics in one responsive web application.

## Current handoff status

The Codex handoff branch is:

```text
codex/project-handoff
```

It was created on **22 August 2026** from `feature/mobile-roulette-polish`, which contains the newest complete line of work: persistent movie-night sessions plus the later Queue Roulette and mobile presentation refinements. At handoff time, `main` does not contain all of that work.

Do not merge this branch, or any other branch, unless Cameron explicitly requests it.

## Current capabilities

- Supabase email/password authentication and membership-gated group access.
- Administrator approval, role management and member removal.
- Persistent shared movie list, metadata lookup, poster gallery, details and voting.
- Persistent Journal entries with approved viewers and Row Level Security.
- Persistent movie-night sessions with participants, selected-film snapshots and resumable game state.
- Queue Roulette with runtime/genre filters, age weighting, vetoes and mobile wheel presentation.
- Editable **Copy for Discord** output for manually posting a session result.
- Responsive phone, tablet and desktop layouts.
- Wrapped/statistics views remain non-persistent prototype calculations.

There is deliberately no Discord bot, webhook, OAuth connection or automatic Discord posting at this stage.

## Stack

- Vite
- Vanilla HTML, CSS and JavaScript modules
- `@supabase/supabase-js`
- Supabase Auth, Postgres, Row Level Security, database functions and Edge Functions
- GitHub Pages deployment

## Local development

```bash
npm install
npm run dev
```

Vite will print the local address. On a local host, append `?design-preview` to load the representative preview workspace without using live account data.

Production validation:

```bash
npm run build
npm run preview
```

There is currently no automated unit or end-to-end test suite. UI changes require manual responsive and state testing in addition to a successful production build.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Active application shell and dialogs |
| `app.js` | Active interface, state, authentication and Supabase calls |
| `styles.css` | Active visual system and responsive styles |
| `assets/` | Application images and avatars |
| `supabase/schema.sql` | Base profiles, groups and Journal schema |
| `supabase/member_management.sql` | Access requests and secure member administration |
| `supabase/movie_metadata.sql` | Persistent movie metadata additions |
| `supabase/movie_sessions.sql` | Persistent movie-night sessions and game state |
| `supabase/functions/movie-lookup/` | Protected server-side movie metadata lookup |
| `supabase/README.md` | Backend setup, access model and migration notes |
| `design-qa.md` | Recorded responsive/design checks |
| `Movie Picker.dc.html` | Legacy design prototype reference |
| `support.js` | Generated legacy runtime; do not hand-edit |
| `AGENTS.md` | Repository rules automatically loaded by Codex |
| `docs/PROJECT_CONTEXT.md` | Product intent, current boundaries and backlog context |

## Supabase setup

The existing Supabase project and security model are documented in `supabase/README.md`. For a fresh environment, review and apply the SQL in this order:

1. `supabase/schema.sql`
2. `supabase/member_management.sql`
3. `supabase/movie_metadata.sql`
4. `supabase/movie_sessions.sql`

Deploy the `movie-lookup` Edge Function and store its external movie-database credential as a server-side Supabase secret. Never place service-role keys or external API secrets in the frontend.

The configured GitHub Pages site is:

```text
https://cambo2k20.github.io/moviepicker/
```

## Recommended Codex workflow

1. Open `Cambo2k20/moviepicker` in Codex.
2. Select `codex/project-handoff` as the starting branch.
3. Ask Codex to read `AGENTS.md`, `README.md`, `docs/PROJECT_CONTEXT.md` and `supabase/README.md` before planning a change.
4. Create a new focused branch for each feature or fix.
5. Require `npm run build` and a concise manual-QA report before opening a pull request.
6. Review the pull request yourself; do not ask Codex to merge it unless that is an explicit decision.
