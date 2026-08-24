import {
  bearerForSupabaseApiKey,
  buildDiscordJournalPayload,
  discordGuildIdForMessage,
  discordMessageUrl,
  discordWebhookMessageUrl,
  namedSupabaseKey,
  safeDiscordWebhookUrl,
} from "../_shared/discord-journal.js";
import { DISCORDIANS_GUILD_ID } from "../_shared/discord-server-profile.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTING_TIMEOUT_MS = 5 * 60 * 1000;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function environmentKey(name: string, legacyName?: string) {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  if (legacyName) {
    const legacy = Deno.env.get(legacyName);
    if (legacy) return legacy;
  }
  return null;
}

function namedEnvironmentKey(name: string) {
  return namedSupabaseKey(Deno.env.get(name));
}

function restHeaders(key: string, authorization: string | null, extra: Record<string, string> = {}) {
  return { apikey: key, ...(authorization ? { Authorization: authorization } : {}), ...extra };
}

async function restRows(base: string, path: string, key: string, authorization: string | null) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    headers: restHeaders(key, authorization),
  });
  if (!response.ok) throw new Error(`Database read failed (${response.status}).`);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []) as Array<Record<string, any>>;
}

async function serviceWrite(base: string, path: string, key: string, method: string, body: unknown, prefer = "return=representation") {
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

function first(rows: Array<Record<string, any>>) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function safeFailureMessage(status: number, operation: "post" | "update" = "post") {
  const action = operation === "update" ? "update" : "post";
  if (status === 429) return `Discord is rate limiting Journal ${action}s. Try again shortly.`;
  if (status === 401 || status === 403 || status === 404) return "The configured Discord webhook is no longer available.";
  return `Discord did not accept the Journal ${action}. Try again.`;
}

async function discordWebhookMetadata(webhook: URL) {
  try {
    const metadataUrl = new URL(webhook);
    metadataUrl.search = "";
    const response = await fetch(metadataUrl);
    if (!response.ok) return null;
    const metadata = await response.json().catch(() => null);
    const guildId = String(metadata?.guild_id || "").trim();
    const channelId = String(metadata?.channel_id || "").trim();
    return guildId && channelId ? { guildId, channelId } : null;
  } catch {
    return null;
  }
}

async function contentHash(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function entryIsNewer(entry: Record<string, any>, publication: Record<string, any>) {
  if (!publication?.discord_message_id) return false;
  if (!publication.synced_entry_updated_at) return true;
  const entryTime = new Date(entry.updated_at).getTime();
  const syncedTime = new Date(publication.synced_entry_updated_at).getTime();
  return !Number.isFinite(entryTime) || !Number.isFinite(syncedTime) || entryTime > syncedTime;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = namedEnvironmentKey("SUPABASE_PUBLISHABLE_KEYS")
    || environmentKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  const serviceKey = namedEnvironmentKey("SUPABASE_SECRET_KEYS")
    || environmentKey("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !publicKey || !serviceKey) return respond({ error: "Journal publishing is not configured." }, 503);
  if (!authorization) return respond({ error: "Sign in to publish a Journal entry." }, 401);

  let reservedPublicationId: string | null = null;
  let deliveryStarted = false;
  let deliveryOperation: "post" | "update" = "post";
  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: restHeaders(publicKey, authorization),
    });
    if (!userResponse.ok) return respond({ error: "Sign in to publish a Journal entry." }, 401);
    const user = await userResponse.json();
    if (!user?.id) return respond({ error: "Sign in to publish a Journal entry." }, 401);

    const body = await req.json().catch(() => null);
    const journalEntryId = String(body?.journalEntryId || "").trim();
    const action = body?.action == null ? "publish" : String(body.action).toLowerCase();
    if (!UUID.test(journalEntryId)) return respond({ error: "Choose a valid saved Journal entry." }, 400);
    if (!new Set(["publish", "update"]).has(action)) return respond({ error: "Choose a valid Discord Journal action." }, 400);

    const serviceAuthorization = bearerForSupabaseApiKey(serviceKey);
    const entries = await restRows(
      supabaseUrl,
      `journal_entries?select=id,group_id,movie_session_id,entry_number,title,release_year,watched_at,status,comment,created_by,updated_at&id=eq.${journalEntryId}&limit=1`,
      serviceKey,
      serviceAuthorization,
    );
    const entry = first(entries);
    if (!entry?.movie_session_id) return respond({ error: "That saved Journal entry is not linked to a watch session." }, 404);

    const [sessions, memberships, viewerRows, identityRows, existingRows] = await Promise.all([
      restRows(supabaseUrl, `movie_sessions?select=id,group_id,status,selected_title,selected_runtime_minutes,selected_genres,selected_poster_path&id=eq.${entry.movie_session_id}&limit=1`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `group_memberships?select=role&group_id=eq.${entry.group_id}&user_id=eq.${user.id}&limit=1`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `entry_viewers?select=profile_id&entry_id=eq.${entry.id}`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `discord_identities?select=profile_id,discord_guild_id,display_name,avatar_url&profile_id=eq.${user.id}&discord_guild_id=eq.${DISCORDIANS_GUILD_ID}&limit=1`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `discord_publications?select=*&journal_entry_id=eq.${journalEntryId}&limit=1`, serviceKey, serviceAuthorization),
    ]);
    const session = first(sessions);
    const membership = first(memberships);
    if (!session || session.group_id !== entry.group_id) return respond({ error: "The linked watch session is unavailable." }, 404);
    if (!membership) return respond({ error: "Approved Cine-Cord membership is required." }, 403);
    const isAdmin = String(membership.role).toLowerCase() === "admin";
    if (entry.created_by !== user.id && !isAdmin) {
      return respond({ error: "Only the entry creator or a website administrator can post or update this Journal entry." }, 403);
    }
    if (session.status !== "WATCHED") return respond({ error: "The Journal can be posted only after the film is marked watched." }, 409);

    const viewerIds = [...new Set(viewerRows.map((viewer) => String(viewer.profile_id || "")).filter((id) => UUID.test(id)))];
    const viewerProfiles = viewerIds.length
      ? await restRows(supabaseUrl, `profiles?select=id,display_name&id=in.(${viewerIds.join(",")})`, serviceKey, serviceAuthorization)
      : [];
    const viewerNameById = new Map(viewerProfiles.map((profile) => [profile.id, profile.display_name]));
    const viewers = viewerIds
      .map((id) => ({ display_name: viewerNameById.get(id) || "Former member" }))
      .sort((left, right) => left.display_name.localeCompare(right.display_name));
    const discordIdentity = first(identityRows);
    const webhook = safeDiscordWebhookUrl(Deno.env.get("DISCORD_JOURNAL_WEBHOOK_URL"));
    let publication = first(existingRows);
    const hasDiscordMessage = Boolean(
      publication?.discord_channel_id
      && publication?.discord_message_id
      && publication?.posted_at
    );

    if (action === "update") {
      if (!publication || !hasDiscordMessage) {
        return respond({ error: "Post this Journal entry to Discord before trying to update it." }, 409);
      }
      if (publication.status === "UPDATING") {
        const age = Date.now() - new Date(publication.attempt_started_at).getTime();
        if (Number.isFinite(age) && age < POSTING_TIMEOUT_MS) {
          return respond({ error: "This Discord message is already being updated. Refresh in a moment." }, 409);
        }
      }
      if (!entryIsNewer(entry, publication) && publication.status === "POSTED") {
        return respond({ status: "current", publication, outOfDate: false, messageUrl: discordMessageUrl(publication) });
      }
      if (!webhook) return respond({ error: "The Discord Journal webhook is not configured. Check the Supabase secret name." }, 503);

      const webhookMetadata = await discordWebhookMetadata(webhook);
      if (webhookMetadata && webhookMetadata.channelId !== String(publication.discord_channel_id)) {
        return respond({ error: "The configured webhook no longer belongs to this Journal message's channel." }, 409);
      }
      const editUrl = discordWebhookMessageUrl(webhook, publication.discord_message_id);
      if (!editUrl) return respond({ error: "The stored Discord message reference is invalid." }, 409);
      const payload = buildDiscordJournalPayload({
        entry,
        session,
        viewers,
        submitter: publication.poster_display_name || "A Discordian",
        includeWebhookIdentity: false,
      });
      const hash = await contentHash(payload);
      const reserved = await serviceWrite(
        supabaseUrl,
        `discord_publications?id=eq.${publication.id}&status=eq.${publication.status}`,
        serviceKey,
        "PATCH",
        {
          status: "UPDATING",
          attempt_started_at: new Date().toISOString(),
          last_error: null,
        },
      );
      if (!reserved.response.ok || !Array.isArray(reserved.data) || !reserved.data.length) {
        return respond({ error: "This Discord message is already being updated. Refresh in a moment." }, 409);
      }
      publication = reserved.data[0];
      reservedPublicationId = publication.id;
      deliveryOperation = "update";
      deliveryStarted = true;

      const discordResponse = await fetch(editUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!discordResponse.ok) {
        const message = safeFailureMessage(discordResponse.status, "update");
        await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
          status: "UPDATE_FAILED",
          last_error: message,
        });
        return respond({ error: message }, discordResponse.status === 429 ? 429 : 502);
      }

      const syncedAt = new Date().toISOString();
      const completed = await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
        status: "POSTED",
        content_hash: hash,
        synced_entry_updated_at: entry.updated_at,
        last_synced_by: user.id,
        last_synced_at: syncedAt,
        discord_updated_at: syncedAt,
        last_error: null,
      });
      if (!completed.response.ok || !Array.isArray(completed.data) || !completed.data.length) {
        throw new Error("Discord updated the message, but its publication record could not be completed.");
      }
      publication = completed.data[0];
      return respond({ status: "updated", publication, outOfDate: false, messageUrl: discordMessageUrl(publication) });
    }

    if (hasDiscordMessage) {
      if (!publication.discord_guild_id && webhook) {
        const metadata = await discordWebhookMetadata(webhook);
        if (metadata?.channelId === String(publication.discord_channel_id || "")) {
          const repaired = await serviceWrite(
            supabaseUrl,
            `discord_publications?id=eq.${publication.id}`,
            serviceKey,
            "PATCH",
            { discord_guild_id: metadata.guildId },
          );
          if (repaired.response.ok && Array.isArray(repaired.data) && repaired.data.length) publication = repaired.data[0];
        }
      }
      const outOfDate = entryIsNewer(entry, publication);
      return respond({ status: outOfDate ? "outdated" : "posted", publication, outOfDate, messageUrl: discordMessageUrl(publication) });
    }
    if (publication?.status === "UNKNOWN") {
      return respond({ error: publication.last_error || "Discord delivery could not be confirmed. Check the Journal channel before doing anything else." }, 409);
    }
    if (publication?.status === "POSTING") {
      const age = Date.now() - new Date(publication.attempt_started_at).getTime();
      if (Number.isFinite(age) && age < POSTING_TIMEOUT_MS) {
        return respond({ error: "This Journal entry is already being posted. Refresh in a moment." }, 409);
      }
      const uncertain = "Discord delivery could not be confirmed. Check the Journal channel; retry is blocked to prevent a duplicate post.";
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", { status: "UNKNOWN", last_error: uncertain });
      return respond({ error: uncertain }, 409);
    }

    if (!discordIdentity?.display_name) {
      return respond({ error: "Refresh your The Discordians server profile before posting to Discord." }, 409);
    }
    const posterDisplayName = discordIdentity.display_name;
    const posterAvatarUrl = discordIdentity.avatar_url || null;
    const payload = buildDiscordJournalPayload({
      entry,
      session,
      viewers,
      submitter: posterDisplayName,
      poster: { displayName: posterDisplayName, avatarUrl: posterAvatarUrl },
    });
    const hash = await contentHash(payload);
    if (publication) {
      const updated = await serviceWrite(
        supabaseUrl,
        `discord_publications?id=eq.${publication.id}&status=eq.${publication.status}`,
        serviceKey,
        "PATCH",
        {
          status: "POSTING",
          posted_by: user.id,
          poster_display_name: posterDisplayName,
          poster_avatar_url: posterAvatarUrl,
          attempt_started_at: new Date().toISOString(),
          content_hash: hash,
          last_error: null,
          discord_guild_id: null,
          discord_channel_id: null,
          discord_message_id: null,
          posted_at: null,
          synced_entry_updated_at: null,
          last_synced_by: null,
          last_synced_at: null,
          discord_updated_at: null,
        },
      );
      if (!updated.response.ok || !Array.isArray(updated.data) || !updated.data.length) {
        return respond({ error: "This Journal entry is already being posted. Refresh in a moment." }, 409);
      }
      publication = updated.data[0];
    } else {
      const inserted = await serviceWrite(
        supabaseUrl,
        "discord_publications",
        serviceKey,
        "POST",
        {
          group_id: entry.group_id,
          journal_entry_id: entry.id,
          status: "POSTING",
          posted_by: user.id,
          poster_display_name: posterDisplayName,
          poster_avatar_url: posterAvatarUrl,
          content_hash: hash,
        },
      );
      if (!inserted.response.ok) {
        if (inserted.response.status === 409) return respond({ error: "This Journal entry is already being posted. Refresh in a moment." }, 409);
        throw new Error(`Publication reservation failed (${inserted.response.status}).`);
      }
      publication = inserted.data[0];
    }
    reservedPublicationId = publication.id;

    if (!webhook) {
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
        status: "FAILED",
        last_error: "The Discord Journal webhook is not configured.",
      });
      return respond({ error: "The Discord Journal webhook is not configured. Check the Supabase secret name." }, 503);
    }

    const webhookMetadata = await discordWebhookMetadata(webhook);
    deliveryStarted = true;
    const discordResponse = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!discordResponse.ok) {
      const message = safeFailureMessage(discordResponse.status, "post");
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
        status: "FAILED",
        last_error: message,
      });
      return respond({ error: message }, discordResponse.status === 429 ? 429 : 502);
    }

    const discordMessage = await discordResponse.json().catch(() => null);
    if (!discordMessage?.id || !discordMessage?.channel_id) {
      const message = "Discord accepted the request but did not return a message reference. Check the Journal channel; retry is blocked to prevent a duplicate post.";
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", { status: "UNKNOWN", last_error: message });
      return respond({ error: message }, 502);
    }

    const postedAt = new Date().toISOString();
    const discordGuildId = discordGuildIdForMessage(discordMessage, webhookMetadata);
    const completed = await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
      status: "POSTED",
      discord_guild_id: discordGuildId || null,
      discord_channel_id: discordMessage.channel_id,
      discord_message_id: discordMessage.id,
      posted_at: postedAt,
      synced_entry_updated_at: entry.updated_at,
      last_synced_by: user.id,
      last_synced_at: postedAt,
      last_error: null,
    });
    if (!completed.response.ok || !Array.isArray(completed.data) || !completed.data.length) {
      throw new Error("Discord posted the message, but its publication record could not be completed.");
    }
    publication = completed.data[0];
    return respond({ status: "posted", publication, outOfDate: false, messageUrl: discordMessageUrl(publication) });
  } catch (error) {
    console.error("Journal publication failed", error);
    if (reservedPublicationId && deliveryStarted) {
      if (deliveryOperation === "update") {
        const message = "Discord may have updated the message, but Cine-Cord could not confirm it. Retrying is safe and will not create a duplicate.";
        await serviceWrite(supabaseUrl, `discord_publications?id=eq.${reservedPublicationId}`, serviceKey, "PATCH", { status: "UPDATE_FAILED", last_error: message }).catch(() => null);
        return respond({ error: message }, 502);
      }
      const message = "Discord delivery could not be confirmed. Check the Journal channel; retry is blocked to prevent a duplicate post.";
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${reservedPublicationId}`, serviceKey, "PATCH", { status: "UNKNOWN", last_error: message }).catch(() => null);
      return respond({ error: message }, 502);
    }
    return respond({ error: `The Journal could not be ${deliveryOperation === "update" ? "updated in" : "posted to"} Discord. Try again.` }, 500);
  }
});
