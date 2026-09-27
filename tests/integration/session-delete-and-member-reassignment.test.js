// Regression coverage for session deletion and the one-time legacy account
// repair used when shared films were added under an older Discord login.

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
let admin;
let host;
let suggester;
let watchedSessionId;
let watchedFilmId;

test("a host can delete a watched session without owning the shared film", async () => {
  await resetWorkspace();
  group = groupId();
  admin = await createIdentity({ name: "Cameron", role: "admin" });
  host = await createIdentity({ name: "Dean", role: "member" });
  suggester = await createIdentity({ name: "Ross", role: "member" });

  watchedFilmId = await addFilm(suggester, group, { title: "Alien", year: 1979 });
  const { data: created, error: createError } = await host.client.rpc("create_movie_session", {
    p_group_id: group,
    p_mode: "Queue Roulette",
    p_participant_ids: [host.id, admin.id],
    p_candidate_count: 1,
    p_game_state: {},
  });
  assert.equal(createError, null);
  watchedSessionId = created;

  await confirmSession(host, watchedSessionId, group, { id: watchedFilmId, title: "Alien", year: 1979 });
  const { error: watchError } = await host.client.rpc("mark_movie_session_watched", {
    p_session_id: watchedSessionId,
    p_watched_on: "2026-09-27",
    p_host_id: host.id,
    p_participant_ids: [host.id, admin.id],
  });
  assert.equal(watchError, null);

  await expectRpcError(
    suggester.client.rpc("delete_movie_session", { p_session_id: watchedSessionId }),
    /only the session host or a group administrator/i,
  );

  const { data: deleted, error: deleteError } = await host.client.rpc("delete_movie_session", {
    p_session_id: watchedSessionId,
  });
  assert.equal(deleteError, null);
  assert.equal(deleted, true);
  assert.equal(sqlRow(`select count(*)::integer as count from public.movie_sessions where id = '${watchedSessionId}'`).count, 0);
  assert.equal(sqlRow(`select count(*)::integer as count from public.movie_session_participants where session_id = '${watchedSessionId}'`).count, 0);
  assert.equal(sqlRow(`select watched from public.queue_items where id = '${watchedFilmId}'`).watched, false);
});

test("a session with a Journal entry cannot be deleted", async () => {
  const filmId = await addFilm(host, group, { title: "The Matrix", year: 1999 });
  const { data: created, error: createError } = await host.client.rpc("create_movie_session", {
    p_group_id: group,
    p_mode: "Queue Roulette",
    p_participant_ids: [host.id, admin.id],
    p_candidate_count: 1,
    p_game_state: {},
  });
  assert.equal(createError, null);
  const sessionId = created;

  await confirmSession(host, sessionId, group, { id: filmId, title: "The Matrix", year: 1999 });
  const { error: watchError } = await host.client.rpc("mark_movie_session_watched", {
    p_session_id: sessionId,
    p_watched_on: "2026-09-27",
    p_host_id: host.id,
    p_participant_ids: [host.id, admin.id],
  });
  assert.equal(watchError, null);

  const { error: journalError } = await host.client.rpc("save_movie_session_journal", {
    p_session_id: sessionId,
    p_title: "The Matrix",
    p_release_year: 1999,
    p_status: "FINISHED",
    p_comment: "Still excellent.",
    p_entry_number: null,
  });
  assert.equal(journalError, null);

  await expectRpcError(
    admin.client.rpc("delete_movie_session", { p_session_id: sessionId }),
    /linked Journal entry/i,
  );
  assert.equal(sqlRow(`select count(*)::integer as count from public.movie_sessions where id = '${sessionId}'`).count, 1);
});

test("an administrator can reassign the legacy shared films and remove only group access", async () => {
  await resetWorkspace();
  group = groupId();
  admin = await createIdentity({ name: "Cameron", role: "admin" });
  const legacy = await createIdentity({ name: "cameron_brown00", role: "member" });
  const otherMember = await createIdentity({ name: "Dean", role: "member" });

  const firstFilmId = await addFilm(legacy, group, { title: "Tarzan", year: 1999 });
  const secondFilmId = await addFilm(legacy, group, { title: "Shrek", year: 2001 });
  const otherFilmId = await addFilm(otherMember, group, { title: "Alien", year: 1979 });

  await expectRpcError(
    otherMember.client.rpc("reassign_shared_films_and_remove_member", {
      p_group_id: group,
      p_old_user_id: legacy.id,
    }),
    /group administrator/i,
  );

  const { data: moved, error: repairError } = await admin.client.rpc("reassign_shared_films_and_remove_member", {
    p_group_id: group,
    p_old_user_id: legacy.id,
  });
  assert.equal(repairError, null);
  assert.equal(moved, 2);

  const reassigned = sqlRows(`
    select id, suggested_by
    from public.queue_items
    where id in ('${firstFilmId}', '${secondFilmId}', '${otherFilmId}')
    order by id
  `);
  assert.equal(reassigned.length, 3);
  assert.deepEqual(
    reassigned.filter((film) => film.id !== otherFilmId).map((film) => film.suggested_by),
    [admin.id, admin.id],
  );
  assert.equal(reassigned.find((film) => film.id === otherFilmId).suggested_by, otherMember.id);

  assert.equal(sqlRow(`select count(*)::integer as count from public.group_memberships where group_id = '${group}' and user_id = '${legacy.id}'`).count, 0);
  assert.equal(sqlRow(`select count(*)::integer as count from public.profiles where id = '${legacy.id}'`).count, 1);
  assert.equal(sqlRow(`select count(*)::integer as count from auth.users where id = '${legacy.id}'`).count, 1);

  const { data: hiddenFilms, error: hiddenFilmsError } = await legacy.client.from("queue_items").select("id");
  assert.equal(hiddenFilmsError, null);
  assert.deepEqual(hiddenFilms, []);
});

test("the new repair and delete functions expose only authenticated execution", () => {
  assert.deepEqual(sqlRow(`
    select
      has_function_privilege('anon', 'public.delete_movie_session(uuid)', 'EXECUTE') as anon_delete,
      has_function_privilege('authenticated', 'public.delete_movie_session(uuid)', 'EXECUTE') as member_delete,
      has_function_privilege('anon', 'public.reassign_shared_films_and_remove_member(uuid,uuid)', 'EXECUTE') as anon_reassign,
      has_function_privilege('authenticated', 'public.reassign_shared_films_and_remove_member(uuid,uuid)', 'EXECUTE') as member_reassign
  `), {
    anon_delete: false,
    member_delete: true,
    anon_reassign: false,
    member_reassign: true,
  });
});
