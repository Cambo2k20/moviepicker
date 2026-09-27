import {
  bearerForSupabaseApiKey,
  discordWebhookMessageUrl,
  safeDiscordWebhookUrl,
} from "../_shared/discord-journal.js";
import { DISCORDIANS_GUILD_ID } from "../_shared/discord-server-profile.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };
const DEFAULT_SITE_URL = "https://cambo2k20.github.io/moviepicker/";

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function namedKey(name: string, legacyName?: string) {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const value = JSON.parse(raw)?.default;
      if (typeof value === "string" && value.trim()) return value.trim();
    } catch { /* fall through to legacy environment values */ }
  }
  return legacyName ? Deno.env.get(legacyName) || null : null;
}

function restHeaders(key: string, authorization: string | null, extra: Record<string, string> = {}) {
  return { apikey: key, ...(authorization ? { Authorization: authorization } : {}), ...extra };
}

async function rows(base: string, path: string, key: string, authorization: string | null) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: restHeaders(key, authorization) });
  if (!response.ok) throw new Error(`Database read failed (${response.status}).`);
  const value = await response.json();
  return Array.isArray(value) ? value as Array<Record<string, any>> : [];
}

async function write(base: string, path: string, key: string, method: string, body: unknown, prefer = "return=representation") {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: restHeaders(key, bearerForSupabaseApiKey(key), {
      "Content-Type": "application/json",
      Prefer: prefer,
    }),
    body: JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, data };
}

function siteUrl(path: string) {
  const raw = Deno.env.get("CINE_CORD_SITE_URL") || DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return new URL(path.replace(/^\//, ""), url).toString();
  } catch {
    throw new Error("The Cine-Cord site URL is not configured.");
  }
}

function hubPayload() {
  return {
    username: "Cine-Cord",
    allowed_mentions: { parse: [] },
    embeds: [{
      color: 0x6c4cf5,
      title: "Cine-Cord",
      description: "The private movie list, watch sessions and Journal for The Discordians.",
      fields: [
        { name: "Shared cinema", value: "Browse films, join sessions and see the group Journal.", inline: false },
        { name: "Private by default", value: "My Cinema and viewing history are visible only to you.", inline: false },
      ],
      footer: { text: "Open Cine-Cord to continue" },
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 5, label: "Open Cine-Cord", url: siteUrl("#list") },
        { type: 2, style: 5, label: "Sessions", url: siteUrl("#sessions") },
        { type: 2, style: 5, label: "Journal", url: siteUrl("#journal") },
        { type: 2, style: 5, label: "My Cinema", url: siteUrl("#my-films") },
      ],
    }],
  };
}

async function webhookMetadata(webhook: URL) {
  const metadataUrl = new URL(webhook);
  metadataUrl.search = "";
  const response = await fetch(metadataUrl);
  if (!response.ok) return null;
  const value = await response.json().catch(() => null);
  return { guildId: String(value?.guild_id || "").trim(), channelId: String(value?.channel_id || "").trim() };
}

function discordFailure(status: number) {
  if (status === 429) return "Discord is rate limiting hub updates. Try again shortly.";
  if ([401, 403, 404].includes(status)) return "The configured Cine-Cord hub webhook is unavailable.";
  return "Discord did not accept the Cine-Cord hub message.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhook = safeDiscordWebhookUrl(Deno.env.get("DISCORD_CINE_CORD_WEBHOOK_URL"));
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !publicKey || !serviceKey) return respond({ error: "Cine-Cord Discord publishing is not configured." }, 503);
  if (!webhook) return respond({ error: "The Cine-Cord hub webhook is not configured." }, 503);
  if (!authorization) return respond({ error: "Sign in as a Cine-Cord administrator to publish the hub." }, 401);

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: restHeaders(publicKey, authorization) });
    if (!userResponse.ok) return respond({ error: "Sign in as a Cine-Cord administrator to publish the hub." }, 401);
    const user = await userResponse.json();
    if (!user?.id) return respond({ error: "Sign in as a Cine-Cord administrator to publish the hub." }, 401);

    const body = await req.json().catch(() => null);
    const requestedGroupId = String(body?.groupId || "").trim();
    const serviceAuthorization = bearerForSupabaseApiKey(serviceKey);
    const memberships = await rows(
      supabaseUrl,
      `group_memberships?select=group_id,role&user_id=eq.${encodeURIComponent(user.id)}${requestedGroupId ? `&group_id=eq.${encodeURIComponent(requestedGroupId)}` : ""}`,
      serviceKey,
      serviceAuthorization,
    );
    const membership = memberships.find((item) => String(item.role).toLowerCase() === "admin");
    if (!membership) return respond({ error: "Only a Cine-Cord administrator can publish the hub." }, 403);
    const groupId = String(membership.group_id);
    const existingRows = await rows(supabaseUrl, `discord_hub_publications?select=*&group_id=eq.${encodeURIComponent(groupId)}&limit=1`, serviceKey, serviceAuthorization);
    const existing = existingRows[0] || null;
    const payload = hubPayload();
    const metadata = await webhookMetadata(webhook);
    const messageUrl = existing?.discord_message_id ? discordWebhookMessageUrl(webhook, existing.discord_message_id) : null;
    const attemptStartedAt = new Date().toISOString();
    const reserved = await write(supabaseUrl, "discord_hub_publications?on_conflict=group_id", serviceKey, "POST", {
      group_id: groupId,
      status: "POSTING",
      discord_guild_id: existing?.discord_guild_id || metadata?.guildId || DISCORDIANS_GUILD_ID,
      discord_channel_id: existing?.discord_channel_id || metadata?.channelId || null,
      discord_message_id: existing?.discord_message_id || null,
      posted_by: user.id,
      attempt_started_at: attemptStartedAt,
      last_error: null,
    }, "resolution=merge-duplicates,return=representation");
    if (!reserved.response.ok) return respond({ error: "The Cine-Cord hub is already being updated or could not reserve an update." }, 409);

    let discordResponse;
    if (messageUrl) {
      discordResponse = await fetch(messageUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      discordResponse = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    if (!discordResponse.ok) {
      const errorMessage = discordFailure(discordResponse.status);
      await write(supabaseUrl, `discord_hub_publications?group_id=eq.${encodeURIComponent(groupId)}`, serviceKey, "PATCH", { status: "FAILED", last_error: errorMessage }).catch(() => null);
      return respond({ error: errorMessage }, discordResponse.status === 429 ? 429 : 502);
    }
    const message = messageUrl ? existing : await discordResponse.json().catch(() => null);
    const messageId = String(existing?.discord_message_id || message?.id || "").trim();
    const channelId = String(existing?.discord_channel_id || message?.channel_id || metadata?.channelId || "").trim();
    const guildId = String(existing?.discord_guild_id || message?.guild_id || metadata?.guildId || DISCORDIANS_GUILD_ID).trim();
    if (!messageId || !channelId) {
      const errorMessage = "Discord accepted the hub, but did not return a usable message reference.";
      await write(supabaseUrl, `discord_hub_publications?group_id=eq.${encodeURIComponent(groupId)}`, serviceKey, "PATCH", { status: "UNKNOWN", last_error: errorMessage }).catch(() => null);
      return respond({ error: errorMessage }, 502);
    }
    const saved = await write(supabaseUrl, "discord_hub_publications?on_conflict=group_id", serviceKey, "POST", {
      group_id: groupId,
      status: "POSTED",
      discord_guild_id: guildId,
      discord_channel_id: channelId,
      discord_message_id: messageId,
      posted_by: user.id,
      posted_at: new Date().toISOString(),
      attempt_started_at: attemptStartedAt,
      last_error: null,
    }, "resolution=merge-duplicates,return=representation");
    if (!saved.response.ok) return respond({ error: "Discord was updated, but the hub record could not be saved." }, 502);
    return respond({ messageUrl: `https://discord.com/channels/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}`, updated: Boolean(messageUrl) });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "The Cine-Cord hub could not be published." }, 500);
  }
});
