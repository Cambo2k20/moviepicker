// Phase 2B viewing-event ownership, source semantics and lifecycle against
// local Supabase with genuinely authenticated owners, admins and non-members.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  groupId,
  resetWorkspace,
  runSql,
  serviceDataClient,
  sqlRow,
} from "./helpers/local-supabase.js";

let group;
let owner;
let otherMember;
let outsider;
let alien;
let matrix;
let manualEventId;

test("set up viewing-event identities and canonical movies", async () => {
  await resetWorkspace();
  group = groupId();
  owner = await createIdentity({ name: "Cameron", role: "member" });
  otherMember = await createIdentity({ name: "Dean", role: "admin" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  const { data, error } = await serviceDataClient()
    .from("movies")
    .insert([
      { tmdb_id: 348, title: "Alien", release_year: 1979 },
      { tmdb_id: 603, title: "The Matrix", release_year: 1999 },
    ])
    .select("id,tmdb_id");

  assert.equal(error, null);
  alien = data.find((movie) => Number(movie.tmdb_id) === 348);
  matrix = data.find((movie) => Number(movie.tmdb_id) === 603);
  assert.ok(alien?.id && matrix?.id);
});

test("an owner can create independent manual viewing history", async () => {
  const { data, error } = await owner.client
    .from("personal_viewing_events")
    .insert({
      owner_id: owner.id,
      movie_id: alien.id,
      outcome: "FINISHED",
      watched_on: "2026-09-01",
    })
    .select("id,owner_id,movie_id,outcome,watched_on,source_journal_entry_id,is_hidden")
    .single();

  assert.equal(error, null);
  manualEventId = data.id;
  assert.deepEqual(data, {
    id: manualEventId,
    owner_id: owner.id,
    movie_id: alien.id,
    outcome: "FINISHED",
    watched_on: "2026-09-01",
    source_journal_entry_id: null,
    is_hidden: false,
  });
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_films").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.journal_entries").count, 0);
});

test("viewing events are visible only to their owner, not another member or admin", async () => {
  const { data: ownRows, error: ownError } = await owner.client
    .from("personal_viewing_events")
    .select("id,outcome");
  assert.equal(ownError, null);
  assert.deepEqual(ownRows, [{ id: manualEventId, outcome: "FINISHED" }]);

  for (const identity of [otherMember, outsider]) {
    const { data, error } = await identity.client
      .from("personal_viewing_events")
      .select("id,outcome");
    assert.equal(error, null);
    assert.deepEqual(data, []);
  }
});

test("members cannot forge viewing-event ownership or source identity", async () => {
  const { error: forgedOwnerError } = await otherMember.client
    .from("personal_viewing_events")
    .insert({
      owner_id: owner.id,
      movie_id: matrix.id,
      outcome: "FINISHED",
    });
  assert.match(forgedOwnerError?.message || "", /row-level security/i);

  const { error: sourceInsertError } = await owner.client
    .from("personal_viewing_events")
    .insert({
      owner_id: owner.id,
      movie_id: matrix.id,
      outcome: "FINISHED",
      source_journal_entry_id: "00000000-0000-0000-0000-000000000001",
    });
  assert.match(sourceInsertError?.message || "", /permission denied|column.*not found|schema cache/i);

  const { error: ownerRewriteError } = await owner.client
    .from("personal_viewing_events")
    .update({ owner_id: otherMember.id })
    .eq("id", manualEventId);
  assert.match(ownerRewriteError?.message || "", /permission denied/i);

  const { error: sourceRewriteError } = await owner.client
    .from("personal_viewing_events")
    .update({ source_journal_entry_id: "00000000-0000-0000-0000-000000000001" })
    .eq("id", manualEventId);
  assert.match(sourceRewriteError?.message || "", /permission denied/i);

  const { error: invalidOutcomeError } = await owner.client
    .from("personal_viewing_events")
    .insert({
      owner_id: owner.id,
      movie_id: matrix.id,
      outcome: "WATCHED",
    });
  assert.match(invalidOutcomeError?.message || "", /personal_viewing_events_outcome_check|check constraint/i);

  const { data: otherDelete, error: otherDeleteError } = await otherMember.client
    .rpc("delete_manual_personal_viewing_event", { p_event_id: manualEventId });
  assert.equal(otherDeleteError, null);
  assert.equal(otherDelete, false);

  const { error: outsiderDeleteError } = await outsider.client
    .rpc("delete_manual_personal_viewing_event", { p_event_id: manualEventId });
  assert.match(outsiderDeleteError?.message || "", /membership is required/i);
});

test("manual history can change outcome and date but must be deleted rather than hidden", async () => {
  const { data, error } = await owner.client
    .from("personal_viewing_events")
    .update({ outcome: "DID_NOT_FINISH", watched_on: null })
    .eq("id", manualEventId)
    .select("outcome,watched_on,is_hidden")
    .single();
  assert.equal(error, null);
  assert.deepEqual(data, { outcome: "DID_NOT_FINISH", watched_on: null, is_hidden: false });

  const { error: hideError } = await owner.client
    .from("personal_viewing_events")
    .update({ is_hidden: true })
    .eq("id", manualEventId);
  assert.match(hideError?.message || "", /cannot be hidden/i);

  const { error: directDeleteError } = await owner.client
    .from("personal_viewing_events")
    .delete()
    .eq("id", manualEventId);
  assert.match(directDeleteError?.message || "", /permission denied/i);

  const { data: deleted, error: deleteError } = await owner.client
    .rpc("delete_manual_personal_viewing_event", { p_event_id: manualEventId });
  assert.equal(deleteError, null);
  assert.equal(deleted, true);
});

test("source-linked history can only be hidden and follows source deletion", async () => {
  runSql(`
    insert into public.journal_entries (
      group_id, title, release_year, watched_at, status, created_by, movie_id
    ) values (
      '${group}', 'The Matrix', 1999, '2026-09-02', 'FINISHED', '${otherMember.id}', '${matrix.id}'
    );
  `);
  const journalEntry = sqlRow("select id from public.journal_entries where title = 'The Matrix'");
  assert.ok(journalEntry?.id);

  runSql(`
    insert into public.entry_viewers (entry_id, profile_id)
    values ('${journalEntry.id}', '${owner.id}');
    insert into public.personal_viewing_events (
      owner_id, movie_id, outcome, watched_on, source_journal_entry_id
    ) values (
      '${owner.id}', '${matrix.id}', 'FINISHED', '2026-09-02', '${journalEntry.id}'
    );
  `);
  const sourceEvent = sqlRow(`
    select id from public.personal_viewing_events
    where source_journal_entry_id = '${journalEntry.id}'
  `);
  assert.ok(sourceEvent?.id);

  const { error: factRewriteError } = await owner.client
    .from("personal_viewing_events")
    .update({ outcome: "DID_NOT_FINISH" })
    .eq("id", sourceEvent.id);
  assert.match(factRewriteError?.message || "", /through the Journal/i);

  const { data: hidden, error: hideError } = await owner.client
    .from("personal_viewing_events")
    .update({ is_hidden: true })
    .eq("id", sourceEvent.id)
    .select("is_hidden,outcome,watched_on")
    .single();
  assert.equal(hideError, null);
  assert.deepEqual(hidden, { is_hidden: true, outcome: "FINISHED", watched_on: "2026-09-02" });

  const { error: sourceDeleteError } = await owner.client
    .rpc("delete_manual_personal_viewing_event", { p_event_id: sourceEvent.id });
  assert.match(sourceDeleteError?.message || "", /must be hidden|through the Journal/i);

  assert.throws(() => runSql(`
    insert into public.personal_viewing_events (
      owner_id, movie_id, outcome, source_journal_entry_id
    ) values (
      '${owner.id}', '${matrix.id}', 'FINISHED', '${journalEntry.id}'
    );
  `), /duplicate key|unique constraint/i);

  runSql(`delete from public.journal_entries where id = '${journalEntry.id}';`);
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_viewing_events where id = '${sourceEvent.id}'`).count, 0);
});

test("table, column and function privileges expose only the intended browser surface", () => {
  assert.deepEqual(sqlRow(`
    select
      c.relrowsecurity as rls_enabled,
      has_table_privilege('anon', 'public.personal_viewing_events', 'SELECT') as anon_select,
      has_table_privilege('authenticated', 'public.personal_viewing_events', 'SELECT') as member_select,
      has_table_privilege('authenticated', 'public.personal_viewing_events', 'DELETE') as member_delete,
      has_table_privilege('service_role', 'public.personal_viewing_events', 'SELECT') as service_select,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'owner_id', 'INSERT') as owner_insert,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'owner_id', 'UPDATE') as owner_update,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'movie_id', 'INSERT') as movie_insert,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'movie_id', 'UPDATE') as movie_update,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'outcome', 'INSERT') as outcome_insert,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'outcome', 'UPDATE') as outcome_update,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'watched_on', 'UPDATE') as watched_update,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'source_journal_entry_id', 'INSERT') as source_insert,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'source_journal_entry_id', 'UPDATE') as source_update,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'is_hidden', 'INSERT') as hidden_insert,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'is_hidden', 'UPDATE') as hidden_update,
      has_column_privilege('authenticated', 'public.personal_viewing_events', 'created_at', 'UPDATE') as created_update,
      has_function_privilege('anon', 'public.delete_manual_personal_viewing_event(uuid)', 'EXECUTE') as anon_delete_execute,
      has_function_privilege('authenticated', 'public.delete_manual_personal_viewing_event(uuid)', 'EXECUTE') as member_delete_execute
    from pg_class c
    where c.oid = 'public.personal_viewing_events'::regclass
  `), {
    rls_enabled: true,
    anon_select: false,
    member_select: true,
    member_delete: false,
    service_select: false,
    owner_insert: true,
    owner_update: false,
    movie_insert: true,
    movie_update: false,
    outcome_insert: true,
    outcome_update: true,
    watched_update: true,
    source_insert: false,
    source_update: false,
    hidden_insert: false,
    hidden_update: true,
    created_update: false,
    anon_delete_execute: false,
    member_delete_execute: true,
  });
});

test("membership removal hides retained events and account deletion removes them", async () => {
  const { data: retained, error: createError } = await owner.client
    .from("personal_viewing_events")
    .insert({
      owner_id: owner.id,
      movie_id: alien.id,
      outcome: "FINISHED",
      watched_on: "2026-09-03",
    })
    .select("id")
    .single();
  assert.equal(createError, null);
  assert.ok(retained?.id);

  runSql(`delete from public.group_memberships where group_id = '${group}' and user_id = '${owner.id}';`);

  const { data: hidden, error: readError } = await owner.client
    .from("personal_viewing_events")
    .select("id");
  assert.equal(readError, null);
  assert.deepEqual(hidden, []);
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_viewing_events where owner_id = '${owner.id}'`).count, 1);

  const { error: removedDeleteError } = await owner.client
    .rpc("delete_manual_personal_viewing_event", { p_event_id: retained.id });
  assert.match(removedDeleteError?.message || "", /membership is required/i);

  runSql(`delete from auth.users where id = '${owner.id}';`);
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_viewing_events where owner_id = '${owner.id}'`).count, 0);
});
