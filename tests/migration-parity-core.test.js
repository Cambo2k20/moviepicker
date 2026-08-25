import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMigrationParity,
  formatMigrationParityFailure,
  parseMigrationList,
} from "../scripts/migration-parity-core.mjs";

const local = ["20260822085623", "20260825132802"];

test("parseMigrationList reads the current Supabase CLI JSON response", () => {
  const rows = parseMigrationList(`{"migrations":[{"local":"20260822085623","remote":"20260822085623","time":"2026-08-22 08:56:23"},{"local":"20260825132802","remote":"","time":"2026-08-25 13:28:02"}],"message":"Migrations listed"}\nConnecting to remote database...`);

  assert.deepEqual(rows, [
    { local: "20260822085623", remote: "20260822085623" },
    { local: "20260825132802", remote: null },
  ]);
});

test("parseMigrationList reads matching, local-only and remote-only table rows", () => {
  const rows = parseMigrationList(`
    LOCAL          │ REMOTE         │ TIME (UTC)
  ─────────────────┼────────────────┼──────────────────────
    20260822085623 │ 20260822085623 │ 2026-08-22 08:56:23
    20260825132802 │                │ 2026-08-25 13:28:02
                   │ 20260825140000 │ 2026-08-25 14:00:00
  `);

  assert.deepEqual(rows, [
    { local: "20260822085623", remote: "20260822085623" },
    { local: "20260825132802", remote: null },
    { local: null, remote: "20260825140000" },
  ]);
});

test("evaluateMigrationParity accepts identical local and remote ledgers", () => {
  const report = evaluateMigrationParity(local, `
    LOCAL          | REMOTE         | TIME (UTC)
    20260822085623 | 20260822085623 | 2026-08-22 08:56:23
    20260825132802 | 20260825132802 | 2026-08-25 13:28:02
  `);

  assert.equal(report.ok, true);
  assert.deepEqual(report.remote, local);
});

test("evaluateMigrationParity blocks pending and remote-only migrations", () => {
  const report = evaluateMigrationParity(local, `
    LOCAL          │ REMOTE         │ TIME (UTC)
    20260822085623 │ 20260822085623 │ 2026-08-22 08:56:23
    20260825132802 │                │ 2026-08-25 13:28:02
                   │ 20260825140000 │ 2026-08-25 14:00:00
  `);

  assert.equal(report.ok, false);
  assert.deepEqual(report.missingRemote, ["20260825132802"]);
  assert.deepEqual(report.unknownRemote, ["20260825140000"]);
  assert.match(formatMigrationParityFailure(report), /not applied remotely: 20260825132802/);
  assert.match(formatMigrationParityFailure(report), /remote-only: 20260825140000/);
});

test("evaluateMigrationParity fails closed on unparseable output", () => {
  const report = evaluateMigrationParity(local, "Connected, but no table was returned.");

  assert.equal(report.ok, false);
  assert.match(formatMigrationParityFailure(report), /remote ledger returned no migration versions/);
});
