import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  groupId,
  resetWorkspace,
  runSql,
  sqlRow,
} from "./helpers/local-supabase.js";

let group;
let admin;
let member;
let outsider;
let entryId;

test("set up a publication owned by the server", async () => {
  await resetWorkspace();
  group = groupId();
  admin = await createIdentity({ name: "Cameron", role: "admin" });
  member = await createIdentity({ name: "Dean", role: "member" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  runSql(`
    insert into public.journal_entries (group_id, entry_number, title, release_year, watched_at, status, created_by)
    values ('${group}', 1325, 'Alien', 1979, '2026-08-24', 'FINISHED', '${admin.id}')
    returning id;
  `);
  entryId = sqlRow("select id from public.journal_entries where entry_number = 1325").id;
  runSql(`
    insert into public.discord_publications (group_id, journal_entry_id, status, posted_by)
    values ('${group}', '${entryId}', 'POSTING', '${admin.id}');
  `);
});

test("approved members may read the publication status", async () => {
  const { data, error } = await member.client.from("discord_publications").select("journal_entry_id,status");
  assert.equal(error, null);
  assert.deepEqual(data, [{ journal_entry_id: entryId, status: "POSTING" }]);
});

test("non-members see no publication rows", async () => {
  const { data, error } = await outsider.client.from("discord_publications").select("*");
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test("browser clients cannot forge or alter publication records", async () => {
  const { error: insertError } = await admin.client.from("discord_publications").insert({
    group_id: group,
    journal_entry_id: entryId,
    status: "POSTED",
    posted_by: admin.id,
  });
  assert.match(insertError?.message || "", /permission denied/i);

  const { data, error: updateError } = await admin.client
    .from("discord_publications")
    .update({ status: "FAILED" })
    .eq("journal_entry_id", entryId)
    .select("id");
  assert.match(updateError?.message || "", /permission denied/i);
  assert.equal(data, null);
});
