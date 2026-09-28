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

test("assisted triage saves selected decisions without creating private history", async () => {
  resetWorkspace();
  const group = groupId();
  const cambo = await createIdentity({ name: "Cambo", role: "admin" });
  const dean = await createIdentity({ name: "deanshelton17", role: "member" });
  const outsider = await createIdentity({ name: "Outsider", role: null });
  const service = serviceDataClient();
  const { data: volume, error: volumeError } = await service.from("journal_volumes").select("id").limit(1).single();
  assert.equal(volumeError, null);

  let serial = 0;
  async function addEntry(title, { viewers = ["Cameron", "Dean"], parser = "PARSED" } = {}) {
    serial += 1;
    const messageId = `83000000000000${String(serial).padStart(4, "0")}`;
    const { data, error } = await service.from("journal_archive_entries").insert({
      group_id: group,
      volume_id: volume.id,
      discord_message_id: messageId,
      discord_jump_url: `https://discord.com/channels/272427070779293697/713935563912118293/${messageId}`,
      entry_label: String(2600 + serial),
      entry_sort_number: 2600 + serial,
      title,
      release_year: 2000,
      watched_at: "2026-09-20",
      status: "FINISHED",
      viewer_names: viewers,
      author_display_name: "Cambo",
      message_created_at: "2026-09-20T20:00:00Z",
      raw_content: `- ${title}`,
      parser_status: parser,
    }).select("id").single();
    assert.equal(error, null);
    return data.id;
  }

  async function addCandidate(entryId, tmdbId, { title = "Heroic Journey", score = 0.87, titleScore = 0.9, rank = 1 } = {}) {
    const { error } = await service.from("archive_history_match_candidates").insert({
      archive_entry_id: entryId,
      tmdb_id: tmdbId,
      title,
      release_year: 2001,
      poster_path: "/hero.jpg",
      overview: "A journey through the stars.",
      score,
      title_score: titleScore,
      year_delta: 1,
      match_band: "REVIEW",
      candidate_rank: rank,
      search_query: title,
    });
    assert.equal(error, null);
  }

  const suggested = await addEntry("Heroic Journey");
  await addCandidate(suggested, 10301);
  const archiveOnly = await addEntry("Xbox Showcase");
  const ambiguous = await addEntry("Twin");
  await addCandidate(ambiguous, 10302, { title: "Twin", score: 0.94 });
  await addCandidate(ambiguous, 10303, { title: "Twin", score: 0.9, rank: 2 });
  const unconfirmed = await addEntry("Other Film", { viewers: ["Andrew"] });
  await addCandidate(unconfirmed, 10304, { title: "Other Film" });
  const parserReview = await addEntry("Parser Review", { parser: "REVIEW" });
  await addCandidate(parserReview, 10305, { title: "Parser Review" });

  await expectRpcError(dean.client.rpc("preview_archive_history_triage", { p_group_id: group }), /group administrator/i);
  await expectRpcError(outsider.client.rpc("preview_archive_history_triage", { p_group_id: group }), /group administrator/i);
  await expectRpcError(dean.client.rpc("apply_archive_history_triage", { p_group_id: group, p_expected_token: "invalid", p_approved_ids: [suggested] }), /group administrator/i);

  const { data: preview, error: previewError } = await cambo.client.rpc("preview_archive_history_triage", { p_group_id: group });
  assert.equal(previewError, null);
  assert.equal(preview.suggestedCount, 1);
  assert.equal(preview.noCandidateCount, 1);
  assert.equal(preview.manualCount, 2);
  assert.equal(preview.proposals.length, 4);
  assert.equal(preview.proposals.find((row) => row.archive_entry_id === suggested).movie_title, "Heroic Journey");
  assert.deepEqual(preview.proposals.find((row) => row.archive_entry_id === suggested).viewer_keys, ["cambo", "dean"]);
  assert.equal(preview.proposals.find((row) => row.archive_entry_id === ambiguous).category, "MANUAL");
  assert.equal(preview.proposals.find((row) => row.archive_entry_id === parserReview).can_approve, false);
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 0);

  await expectRpcError(cambo.client.rpc("apply_archive_history_triage", {
    p_group_id: group, p_expected_token: preview.token, p_approved_ids: [ambiguous],
  }), /ineligible Journal entry/i);
  await expectRpcError(cambo.client.rpc("apply_archive_history_triage", {
    p_group_id: group, p_expected_token: preview.token, p_skipped_ids: [unconfirmed],
  }), /ineligible Journal entry/i);
  await expectRpcError(cambo.client.rpc("apply_archive_history_triage", {
    p_group_id: group, p_expected_token: preview.token, p_approved_ids: [suggested], p_skipped_ids: [suggested],
  }), /unique Journal entries/i);

  const late = await addEntry("Late Entry");
  await expectRpcError(cambo.client.rpc("apply_archive_history_triage", {
    p_group_id: group, p_expected_token: preview.token, p_approved_ids: [suggested],
  }), /preview has changed/i);
  assert.equal(sqlRow("select count(*)::integer as count from public.archive_history_reconciliation_reviews").count, 0);

  const { data: current, error: currentError } = await cambo.client.rpc("preview_archive_history_triage", { p_group_id: group });
  assert.equal(currentError, null);
  assert.equal(current.noCandidateCount, 2);
  const { data: applied, error: applyError } = await cambo.client.rpc("apply_archive_history_triage", {
    p_group_id: group,
    p_expected_token: current.token,
    p_approved_ids: [suggested],
    p_skipped_ids: [archiveOnly],
  });
  assert.equal(applyError, null);
  assert.deepEqual(applied, { approvedCount: 1, skippedCount: 1, eventsCreated: 0 });
  assert.equal(sqlRow("select count(*)::integer as count from public.personal_viewing_events").count, 0);
  assert.equal(sqlRow("select count(*)::integer as count from public.journal_archive_entries").count, 6);
  assert.equal(sqlRow(`select count(*)::integer as count from public.archive_history_reconciliation_reviews where archive_entry_id = '${archiveOnly}' and decision = 'SKIPPED'`).count, 1);

  const { data: synced, error: syncError } = await cambo.client.rpc("apply_archive_history_reconciliation", {
    p_group_id: group, p_archive_entry_ids: [suggested],
  });
  assert.equal(syncError, null);
  assert.equal(synced.events_created, 2);
  const { data: camboEvents, error: camboError } = await cambo.client.from("personal_viewing_events").select("source_archive_entry_id");
  const { data: deanEvents, error: deanError } = await dean.client.from("personal_viewing_events").select("source_archive_entry_id");
  assert.equal(camboError, null);
  assert.equal(deanError, null);
  assert.deepEqual(camboEvents.map((row) => row.source_archive_entry_id), [suggested]);
  assert.deepEqual(deanEvents.map((row) => row.source_archive_entry_id), [suggested]);
  assert.equal(sqlRow(`select count(*)::integer as count from public.personal_viewing_events where source_archive_entry_id = '${archiveOnly}'`).count, 0);

  const { data: movie, error: movieError } = await service.from("movies").select("id").eq("tmdb_id", 10301).single();
  assert.equal(movieError, null);
  const { error: restoreError } = await cambo.client.rpc("save_archive_history_reconciliation_review", {
    p_group_id: group,
    p_archive_entry_id: archiveOnly,
    p_movie_id: movie.id,
    p_viewer_keys: ["cambo"],
    p_decision: "APPROVED",
  });
  assert.equal(restoreError, null);
  assert.equal(sqlRow(`select count(*)::integer as count from public.archive_history_reconciliation_reviews where archive_entry_id = '${archiveOnly}' and decision = 'APPROVED'`).count, 1);
});
