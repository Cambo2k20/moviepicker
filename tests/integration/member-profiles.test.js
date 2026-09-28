// Curated Member Profile drafts, explicit publication snapshots and group-only
// visibility against the local Supabase stack.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  groupId,
  resetWorkspace,
  runSql,
  serviceDataClient,
  sqlRow,
  sqlRows,
} from "./helpers/local-supabase.js";

let group;
let owner;
let otherMember;
let outsider;
let movies;

function movieByTmdb(tmdbId) {
  return movies.find((movie) => Number(movie.tmdb_id) === tmdbId);
}

async function saveDraft({
  introduction,
  movieIds,
  bannerMovieId = movieIds[0] || null,
  includeRecentWatches = true,
  includeGenreBreakdown = true,
} = {}) {
  return owner.client.rpc("save_member_profile_draft", {
    p_group_id: group,
    p_introduction: introduction,
    p_movie_ids: movieIds,
    p_banner_movie_id: bannerMovieId,
    p_include_recent_watches: includeRecentWatches,
    p_include_genre_breakdown: includeGenreBreakdown,
  });
}

test("set up Member Profile identities and five canonical films", async () => {
  await resetWorkspace();
  group = groupId();
  owner = await createIdentity({ name: "Cameron", role: "member" });
  otherMember = await createIdentity({ name: "Dean", role: "admin" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  const { data, error } = await serviceDataClient()
    .from("movies")
    .insert([
      { tmdb_id: 348, title: "Alien", release_year: 1979, poster_path: "/alien.jpg", backdrop_path: "/alien-wide.jpg", genres: ["Horror", "Science Fiction"] },
      { tmdb_id: 603, title: "The Matrix", release_year: 1999, poster_path: "/matrix.jpg", backdrop_path: "/matrix-wide.jpg", genres: ["Action", "Science Fiction"] },
      { tmdb_id: 680, title: "Pulp Fiction", release_year: 1994, poster_path: "/pulp.jpg", backdrop_path: "/pulp-wide.jpg", genres: ["Crime", "Drama"] },
      { tmdb_id: 771, title: "Home Alone", release_year: 1990, poster_path: "/home-alone.jpg", backdrop_path: "/home-alone-wide.jpg", genres: ["Comedy", "Family"] },
      { tmdb_id: 129, title: "Spirited Away", release_year: 2001, poster_path: "/spirited.jpg", backdrop_path: "/spirited-wide.jpg", genres: ["Animation", "Fantasy"] },
      { tmdb_id: 550, title: "Fight Club", release_year: 1999, poster_path: "/fight-club.jpg", backdrop_path: "/fight-club-wide.jpg", genres: ["Drama"] },
    ])
    .select("id,tmdb_id,title,poster_path,backdrop_path,genres");
  assert.equal(error, null);
  movies = data.sort((left, right) => Number(left.tmdb_id) - Number(right.tmdb_id));

  const selectedMovies = [348, 603, 680, 771, 129].map(movieByTmdb);
  const { error: personalError } = await owner.client
    .from("personal_films")
    .insert(selectedMovies.map((movie, index) => ({
      owner_id: owner.id,
      movie_id: movie.id,
      state: index === 3 ? "WANT_TO_WATCH" : "WATCHED",
      rating: [5, 4, 3, null, 5][index],
    })));
  assert.equal(personalError, null);

  const sessionId = crypto.randomUUID();
  const visibleJournalId = crypto.randomUUID();
  const hiddenJournalId = crypto.randomUUID();
  runSql(`
    insert into public.movie_sessions (
      id, group_id, created_by, host_id, mode, status, candidate_count,
      selected_title, selected_release_year, selected_tmdb_id, selected_poster_path,
      selected_movie_id, watch_date
    ) values (
      '${sessionId}', '${group}', '${owner.id}', '${owner.id}', 'Queue Roulette', 'WATCHED', 5,
      'Alien', 1979, 348, '/alien.jpg', '${movieByTmdb(348).id}', '2026-09-28'
    );
    insert into public.movie_session_participants (session_id, profile_id, display_name_snapshot)
    values ('${sessionId}', '${owner.id}', 'Cameron');
    insert into public.journal_entries (
      id, group_id, title, release_year, watched_at, status, created_by, movie_session_id, movie_id
    ) values (
      '${visibleJournalId}', '${group}', 'Alien', 1979, '2026-09-28', 'FINISHED', '${owner.id}', '${sessionId}', '${movieByTmdb(348).id}'
    );
    insert into public.entry_viewers (entry_id, profile_id)
    values ('${visibleJournalId}', '${owner.id}');
    insert into public.journal_entries (
      id, group_id, title, release_year, watched_at, status, created_by, movie_id
    ) values (
      '${hiddenJournalId}', '${group}', 'Spirited Away', 2001, '2026-09-29', 'FINISHED', '${owner.id}', '${movieByTmdb(129).id}'
    );
    insert into public.entry_viewers (entry_id, profile_id)
    values ('${hiddenJournalId}', '${owner.id}');
  `);

  const { error: historyError } = await owner.client.from("personal_viewing_events").insert([
    { owner_id: owner.id, movie_id: movieByTmdb(603).id, outcome: "DID_NOT_FINISH", watched_on: "2026-09-27" },
    { owner_id: owner.id, movie_id: movieByTmdb(680).id, outcome: "FINISHED", watched_on: "2026-09-26" },
    { owner_id: owner.id, movie_id: movieByTmdb(771).id, outcome: "FINISHED", watched_on: "2026-09-25" },
  ]);
  assert.equal(historyError, null);

  const { error: hideError } = await owner.client
    .from("personal_viewing_events")
    .update({ is_hidden: true })
    .eq("owner_id", owner.id)
    .eq("source_journal_entry_id", hiddenJournalId);
  assert.equal(hideError, null);

  const { error: hiddenStateError } = await owner.client
    .from("personal_films")
    .update({ state: "DID_NOT_FINISH" })
    .eq("owner_id", owner.id)
    .eq("movie_id", movieByTmdb(129).id);
  assert.equal(hiddenStateError, null);
});

test("drafts remain private and a publication exposes the selected profile snapshot", async () => {
  const movieIds = [348, 603, 680, 771, 129].map((tmdbId) => movieByTmdb(tmdbId).id);
  const { data: saved, error: saveError } = await saveDraft({
    introduction: "Five films I would defend in court.",
    movieIds,
    bannerMovieId: movieByTmdb(603).id,
  });
  assert.equal(saveError, null);
  assert.equal(saved, true);

  const { data: draft, error: draftError } = await owner.client
    .from("member_profile_drafts")
    .select("introduction,banner_movie_id,include_recent_watches,include_genre_breakdown,member_profile_draft_films(slot,movie_id)")
    .single();
  assert.equal(draftError, null);
  assert.equal(draft.introduction, "Five films I would defend in court.");
  assert.equal(draft.banner_movie_id, movieByTmdb(603).id);
  assert.equal(draft.include_recent_watches, true);
  assert.equal(draft.include_genre_breakdown, true);
  assert.deepEqual(draft.member_profile_draft_films.sort((left, right) => left.slot - right.slot).map((film) => film.movie_id), movieIds);

  const { data: hiddenDraft, error: hiddenDraftError } = await otherMember.client
    .from("member_profile_drafts")
    .select("owner_id");
  assert.equal(hiddenDraftError, null);
  assert.deepEqual(hiddenDraft, []);

  const { data: published, error: publishError } = await owner.client.rpc("publish_member_profile", { p_group_id: group });
  assert.equal(publishError, null);
  assert.equal(published, true);

  const { data: visibleRows, error: visibleError } = await otherMember.client.rpc("get_member_profiles", { p_group_id: group });
  assert.equal(visibleError, null);
  assert.equal(visibleRows.length, 5);
  assert.deepEqual(visibleRows.map((row) => row.movie_id), movieIds);
  assert.equal(visibleRows[0].introduction, "Five films I would defend in court.");
  assert.equal(visibleRows[0].banner_movie_id, movieByTmdb(603).id);
  assert.equal(visibleRows[0].banner_title, "The Matrix");
  assert.equal(visibleRows[0].banner_backdrop_path, "/matrix-wide.jpg");
  assert.equal(visibleRows[0].films_watched_count, 4);
  assert.equal(visibleRows[0].sessions_attended_count, 1);
  assert.equal(Number(visibleRows[0].average_rating), 4.25);
  assert.equal(Number(visibleRows[0].completion_rate), 75);
  assert.deepEqual(visibleRows.map((row) => row.rating), [5, 4, 3, null, 5]);
  assert.deepEqual(visibleRows[0].recent_watches.map((watch) => watch.title), ["Alien", "The Matrix", "Pulp Fiction", "Home Alone"]);
  assert.equal(visibleRows[0].recent_watches[0].session_label, "Queue Roulette");
  assert.equal(visibleRows[0].recent_watches.some((watch) => watch.title === "Spirited Away"), false);
  assert.deepEqual(visibleRows[0].genre_breakdown, [
    { position: 1, genre: "Comedy", watch_count: 1 },
    { position: 2, genre: "Crime", watch_count: 1 },
    { position: 3, genre: "Drama", watch_count: 1 },
  ]);

  const { data: outsiderRows, error: outsiderError } = await outsider.client.rpc("get_member_profiles", { p_group_id: group });
  assert.equal(outsiderRows, null);
  assert.match(outsiderError?.message || "", /membership is required/i);
});

test("private edits do not alter the published snapshot until republished", async () => {
  const original = [348, 603, 680, 771, 129].map((tmdbId) => movieByTmdb(tmdbId).id);
  const reordered = [...original].reverse();
  const { error: saveError } = await saveDraft({
    introduction: "A private edit that is not public yet.",
    movieIds: reordered,
    bannerMovieId: movieByTmdb(129).id,
    includeRecentWatches: false,
    includeGenreBreakdown: false,
  });
  assert.equal(saveError, null);

  const { data: unchanged, error: unchangedError } = await otherMember.client.rpc("get_member_profiles", { p_group_id: group });
  assert.equal(unchangedError, null);
  assert.equal(unchanged[0].introduction, "Five films I would defend in court.");
  assert.deepEqual(unchanged.map((row) => row.movie_id), original);
  assert.equal(unchanged[0].recent_watches.length, 4);
  assert.equal(unchanged[0].genre_breakdown.length, 3);

  const { error: republishError } = await owner.client.rpc("publish_member_profile", { p_group_id: group });
  assert.equal(republishError, null);
  const { data: refreshed, error: refreshedError } = await otherMember.client.rpc("get_member_profiles", { p_group_id: group });
  assert.equal(refreshedError, null);
  assert.equal(refreshed[0].introduction, "A private edit that is not public yet.");
  assert.deepEqual(refreshed.map((row) => row.movie_id), reordered);
  assert.equal(refreshed[0].banner_movie_id, movieByTmdb(129).id);
  assert.deepEqual(refreshed[0].recent_watches, []);
  assert.deepEqual(refreshed[0].genre_breakdown, []);
  assert.equal(sqlRow("select count(*)::integer as count from public.member_profile_publication_recent_watches").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.member_profile_publication_genres").count, 0);
});

test("profile RPCs enforce five unique owner-owned films and direct snapshot writes stay closed", async () => {
  const owned = [348, 603, 680, 771, 129].map((tmdbId) => movieByTmdb(tmdbId).id);
  const duplicateIds = owned.slice(0, 4).concat(owned[0]);
  const { error: duplicateError } = await saveDraft({
    introduction: "Duplicate attempt",
    movieIds: duplicateIds,
  });
  assert.match(duplicateError?.message || "", /only appear once/i);

  const { error: bannerError } = await saveDraft({
    introduction: "Invalid banner attempt",
    movieIds: owned,
    bannerMovieId: movieByTmdb(550).id,
  });
  assert.match(bannerError?.message || "", /banner must use a film from your Top Five/i);

  const { error: foreignFilmError } = await saveDraft({
    introduction: "Unowned film attempt",
    movieIds: [...owned.slice(0, 4), movieByTmdb(550).id],
    bannerMovieId: owned[0],
  });
  assert.match(foreignFilmError?.message || "", /must already be in your My Cinema/i);

  const { error: forgedError } = await otherMember.client
    .from("member_profile_publications")
    .update({ introduction: "Forged" })
    .eq("group_id", group);
  assert.match(forgedError?.message || "", /permission denied/i);

  const { error: forgedDraftError } = await otherMember.client
    .from("member_profile_drafts")
    .insert({ group_id: group, owner_id: owner.id, introduction: "Forged" });
  assert.match(forgedDraftError?.message || "", /permission denied/i);

  const publicationId = sqlRow("select id from public.member_profile_publications").id;
  const { error: forgedRecentError } = await otherMember.client
    .from("member_profile_publication_recent_watches")
    .insert({
      publication_id: publicationId,
      position: 1,
      movie_id: movieByTmdb(348).id,
      title: "Alien",
      tmdb_id: 348,
      outcome: "FINISHED",
    });
  assert.match(forgedRecentError?.message || "", /permission denied/i);

  const { error: forgedGenreError } = await otherMember.client
    .from("member_profile_publication_genres")
    .insert({ publication_id: publicationId, position: 1, genre: "Horror", watch_count: 999 });
  assert.match(forgedGenreError?.message || "", /permission denied/i);
});

test("unpublishing and membership removal hide the profile without exposing private rows", async () => {
  const { data: unpublished, error: unpublishError } = await owner.client.rpc("unpublish_member_profile", { p_group_id: group });
  assert.equal(unpublishError, null);
  assert.equal(unpublished, true);
  assert.equal(sqlRow("select count(*)::integer as count from public.member_profile_publications").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.member_profile_drafts").count, 1);

  const { error: republishError } = await owner.client.rpc("publish_member_profile", { p_group_id: group });
  assert.equal(republishError, null);
  runSql(`delete from public.group_memberships where group_id = '${group}' and user_id = '${owner.id}';`);

  const { data: hiddenRows, error: hiddenError } = await otherMember.client.rpc("get_member_profiles", { p_group_id: group });
  assert.equal(hiddenError, null);
  assert.deepEqual(hiddenRows, []);
  assert.equal(sqlRow("select count(*)::integer as count from public.member_profile_publications").count, 1);
  assert.deepEqual(sqlRows("select owner_id from public.member_profile_drafts"), [{ owner_id: owner.id }]);
});
