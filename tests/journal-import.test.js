import test from "node:test";
import assert from "node:assert/strict";

import {
  JOURNAL_CHANNELS,
  parseJournalEntries,
  parseJournalMessage,
  planArchiveViewingHistory,
  resolveHistoricalViewerTargets,
} from "../scripts/import-discord-journal.mjs";

const channel = JOURNAL_CHANNELS[0];

function message(content, overrides = {}) {
  return {
    schema_version: 1,
    id: "713935740504899628",
    content,
    created_at: "2020-05-24T03:05:44.821+01:00",
    edited_at: null,
    jump_url: "https://discord.com/channels/272427070779293697/713935563912118293/713935740504899628",
    author: {
      id: "123456789012345678",
      name: "arcadia",
      display_name: "Arcadia",
      avatar_url: "https://cdn.discordapp.com/avatar.png",
    },
    ...overrides,
  };
}

test("parses a normal historical Journal message", () => {
  const result = parseJournalMessage(message([
    "- Entry #1",
    "- Belzebuth",
    "- 2017",
    "- Viewers: Kieran, Dean, Andrew",
    "- Status: Finished",
    "- Two cops try to track down the devil",
  ].join("\n")), channel);

  assert.equal(result.kind, "entry");
  assert.equal(result.record.entry_label, "1");
  assert.equal(result.record.entry_index, 1);
  assert.equal(result.record.entry_sort_number, 1);
  assert.equal(result.record.title, "Belzebuth");
  assert.equal(result.record.release_year, 2017);
  assert.deepEqual(result.record.viewer_names, ["Kieran", "Dean", "Andrew"]);
  assert.equal(result.record.status, "FINISHED");
  assert.equal(result.record.comment, "Two cops try to track down the devil");
  assert.equal(result.record.watched_at, "2020-05-24");
  assert.equal(result.record.parser_status, "PARSED");
});

test("splits multiple Journal entries stored in one Discord message", () => {
  const results = parseJournalEntries(message([
    "- Entry #1347",
    "- Colony",
    "- 2026",
    "- Viewers: Andrew, Dean",
    "- Status: Finished",
    "- The Koreans know how to make a crazy zombie movie.",
    "- Entry #1348",
    "- John Wick: Chapter 4",
    "- 2023",
    "- Viewers: Andrew, Cameron, Dean",
    "- Status: Finished",
    "- John Wick",
  ].join("\n")), channel);

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.record.entry_index), [1, 2]);
  assert.deepEqual(results.map((result) => result.record.entry_label), ["1347", "1348"]);
  assert.deepEqual(results.map((result) => result.record.title), ["Colony", "John Wick: Chapter 4"]);
  assert.equal(results[0].record.comment, "The Koreans know how to make a crazy zombie movie.");
  assert.equal(results[1].record.comment, "John Wick");
  assert.deepEqual(results.map((result) => result.record.parser_status), ["PARSED", "PARSED"]);
});

test("preserves decimal and annotated labels without treating them as global IDs", () => {
  const decimal = parseJournalMessage(message([
    "- Entry #12.1",
    "- Ghostland",
    "- 2018",
    "- Viewers: Adam, Andrew",
    "- Status: Finished",
  ].join("\n")), channel);
  assert.equal(decimal.record.entry_label, "12.1");
  assert.equal(decimal.record.entry_sort_number, 12.1);

  const annotated = parseJournalMessage(message([
    "- Entry #687 (#1000)",
    "- American Pie Reunion",
    "- 2006",
    "- Viewers: Brad, Cameron, Dean",
    "- Status: Finished",
  ].join("\n")), JOURNAL_CHANNELS[1]);
  assert.equal(annotated.record.entry_label, "687 (#1000)");
  assert.equal(annotated.record.entry_sort_number, 687);
});

test("marks incomplete entries for review while preserving raw content", () => {
  const content = [
    "- Entry #42",
    "- A Film Without Metadata",
    "- Status: maybe",
  ].join("\n");
  const result = parseJournalMessage(message(content), channel);
  assert.equal(result.record.parser_status, "REVIEW");
  assert.equal(result.record.release_year, null);
  assert.deepEqual(result.record.viewer_names, []);
  assert.equal(result.record.status, "UNKNOWN");
  assert.equal(result.record.raw_content, content);
  assert.deepEqual(
    result.record.parser_notes.filter((note) => note !== "watch_date_inferred_from_message_timestamp"),
    ["missing_release_year", "missing_viewers", "unrecognised_status"],
  );
});

test("skips divider and conversation messages", () => {
  assert.equal(parseJournalMessage(message("————————————————————"), channel).reason, "divider");
  assert.equal(parseJournalMessage(message("This is not a Journal post"), channel).reason, "not_a_journal_entry");
});

test("resolves confirmed accounts inside compacted historical viewer text", () => {
  assert.deepEqual(resolveHistoricalViewerTargets(["Cameron Dean Andrew Adam Luke"]), ["cambo", "dean"]);
  assert.deepEqual(resolveHistoricalViewerTargets(["Adam  Dean", "Cambo (Zzz)"]), ["cambo", "dean"]);
  assert.deepEqual(resolveHistoricalViewerTargets(["Adam. Andrew", "Cory"]), []);
});

test("plans archive viewing events only for confirmed profiles and unique movies", () => {
  const plan = planArchiveViewingHistory([
    {
      id: "archive-1",
      title: "Alien",
      release_year: 1979,
      watched_at: "2026-09-28",
      status: "FINISHED",
      viewer_names: ["Cameron Dean Andrew"],
    },
    {
      id: "archive-2",
      title: "Unknown Film",
      release_year: 2020,
      watched_at: "2026-09-28",
      status: "FINISHED",
      viewer_names: ["Cameron"],
    },
  ], {
    profiles: [
      { id: "profile-cambo", display_name: "Cambo" },
      { id: "profile-dean", display_name: "deanshelton17" },
    ],
    movies: [
      { id: "movie-alien", title: "Alien", original_title: "Alien", release_year: 1979 },
    ],
  });

  assert.equal(plan.events.length, 2);
  assert.deepEqual(plan.events.map((event) => event.owner_id).sort(), ["profile-cambo", "profile-dean"]);
  assert.equal(plan.events[0].source_archive_entry_id, "archive-1");
  assert.deepEqual(plan.skipped.map((entry) => entry.reason), ["no_unique_canonical_movie"]);
});
