# Branch and worktree policy

Written after a cleanup on 2026-08-23 that removed 5 local branches, 14 remote
branches and a stale worktree, all of whose work was already in `main`.
Updated on 2026-08-25 after remote branches were deleted while two active
branches existed only locally, and a direct local commit caused `main` to
diverge from `origin/main`.

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

7. **`main` has a measurable invariant.** Before and after a task, the primary
   checkout must be clean and this command must print `0 0`:

   ```bash
   git rev-list --left-right --count main...origin/main
   ```

   A different result means local and remote `main` have diverged. Stop before
   editing, committing, pulling, resetting or deleting anything.

8. **Unique work must not exist only locally.** Any branch reported as ACTIVE,
   or otherwise known to contain commits absent from `origin/main`, must be
   pushed to a same-named branch on `origin`. This is a safety backup, not
   permission to merge it.

9. **Never bulk-delete branches in GitHub's interface.** Review and name every
   deletion target. A branch is eligible only when its PR is merged or the
   cleanup report proves it patch-equivalent, it is not checked out, and
   Cameron explicitly approved deleting that exact branch.

10. **Unexpected state is a hard stop.** If a branch, commit, upstream,
    worktree path or uncommitted file differs from the approved plan, perform
    no mutation until the difference has been inspected and reported.

## Mutation preflight

Run this read-only sequence immediately before any merge, rebase, reset, branch
deletion, force-update or worktree removal:

```bash
git fetch --all --prune
git status --short --branch
git branch -vv
git worktree list --porcelain
npm run git:cleanup
```

Then verify all of the following:

- the primary checkout is the expected repository;
- `main` is clean and matches `origin/main`;
- every mutation target is named in Cameron's approval;
- every ACTIVE branch has a same-named remote backup;
- every branch selected for deletion is reported as spent;
- every worktree selected for removal is registered at the exact expected path
  and has a clean `git status --porcelain` result.

Do not treat an old report as authority. Fetch and rerun the preflight because
branches, PRs and worktrees may have changed since the plan was approved.

## If `main` diverges

Do not immediately reset, merge or rebase. First inspect the graph and preserve
any local-only commit:

```bash
git log --graph --decorate --oneline --all -n 30
git rev-list --left-right --count main...origin/main
git branch <recovery-branch> <local-main-commit>
```

After verifying that the recovery branch points to the local-only commit, ask
for explicit approval before realigning `main`. If the commit is wanted, put it
through a focused branch and PR. Never discard it just to make the parity check
green.

## Post-merge reconciliation

Complete this checklist after every merged PR:

1. Fetch and prune remote references.
2. Switch the primary checkout to `main` and fast-forward it with
   `git pull --ff-only origin main`.
3. Verify `main...origin/main` reports `0 0` and the worktree is clean.
4. Verify the merged branch's worktree is registered and clean, then remove it
   with `git worktree remove <exact-path>`.
5. Run `npm run git:cleanup` and review the complete spent list.
6. Delete only the exact local and remote branches Cameron approved.
7. Push same-named remote backups for every remaining ACTIVE branch.
8. Fetch and prune again, then rerun `npm run git:cleanup`.

Cleanup is complete only when the report says nothing is spent, `main` matches
`origin/main`, every active branch has a remote backup, and every remaining
worktree represents intentional active work.

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
