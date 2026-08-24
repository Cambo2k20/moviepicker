import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscordJournalPayload,
  discordMessageUrl,
  safeDiscordWebhookUrl,
} from "../supabase/functions/_shared/discord-journal.js";

const entry = {
  entry_number: 1325,
  title: "Alien",
  release_year: 1979,
  watched_at: "2026-08-24",
  status: "FINISHED",
  comment: "In space, nobody can hear the Journal webhook.",
};
const session = {
  selected_title: "Alien",
  selected_runtime_minutes: 117,
  selected_genres: ["Horror", "Science Fiction"],
  selected_poster_path: "/poster.jpg",
};

test("builds a fancy Journal payload without Discord mentions", () => {
  const payload = buildDiscordJournalPayload({
    entry,
    session,
    viewers: [{ display_name_snapshot: "Cameron" }, { display_name_snapshot: "Dean" }],
    submitter: "Cameron",
  });
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds[0].author.name, "ENTRY #1325");
  assert.equal(payload.embeds[0].title, "Alien");
  assert.equal(payload.embeds[0].fields[0].value, "1979 · 117 min");
  assert.equal(payload.embeds[0].fields[1].value, "Horror · Science Fiction");
  assert.equal(payload.embeds[0].fields[2].value, "Cameron, Dean");
  assert.equal(payload.embeds[0].fields[3].value, "Finished");
  assert.equal(payload.embeds[0].thumbnail.url, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(payload.embeds[1].description, entry.comment);
});

test("keeps long comments in a separate Discord embed and clips safely", () => {
  const payload = buildDiscordJournalPayload({ entry: { ...entry, comment: "x".repeat(5000) }, session, viewers: [], submitter: "Dean" });
  assert.equal(payload.embeds[1].description.length, 4096);
  assert.equal(payload.embeds[1].description.endsWith("…"), true);
  assert.equal(payload.embeds[0].fields[2].value, "No viewers recorded");
});

test("accepts only real Discord webhook URLs and adds wait=true", () => {
  const valid = safeDiscordWebhookUrl("https://discord.com/api/webhooks/123/token_value?thread_id=secret");
  assert.equal(valid?.origin, "https://discord.com");
  assert.equal(valid?.searchParams.get("wait"), "true");
  assert.equal(valid?.searchParams.has("thread_id"), false);
  assert.equal(safeDiscordWebhookUrl("https://example.com/api/webhooks/123/token"), null);
  assert.equal(safeDiscordWebhookUrl("http://discord.com/api/webhooks/123/token"), null);
});

test("builds the direct Discord message URL from stored public identifiers", () => {
  assert.equal(discordMessageUrl({ discord_guild_id: "1", discord_channel_id: "2", discord_message_id: "3" }), "https://discord.com/channels/1/2/3");
  assert.equal(discordMessageUrl({ discord_channel_id: "2" }), null);
});
