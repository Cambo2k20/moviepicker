import assert from "node:assert/strict";
import test from "node:test";

import { allCommitsPatchEquivalent } from "../scripts/git-cleanup-core.mjs";

test("accepts a branch when every individual commit is patch-equivalent", () => {
  assert.equal(allCommitsPatchEquivalent(`
    - 5eeafee Add branch and worktree hygiene tooling
    - be58511 Keep branch deletion manual, never automatic
  `), true);
});

test("keeps a branch active when any commit is not represented in main", () => {
  assert.equal(allCommitsPatchEquivalent(`
    - 5eeafee Add branch and worktree hygiene tooling
    + be58511 Add genuinely unmerged work
  `), false);
});

test("does not classify empty cherry output as patch-equivalent", () => {
  assert.equal(allCommitsPatchEquivalent(""), false);
});

test("fails safe when the branch range contains merge commits", () => {
  assert.equal(allCommitsPatchEquivalent("- 5eeafee Equivalent non-merge commit", { hasMergeCommits: true }), false);
});
