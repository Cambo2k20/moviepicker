# Branch and worktree policy

Written after a cleanup on 2026-08-23 that removed 5 local branches, 14 remote
branches and a stale worktree, all of whose work was already in `main`.

## Why this exists

A stale worktree caused a real problem: `moviepicker-discord-auth/` sat on a
branch whose PR had already merged, so it looked like a second clone of the
project and a review run against it described code that `main` had moved past
two PRs earlier. Branches that outlive their PR are not free — they are a
source of wrong answers.

## Rules

1. **One worktree per repository unless a task genuinely needs two.** The main
   working copy is `C:\Users\Cambo\Documents\GitHub\moviepicker`. If a second
   is needed, create it under `.worktrees/` so nothing ever looks like a
   separate clone:

   ```bash
   git worktree add ../.worktrees/moviepicker/<slug> -b <branch>
   ```

2. **A worktree dies with its PR.** When the PR merges, run
   `git worktree remove <path>` the same day. Close any editor window on that
   folder first, or Windows keeps the directory locked.

3. **Branch names carry a prefix**: `feature/`, `fix/`, `chore/`, or `codex/`
   for agent-generated work. The prefix is what makes a stale branch obvious
   six weeks later.

4. **Never work directly on `main`.** Branch first, PR always. (This mirrors
   the working agreement in `AGENTS.md`.)

5. **The remote should delete its own branches.** Turn this on once and merged
   PRs take their branches with them:

   ```bash
   gh repo edit Cambo2k20/moviepicker --enable-delete-branch-on-merge
   ```

   Without it, every merged PR leaves a branch behind forever â that is how
   15 remote branches accumulated before the first cleanup.

6. **Run the hygiene check when a PR merges**, or any time the branch list
   looks long:

   ```bash
   npm run git:cleanup            # report only, changes nothing
   npm run git:cleanup -- --apply # delete spent local branches, prune worktrees
   ```

   Add `--remote` to the apply run to delete the matching branches on `origin`
   as well. That is rarely needed once rule 5 is in place.

## What counts as "spent"

`scripts/git-cleanup.mjs` treats a branch as spent when `main` already contains
its work. It checks plain ancestry first, then — because this repository merges
by squash, which breaks ancestry — replays the branch as a single commit on its
merge base and asks `git cherry` whether that patch already landed. A branch
holding genuinely unmerged commits is reported as ACTIVE and never touched, and
a branch checked out in a worktree is never deleted out from under it.
