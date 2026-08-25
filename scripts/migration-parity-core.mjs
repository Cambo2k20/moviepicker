const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
const MIGRATION_VERSION = /^\d{14}$/;

function uniqueSorted(versions) {
  const values = versions.map(String);
  for (const version of values) {
    if (!MIGRATION_VERSION.test(version)) throw new Error(`Invalid migration version: ${version}`);
  }
  if (new Set(values).size !== values.length) throw new Error("Migration versions must be unique.");
  return values.sort();
}

export function parseMigrationList(output) {
  const plain = String(output).replace(ANSI_ESCAPE, "");
  const jsonStart = plain.indexOf('{"migrations"');
  const jsonEnd = plain.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(plain.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed.migrations)) {
        return parsed.migrations.map(({ local, remote }) => ({
          local: local || null,
          remote: remote || null,
        }));
      }
    } catch {
      // Older CLI releases return a text table, handled below.
    }
  }

  return plain
    .split(/\r?\n/)
    .map((line) => line.split(/[│|]/))
    .filter((columns) => columns.length >= 3)
    .map((columns) => ({
      local: columns[0].match(/\b\d{14}\b/)?.[0] || null,
      remote: columns[1].match(/\b\d{14}\b/)?.[0] || null,
    }))
    .filter(({ local, remote }) => local || remote);
}

export function evaluateMigrationParity(localVersions, cliOutput) {
  const expectedLocal = uniqueSorted(localVersions);
  const rows = parseMigrationList(cliOutput);
  const cliLocal = uniqueSorted(rows.flatMap(({ local }) => local ? [local] : []));
  const remote = uniqueSorted(rows.flatMap(({ remote }) => remote ? [remote] : []));
  const expectedSet = new Set(expectedLocal);
  const cliLocalSet = new Set(cliLocal);
  const remoteSet = new Set(remote);

  const omittedByCli = expectedLocal.filter((version) => !cliLocalSet.has(version));
  const unknownCliLocal = cliLocal.filter((version) => !expectedSet.has(version));
  const missingRemote = expectedLocal.filter((version) => !remoteSet.has(version));
  const unknownRemote = remote.filter((version) => !expectedSet.has(version));

  return {
    ok: rows.length > 0
      && omittedByCli.length === 0
      && unknownCliLocal.length === 0
      && missingRemote.length === 0
      && unknownRemote.length === 0,
    local: expectedLocal,
    remote,
    omittedByCli,
    unknownCliLocal,
    missingRemote,
    unknownRemote,
  };
}

export function formatMigrationParityFailure(report) {
  const details = [];
  if (!report.remote.length) details.push("the remote ledger returned no migration versions");
  if (report.omittedByCli.length) details.push(`CLI omitted local: ${report.omittedByCli.join(", ")}`);
  if (report.unknownCliLocal.length) details.push(`CLI reported unknown local: ${report.unknownCliLocal.join(", ")}`);
  if (report.missingRemote.length) details.push(`not applied remotely: ${report.missingRemote.join(", ")}`);
  if (report.unknownRemote.length) details.push(`remote-only: ${report.unknownRemote.join(", ")}`);
  return details.join("; ") || "the migration table could not be parsed";
}
