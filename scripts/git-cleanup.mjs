import { execFileSync } from "node:child_process";

import { allCommitsPatchEquivalent } from "./git-cleanup-core.mjs";

// Branch and worktree hygiene. Reports by default; deletes only when asked.
//   node scripts/git-cleanup.mjs             report what is spent, change nothing
//   node scripts/git-cleanup.mjs --apply     delete spent local branches, prune worktrees
//   node scripts/git-cleanup.mjs --apply --remote   also delete the matching branches on origin

const apply = process.argv.includes("--apply");
const includeRemote = process.argv.includes("--remote");
const trunk = "origin/main";
const protectedBranches = new Set(["main"]);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (output) => output.split("\n").map((line) => line.trim()).filter(Boolean);

// A branch is spent when main already contains its work. Plain ancestry misses
// squash merges, so replay the branch as one commit on its merge base and ask
// whether that patch is already in main.
function isSpent(branch) {
  if (lines(git("branch", "--merged", trunk, "--format=%(refname:short)")).includes(branch)) return "merged";
  const hasMergeCommits = lines(git("rev-list", "--merges", `${trunk}..${branch}`)).length > 0;
  if (allCommitsPatchEquivalent(git("cherry", trunk, branch), { hasMergeCommits })) return "patch-equivalent";
  const base = git("merge-base", trunk, branch);
  const probe = git("commit-tree", git("rev-parse", `${branch}^{tree}`), "-p", base, "-m", "hygiene probe");
  return git("cherry", trunk, probe).startsWith("-") ? "squash-merged" : null;
}

const here = git("rev-parse", "--show-toplevel");

git("fetch", "--all", "--prune", "--quiet");

const checkedOut = new Map();
let worktreePath = null;
for (const line of lines(git("worktree", "list", "--porcelain"))) {
  if (line.startsWith("worktree ")) worktreePath = line.slice("worktree ".length);
  if (line.startsWith("branch ")) checkedOut.set(line.slice("branch refs/heads/".length), worktreePath);
}

const spent = [];
const active = [];
for (const branch of lines(git("for-each-ref", "--format=%(refname:short)", "refs/heads"))) {
  if (protectedBranches.has(branch)) continue;
  const reason = isSpent(branch);
  const held = checkedOut.get(branch);
  const ahead = git("rev-list", "--count", `${trunk}..${branch}`);
  const when = git("log", "-1", "--format=%cs", branch);
  (reason ? spent : active).push({ branch, reason, held, ahead, when });
}

console.log(`\n  trunk: ${trunk}   worktrees: ${checkedOut.size}   local branches: ${spent.length + active.length + 1}\n`);

if (active.length) {
  console.log("  ACTIVE - real unmerged work, left alone");
  for (const { branch, ahead, when, held } of active) {
    console.log(`    ${branch.padEnd(42)} ${ahead} ahead   last commit ${when}${held ? `   worktree: ${held}` : ""}`);
  }
  console.log("");
}

if (!spent.length) {
  console.log("  Nothing spent. Repository is clean.\n");
} else {
  console.log(`  SPENT - already in main${apply ? ", deleting" : ", run with --apply to delete"}`);
  for (const { branch, reason, held, when } of spent) {
    if (held) {
      const where = held === here ? "checked out here - switch away first" : `checked out at ${held} - remove that worktree first`;
      console.log(`    ${branch.padEnd(42)} ${reason}, but ${where}`);
      continue;
    }
    console.log(`    ${branch.padEnd(42)} ${reason}   last commit ${when}`);
    if (!apply) continue;
    git("branch", "-D", branch);
    if (includeRemote && lines(git("branch", "-r", "--format=%(refname:short)")).includes(`origin/${branch}`)) {
      git("push", "origin", "--delete", branch, "--quiet");
      console.log(`      also deleted origin/${branch}`);
    }
  }
  console.log("");
}

const staleWorktrees = lines(git("worktree", "prune", "--dry-run", "--verbose"));
if (staleWorktrees.length) {
  console.log(`  STALE WORKTREES${apply ? ", pruning" : ", run with --apply to prune"}`);
  for (const line of staleWorktrees) console.log(`    ${line}`);
  if (apply) git("worktree", "prune");
  console.log("");
}

if (!apply) console.log("  Report only. Nothing was changed.\n");
