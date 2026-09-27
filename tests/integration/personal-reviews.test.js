// Phase 2C private review drafts, deliberate publication and membership-gated
// visibility against local Supabase with genuinely authenticated identities.

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
let reviewId;

test("set up review identities and a canonical movie", async () => {
  await resetWorkspace();
  group = groupId();
  owner = await createIdentity({ name: "Cameron", role: "member" });
  otherMember = await createIdentity({ name: "Dean", role: "admin" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  const { data, error } = await serviceDataClient()
    .from("movies")
    .insert({ tmdb_id: 348, title: "Alien", release_year: 1979 })
    .select("id,tmdb_id")
    .single();
  assert.equal(error, null);
  alien = data;
});

test("an approved owner can save a text-only private review", async () => {
  const { data, error } = await owner.client
    .from("personal_reviews")
    .insert({
      owner_id: owner.id,
      movie_id: alien.id,
      body: "Claustrophobic, patient and still vicious.",
      contains_spoilers: false,
    })
    .select("id,owner_id,movie_id,body,contains_spoilers")
    .single();

  assert.equal(error, null);
  reviewId = data.id;
  assert.deepEqual(data, {
    id: reviewId,
    owner_id: owner.id,
    movie_id: alien.id,
    body: "Claustrophobic, patient and still vicious.",
    contains_spoilers: false,
  });
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_films where owner_id = '${owner.id}'`).count, 0);
});

test("private drafts are visible only to their owner", async () => {
  const { data: ownRows, error: ownError } = await owner.client
    .from("personal_reviews")
    .select("id,body");
  assert.equal(ownError, null);
  assert.deepEqual(ownRows, [{ id: reviewId, body: "Claustrophobic, patient and still vicious." }]);

  for (const identity of [otherMember, outsider]) {
    const { data, error } = await identity.client.from("personal_reviews").select("id,body");
    assert.equal(error, null);
    assert.deepEqual(data, []);
  }
});

test("a text-only review can be deliberately published to approved members", async () => {
  const { data: published, error: publishError } = await owner.client
    .rpc("publish_personal_review", { p_review_id: reviewId });
  assert.equal(publishError, null);
  assert.equal(published, true);

  const { data, error } = await otherMember.client
    .from("published_reviews")
    .select("review_id,owner_id,movie_id,body,contains_spoilers,rating")
    .single();
  assert.equal(error, null);
  assert.deepEqual(data, {
    review_id: reviewId,
    owner_id: owner.id,
    movie_id: alien.id,
    body: "Claustrophobic, patient and still vicious.",
    contains_spoilers: false,
    rating: null,
  });

  const { data: outsiderRows, error: outsiderError } = await outsider.client
    .from("published_reviews")
    .select("review_id,body");
  assert.equal(outsiderError, null);
  assert.deepEqual(outsiderRows, []);
});

test("later private edits do not alter the published snapshot until republished", async () => {
  const { error: editError } = await owner.client
    .from("personal_reviews")
    .update({ body: "The private second draft changes the ending notes.", contains_spoilers: true })
    .eq("id", reviewId);
  assert.equal(editError, null);

  const { data: unchanged, error: readError } = await otherMember.client
    .from("published_reviews")
    .select("body,contains_spoilers")
    .single();
  assert.equal(readError, null);
  assert.deepEqual(unchanged, {
    body: "Claustrophobic, patient and still vicious.",
    contains_spoilers: false,
  });

  const { data: republished, error: republishError } = await owner.client
    .rpc("publish_personal_review", { p_review_id: reviewId });
  assert.equal(republishError, null);
  assert.equal(republished, true);

  const { data: refreshed, error: refreshedError } = await otherMember.client
    .from("published_reviews")
    .select("body,contains_spoilers,rating")
    .single();
  assert.equal(refreshedError, null);
  assert.deepEqual(refreshed, {
    body: "The private second draft changes the ending notes.",
    contains_spoilers: true,
    rating: null,
  });
});

test("a rating is optional metadata and clearing it leaves the review published", async () => {
  const { error: filmError } = await owner.client
    .from("personal_films")
    .insert({ owner_id: owner.id, movie_id: alien.id, rating: 4 });
  assert.equal(filmError, null);

  const { error: publishError } = await owner.client
    .rpc("publish_personal_review", { p_review_id: reviewId });
  assert.equal(publishError, null);
  assert.equal(sqlRow(`select rating from public.published_reviews where review_id = '${reviewId}'`).rating, 4);

  const { error: changeError } = await owner.client
    .from("personal_films")
    .update({ rating: 5 })
    .eq("owner_id", owner.id)
    .eq("movie_id", alien.id);
  assert.equal(changeError, null);
  assert.equal(sqlRow(`select rating from public.published_reviews where review_id = '${reviewId}'`).rating, 4);

  const { error: clearError } = await owner.client
    .from("personal_films")
    .update({ rating: null })
    .eq("owner_id", owner.id)
    .eq("movie_id", alien.id);
  assert.equal(clearError, null);
  assert.deepEqual(sqlRow(`select body, rating from public.published_reviews where review_id = '${reviewId}'`), {
    body: "The private second draft changes the ending notes.",
    rating: null,
  });
});

test("other members cannot forge drafts, publications or publication actions", async () => {
  const { error: forgedDraftError } = await otherMember.client
    .from("personal_reviews")
    .insert({ owner_id: owner.id, movie_id: alien.id, body: "Forged review" });
  assert.match(forgedDraftError?.message || "", /row-level security/i);

  const { error: directPublishError } = await otherMember.client
    .from("published_reviews")
    .update({ body: "Rewritten by someone else" })
    .eq("review_id", reviewId);
  assert.match(directPublishError?.message || "", /permission denied/i);

  const { data: otherPublish, error: otherPublishError } = await otherMember.client
    .rpc("publish_personal_review", { p_review_id: reviewId });
  assert.equal(otherPublishError, null);
  assert.equal(otherPublish, false);

  const { error: outsiderPublishError } = await outsider.client
    .rpc("publish_personal_review", { p_review_id: reviewId });
  assert.match(outsiderPublishError?.message || "", /membership is required/i);
});

test("the author can unpublish without deleting the private draft", async () => {
  const { data: unpublished, error: unpublishError } = await owner.client
    .rpc("unpublish_personal_review", { p_review_id: reviewId });
  assert.equal(unpublishError, null);
  assert.equal(unpublished, true);
  assert.equal(sqlRow("select count(*)::integer as count from public.published_reviews").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_reviews").count, 1);

  const { error: republishError } = await owner.client
    .rpc("publish_personal_review", { p_review_id: reviewId });
  assert.equal(republishError, null);
});

test("table and function privileges expose only the intended browser surface", () => {
  assert.deepEqual(sqlRow(`
    select
      has_table_privilege('anon', 'public.personal_reviews', 'SELECT') as anon_private_select,
      has_table_privilege('authenticated', 'public.personal_reviews', 'SELECT') as member_private_select,
      has_table_privilege('authenticated', 'public.personal_reviews', 'DELETE') as member_private_delete,
      has_table_privilege('service_role', 'public.personal_reviews', 'SELECT') as service_private_select,
      has_column_privilege('authenticated', 'public.personal_reviews', 'owner_id', 'UPDATE') as owner_update,
      has_column_privilege('authenticated', 'public.personal_reviews', 'body', 'UPDATE') as body_update,
      has_table_privilege('authenticated', 'public.published_reviews', 'SELECT') as member_published_select,
      has_table_privilege('authenticated', 'public.published_reviews', 'INSERT') as member_published_insert,
      has_table_privilege('authenticated', 'public.published_reviews', 'UPDATE') as member_published_update,
      has_table_privilege('authenticated', 'public.published_reviews', 'DELETE') as member_published_delete,
      has_table_privilege('service_role', 'public.published_reviews', 'SELECT') as service_published_select,
      has_function_privilege('anon', 'public.publish_personal_review(uuid)', 'EXECUTE') as anon_publish,
      has_function_privilege('authenticated', 'public.publish_personal_review(uuid)', 'EXECUTE') as member_publish,
      has_function_privilege('authenticated', 'public.unpublish_personal_review(uuid)', 'EXECUTE') as member_unpublish
  `), {
    anon_private_select: false,
    member_private_select: true,
    member_private_delete: true,
    service_private_select: false,
    owner_update: false,
    body_update: true,
    member_published_select: true,
    member_published_insert: false,
    member_published_update: false,
    member_published_delete: false,
    service_published_select: false,
    anon_publish: false,
    member_publish: true,
    member_unpublish: true,
  });
});

test("membership removal hides retained drafts and publications, while account deletion removes them", async () => {
  runSql(`delete from public.group_memberships where group_id = '${group}' and user_id = '${owner.id}';`);

  const { data: hiddenDrafts, error: draftError } = await owner.client.from("personal_reviews").select("id");
  assert.equal(draftError, null);
  assert.deepEqual(hiddenDrafts, []);

  const { data: hiddenPublication, error: publicationError } = await otherMember.client.from("published_reviews").select("review_id");
  assert.equal(publicationError, null);
  assert.deepEqual(hiddenPublication, []);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_reviews").count, 1);
  assert.equal(sqlRow("select count(*)::integer as count from public.published_reviews").count, 1);

  runSql(`delete from auth.users where id = '${owner.id}';`);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_reviews").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.published_reviews").count, 0);
});
