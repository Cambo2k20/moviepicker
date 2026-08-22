# AGENTS.md

## Project

This repository contains **Discordians / Cine-Cord**, a private, membership-gated movie list, movie-night and journal companion for a small Discord group.

## Working agreement

- Never merge, auto-merge, rebase, delete or force-update a branch unless Cameron explicitly requests it.
- Never commit directly to `main`. Work on a focused `feature/`, `fix/` or `codex/` branch.
- Before editing, inspect the active branch and compare it with `main`; this repository may contain important unmerged work.
- Keep changes focused. Do not refactor or replace unrelated working behaviour.
- Run `npm run build` before treating an implementation task as complete.
- Report the files changed, validation performed and any unresolved risks.

## Active code

- `index.html` — application shell, dialogs and entry points.
- `app.js` — active UI, authentication, state and Supabase integration.
- `styles.css` — active visual system and responsive behaviour.
- `supabase/` — SQL, Row Level Security, Edge Functions and backend setup notes.
- `assets/` — versioned imagery used by the application.
- `Movie Picker.dc.html` and `support.js` are legacy/generated reference files. Do not edit them unless a task explicitly targets them.

## Product constraints

- Preserve the Discordians purple, grey and white identity.
- Preserve clear movie-poster artwork on phone layouts and in selected-film views.
- Do not add Discord bot, webhook, OAuth or server permissions unless Cameron explicitly requests that integration.
- Keep the manual **Copy for Discord** journal/session output available when changing movie-night flows.
- Supabase changes must preserve membership gating, Row Level Security and least privilege.
- Never place a Supabase service-role key, TMDB secret, password or other private credential in browser code or committed files.
- Prefer additive, repeatable database migrations and document backend changes in `supabase/README.md`.

## Validation

Install and build with:

```bash
npm install
npm run build
```

For UI changes, also inspect representative phone, tablet and desktop sizes, including approximately `390 × 844`, `768 × 1024` and `1440 × 900`. Check loading, empty, error and signed-out states where relevant. There is not yet an automated test suite, so state which manual checks were completed.
