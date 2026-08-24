// Session RPCs and Row Level Security, exercised with real signed-in users.
//
// Covers the boundary the Playwright suite cannot reach: it runs entirely in
// ?design-preview, where every Supabase write is short-circuited in app.js.

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
let cameron; // admin
let dean;    // member, hosts the session
let ross;    // member, suggested the film, hosts nothing
let outsider; // authenticated, never approved
let film;
let sessionId;

test("set up a real group with four authenticated identities", async () => {
  await resetWorkspace();
  group = groupId();

  cameron = await createIdentity({ name: "Cameron", role: "admin" });
  dean = await createIdentity({ name: "Dean", role: "member" });
  ross = await createIdentity({ name: "Ross", role: "member" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  // Suggested by Ross, hosted by Dean: this is the split that makes the
  // SECURITY DEFINER queue_items bypass in mark_movie_session_watched matter.
  const filmId = await addFilm(ross, group, { title: "Alien", year: 1979, runtime: 117 });
  film = { id: filmId, title: "Alien", year: 1979 };

  assert.ok(group && cameron.id && dean.id && ross.id && outsider.id);
});

test("an authenticated non-member sees no group data at all", async () => {
  for (const table of ["queue_items", "movie_sessions", "journal_entries", "group_memberships"]) {
    const { data, error } = await outsider.client.from(table).select("*");
    assert.equal(error, null, `${table} should not error for a signed-in non-member`);
    assert.deepEqual(data, [], `${table} must be empty for a signed-in non-member`);
  }
});

test("create_movie_session validates its participants", async () => {
  await expectRpcError(
    dean.client.rpc("create_movie_session", {
      p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [], p_candidate_count: 1, p_game_state: {},
    }),
    /at least one participant/i,
  );

  await expectRpcError(
    dean.client.rpc("create_movie_session", {
      p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [dean.id, dean.id], p_candidate_count: 1, p_game_state: {},
    }),
    /only be added once/i,
  );

  await expectRpcError(
    dean.client.rpc("create_movie_session", {
      p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [dean.id, outsider.id], p_candidate_count: 1, p_game_state: {},
    }),
    /approved member/i,
  );

  const { data, error } = await dean.client.rpc("create_movie_session", {
    p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [dean.id, cameron.id], p_candidate_count: 1, p_game_state: {},
  });
  assert.equal(error, null);
  sessionId = data;
  assert.ok(sessionId);
});

test("only one session may be open per group", async () => {
  await expectRpcError(
    cameron.client.rpc("create_movie_session", {
      p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [cameron.id], p_candidate_count: 1, p_game_state: {},
    }),
    /duplicate key|movie_sessions_one_open_per_group/i,
  );
});

test("the host confirms the pick, and the snapshot lands", async () => {
  const row = await confirmSession(dean, sessionId, group, film);
  assert.equal(row.status, "CONFIRMED");
  assert.equal(row.selected_title, "Alien");
  assert.ok(row.confirmed_at);
});

test("a member who is neither host nor admin cannot edit the session", async () => {
  await expectRpcError(
    ross.client.rpc("save_movie_session_details", {
      p_session_id: sessionId, p_watch_date: "2026-08-25", p_host_id: dean.id, p_participant_ids: [dean.id],
    }),
    /does not exist, or you cannot edit it/i,
  );
});

test("the host may edit details but may not transfer the host role", async () => {
  const { error } = await dean.client.rpc("save_movie_session_details", {
    p_session_id: sessionId, p_watch_date: "2026-08-25", p_host_id: dean.id, p_participant_ids: [dean.id, cameron.id],
  });
  assert.equal(error, null, "the host must be able to edit their own session");

  // The admin-only rule IS enforced, but only as a side effect of the UPDATE
  // policy's WITH CHECK: the new row would no longer be owned by Dean. Postgres
  // therefore raises its own RLS error rather than reaching the function's
  // "you cannot edit it" message, and that raw text reaches the browser. The
  // rule holds; the wording is the thing worth fixing (audit finding S3).
  await expectRpcError(
    dean.client.rpc("save_movie_session_details", {
      p_session_id: sessionId, p_watch_date: "2026-08-25", p_host_id: ross.id, p_participant_ids: [dean.id, cameron.id],
    }),
    /violates row-level security policy/i,
  );

  const row = sqlRow(`select host_id, watch_date from public.movie_sessions where id = '${sessionId}'`);
  assert.equal(row.host_id, dean.id, "the failed transfer must not have taken effect");
  assert.equal(row.watch_date, "2026-08-25");
});

test("an administrator may transfer the host, and back again", async () => {
  const { error } = await cameron.client.rpc("save_movie_session_details", {
    p_session_id: sessionId, p_watch_date: "2026-08-25", p_host_id: ross.id, p_participant_ids: [dean.id, cameron.id],
  });
  assert.equal(error, null);

  const moved = sqlRow(`select host_id from public.movie_sessions where id = '${sessionId}'`);
  assert.equal(moved.host_id, ross.id);

  await cameron.client.rpc("save_movie_session_details", {
    p_session_id: sessionId, p_watch_date: "2026-08-25", p_host_id: dean.id, p_participant_ids: [dean.id, cameron.id],
  });
  const restored = sqlRow(`select host_id from public.movie_sessions where id = '${sessionId}'`);
  assert.equal(restored.host_id, dean.id);
});

test("the Journal is refused before the film is marked watched", async () => {
  await expectRpcError(
    dean.client.rpc("save_movie_session_journal", {
      p_session_id: sessionId, p_title: "Alien", p_release_year: 1979, p_status: "FINISHED", p_comment: "", p_entry_number: null,
    }),
    /after the film is marked watched/i,
  );
});

test("a non-host member cannot mark the session watched", async () => {
  await expectRpcError(
    ross.client.rpc("mark_movie_session_watched", {
      p_session_id: sessionId, p_watched_on: "2026-08-25", p_host_id: dean.id, p_participant_ids: [dean.id, cameron.id],
    }),
    /only the session host or a website administrator/i,
  );
});

test("the host marks a film watched that somebody else suggested", async () => {
  // Dean cannot update this queue item directly: queue_items RLS restricts that
  // to Ross (the suggester) or an admin. The definer function is what closes
  // that gap, and this asserts it actually does.
  const { data: blocked } = await dean.client
    .from("queue_items").update({ watched: true }).eq("id", film.id).select("id").maybeSingle();
  assert.equal(blocked, null, "RLS must stop a non-suggester writing queue_items directly");

  const { data, error } = await dean.client.rpc("mark_movie_session_watched", {
    p_session_id: sessionId, p_watched_on: "2026-08-25", p_host_id: dean.id, p_participant_ids: [dean.id, cameron.id],
  });
  assert.equal(error, null);
  const row = Array.isArray(data) ? data[0] : data;
  assert.equal(row.status, "WATCHED");

  const item = sqlRow(`select watched from public.queue_items where id = '${film.id}'`);
  assert.equal(item.watched, true, "the RPC must flip the queue item the host could not touch directly");
});

test("marking watched is refused a second time", async () => {
  await expectRpcError(
    dean.client.rpc("mark_movie_session_watched", {
      p_session_id: sessionId, p_watched_on: "2026-08-25", p_host_id: dean.id, p_participant_ids: [dean.id],
    }),
    /only a confirmed session/i,
  );
});

test("group_watch_counts derives the viewing history", async () => {
  const { data, error } = await dean.client.rpc("group_watch_counts", { p_group_id: group });
  assert.equal(error, null);
  const row = data.find((candidate) => candidate.queue_item_id === film.id);
  assert.ok(row, "the watched film must appear in the derived counts");
  assert.equal(Number(row.watch_count), 1);
  assert.equal(row.last_watched_on, "2026-08-25");
});

test("only the host or an admin may write the Journal entry", async () => {
  await expectRpcError(
    ross.client.rpc("save_movie_session_journal", {
      p_session_id: sessionId, p_title: "Alien", p_release_year: 1979, p_status: "FINISHED", p_comment: "", p_entry_number: null,
    }),
    /only the session host or a website administrator/i,
  );

  const { data, error } = await dean.client.rpc("save_movie_session_journal", {
    p_session_id: sessionId, p_title: "Alien", p_release_year: 1979, p_status: "FINISHED", p_comment: "Still holds up.", p_entry_number: null,
  });
  assert.equal(error, null);
  const entry = Array.isArray(data) ? data[0] : data;
  assert.equal(entry.entry_number, 1317, "the first entry continues the Discord numbering");
  assert.equal(entry.created_by, dean.id);

  const viewers = sqlRows(`select profile_id from public.entry_viewers where entry_id = '${entry.id}'`);
  assert.deepEqual(new Set(viewers.map((viewer) => viewer.profile_id)), new Set([dean.id, cameron.id]));
});

test("an administrator who did not author the entry may still correct it", async () => {
  const { data, error } = await cameron.client.rpc("save_movie_session_journal", {
    p_session_id: sessionId, p_title: "Alien", p_release_year: 1979, p_status: "DNF", p_comment: "Corrected by an admin.", p_entry_number: null,
  });
  assert.equal(error, null);
  const entry = Array.isArray(data) ? data[0] : data;
  assert.equal(entry.status, "DNF");
  assert.equal(entry.entry_number, 1317, "correcting must not allocate a second number");
  assert.equal(entry.created_by, dean.id, "authorship stays with the original writer");

  const entries = sqlRows(`select id from public.journal_entries where movie_session_id = '${sessionId}'`);
  assert.equal(entries.length, 1, "one session may only ever produce one Journal entry");
});
