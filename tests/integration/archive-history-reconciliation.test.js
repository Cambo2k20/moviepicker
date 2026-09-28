// Admin-only reconciliation of imported Discord Journal rows into private history.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  expectRpcError,
  groupId,
  resetWorkspace,
  runSql,
  serviceDataClient,
  sqlRow,
  sqlRows,
} from "./helpers/local-supabase.js";

let group;
let cambo;
let dean;
let outsider;
let alien;
let matrix;
let readyEntryId;
let dnfEntryId;
let queueItemId;
let manualReviewEntryId;
let skippedReviewEntryId;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function archiveEntry({ messageId, label, title, year, status = "FINISHED", viewers = [], parserStatus = "PARSED" }) {
  const volumeId = sqlRow(`
    select id
    from public.journal_volumes
    where discord_channel_id = '713935563912118293'
  `).id;
  const viewerArray = viewers.length ? `array[${viewers.map(sqlString).join(", ")}]` : "'{}'::text[]";
  runSql(`
    insert into public.journal_archive_entries (
      group_id, volume_id, discord_message_id, discord_jump_url,
      entry_label, entry_sort_number, title, release_year, watched_at,
      status, viewer_names, author_display_name, message_created_at,
      raw_content, parser_status
    ) values (
      '${group}', '${volumeId}', '${messageId}',
      'https://discord.com/channels/272427070779293697/713935563912118293/${messageId}',
      ${sqlString(label)}, ${Number(label)}, ${sqlString(title)}, ${year ?? "null"},
      '2026-09-20', '${status}', ${viewerArray},
      'Cambo', '2026-09-20T20:00:00Z', ${sqlString(`- Entry #${label}`)}, '${parserStatus}'
    );
  `);
  return sqlRow(`select id from public.journal_archive_entries where discord_message_id = '${messageId}'`).id;
}

test("an administrator can preview and idempotently reconcile exact archive matches", async () => {
  resetWorkspace();
  group = groupId();
  cambo = await createIdentity({ name: "Cambo", role: "admin" });
  dean = await createIdentity({ name: "deanshelton17", role: "member" });
  outsider = await createIdentity({ name: "Outsider", role: null });

  const { data: movies, error: movieError } = await serviceDataClient()
    .from("movies")
    .insert([
      { tmdb_id: 348, title: "Alien", release_year: 1979 },
      { tmdb_id: 603, title: "The Matrix", release_year: 1999 },
      { tmdb_id: 1001, title: "Twin", release_year: 2000 },
      { tmdb_id: 1002, title: "Twin", release_year: 2000 },
    ])
    .select("id,tmdb_id");
  assert.equal(movieError, null);
  alien = movies.find((movie) => Number(movie.tmdb_id) === 348);
  matrix = movies.find((movie) => Number(movie.tmdb_id) === 603);

  readyEntryId = archiveEntry({
    messageId: "700000000000000001",
    label: "1401",
    title: "Alien",
    year: 1979,
    viewers: ["Cameron", "Dean"],
  });
  dnfEntryId = archiveEntry({
    messageId: "700000000000000002",
    label: "1400",
    title: "The Matrix",
    year: 1999,
    status: "DNF",
    viewers: ["Cambo (Zzz)", "Dean"],
  });
  archiveEntry({ messageId: "700000000000000003", label: "1399", title: "No Such Film", year: 1999, viewers: ["Cambo"] });
  archiveEntry({ messageId: "700000000000000004", label: "1398", title: "Twin", year: 2000, viewers: ["Dean"] });
  archiveEntry({ messageId: "700000000000000005", label: "1397", title: "Alien", year: 1979, viewers: [], parserStatus: "REVIEW" });
  archiveEntry({ messageId: "700000000000000006", label: "1396", title: "Alien", year: 1979, viewers: ["Andrew"] });

  const { data: queueItem, error: queueError } = await cambo.client
    .from("queue_items")
    .insert({ group_id: group, suggested_by: cambo.id, title: "Alien", release_year: 1979 })
    .select("id,watched")
    .single();
  assert.equal(queueError, null);
  queueItemId = queueItem.id;

  const { error: memberPreviewError } = await dean.client.rpc("preview_archive_history_reconciliation", { p_group_id: group });
  assert.match(memberPreviewError?.message || "", /group administrator/i);
  await expectRpcError(
    outsider.client.rpc("preview_archive_history_reconciliation", { p_group_id: group }),
    /group administrator/i,
  );

  const { data: preview, error: previewError } = await cambo.client.rpc("preview_archive_history_reconciliation", { p_group_id: group });
  assert.equal(previewError, null);
  const statusByTitle = new Map(preview.map((row) => [`${row.title}:${row.release_year}:${row.entry_label}`, row.match_status]));
  assert.equal(statusByTitle.get("Alien:1979:1401"), "READY");
  assert.equal(statusByTitle.get("The Matrix:1999:1400"), "READY");
  assert.equal(statusByTitle.get("No Such Film:1999:1399"), "NO_CANONICAL_MOVIE");
  assert.equal(statusByTitle.get("Twin:2000:1398"), "AMBIGUOUS_MOVIE");
  assert.equal(statusByTitle.get("Alien:1979:1397"), "NO_CONFIRMED_VIEWER");
  assert.equal(statusByTitle.get("Alien:1979:1396"), "NO_CONFIRMED_VIEWER");

  const { data: firstApply, error: firstApplyError } = await cambo.client.rpc("apply_archive_history_reconciliation", {
    p_group_id: group,
    p_archive_entry_ids: null,
  });
  assert.equal(firstApplyError, null);
  assert.deepEqual(firstApply, {
    entries_applied: 2,
    events_created: 4,
    events_already_present: 0,
    events_total: 4,
  });

  assert.deepEqual(sqlRows(`
    select owner_id, movie_id, outcome, watched_on, source_archive_entry_id
    from public.personal_viewing_events
    where source_archive_entry_id in ('${readyEntryId}', '${dnfEntryId}')
    order by owner_id, source_archive_entry_id
  `), [
    { owner_id: cambo.id, movie_id: alien.id, outcome: "FINISHED", watched_on: "2026-09-20", source_archive_entry_id: readyEntryId },
    { owner_id: cambo.id, movie_id: matrix.id, outcome: "DID_NOT_FINISH", watched_on: "2026-09-20", source_archive_entry_id: dnfEntryId },
    { owner_id: dean.id, movie_id: alien.id, outcome: "FINISHED", watched_on: "2026-09-20", source_archive_entry_id: readyEntryId },
    { owner_id: dean.id, movie_id: matrix.id, outcome: "DID_NOT_FINISH", watched_on: "2026-09-20", source_archive_entry_id: dnfEntryId },
  ].sort((left, right) => `${left.owner_id}:${left.source_archive_entry_id}`.localeCompare(`${right.owner_id}:${right.source_archive_entry_id}`)));

  assert.deepEqual(sqlRows(`
    select owner_id, movie_id, state
    from public.personal_films
    where movie_id in ('${alien.id}', '${matrix.id}')
    order by owner_id, movie_id
  `), [
    { owner_id: cambo.id, movie_id: alien.id, state: "WATCHED" },
    { owner_id: cambo.id, movie_id: matrix.id, state: "DID_NOT_FINISH" },
    { owner_id: dean.id, movie_id: alien.id, state: "WATCHED" },
    { owner_id: dean.id, movie_id: matrix.id, state: "DID_NOT_FINISH" },
  ].sort((left, right) => `${left.owner_id}:${left.movie_id}`.localeCompare(`${right.owner_id}:${right.movie_id}`)));

  assert.deepEqual(sqlRow(`select watched from public.queue_items where id = '${queueItemId}'`), { watched: false });

  const { data: secondApply, error: secondApplyError } = await cambo.client.rpc("apply_archive_history_reconciliation", {
    p_group_id: group,
    p_archive_entry_ids: null,
  });
  assert.equal(secondApplyError, null);
  assert.deepEqual(secondApply, {
    entries_applied: 0,
    events_created: 0,
    events_already_present: 0,
    events_total: 0,
  });

  const { data: finalPreview, error: finalPreviewError } = await cambo.client.rpc("preview_archive_history_reconciliation", { p_group_id: group });
  assert.equal(finalPreviewError, null);
  assert.equal(finalPreview.find((row) => row.archive_entry_id === readyEntryId).match_status, "ALREADY_SYNCED");
  assert.equal(finalPreview.find((row) => row.archive_entry_id === dnfEntryId).match_status, "ALREADY_SYNCED");

  manualReviewEntryId = archiveEntry({ messageId: "700000000000000007", label: "1395", title: "Unknown Discord title", year: 2001, viewers: ["Andrew"] });
  skippedReviewEntryId = archiveEntry({ messageId: "700000000000000008", label: "1394", title: "Another unknown title", year: 2002, viewers: ["Dean"] });

  const { error: memberReviewError } = await dean.client.rpc("save_archive_history_reconciliation_review", {
    p_group_id: group,
    p_archive_entry_id: manualReviewEntryId,
    p_movie_id: matrix.id,
    p_viewer_keys: ["dean"],
    p_decision: "APPROVED",
  });
  assert.match(memberReviewError?.message || "", /group administrator/i);

  const { data: savedReview, error: saveReviewError } = await cambo.client.rpc("save_archive_history_reconciliation_review", {
    p_group_id: group,
    p_archive_entry_id: manualReviewEntryId,
    p_movie_id: matrix.id,
    p_viewer_keys: ["dean"],
    p_decision: "APPROVED",
  });
  assert.equal(saveReviewError, null);
  assert.equal(savedReview.decision, "APPROVED");

  const { error: skipReviewError } = await cambo.client.rpc("save_archive_history_reconciliation_review", {
    p_group_id: group,
    p_archive_entry_id: skippedReviewEntryId,
    p_movie_id: null,
    p_viewer_keys: [],
    p_decision: "SKIPPED",
  });
  assert.equal(skipReviewError, null);

  const { data: reviewedPreview, error: reviewedPreviewError } = await cambo.client.rpc("preview_archive_history_reconciliation", { p_group_id: group });
  assert.equal(reviewedPreviewError, null);
  assert.equal(reviewedPreview.find((row) => row.archive_entry_id === manualReviewEntryId).match_status, "READY");
  assert.deepEqual(reviewedPreview.find((row) => row.archive_entry_id === manualReviewEntryId).reviewed_viewer_keys, ["dean"]);
  assert.equal(reviewedPreview.find((row) => row.archive_entry_id === skippedReviewEntryId).match_status, "SKIPPED");

  const { data: manualApply, error: manualApplyError } = await cambo.client.rpc("apply_archive_history_reconciliation", {
    p_group_id: group,
    p_archive_entry_ids: [manualReviewEntryId],
  });
  assert.equal(manualApplyError, null);
  assert.deepEqual(manualApply, {
    entries_applied: 1,
    events_created: 1,
    events_already_present: 0,
    events_total: 1,
  });
  assert.deepEqual(sqlRow(`
    select owner_id, movie_id, outcome, source_archive_entry_id
    from public.personal_viewing_events
    where source_archive_entry_id = '${manualReviewEntryId}'
  `), { owner_id: dean.id, movie_id: matrix.id, outcome: "FINISHED", source_archive_entry_id: manualReviewEntryId });
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_viewing_events where source_archive_entry_id = '${skippedReviewEntryId}'`).count, 0);
});
