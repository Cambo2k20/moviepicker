// Canonical movie identity, grants and compatibility bridges against local
// Supabase with real member and non-member JWTs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  groupId,
  resetWorkspace,
  serviceDataClient,
  sqlRow,
} from "./helpers/local-supabase.js";

let group;
let admin;
let member;
let outsider;
let alien;
let matrix;
let alienQueueItem;
let sessionId;

test("set up canonical movies through the narrow service-role surface", async () => {
  await resetWorkspace();
  group = groupId();
  admin = await createIdentity({ name: "Cameron", role: "admin" });
  member = await createIdentity({ name: "Dean", role: "member" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  const service = serviceDataClient();
  const { data, error } = await service
    .from("movies")
    .upsert([
      {
        tmdb_id: 348,
        title: "Alien",
        original_title: "Alien",
        release_date: "1979-05-25",
        release_year: 1979,
        original_language: "en",
        poster_path: "/alien.jpg",
        runtime_minutes: 117,
        genres: ["Horror", "Science Fiction"],
        overview: "A commercial spacecraft encounters a deadly lifeform.",
      },
      {
        tmdb_id: 603,
        title: "The Matrix",
        original_title: "The Matrix",
        release_date: "1999-03-31",
        release_year: 1999,
        original_language: "en",
        poster_path: "/matrix.jpg",
        runtime_minutes: 136,
        genres: ["Action", "Science Fiction"],
        overview: "A hacker discovers the world is a simulation.",
      },
    ], { onConflict: "tmdb_id" })
    .select("id,tmdb_id,title");

  assert.equal(error, null);
  alien = data.find((movie) => Number(movie.tmdb_id) === 348);
  matrix = data.find((movie) => Number(movie.tmdb_id) === 603);
  assert.ok(alien?.id && matrix?.id);
});

test("only approved members can read canonical metadata", async () => {
  for (const identity of [admin, member]) {
    const { data, error } = await identity.client.from("movies").select("id,tmdb_id,title").order("tmdb_id");
    assert.equal(error, null);
    assert.deepEqual(data.map((movie) => movie.title), ["Alien", "The Matrix"]);
  }

  const { data, error } = await outsider.client.from("movies").select("id,tmdb_id,title");
  assert.equal(error, null, "an authenticated non-member has SELECT privilege but no RLS-visible rows");
  assert.deepEqual(data, []);
});

test("browser roles cannot create, alter or delete canonical metadata", async () => {
  const { error: insertError } = await member.client.from("movies").insert({ tmdb_id: 1, title: "Forged" });
  const { error: updateError } = await member.client.from("movies").update({ title: "Forged" }).eq("id", alien.id);
  const { error: deleteError } = await admin.client.from("movies").delete().eq("id", alien.id);

  assert.match(insertError?.message || "", /permission denied/i);
  assert.match(updateError?.message || "", /permission denied/i);
  assert.match(deleteError?.message || "", /permission denied/i);
  assert.deepEqual(sqlRow(`
    select
      c.relrowsecurity as rls_enabled,
      has_table_privilege('anon', 'public.movies', 'SELECT') as anon_select,
      has_table_privilege('authenticated', 'public.movies', 'SELECT') as member_select,
      has_table_privilege('authenticated', 'public.movies', 'INSERT') as member_insert,
      has_table_privilege('authenticated', 'public.movies', 'UPDATE') as member_update,
      has_table_privilege('authenticated', 'public.movies', 'DELETE') as member_delete,
      has_table_privilege('service_role', 'public.movies', 'SELECT') as service_select,
      has_table_privilege('service_role', 'public.movies', 'INSERT') as service_insert,
      has_table_privilege('service_role', 'public.movies', 'UPDATE') as service_update,
      has_table_privilege('service_role', 'public.movies', 'DELETE') as service_delete,
      has_table_privilege('service_role', 'public.movies', 'TRUNCATE') as service_truncate,
      has_table_privilege('service_role', 'public.movies', 'REFERENCES') as service_references,
      has_table_privilege('service_role', 'public.movies', 'TRIGGER') as service_trigger
    from pg_class c
    where c.oid = 'public.movies'::regclass
  `), {
    rls_enabled: true,
    anon_select: false,
    member_select: true,
    member_insert: false,
    member_update: false,
    member_delete: false,
    service_select: true,
    service_insert: true,
    service_update: true,
    service_delete: false,
    service_truncate: false,
    service_references: false,
    service_trigger: false,
  });
});

test("old-style queue writes auto-link while manual films remain valid", async () => {
  const { data, error } = await member.client
    .from("queue_items")
    .insert({
      group_id: group,
      suggested_by: member.id,
      title: "Alien",
      release_year: 1979,
      tmdb_id: 348,
      runtime_minutes: 117,
    })
    .select("id,movie_id,tmdb_id")
    .single();
  assert.equal(error, null);
  assert.equal(data.movie_id, alien.id);
  alienQueueItem = data.id;

  const { data: manual, error: manualError } = await admin.client
    .from("queue_items")
    .insert({ group_id: group, suggested_by: admin.id, title: "Unmatched festival short" })
    .select("id,movie_id,tmdb_id")
    .single();
  assert.equal(manualError, null);
  assert.equal(manual.movie_id, null);
  assert.equal(manual.tmdb_id, null);

  const { error: mismatchError } = await member.client.from("queue_items").insert({
    group_id: group,
    suggested_by: member.id,
    title: "Contradictory identity",
    tmdb_id: 348,
    movie_id: matrix.id,
  });
  assert.match(mismatchError?.message || "", /TMDB ID must match its canonical movie/i);
});

test("sessions and their Journal entries inherit one canonical identity", async () => {
  const { data: createdSessionId, error: createError } = await member.client.rpc("create_movie_session", {
    p_group_id: group,
    p_mode: "Queue Roulette",
    p_participant_ids: [member.id, admin.id],
    p_candidate_count: 1,
    p_game_state: {},
  });
  assert.equal(createError, null);
  sessionId = createdSessionId;

  const { error: mismatchError } = await member.client
    .from("movie_sessions")
    .update({
      status: "CONFIRMED",
      watch_date: "2026-08-24",
      selected_queue_item_id: alienQueueItem,
      selected_title: "Alien",
      selected_release_year: 1979,
      selected_movie_id: matrix.id,
      selected_tmdb_id: 348,
    })
    .eq("id", sessionId);
  assert.match(mismatchError?.message || "", /must match the selected queue item/i);

  // Compatibility path: this deliberately omits selected_movie_id, as an old
  // frontend build would. The database derives it from selected_tmdb_id.
  const { data: confirmed, error: confirmError } = await member.client
    .from("movie_sessions")
    .update({
      status: "CONFIRMED",
      watch_date: "2026-08-24",
      selected_queue_item_id: alienQueueItem,
      selected_title: "Alien",
      selected_release_year: 1979,
      selected_tmdb_id: 348,
      selected_genres: ["Horror", "Science Fiction"],
    })
    .eq("id", sessionId)
    .select("id,status,selected_movie_id,selected_tmdb_id")
    .single();
  assert.equal(confirmError, null);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.selected_movie_id, alien.id);

  const { error: watchedError } = await member.client.rpc("mark_movie_session_watched", {
    p_session_id: sessionId,
    p_watched_on: "2026-08-24",
    p_host_id: member.id,
    p_participant_ids: [member.id, admin.id],
  });
  assert.equal(watchedError, null);

  const { data: saved, error: journalError } = await member.client.rpc("save_movie_session_journal", {
    p_session_id: sessionId,
    p_title: "Alien",
    p_release_year: 1979,
    p_status: "FINISHED",
    p_comment: "Canonical identity survives the whole watch flow.",
    p_entry_number: null,
  });
  assert.equal(journalError, null);
  const entry = Array.isArray(saved) ? saved[0] : saved;
  assert.equal(entry.movie_id, alien.id);
  assert.equal(sqlRow(`select movie_id from public.journal_entries where id = '${entry.id}'`).movie_id, alien.id);
});
