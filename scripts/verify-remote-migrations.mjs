import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { evaluateMigrationParity, formatMigrationParityFailure } from "./migration-parity-core.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = resolve(repoRoot, "supabase", "migrations");
const databaseUrl = String(process.env.SUPABASE_MIGRATION_DB_URL || "").trim();

if (!databaseUrl) {
  console.error("SUPABASE_MIGRATION_DB_URL is required. Add it as a protected github-pages environment secret before deploying.");
  process.exit(1);
}
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  console.error("SUPABASE_MIGRATION_DB_URL must be a percent-encoded Postgres connection URL.");
  process.exit(1);
}

const migrationFiles = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name);
const invalidFiles = migrationFiles.filter((name) => !/^\d{14}_.+\.sql$/.test(name));
if (invalidFiles.length) {
  console.error(`Migration filenames must use <14-digit timestamp>_<name>.sql: ${invalidFiles.join(", ")}`);
  process.exit(1);
}
const localVersions = migrationFiles.map((name) => name.slice(0, 14));

const cliEntry = resolve(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
const result = spawnSync(process.execPath, [cliEntry, "migration", "list", "--db-url", databaseUrl], {
  cwd: repoRoot,
  encoding: "utf8",
  windowsHide: true,
});
const sanitise = (value) => String(value || "").split(databaseUrl).join("[database-url]");

if (result.error || result.status !== 0) {
  console.error("Could not read the production Supabase migration ledger.");
  const detail = sanitise(result.stderr || result.stdout || result.error?.message).trim();
  if (detail) console.error(detail);
  process.exit(result.status || 1);
}

const report = evaluateMigrationParity(localVersions, `${result.stdout || ""}\n${result.stderr || ""}`);
if (!report.ok) {
  console.error(`Deployment blocked: local and production migrations differ (${formatMigrationParityFailure(report)}).`);
  process.exit(1);
}

console.log(`Migration parity confirmed: ${report.local.length} local migrations match production.`);
