# AGENTS.md

## Project

This repository contains **Discordians / Cine-Cord**, a private, membership-gated movie list, movie-night and journal companion for a small Discord group.

## Working agreement

- Never begin requested work without confirmation. Explain the plan first and
  wait until Cameron explicitly agrees.
- Never merge, auto-merge, rebase, delete or force-update a branch unless Cameron explicitly requests it.
- Never commit directly to `main`. Work on a focused `feature/`, `fix/` or `codex/` branch.
- Before editing, inspect the active branch and compare it with `main`; this repository may contain important unmerged work.
- Keep changes focused. Do not refactor or replace unrelated working behaviour.
- Run the relevant validation described in `README.md` — unit tests, build,
  end-to-end tests and database tests for database changes — before treating
  an implementation task as complete.
- Report the files changed, validation performed and any unresolved risks.

## Branches and worktrees

- The working copy is `moviepicker/`. Confirm you are in it, and on the branch you think you are, before reviewing or editing — a stale worktree once caused a review of code that `main` had already moved past.
- Extra worktrees live under `.worktrees/`, one per open PR, removed when that PR merges.
- Run `npm run git:cleanup` after a PR merges to see what is spent. It only reports — branches are never deleted automatically, and an agent deletes one only when Cameron asks. Full policy in `docs/branch-and-worktree-policy.md`.

### Repository safety gate

- Before editing, `main` must be clean and match `origin/main`. Fetch first,
  then require `git rev-list --left-right --count main...origin/main` to return
  `0 0`. If it does not, stop and report the divergence.
- Create the task branch before changing files. Never rescue a direct commit on
  `main` by discarding it; preserve it on a named branch before realigning
  `main`, and get explicit approval for the realignment.
- Before any merge, rebase, reset, branch deletion, force-update or worktree
  removal, run the mutation preflight in
  `docs/branch-and-worktree-policy.md` and compare the exact targets with the
  approved plan. Unexpected state is a hard stop.
- Never bulk-delete branches in GitHub's interface. Delete only branches named
  in Cameron's approval and proven spent by a merged PR or
  `npm run git:cleanup`.
- A branch with unique commits must have a remote backup before any repository
  cleanup. Local-only active branches are not allowed.
- Remove worktrees only with `git worktree remove <exact-path>` after verifying
  the registered path and a clean status. Never delete a worktree directory in
  File Explorer.
- After every PR merge, reconcile `main`, the merged branch and its worktree
  using the post-merge checklist in `docs/branch-and-worktree-policy.md`.

## Active code

- `index.html` — application shell, dialogs and entry points.
- `app.js` — active UI, authentication, state and Supabase integration.
- `styles.css` — active visual system and responsive behaviour.
- `supabase/` — SQL, Row Level Security, Edge Functions and backend setup notes.
- `assets/` — versioned imagery used by the application.
- `Movie Picker.dc.html` and `support.js` are legacy/generated reference files. Do not edit them unless a task explicitly targets them.

## Product constraints

- Before planning or implementing future product work, read the
  [product direction](docs/PRODUCT_DIRECTION.md) and state which approved
  decision and release phase the task belongs to.
- Distinguish shipped behaviour from approved direction. A roadmap item or
  approved product decision is not permission to implement, migrate, deploy or
  merge it.
- Treat approved decisions as the best current route towards the vision, not
  immutable rules. If Cameron changes their mind or evidence shows a better
  approach, surface it and update the direction deliberately; never let the
  documents drift silently.
- Preserve the Discordians purple, grey and white identity.
- Preserve clear movie-poster artwork on phone layouts and in selected-film views.
- Do not add Discord bot, webhook, OAuth or server permissions unless Cameron explicitly requests that integration.
- Keep the manual **Copy for Discord** journal/session output available when changing movie-night flows.
- Supabase changes must preserve membership gating, Row Level Security and least privilege.
- Never place a Supabase service-role key, TMDB secret, password or other private credential in browser code or committed files.
- Prefer additive, repeatable database migrations and document backend changes in `supabase/README.md`.

## Validation

Install and run the baseline checks with:

```bash
npm install
npm run test:unit
npm run build
npm run test:e2e
```

For UI changes, also inspect representative phone, tablet and desktop sizes,
including approximately `390 × 844`, `768 × 1024` and `1440 × 900`. Check
loading, empty, error and signed-out states where relevant. Also run the
relevant unit, database integration and Playwright suites described in
`README.md`. State which automated and manual checks were completed.

Repository documentation uses portable `npm` commands. On Windows PowerShell,
use `npm.cmd` when command resolution requires it.
