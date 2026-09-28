import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  expectRpcError,
  groupId,
  resetWorkspace,
  serviceDataClient,
  sqlRow,
} from "./helpers/local-supabase.js";

test("bulk approval previews only clear archive identities and keeps history private until Sync", async () => {
  resetWorkspace();
  const group = groupId();
  const cambo = await createIdentity({ name: "Cambo", role: "admin" });
  const dean = await createIdentity({ name: "deanshelton17", role: "member" });
  const outsider = await createIdentity({ name: "Outsider", role: null });
  const service = serviceDataClient();
  const { data: volume, error: volumeError } = await service.from("journal_volumes").select("id").limit(1).single();
  assert.equal(volumeError, null);

  let serial = 0;
  async function addEntry({ title, year = 2000, viewers = ["Dean"], parser = "PARSED", status = "FINISHED" }) {
    serial += 1;
    const messageId = `81000000000000${String(serial).padStart(4, "0")}`;
    const { data, error } = await service.from("journal_archive_entries").insert({
      group_id: group,
      volume_id: volume.id,
      discord_message_id: messageId,
      discord_jump_url: `https://discord.com/channels/272427070779293697/713935563912118293/${messageId}`,
      entry_label: String(2400 + serial),
      entry_sort_number: 2400 + serial,
      title,
      release_year: year,
      watched_at: "2026-09-20",
      status,
      viewer_names: viewers,
      author_display_name: "Cambo",
      message_created_at: "2026-09-20T20:00:00Z",
      raw_content: `- ${title}`,
      parser_status: parser,
    }).select("id").single();
    assert.equal(error, null);
    return data.id;
  }

  async function addCandidate(entryId, { tmdbId, title, year = 2000, score = 1, titleScore = 1, rank = 1 }) {
    const { error } = await service.from("archive_history_match_candidates").insert({
      archive_entry_id: entryId,
      tmdb_id: tmdbId,
      title,
      release_year: year,
      score,
      title_score: titleScore,
      year_delta: Math.abs(year - 2000),
      match_band: "STRONG",
      candidate_rank: rank,
      search_query: title,
    });
    assert.equal(error, null);
  }

  const exact = await addEntry({ title: "Wall E!", viewers: ["Cameron", "Dean"] });
  await addCandidate(exact, { tmdbId: 10101, title: "WALL-E" });
  const dnf = await addEntry({ title: "Ghost Story", viewers: ["Dean"], status: "DNF" });
  await addCandidate(dnf, { tmdbId: 10102, title: "Ghost Story" });
  const nearYear = await addEntry({ title: "Near Year", year: 2001 });
  await addCandidate(nearYear, { tmdbId: 10103, title: "Near Year", year: 2000, score: 0.98 });
  const closeAlternative = await addEntry({ title: "Two Twins" });
  await addCandidate(closeAlternative, { tmdbId: 10104, title: "Two Twins" });
  await addCandidate(closeAlternative, { tmdbId: 10105, title: "Two Twins II", score: 0.9, titleScore: 0.9, rank: 2 });
  const unknownViewer = await addEntry({ title: "Unknown Viewer", viewers: ["Andrew"] });
  await addCandidate(unknownViewer, { tmdbId: 10106, title: "Unknown Viewer" });
  const parserReview = await addEntry({ title: "Parser Review", parser: "REVIEW" });
  await addCandidate(parserReview, { tmdbId: 10107, title: "Parser Review" });
  const noYear = await addEntry({ title: "No Year", year: null });
  await addCandidate(noYear, { tmdbId: 10108, title: "No Year" });

  const { data: manualMovie, error: movieError } = await service.from("movies")
    .insert({ tmdb_id: 10109, title: "Approved Identity", release_year: 2000 })
    .select("id").single();
  assert.equal(movieError, null);
  const reviewed = await addEntry({ title: "Alias Title" });
  const reused = await addEntry({ title: "Alias Title", viewers: ["Cameron"] });
  const { error: reviewError } = await cambo.client.rpc("save_archive_history_reconciliation_review", {
    p_group_id: group,
    p_archive_entry_id: reviewed,
    p_movie_id: manualMovie.id,
    p_viewer_keys: ["dean"],
    p_decision: "APPROVED",
  });
  assert.equal(reviewError, null);

  await expectRpcError(dean.client.rpc("preview_archive_history_bulk_approval", { p_group_id: group }), /group administrator/i);
  await expectRpcError(outsider.client.rpc("preview_archive_history_bulk_approval", { p_group_id: group }), /group administrator/i);
  await expectRpcError(dean.client.rpc("apply_archive_history_bulk_approval", { p_group_id: group, p_expected_token: "invalid" }), /group administrator/i);
  const { data: dryRun, error: dryRunError } = await cambo.client.rpc("preview_archive_history_bulk_approval", { p_group_id: group });
  assert.equal(dryRunError, null);
  assert.equal(dryRun.eligibleCount, 3);
  assert.equal(dryRun.tmdbCount, 2);
  assert.equal(dryRun.reusedCount, 1);
  assert.deepEqual(new Set(dryRun.proposals.map((row) => row.archive_entry_id)), new Set([exact, dnf, reused]));
  assert.deepEqual(dryRun.proposals.find((row) => row.archive_entry_id === exact).viewer_keys, ["cambo", "dean"]);
  assert.equal(sqlRow("select count(*)::integer as count from public.archive_history_reconciliation_reviews").count, 1);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 0);

  const late = await addEntry({ title: "Late Match" });
  await addCandidate(late, { tmdbId: 10110, title: "Late Match" });
  await expectRpcError(cambo.client.rpc("apply_archive_history_bulk_approval", {
    p_group_id: group,
    p_expected_token: dryRun.token,
  }), /preview has changed/i);
  assert.equal(sqlRow("select count(*)::integer as count from public.archive_history_reconciliation_reviews").count, 1);

  const { data: current, error: currentError } = await cambo.client.rpc("preview_archive_history_bulk_approval", { p_group_id: group });
  assert.equal(currentError, null);
  assert.equal(current.eligibleCount, 4);
  const { data: approved, error: approvalError } = await cambo.client.rpc("apply_archive_history_bulk_approval", {
    p_group_id: group,
    p_expected_token: current.token,
  });
  assert.equal(approvalError, null);
  assert.deepEqual(approved, { approvedCount: 4, eventsCreated: 0 });
  assert.equal(sqlRow("select count(*)::integer as count from public.archive_history_reconciliation_reviews").count, 5);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.movies where tmdb_id in (10101,10102,10110)").count, 3);
  assert.equal(sqlRow(`select count(*)::integer as count from public.archive_history_reconciliation_reviews where archive_entry_id in ('${nearYear}','${closeAlternative}','${unknownViewer}','${parserReview}','${noYear}')`).count, 0);

  const { data: after, error: afterError } = await cambo.client.rpc("preview_archive_history_bulk_approval", { p_group_id: group });
  assert.equal(afterError, null);
  assert.equal(after.eligibleCount, 0);

  const { data: synced, error: syncError } = await cambo.client.rpc("apply_archive_history_reconciliation", {
    p_group_id: group,
    p_archive_entry_ids: [exact, dnf, reused, late],
  });
  assert.equal(syncError, null);
  assert.equal(synced.events_created, 5);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 5);
  const { data: camboEvents, error: camboEventsError } = await cambo.client.from("personal_viewing_events").select("source_archive_entry_id, outcome");
  const { data: deanEvents, error: deanEventsError } = await dean.client.from("personal_viewing_events").select("source_archive_entry_id, outcome");
  assert.equal(camboEventsError, null);
  assert.equal(deanEventsError, null);
  assert.deepEqual(new Set(camboEvents.map((row) => row.source_archive_entry_id)), new Set([exact, reused]));
  assert.deepEqual(new Set(deanEvents.map((row) => row.source_archive_entry_id)), new Set([exact, dnf, late]));
  assert.equal(deanEvents.find((row) => row.source_archive_entry_id === dnf).outcome, "DID_NOT_FINISH");
  assert.equal(sqlRow("select count(*)::integer as count from public.queue_items").count, 0);

  await createIdentity({ name: "Cambo", role: "member" });
  const duplicateAccount = await addEntry({ title: "Duplicate Name Film", viewers: ["Cameron"] });
  await addCandidate(duplicateAccount, { tmdbId: 10111, title: "Duplicate Name Film" });
  const { data: duplicatePreview, error: duplicateError } = await cambo.client.rpc("preview_archive_history_bulk_approval", { p_group_id: group });
  assert.equal(duplicateError, null);
  assert.equal(duplicatePreview.eligibleCount, 0);
});

test("ranked bulk review approves only selected strong matches and never guesses viewers", async () => {
  resetWorkspace();
  const group = groupId();
  const cambo = await createIdentity({ name: "Cambo", role: "admin" });
  const dean = await createIdentity({ name: "deanshelton17", role: "member" });
  const service = serviceDataClient();
  const { data: volume, error: volumeError } = await service.from("journal_volumes").select("id").limit(1).single();
  assert.equal(volumeError, null);

  let serial = 0;
  async function addEntry(title, viewers = ["Cameron", "Dean"]) {
    serial += 1;
    const messageId = `82000000000000${String(serial).padStart(4, "0")}`;
    const { data, error } = await service.from("journal_archive_entries").insert({
      group_id: group,
      volume_id: volume.id,
      discord_message_id: messageId,
      discord_jump_url: `https://discord.com/channels/272427070779293697/713935563912118293/${messageId}`,
      entry_label: String(2500 + serial),
      entry_sort_number: 2500 + serial,
      title,
      release_year: 2001,
      watched_at: "2026-09-20",
      status: "FINISHED",
      viewer_names: viewers,
      author_display_name: "Cambo",
      message_created_at: "2026-09-20T20:00:00Z",
      raw_content: `- ${title}`,
      parser_status: "PARSED",
    }).select("id").single();
    assert.equal(error, null);
    return data.id;
  }

  async function addCandidate(entryId, tmdbId, title, { year = 2002, score = 0.94, titleScore = 0.96, rank = 1 } = {}) {
    const { error } = await service.from("archive_history_match_candidates").insert({
      archive_entry_id: entryId,
      tmdb_id: tmdbId,
      title,
      release_year: year,
      score,
      title_score: titleScore,
      year_delta: Math.abs(year - 2001),
      match_band: "STRONG",
      candidate_rank: rank,
      search_query: title,
    });
    assert.equal(error, null);
  }

  const strong = await addEntry("Spider Man Homecoming");
  await addCandidate(strong, 10201, "Spider-Man: Homecoming");
  const exact = await addEntry("Exact Film", ["Dean"]);
  await addCandidate(exact, 10202, "Exact Film", { year: 2001, score: 1, titleScore: 1 });
  const ambiguous = await addEntry("Ambiguous Film");
  await addCandidate(ambiguous, 10203, "Ambiguous Film");
  await addCandidate(ambiguous, 10204, "Ambiguous Film Two", { score: 0.84, titleScore: 0.9, rank: 2 });
  const lowScore = await addEntry("Low Score Film");
  await addCandidate(lowScore, 10205, "Low Score Film", { score: 0.89 });
  const unknownViewer = await addEntry("Unknown Viewer Film", ["Andrew"]);
  await addCandidate(unknownViewer, 10206, "Unknown Viewer Film");

  await expectRpcError(dean.client.rpc("preview_archive_history_bulk_review", { p_group_id: group }), /group administrator/i);
  await expectRpcError(dean.client.rpc("apply_archive_history_bulk_review", {
    p_group_id: group, p_expected_token: "invalid", p_archive_entry_ids: [strong],
  }), /group administrator/i);

  const { data: preview, error: previewError } = await cambo.client.rpc("preview_archive_history_bulk_review", { p_group_id: group });
  assert.equal(previewError, null);
  assert.equal(preview.eligibleCount, 2);
  assert.equal(preview.exactCount, 1);
  assert.equal(preview.strongCount, 1);
  assert.deepEqual(preview.proposals.map((row) => row.archive_entry_id), [exact, strong]);
  assert.equal(preview.proposals[1].source, "TMDB_STRONG");
  assert.equal(Number(preview.proposals[1].match_score), 0.94);
  assert.equal(preview.proposals[1].year_delta, 1);
  assert.deepEqual(preview.proposals[1].viewer_keys, ["cambo", "dean"]);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 0);

  await expectRpcError(cambo.client.rpc("apply_archive_history_bulk_review", {
    p_group_id: group, p_expected_token: preview.token, p_archive_entry_ids: [strong, strong],
  }), /unique Journal matches/i);
  await expectRpcError(cambo.client.rpc("apply_archive_history_bulk_review", {
    p_group_id: group, p_expected_token: preview.token, p_archive_entry_ids: [strong, unknownViewer],
  }), /ineligible Journal entry/i);

  const late = await addEntry("Late Film");
  await addCandidate(late, 10207, "Late Film");
  await expectRpcError(cambo.client.rpc("apply_archive_history_bulk_review", {
    p_group_id: group, p_expected_token: preview.token, p_archive_entry_ids: [strong],
  }), /preview has changed/i);
  assert.equal(sqlRow("select count(*)::integer as count from public.archive_history_reconciliation_reviews").count, 0);

  const { data: current, error: currentError } = await cambo.client.rpc("preview_archive_history_bulk_review", { p_group_id: group });
  assert.equal(currentError, null);
  assert.equal(current.eligibleCount, 3);
  const { data: approved, error: approvedError } = await cambo.client.rpc("apply_archive_history_bulk_review", {
    p_group_id: group, p_expected_token: current.token, p_archive_entry_ids: [strong],
  });
  assert.equal(approvedError, null);
  assert.deepEqual(approved, { approvedCount: 1, eventsCreated: 0 });
  assert.equal(sqlRow("select count(*)::integer as count from public.archive_history_reconciliation_reviews").count, 1);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 0);
  assert.equal(sqlRow(`select count(*)::integer as count from public.archive_history_reconciliation_reviews where archive_entry_id in ('${exact}','${ambiguous}','${lowScore}','${unknownViewer}','${late}')`).count, 0);

  const { data: synced, error: syncedError } = await cambo.client.rpc("apply_archive_history_reconciliation", {
    p_group_id: group, p_archive_entry_ids: [strong],
  });
  assert.equal(syncedError, null);
  assert.equal(synced.events_created, 2);
  const { data: camboEvents, error: camboError } = await cambo.client.from("personal_viewing_events").select("source_archive_entry_id");
  const { data: deanEvents, error: deanError } = await dean.client.from("personal_viewing_events").select("source_archive_entry_id");
  assert.equal(camboError, null);
  assert.equal(deanError, null);
  assert.deepEqual(camboEvents.map((event) => event.source_archive_entry_id), [strong]);
  assert.deepEqual(deanEvents.map((event) => event.source_archive_entry_id), [strong]);
  assert.equal(sqlRow("select count(*)::integer as count from public.queue_items").count, 0);
});
