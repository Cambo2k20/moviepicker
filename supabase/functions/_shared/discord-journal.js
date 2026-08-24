const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_LIMIT = 1024;
const EMBED_TITLE_LIMIT = 256;

export function namedSupabaseKey(raw, name = "default") {
  if (!raw) return null;
  try {
    const value = JSON.parse(String(raw))?.[name];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function bearerForSupabaseApiKey(key) {
  const value = String(key || "").trim();
  if (!value || value.startsWith("sb_secret_") || value.startsWith("sb_publishable_")) return null;
  return `Bearer ${value}`;
}

export function discordGuildIdForMessage(message, webhookMetadata) {
  const directGuildId = String(message?.guild_id || "").trim();
  if (directGuildId) return directGuildId;
  const messageChannelId = String(message?.channel_id || "").trim();
  const metadataChannelId = String(webhookMetadata?.channelId || "").trim();
  const metadataGuildId = String(webhookMetadata?.guildId || "").trim();
  return messageChannelId && messageChannelId === metadataChannelId && metadataGuildId
    ? metadataGuildId
    : null;
}

function clipped(value, maximum) {
  const text = String(value ?? "").trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function pluralRuntime(minutes) {
  const runtime = Number(minutes);
  return Number.isFinite(runtime) && runtime > 0 ? `${Math.round(runtime)} min` : "Runtime unavailable";
}

function cleanGenres(value) {
  if (Array.isArray(value)) return value.map(String).map((genre) => genre.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((genre) => genre.trim()).filter(Boolean);
  return [];
}

function posterUrl(path) {
  const value = String(path || "").trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  return value.startsWith("/") ? `https://image.tmdb.org/t/p/w500${value}` : null;
}

function webhookAvatarUrl(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\//i.test(text) || text.length > 2048) return null;
  return text;
}

export function webhookPosterName(value) {
  const fallback = "A Discordian";
  const requested = clipped(value || fallback, 80) || fallback;
  return requested
    .replace(/discord/gi, "Discordian")
    .replace(/clyde/gi, "Member");
}

export function buildDiscordJournalPayload({ entry, session, viewers, submitter, poster, includeWebhookIdentity = true }) {
  const genres = cleanGenres(session.selected_genres);
  const details = [
    entry.release_year ? String(entry.release_year) : "Year unavailable",
    pluralRuntime(session.selected_runtime_minutes),
  ].join(" · ");
  const viewerText = (Array.isArray(viewers) ? viewers : [])
    .map((viewer) => String(viewer.display_name_snapshot || viewer.display_name || viewer).trim())
    .filter(Boolean)
    .join(", ") || "No viewers recorded";
  const status = String(entry.status).toUpperCase() === "DNF" ? "DNF" : "Finished";
  const mainEmbed = {
    color: 0x6c4cf5,
    author: { name: clipped(`ENTRY #${entry.entry_number}`, 256) },
    title: clipped(entry.title || session.selected_title || "Untitled", EMBED_TITLE_LIMIT),
    fields: [
      { name: "FILM", value: clipped(details, EMBED_FIELD_LIMIT), inline: false },
      { name: "GENRES", value: clipped(genres.join(" · ") || "Genres unavailable", EMBED_FIELD_LIMIT), inline: false },
      { name: "VIEWERS", value: clipped(viewerText, EMBED_FIELD_LIMIT), inline: false },
      { name: "STATUS", value: status, inline: true },
    ],
    footer: { text: clipped(`Submitted by ${submitter || "a Discordian"} via Cine-Cord`, 2048) },
  };
  const watchedAt = new Date(`${entry.watched_at}T12:00:00.000Z`);
  if (!Number.isNaN(watchedAt.getTime())) mainEmbed.timestamp = watchedAt.toISOString();
  const thumbnail = posterUrl(session.selected_poster_path);
  if (thumbnail) mainEmbed.thumbnail = { url: thumbnail };

  const embeds = [mainEmbed];
  const comment = clipped(entry.comment, EMBED_DESCRIPTION_LIMIT);
  if (comment) embeds.push({ color: 0x20183a, title: "COMMENT", description: comment });

  const payload = {
    allowed_mentions: { parse: [] },
    embeds,
  };
  if (includeWebhookIdentity) {
    payload.username = webhookPosterName(poster?.displayName || submitter);
    const avatarUrl = webhookAvatarUrl(poster?.avatarUrl);
    if (avatarUrl) payload.avatar_url = avatarUrl;
  }
  return payload;
}

export function discordMessageUrl(publication) {
  const guild = String(publication?.discord_guild_id || "").trim();
  const channel = String(publication?.discord_channel_id || "").trim();
  const message = String(publication?.discord_message_id || "").trim();
  if (!guild || !channel || !message) return null;
  return `https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(channel)}/${encodeURIComponent(message)}`;
}

export function safeDiscordWebhookUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const validHost = host === "discord.com" || host.endsWith(".discord.com")
    || host === "discordapp.com" || host.endsWith(".discordapp.com");
  const validPath = /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
  if (url.protocol !== "https:" || !validHost || !validPath) return null;
  url.search = "";
  url.hash = "";
  url.searchParams.set("wait", "true");
  return url;
}

export function discordWebhookMessageUrl(webhook, messageId) {
  if (!(webhook instanceof URL) || !/^\d+$/.test(String(messageId || ""))) return null;
  const url = new URL(webhook);
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${messageId}`;
  return url;
}

export function discordWebhookDeleteAccepted(status) {
  return status === 204 || status === 404;
}

export function journalActionRequiresSession(action) {
  return String(action || "").toLowerCase() !== "delete";
}
