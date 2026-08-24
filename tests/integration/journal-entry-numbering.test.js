// Regression cover for 20260824103055_harden_journal_entry_numbering.
//
// Before that migration, typing a historical Discord entry number left the
// identity sequence behind the data, and the next automatically numbered entry
// failed the (group_id, entry_number) unique constraint for good.

import test from "node:test";
import assert from "node:assert/strict";

import {
  addFilm,
  confirmSession,
  createIdentity,
  expectRpcError,
  groupId,
  resetWorkspace,
  sqlRow,
  sqlRows,
} from "./helpers/local-supabase.js";

let group;
let host;

/** Runs a whole session to WATCHED so it can carry a Journal entry. */
async function watchedSession(title) {
  const filmId = await addFilm(host, group, { title, year: 1999 });
  const { data: sessionId, error } = await host.client.rpc("create_movie_session", {
    p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [host.id], p_candidate_count: 1, p_game_state: {},
  });
  if (error) throw error;
  await confirmSession(host, sessionId, group, { id: filmId, title, year: 1999 });
  const { error: watchError } = await host.client.rpc("mark_movie_session_watched", {
    p_session_id: sessionId, p_watched_on: "2026-08-24", p_host_id: host.id, p_participant_ids: [host.id],
  });
  if (watchError) throw watchError;
  return sessionId;
}

// "1317:f" means the sequence has not been used yet and will hand out 1317
// next; "1317:t" means 1317 is spent and the next number is 1318.
function sequenceState() {
  const row = sqlRow("select last_value, is_called from public.journal_entries_entry_number_seq");
  return `${row.last_value}:${row.is_called ? "t" : "f"}`;
}

let sessionA;
let sessionB;
let sessionC;

test("set up three watched sessions", async () => {
  await resetWorkspace();
  group = groupId();
  host = await createIdentity({ name: "Cameron", role: "admin" });

  sessionA = await watchedSession("Alien");
  sessionB = await watchedSession("The Matrix");
  sessionC = await watchedSession("Inception");

  assert.equal(sequenceState(), "1317:f", "an untouched sequence must still be waiting to hand out 1317");
});

test("an explicitly numbered entry advances the sequence past itself", async () => {
  const { data, error } = await host.client.rpc("save_movie_session_journal", {
    p_session_id: sessionA, p_title: "Alien", p_release_year: 1979, p_status: "FINISHED", p_comment: "", p_entry_number: 1317,
  });
  assert.equal(error, null);
  assert.equal((Array.isArray(data) ? data[0] : data).entry_number, 1317);
  assert.equal(sequenceState(), "1317:t", "the sequence must now be past the explicit number");
});

test("the next automatic entry no longer collides", async () => {
  // This is the exact call that failed with a raw duplicate-key error before.
  const { data, error } = await host.client.rpc("save_movie_session_journal", {
    p_session_id: sessionB, p_title: "The Matrix", p_release_year: 1999, p_status: "FINISHED", p_comment: "", p_entry_number: null,
  });
  assert.equal(error, null, "an automatic number must follow an explicit one cleanly");
  assert.equal((Array.isArray(data) ? data[0] : data).entry_number, 1318);
});

test("a number already in use is refused in words the host can act on", async () => {
  const error = await expectRpcError(
    host.client.rpc("save_movie_session_journal", {
      p_session_id: sessionC, p_title: "Inception", p_release_year: 2010, p_status: "FINISHED", p_comment: "", p_entry_number: 1318,
    }),
    /Journal entry #1318 already exists in this group/,
  );
  assert.ok(
    !/constraint|duplicate key/i.test(error.message),
    `the raw Postgres text must not reach the host: ${error.message}`,
  );
});

test("re-saving an entry may keep its own number", async () => {
  const { error } = await host.client.rpc("save_movie_session_journal", {
    p_session_id: sessionB, p_title: "The Matrix", p_release_year: 1999, p_status: "DNF", p_comment: "Changed my mind.", p_entry_number: 1318,
  });
  assert.equal(error, null, "an entry keeping its own number must not be treated as a duplicate");
});

test("backfilling a low historical number does not rewind the sequence", async () => {
  const { error } = await host.client.rpc("save_movie_session_journal", {
    p_session_id: sessionA, p_title: "Alien", p_release_year: 1979, p_status: "FINISHED", p_comment: "", p_entry_number: 500,
  });
  assert.equal(error, null);
  assert.equal(sequenceState(), "1318:t", "the sequence must stay at the highest number ever used");

  const { data, error: autoError } = await host.client.rpc("save_movie_session_journal", {
    p_session_id: sessionC, p_title: "Inception", p_release_year: 2010, p_status: "FINISHED", p_comment: "", p_entry_number: null,
  });
  assert.equal(autoError, null);
  assert.equal((Array.isArray(data) ? data[0] : data).entry_number, 1319, "numbering continues forward, never reusing");

  const rows = sqlRows("select entry_number from public.journal_entries order by entry_number");
  assert.deepEqual(rows.map((row) => Number(row.entry_number)), [500, 1318, 1319]);
});
