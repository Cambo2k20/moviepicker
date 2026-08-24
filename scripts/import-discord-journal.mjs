import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

export const JOURNAL_CHANNELS = Object.freeze([
  {
    guildId: "272427070779293697",
    channelId: "713935563912118293",
    channelName: "the-journal",
    displayName: "The Journal",
    sortOrder: 1,
  },
  {
    guildId: "272427070779293697",
    channelId: "995528992985710682",
    channelName: "the-journal-strikes-back",
    displayName: "The Journal Strikes Back",
    sortOrder: 2,
  },
  {
    guildId: "272427070779293697",
    channelId: "1353823481413763132",
    channelName: "return-of-the-journal",
    displayName: "Return of the Journal",
    sortOrder: 3,
  },
]);

const DIVIDER = /^[-—–_=*]{8,}$/u;
const ENTRY_HEADER = /^Entry\s*#\s*(.+)$/i;
const YEAR = /^(18\d{2}|19\d{2}|20\d{2}|21\d{2}|2200)(?:\s*(?:[-–,/]|and\b|\().*)?$/i;
const VIEWERS = /^Viewers?\s*[:\-]\s*(.*)$/i;
const STATUS = /^Status\s*[:\-]\s*(.*)$/i;

function cleanLine(value) {
  return String(value ?? "")
    .replace(/^\s*-\s*/, "")
    .trim();
}

function isDivider(value) {
  return DIVIDER.test(String(value ?? "").replace(/\s/g, ""));
}

function safeHttpsUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" && text.length <= 2048 ? text : null;
  } catch {
    return null;
  }
}

function localDateFromTimestamp(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}

function normaliseStatus(value) {
  const status = String(value || "").trim();
  if (/\b(dnf|did\s+not\s+finish|not\s+finished)\b/i.test(status)) return "DNF";
  if (/\b(finished|finish|complete|completed)\b/i.test(status)) return "FINISHED";
  return "UNKNOWN";
}

function splitViewerNames(value) {
  return String(value || "")
    .split(/,|\s+&\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function parseJournalMessage(message, channel) {
  const rawContent = String(message?.content || "").replace(/\r\n?/g, "\n");
  const rawLines = rawContent.split("\n");
  const lines = rawLines.map(cleanLine);
  const headerIndex = lines.findIndex((line) => ENTRY_HEADER.test(line));
  if (headerIndex < 0) {
    return {
      kind: "skipped",
      messageId: String(message?.id || ""),
      reason: isDivider(rawContent.trim()) ? "divider" : "not_a_journal_entry",
    };
  }

  const header = lines[headerIndex].match(ENTRY_HEADER);
  const entryLabel = String(header?.[1] || "").trim();
  const entryNumberMatch = entryLabel.match(/\d+(?:\.\d+)?/);
  const entrySortNumber = entryNumberMatch ? Number(entryNumberMatch[0]) : null;
  const viewerIndex = lines.findIndex((line, index) => index > headerIndex && VIEWERS.test(line));
  const statusIndex = lines.findIndex((line, index) => index > headerIndex && STATUS.test(line));
  const metadataBoundary = [viewerIndex, statusIndex]
    .filter((index) => index >= 0)
    .reduce((smallest, index) => Math.min(smallest, index), lines.length);
  let yearIndex = -1;
  for (let index = headerIndex + 1; index < metadataBoundary; index += 1) {
    if (YEAR.test(lines[index])) {
      yearIndex = index;
    }
  }
  const yearMatch = yearIndex >= 0 ? lines[yearIndex].match(YEAR) : null;
  const releaseYear = yearMatch ? Number(yearMatch[1]) : null;
  const title = lines
    .slice(headerIndex + 1, metadataBoundary)
    .find((line, offset) => {
      const index = headerIndex + 1 + offset;
      return line && index !== yearIndex && !isDivider(line) && !VIEWERS.test(line) && !STATUS.test(line);
    });

  const viewerMatch = viewerIndex >= 0 ? lines[viewerIndex].match(VIEWERS) : null;
  let viewerNames = splitViewerNames(viewerMatch?.[1]);
  let inferredUnlabelledViewers = false;
  if (!viewerNames.length && statusIndex > headerIndex + 1) {
    const possibleViewers = lines[statusIndex - 1];
    if (statusIndex - 1 !== yearIndex && possibleViewers.includes(",")) {
      viewerNames = splitViewerNames(possibleViewers);
      inferredUnlabelledViewers = viewerNames.length > 0;
    }
  }
  const statusMatch = statusIndex >= 0 ? lines[statusIndex].match(STATUS) : null;
  const status = normaliseStatus(statusMatch?.[1]);
  const comment = statusIndex >= 0
    ? lines.slice(statusIndex + 1).filter((line) => line && !isDivider(line)).join("\n")
    : "";
  const watchedAt = localDateFromTimestamp(message?.created_at);
  const notes = ["watch_date_inferred_from_message_timestamp"];

  if (!entryLabel) notes.push("missing_entry_label");
  if (!Number.isFinite(entrySortNumber)) notes.push("entry_label_has_no_numeric_sort_value");
  if (!title) notes.push("missing_title");
  if (!releaseYear) notes.push("missing_release_year");
  if (inferredUnlabelledViewers) notes.push("viewers_inferred_from_unlabelled_line");
  else if (viewerIndex < 0 || !viewerNames.length) notes.push("missing_viewers");
  if (status === "UNKNOWN") notes.push("unrecognised_status");
  if (!watchedAt) notes.push("missing_message_date");
  if (headerIndex > 0 && lines.slice(0, headerIndex).some(Boolean)) notes.push("content_before_entry_header");

  const reviewNotes = notes.filter((note) => note !== "watch_date_inferred_from_message_timestamp");
  const messageId = String(message?.id || "").trim();
  const jumpUrl = safeHttpsUrl(message?.jump_url)
    || `https://discord.com/channels/${channel.guildId}/${channel.channelId}/${messageId}`;
  const authorName = String(message?.author?.display_name || message?.author?.name || "Unknown Discordian").trim();

  return {
    kind: "entry",
    channelId: channel.channelId,
    record: {
      discord_message_id: messageId,
      discord_jump_url: jumpUrl,
      entry_label: entryLabel || "Unlabelled",
      entry_sort_number: Number.isFinite(entrySortNumber) ? entrySortNumber : null,
      title: String(title || "Untitled archive entry").slice(0, 300),
      release_year: releaseYear,
      watched_at: watchedAt,
      status,
      comment: comment || null,
      viewer_names: viewerNames,
      author_discord_user_id: /^\d+$/.test(String(message?.author?.id || "")) ? String(message.author.id) : null,
      author_display_name: (authorName || "Unknown Discordian").slice(0, 100),
      author_avatar_url: safeHttpsUrl(message?.author?.avatar_url),
      message_created_at: message?.created_at,
      message_edited_at: message?.edited_at || null,
      raw_content: rawContent,
      parser_status: reviewNotes.length ? "REVIEW" : "PARSED",
      parser_notes: notes,
      source_schema_version: Number.isInteger(message?.schema_version) ? message.schema_version : null,
    },
  };
}

async function readJsonLines(path, onRow) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${lineNumber} is not valid JSON: ${error.message}`);
    }
    await onRow(parsed, lineNumber);
  }
}

export async function inspectDiscordJournalBackup(sourceRoot) {
  const root = resolve(sourceRoot);
  const entries = [];
  const skipped = [];
  const seenMessageIds = new Set();
  const channels = [];

  for (const channel of JOURNAL_CHANNELS) {
    const channelRoot = resolve(root, channel.channelId);
    const metaPath = resolve(channelRoot, "meta.json");
    const messagesPath = resolve(channelRoot, "messages.jsonl");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (String(meta?.guild?.id) !== channel.guildId || String(meta?.channel?.id) !== channel.channelId) {
      throw new Error(`Backup metadata does not match the approved Journal channel ${channel.channelId}.`);
    }

    const channelStart = entries.length;
    const skippedStart = skipped.length;
    await readJsonLines(messagesPath, (message, lineNumber) => {
      const result = parseJournalMessage(message, channel);
      if (result.kind === "skipped") {
        skipped.push({ channelId: channel.channelId, lineNumber, ...result });
        return;
      }
      if (!result.record.discord_message_id) {
        throw new Error(`${messagesPath}:${lineNumber} has no Discord message ID.`);
      }
      if (seenMessageIds.has(result.record.discord_message_id)) {
        throw new Error(`Duplicate Discord message ID ${result.record.discord_message_id} in the backup.`);
      }
      seenMessageIds.add(result.record.discord_message_id);
      entries.push(result);
    });

    const channelEntries = entries.slice(channelStart);
    channels.push({
      channelId: channel.channelId,
      channelName: channel.displayName,
      entries: channelEntries.length,
      parsed: channelEntries.filter((entry) => entry.record.parser_status === "PARSED").length,
      review: channelEntries.filter((entry) => entry.record.parser_status === "REVIEW").length,
      skipped: skipped.length - skippedStart,
    });
  }

  return {
    sourceRoot: root,
    entries,
    skipped,
    summary: {
      mode: "dry-run",
      channels,
      entries: entries.length,
      parsed: entries.filter((entry) => entry.record.parser_status === "PARSED").length,
      review: entries.filter((entry) => entry.record.parser_status === "REVIEW").length,
      skipped: skipped.length,
      reviewMessages: entries
        .filter((entry) => entry.record.parser_status === "REVIEW")
        .map((entry) => ({
          channelId: entry.channelId,
          messageId: entry.record.discord_message_id,
          notes: entry.record.parser_notes.filter((note) => note !== "watch_date_inferred_from_message_timestamp"),
        })),
      skippedMessages: skipped.map(({ channelId, messageId, reason }) => ({ channelId, messageId, reason })),
    },
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function isLocalSupabaseUrl(value) {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function applyDiscordJournalImport(report, { supabaseUrl, secretKey, allowHosted = false }) {
  if (!supabaseUrl || !secretKey) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY before using --apply.");
  if (!isLocalSupabaseUrl(supabaseUrl) && !allowHosted) {
    throw new Error("Refusing a hosted import without the explicit --allow-hosted flag.");
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const channelIds = JOURNAL_CHANNELS.map((channel) => channel.channelId);
  const { data: volumes, error: volumeError } = await supabase
    .from("journal_volumes")
    .select("id,group_id,discord_channel_id")
    .in("discord_channel_id", channelIds);
  if (volumeError) throw volumeError;
  if ((volumes || []).length !== JOURNAL_CHANNELS.length) {
    throw new Error("The three seeded Journal volumes are missing. Apply the Phase 1 migration first.");
  }

  const volumeByChannel = new Map(volumes.map((volume) => [volume.discord_channel_id, volume]));
  const groupIds = new Set(volumes.map((volume) => volume.group_id));
  if (groupIds.size !== 1) throw new Error("The approved Journal volumes do not belong to one Cine-Cord group.");
  const [group] = groupIds;

  const { data: publications, error: publicationError } = await supabase
    .from("discord_publications")
    .select("journal_entry_id,discord_channel_id,discord_message_id")
    .eq("group_id", group)
    .not("discord_message_id", "is", null);
  if (publicationError) throw publicationError;
  const managedMessages = new Set((publications || []).map((publication) => (
    `${publication.discord_channel_id}:${publication.discord_message_id}`
  )));

  const linkedManagedEntries = [];
  const rows = report.entries.flatMap((entry) => {
    const identity = `${entry.channelId}:${entry.record.discord_message_id}`;
    if (managedMessages.has(identity)) {
      linkedManagedEntries.push(identity);
      return [];
    }
    const volume = volumeByChannel.get(entry.channelId);
    return [{ ...entry.record, group_id: volume.group_id, volume_id: volume.id }];
  });

  for (const batch of chunks(rows, 200)) {
    const { error } = await supabase
      .from("journal_archive_entries")
      .upsert(batch, { onConflict: "discord_message_id" });
    if (error) throw error;
  }

  return {
    imported: rows.length,
    linkedManagedEntries: linkedManagedEntries.length,
    totalCandidates: report.entries.length,
  };
}

function argumentValue(args, name) {
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const source = argumentValue(args, "--source");
  if (!source) {
    throw new Error("Usage: npm run journal:import -- --source <guild-backup-directory> [--apply] [--allow-hosted]");
  }

  const report = await inspectDiscordJournalBackup(source);
  if (!args.includes("--apply")) {
    console.log(JSON.stringify(report.summary, null, 2));
    return;
  }

  const result = await applyDiscordJournalImport(report, {
    supabaseUrl: process.env.SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    allowHosted: args.includes("--allow-hosted"),
  });
  console.log(JSON.stringify({ ...report.summary, mode: "apply", ...result }, null, 2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(`Journal import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
