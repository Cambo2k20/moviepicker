import test from "node:test";
import assert from "node:assert/strict";

import { fetchArchiveHistoryCandidates, fetchArchiveHistoryPreview } from "../archive-reconciliation-core.js";

function pagedClient(rows, calls, failedPage = -1) {
  return {
    rpc(functionName, args) {
      const order = [];
      return {
        order(column, options) {
          order.push([column, options.ascending]);
          return this;
        },
        async range(start, end) {
          calls.push({ functionName, args, order, start, end });
          return start === failedPage
            ? { data: null, error: new Error("Page failed") }
            : { data: rows.slice(start, end + 1), error: null };
        },
      };
    },
  };
}

test("archive preview loads every ordered page beyond the API row limit", async () => {
  const rows = Array.from({ length: 1371 }, (_, index) => ({ archive_entry_id: `entry-${index}` }));
  const calls = [];
  const result = await fetchArchiveHistoryPreview(pagedClient(rows, calls), "group-1");

  assert.deepEqual(result, rows);
  assert.deepEqual(calls.map(({ start, end }) => [start, end]), [[0, 499], [500, 999], [1000, 1499]]);
  assert.ok(calls.every((call) => call.functionName === "preview_archive_history_reconciliation"));
  assert.ok(calls.every((call) => call.args.p_group_id === "group-1"));
  assert.ok(calls.every((call) => JSON.stringify(call.order) === JSON.stringify([["entry_label", false], ["archive_entry_id", true]])));
});

test("archive preview fails closed when a later page fails", async () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({ archive_entry_id: `entry-${index}` }));
  await assert.rejects(fetchArchiveHistoryPreview(pagedClient(rows, [], 500), "group-1"), /Page failed/);
});

test("cached archive candidates are paged independently of preview rows", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ archive_entry_id: `entry-${index}` }));
  const calls = [];
  assert.equal((await fetchArchiveHistoryCandidates(pagedClient(rows, calls), "group-1")).length, 1001);
  assert.deepEqual(calls.map(({ start }) => start), [0, 500, 1000]);
  assert.ok(calls.every((call) => call.functionName === "get_archive_history_match_candidates"));
  assert.ok(calls.every((call) => call.args.p_archive_entry_ids === null));
  assert.deepEqual(calls[0].order, [["archive_entry_id", true], ["candidate_rank", true], ["tmdb_id", true]]);
});
