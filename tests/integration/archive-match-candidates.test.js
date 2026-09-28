import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentity,
  expectRpcError,
  groupId,
  resetWorkspace,
  serviceDataClient,
} from "./helpers/local-supabase.js";

test("archive match candidates are readable only through the administrator RPC", async () => {
  resetWorkspace();
  const group = groupId();
  const cambo = await createIdentity({ name: "Cambo", role: "admin" });
  const dean = await createIdentity({ name: "deanshelton17", role: "member" });
  const { data: volume, error: volumeError } = await serviceDataClient()
    .from("journal_volumes")
    .select("id")
    .limit(1)
    .single();
  assert.equal(volumeError, null);

  const { data: archiveEntry, error: archiveError } = await serviceDataClient()
    .from("journal_archive_entries")
    .insert({
      group_id: group,
      volume_id: volume.id,
      discord_message_id: "800000000000000001",
      discord_jump_url: "https://discord.com/channels/272427070779293697/713935563912118293/800000000000000001",
      entry_label: "2001",
      entry_sort_number: 2001,
      title: "The Grand Adventur",
      release_year: 2012,
      watched_at: "2026-09-20",
      status: "FINISHED",
      viewer_names: ["Dean"],
      author_display_name: "Cambo",
      message_created_at: "2026-09-20T20:00:00Z",
      raw_content: "- The Grand Adventur",
      parser_status: "PARSED",
    })
    .select("id")
    .single();
  assert.equal(archiveError, null);

  const { error: candidateError } = await serviceDataClient()
    .from("archive_history_match_candidates")
    .insert({
      archive_entry_id: archiveEntry.id,
      tmdb_id: 1003,
      title: "The Grand Adventure",
      release_year: 2010,
      score: 0.956,
      title_score: 0.98,
      year_delta: 2,
      match_band: "STRONG",
      candidate_rank: 1,
      search_query: "The Grand Adventur",
    });
  assert.equal(candidateError, null);

  const { data: candidates, error: readError } = await cambo.client.rpc("get_archive_history_match_candidates", {
    p_group_id: group,
    p_archive_entry_ids: [archiveEntry.id],
  });
  assert.equal(readError, null);
  assert.deepEqual(candidates.map((row) => ({ title: row.title, tmdb_id: row.tmdb_id, match_band: row.match_band })), [
    { title: "The Grand Adventure", tmdb_id: 1003, match_band: "STRONG" },
  ]);

  await expectRpcError(
    dean.client.rpc("get_archive_history_match_candidates", {
      p_group_id: group,
      p_archive_entry_ids: [archiveEntry.id],
    }),
    /group administrator/i,
  );
});
