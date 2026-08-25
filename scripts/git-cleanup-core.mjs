export function allCommitsPatchEquivalent(cherryOutput, { hasMergeCommits = false } = {}) {
  if (hasMergeCommits) return false;

  const statuses = String(cherryOutput)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line[0]);

  return statuses.length > 0 && statuses.every((status) => status === "-");
}
