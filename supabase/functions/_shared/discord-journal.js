const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_LIMIT = 1024;
const EMBED_TITLE_LIMIT = 256;

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

export function buildDiscordJournalPayload({ entry, session, viewers, submitter }) {
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

  return {
    username: "The Discordians Journal",
    allowed_mentions: { parse: [] },
    embeds,
  };
}

export function discordMessageUrl(publication) {
  const channel = String(publication?.discord_channel_id || "").trim();
  const message = String(publication?.discord_message_id || "").trim();
  if (!channel || !message) return null;
  const guild = String(publication?.discord_guild_id || "@me").trim();
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
