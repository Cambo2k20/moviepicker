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

5. **Nothing is deleted automatically.** GitHub's `deleteBranchOnMerge` stays
   **off** on this repository, deliberately. A merged PR keeps its branch until
   Cameron decides otherwise — either by deleting it manually, or by asking
   an agent to, which the `AGENTS.md` working agreement already requires ("never
   merge, auto-merge, rebase, delete or force-update a branch unless Cameron
   explicitly requests it").

   The cost of this choice is that branches accumulate, which is how 15 remote
   branches built up before the first cleanup. Rule 6 is how that stays visible
   without anything disappearing on its own.

6. **Run the hygiene check when a PR merges**, or any time the branch list
   looks long. It reports; it never deletes on its own:

   ```bash
   npm run git:cleanup            # report only, changes nothing
   npm run git:cleanup -- --apply # delete spent local branches, prune worktrees
   ```

   Add `--remote` to the apply run to delete the matching branches on `origin`
   as well. Both flags are deliberate, one-off acts — there is no scheduled job,
   no hook and no CI step that runs them.

## What counts as "spent"

`scripts/git-cleanup.mjs` treats a branch as spent when `main` already contains
its work. It checks plain ancestry first, then uses `git cherry` to recognise
branches whose individual non-merge commits are already patch-equivalent in
`main`. Branch ranges containing merge commits fail safe and continue to the
whole-tree squash probe, because a merge can contain unique conflict resolution.
The final fallback replays the branch as a single commit on its merge base and
checks whether that combined patch already landed. A branch holding genuinely
unmerged commits is reported as ACTIVE and never touched, and a branch checked
out in a worktree is never deleted out from under it.
