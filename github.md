# GitHub and deployment notes

main is the authoritative integration branch. Fetch and compare the active
branch before beginning work because feature branches may contain important
unmerged changes.

Never work directly on main. Use a focused feature/, fix/, chore/ or codex/
branch. Never merge, rebase, delete, force-update or deploy unless Cameron
explicitly requests it.

Extra worktrees follow the
[branch and worktree policy](docs/branch-and-worktree-policy.md).

## Required checks

Pull requests and non-main branch pushes run:

    npm ci
    npm run test:unit
    npm run build
    npm run test:e2e

Database changes additionally require the relevant local integration tests:

    npm run test:db

The Pages workflow repeats its configured checks on main, uploads the dist
artifact and deploys only after validation succeeds. Repository Pages settings
must use GitHub Actions as the source.

## Current product boundary

In the current feature/session-journal-handoff checkout:

- Queue Roulette is the only implemented decision game.
- Consensus Sprint and Reel Bracket remain disabled placeholders.
- Persistent movie-night sessions hand saved Journal entries into the Journal;
  watched sessions without an entry remain in Sessions.
- The top-level Journal combines current entries with the read-only imported
  Discord archive.
- Current entries support authorised editing and guarded deletion.
- Copy for Discord remains manual and always available.
- Post to Discord and Update Discord post are explicit authenticated
  server-side actions; nothing posts merely because an entry was saved.
- Discord OAuth and server-profile synchronisation do not bypass administrator
  membership approval.
- My Cinema, personal ratings and lists, curated profiles and Discover are
  approved direction but are not implemented.

The committed branch, hosted database, deployed Edge Functions and live Pages
site are separate states. Never infer deployment from a successful build or
from code existing on a branch.

## Product documentation

- [Project context](docs/PROJECT_CONTEXT.md) describes current implemented
  behaviour.
- [Product direction](docs/PRODUCT_DIRECTION.md) records approved future
  behaviour and phased delivery.

A roadmap item is not implementation or deployment permission. The direction
may change when Cameron changes their mind or evidence reveals a better
approach, but the amendment must be deliberate and documented.

Never commit credentials or bypass build, browser, database or security checks.
