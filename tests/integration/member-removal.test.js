// Regression cover for 20260824104512_protect_sessions_on_member_removal.
//
// Before that migration, private.validate_movie_session() re-checked host
// membership on every update, so removing a member who hosted a session made
// that session unwritable — including saving a Journal draft or Queue Roulette
// state — with an error about the host that nobody could act on.

import test from "node:test";
import assert from "node:assert/strict";

import {
  addFilm,
  confirmSession,
  createIdentity,
  groupId,
  resetWorkspace,
  sqlRow,
  sqlRows,
} from "./helpers/local-supabase.js";

let group;
let cameron; // admin who performs the removal
let dean;    // member who hosts both sessions and is then removed

let watchedSessionId;
let openSessionId;

test("set up a watched session and an open session, both hosted by Dean", async () => {
  await resetWorkspace();
  group = groupId();
  cameron = await createIdentity({ name: "Cameron", role: "admin" });
  dean = await createIdentity({ name: "Dean", role: "member" });

  // Session one runs all the way to WATCHED so it becomes history.
  const oldFilm = await addFilm(dean, group, { title: "Home Alone", year: 1990 });
  const { data: firstId, error: firstError } = await dean.client.rpc("create_movie_session", {
    p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [dean.id, cameron.id], p_candidate_count: 2, p_game_state: {},
  });
  assert.equal(firstError, null);
  watchedSessionId = firstId;
  await confirmSession(dean, watchedSessionId, group, { id: oldFilm, title: "Home Alone", year: 1990 });
  const { error: watchError } = await dean.client.rpc("mark_movie_session_watched", {
    p_session_id: watchedSessionId, p_watched_on: "2026-08-20", p_host_id: dean.id, p_participant_ids: [dean.id, cameron.id],
  });
  assert.equal(watchError, null);

  // Session two stays CONFIRMED, so it is the group's one open session.
  const newFilm = await addFilm(dean, group, { title: "Alien", year: 1979 });
  const { data: secondId, error: secondError } = await dean.client.rpc("create_movie_session", {
    p_group_id: group, p_mode: "Queue Roulette", p_participant_ids: [dean.id, cameron.id], p_candidate_count: 1, p_game_state: {},
  });
  assert.equal(secondError, null);
  openSessionId = secondId;
  await confirmSession(dean, openSessionId, group, { id: newFilm, title: "Alien", year: 1979 });
});

test("removing the host transfers the open session to the removing administrator", async () => {
  const { error } = await cameron.client.rpc("remove_group_member", { p_group_id: group, p_user_id: dean.id });
  assert.equal(error, null);

  const membership = sqlRow(
    `select user_id from public.group_memberships where group_id = '${group}' and user_id = '${dean.id}'`,
  );
  assert.equal(membership, null, "the membership must actually be gone");

  const open = sqlRow(`select host_id, status from public.movie_sessions where id = '${openSessionId}'`);
  assert.equal(open.status, "CONFIRMED");
  assert.equal(open.host_id, cameron.id, "the open session must be handed to the administrator");
});

test("the watched session keeps its real host for the history", async () => {
  const watched = sqlRow(`select host_id, status from public.movie_sessions where id = '${watchedSessionId}'`);
  assert.equal(watched.status, "WATCHED");
  assert.equal(watched.host_id, dean.id, "rewriting history would misreport who hosted that night");
});

test("the administrator can still write to the session hosted by a departed member", async () => {
  // This is the update that used to fail with "The session host must be an
  // approved member of this group" — the trigger now only validates on change.
  const { data, error } = await cameron.client
    .from("movie_sessions")
    .update({ journal_draft: { sessionId: watchedSessionId, comment: "Written after Dean left." } })
    .eq("id", watchedSessionId)
    .eq("group_id", group)
    .select("id, journal_draft")
    .maybeSingle();

  assert.equal(error, null, `saving a draft must not be blocked by the departed host: ${error?.message}`);
  assert.ok(data, "the update must affect the row");
  assert.equal(data.journal_draft.comment, "Written after Dean left.");
});

test("the administrator can still edit the details of that historical session", async () => {
  const { error } = await cameron.client.rpc("save_movie_session_details", {
    p_session_id: watchedSessionId, p_watch_date: "2026-08-21", p_host_id: cameron.id, p_participant_ids: [cameron.id],
  });
  assert.equal(error, null, "an admin must be able to repair a session whose host has left");

  const data = sqlRow(`select watch_date, host_id from public.movie_sessions where id = '${watchedSessionId}'`);
  assert.equal(data.watch_date, "2026-08-21");
  assert.equal(data.host_id, cameron.id);
});

test("a departed member loses all access through Row Level Security", async () => {
  const { data: sessions } = await dean.client.from("movie_sessions").select("id");
  assert.deepEqual(sessions, [], "the removed member must no longer see group sessions");

  const { data: films } = await dean.client.from("queue_items").select("id");
  assert.deepEqual(films, [], "the removed member must no longer see the shared list");
});

test("a session host may still not be set to a non-member", async () => {
  // The relaxation must not become a hole: assigning a non-member is still an error.
  const { error } = await cameron.client.rpc("save_movie_session_details", {
    p_session_id: watchedSessionId, p_watch_date: "2026-08-21", p_host_id: dean.id, p_participant_ids: [cameron.id],
  });
  assert.ok(error, "assigning a departed member as host must still be refused");
  assert.match(error.message, /must be an approved member/i);
});
