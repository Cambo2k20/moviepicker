// Phase 2A personal-film state, reaction semantics and privacy against local
// Supabase with genuinely authenticated owners, members and non-members.

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

test("set up members and canonical movies", async () => {
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
    .select("id,tmdb_id,title");

  assert.equal(error, null);
  alien = data.find((movie) => Number(movie.tmdb_id) === 348);
  matrix = data.find((movie) => Number(movie.tmdb_id) === 603);
  assert.ok(alien?.id && matrix?.id);
});

test("a rating creates a private Watched film without touching Cine-Cord", async () => {
  const { data, error } = await owner.client
    .from("personal_films")
    .insert({ owner_id: owner.id, movie_id: alien.id, rating: 4 })
    .select("id,owner_id,movie_id,state,rating,is_favourite")
    .single();

  assert.equal(error, null);
  assert.equal(data.owner_id, owner.id);
  assert.equal(data.movie_id, alien.id);
  assert.equal(data.state, "WATCHED");
  assert.equal(data.rating, 4);
  assert.equal(data.is_favourite, false);
  assert.equal(sqlRow("select count(*)::integer as count from public.queue_items").count, 0);
});

test("personal films are visible only to their owner, not another member or admin", async () => {
  const { data: ownRows, error: ownError } = await owner.client
    .from("personal_films")
    .select("movie_id,rating");
  assert.equal(ownError, null);
  assert.deepEqual(ownRows, [{ movie_id: alien.id, rating: 4 }]);

  for (const identity of [otherMember, outsider]) {
    const { data, error } = await identity.client
      .from("personal_films")
      .select("movie_id,rating");
    assert.equal(error, null);
    assert.deepEqual(data, []);
  }
});

test("members cannot create or rewrite another person's record", async () => {
  const { error: forgedOwnerError } = await otherMember.client
    .from("personal_films")
    .insert({ owner_id: owner.id, movie_id: matrix.id, state: "WANT_TO_WATCH" });
  assert.match(forgedOwnerError?.message || "", /row-level security/i);

  const { error: ownerRewriteError } = await owner.client
    .from("personal_films")
    .update({ owner_id: otherMember.id })
    .eq("movie_id", alien.id);
  assert.match(ownerRewriteError?.message || "", /permission denied/i);

  const { error: movieRewriteError } = await owner.client
    .from("personal_films")
    .update({ movie_id: matrix.id })
    .eq("movie_id", alien.id);
  assert.match(movieRewriteError?.message || "", /permission denied/i);
});

test("DNF survives rating changes and clearing a rating leaves other signals alone", async () => {
  const { data: dnf, error: dnfError } = await owner.client
    .from("personal_films")
    .update({ state: "DID_NOT_FINISH", rating: 5, is_favourite: true })
    .eq("movie_id", alien.id)
    .select("state,rating,is_favourite")
    .single();
  assert.equal(dnfError, null);
  assert.deepEqual(dnf, { state: "DID_NOT_FINISH", rating: 5, is_favourite: true });

  const { data: cleared, error: clearError } = await owner.client
    .from("personal_films")
    .update({ rating: null })
    .eq("movie_id", alien.id)
    .select("state,rating,is_favourite")
    .single();
  assert.equal(clearError, null);
  assert.deepEqual(cleared, { state: "DID_NOT_FINISH", rating: null, is_favourite: true });
});

test("Favourite remains independent and one owner cannot duplicate a movie", async () => {
  const { data, error } = await owner.client
    .from("personal_films")
    .insert({ owner_id: owner.id, movie_id: matrix.id, is_favourite: true })
    .select("state,rating,is_favourite")
    .single();
  assert.equal(error, null);
  assert.deepEqual(data, { state: null, rating: null, is_favourite: true });

  const { data: unfavourited, error: favouriteError } = await owner.client
    .from("personal_films")
    .update({ is_favourite: false })
    .eq("movie_id", matrix.id)
    .select("state,rating,is_favourite")
    .single();
  assert.equal(favouriteError, null);
  assert.deepEqual(unfavourited, { state: null, rating: null, is_favourite: false });

  const { error: duplicateError } = await owner.client
    .from("personal_films")
    .insert({ owner_id: owner.id, movie_id: matrix.id, state: "WANT_TO_WATCH" });
  assert.match(duplicateError?.message || "", /duplicate key|unique constraint/i);
});

test("rated films cannot become Want to Watch without clearing the rating", async () => {
  const { data: rated, error: ratingError } = await owner.client
    .from("personal_films")
    .update({ rating: 3 })
    .eq("movie_id", matrix.id)
    .select("state,rating")
    .single();
  assert.equal(ratingError, null);
  assert.deepEqual(rated, { state: "WATCHED", rating: 3 });

  const { error: invalidStateError } = await owner.client
    .from("personal_films")
    .update({ state: "WANT_TO_WATCH" })
    .eq("movie_id", matrix.id);
  assert.match(invalidStateError?.message || "", /personal_films_rating_state_check/i);
});

test("table and column privileges expose only the personal-film browser surface", () => {
  assert.deepEqual(sqlRow(`
    select
      c.relrowsecurity as rls_enabled,
      has_table_privilege('anon', 'public.personal_films', 'SELECT') as anon_select,
      has_table_privilege('authenticated', 'public.personal_films', 'SELECT') as member_select,
      has_table_privilege('authenticated', 'public.personal_films', 'DELETE') as member_delete,
      has_table_privilege('service_role', 'public.personal_films', 'SELECT') as service_select,
      has_table_privilege('service_role', 'public.personal_films', 'INSERT') as service_insert,
      has_column_privilege('authenticated', 'public.personal_films', 'owner_id', 'INSERT') as owner_insert,
      has_column_privilege('authenticated', 'public.personal_films', 'owner_id', 'UPDATE') as owner_update,
      has_column_privilege('authenticated', 'public.personal_films', 'movie_id', 'INSERT') as movie_insert,
      has_column_privilege('authenticated', 'public.personal_films', 'movie_id', 'UPDATE') as movie_update,
      has_column_privilege('authenticated', 'public.personal_films', 'state', 'INSERT') as state_insert,
      has_column_privilege('authenticated', 'public.personal_films', 'state', 'UPDATE') as state_update,
      has_column_privilege('authenticated', 'public.personal_films', 'created_at', 'INSERT') as created_insert,
      has_column_privilege('authenticated', 'public.personal_films', 'created_at', 'UPDATE') as created_update
    from pg_class c
    where c.oid = 'public.personal_films'::regclass
  `), {
    rls_enabled: true,
    anon_select: false,
    member_select: true,
    member_delete: true,
    service_select: false,
    service_insert: false,
    owner_insert: true,
    owner_update: false,
    movie_insert: true,
    movie_update: false,
    state_insert: true,
    state_update: true,
    created_insert: false,
    created_update: false,
  });
});

test("membership removal hides retained private data and account deletion removes it", async () => {
  runSql(`delete from public.group_memberships where group_id = '${group}' and user_id = '${owner.id}';`);

  const { data: hidden, error: readError } = await owner.client
    .from("personal_films")
    .select("id");
  assert.equal(readError, null);
  assert.deepEqual(hidden, []);
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_films where owner_id = '${owner.id}'`).count, 2);

  const { data: changed, error: updateError } = await owner.client
    .from("personal_films")
    .update({ is_favourite: false })
    .eq("owner_id", owner.id)
    .select("id");
  assert.equal(updateError, null);
  assert.deepEqual(changed, []);

  runSql(`delete from auth.users where id = '${owner.id}';`);
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_films where owner_id = '${owner.id}'`).count, 0);
});
