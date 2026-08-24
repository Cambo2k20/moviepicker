import {
  buildDiscordJournalPayload,
  discordMessageUrl,
  safeDiscordWebhookUrl,
} from "../_shared/discord-journal.js";

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

function restHeaders(key: string, authorization: string, extra: Record<string, string> = {}) {
  return { apikey: key, Authorization: authorization, ...extra };
}

async function restRows(base: string, path: string, key: string, authorization: string) {
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
    headers: restHeaders(key, `Bearer ${key}`, {
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

function safeFailureMessage(status: number) {
  if (status === 429) return "Discord is rate limiting Journal posts. Try again shortly.";
  if (status === 401 || status === 403 || status === 404) return "The configured Discord webhook is no longer available.";
  return "Discord did not accept the Journal post. Try again.";
}

async function contentHash(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = environmentKey("SUPABASE_ANON_KEY", "SB_PUBLISHABLE_KEY");
  const serviceKey = environmentKey("SUPABASE_SERVICE_ROLE_KEY", "SB_SECRET_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !publicKey || !serviceKey) return respond({ error: "Journal publishing is not configured." }, 503);
  if (!authorization) return respond({ error: "Sign in to publish a Journal entry." }, 401);

  let reservedPublicationId: string | null = null;
  let deliveryStarted = false;
  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: restHeaders(publicKey, authorization),
    });
    if (!userResponse.ok) return respond({ error: "Sign in to publish a Journal entry." }, 401);
    const user = await userResponse.json();
    if (!user?.id) return respond({ error: "Sign in to publish a Journal entry." }, 401);

    const body = await req.json().catch(() => null);
    const journalEntryId = String(body?.journalEntryId || "").trim();
    if (!UUID.test(journalEntryId)) return respond({ error: "Choose a valid saved Journal entry." }, 400);

    const serviceAuthorization = `Bearer ${serviceKey}`;
    const entries = await restRows(
      supabaseUrl,
      `journal_entries?select=id,group_id,movie_session_id,entry_number,title,release_year,watched_at,status,comment,created_by&id=eq.${journalEntryId}&limit=1`,
      serviceKey,
      serviceAuthorization,
    );
    const entry = first(entries);
    if (!entry?.movie_session_id) return respond({ error: "That saved Journal entry is not linked to a watch session." }, 404);

    const [sessions, memberships, viewers, profiles, existingRows] = await Promise.all([
      restRows(supabaseUrl, `movie_sessions?select=id,group_id,host_id,status,selected_title,selected_runtime_minutes,selected_genres,selected_poster_path&id=eq.${entry.movie_session_id}&limit=1`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `group_memberships?select=role&group_id=eq.${entry.group_id}&user_id=eq.${user.id}&limit=1`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `movie_session_participants?select=display_name_snapshot,added_at&session_id=eq.${entry.movie_session_id}&order=added_at.asc`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `profiles?select=display_name&id=eq.${user.id}&limit=1`, serviceKey, serviceAuthorization),
      restRows(supabaseUrl, `discord_publications?select=*&journal_entry_id=eq.${journalEntryId}&limit=1`, serviceKey, serviceAuthorization),
    ]);
    const session = first(sessions);
    const membership = first(memberships);
    if (!session || session.group_id !== entry.group_id) return respond({ error: "The linked watch session is unavailable." }, 404);
    if (!membership) return respond({ error: "Approved Cine-Cord membership is required." }, 403);
    const isAdmin = String(membership.role).toLowerCase() === "admin";
    if (session.host_id !== user.id && !isAdmin) return respond({ error: "Only the session host or a website administrator can post this Journal entry." }, 403);
    if (session.status !== "WATCHED") return respond({ error: "The Journal can be posted only after the film is marked watched." }, 409);

    let publication = first(existingRows);
    if (publication?.status === "POSTED") {
      return respond({ status: "posted", publication, messageUrl: discordMessageUrl(publication) });
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

    const payload = buildDiscordJournalPayload({
      entry,
      session,
      viewers,
      submitter: first(profiles)?.display_name || user.email || "a Discordian",
    });
    const hash = await contentHash(payload);

    if (publication) {
      const updated = await serviceWrite(
        supabaseUrl,
        `discord_publications?id=eq.${publication.id}&status=neq.POSTED`,
        serviceKey,
        "PATCH",
        {
          status: "POSTING",
          posted_by: user.id,
          attempt_started_at: new Date().toISOString(),
          content_hash: hash,
          last_error: null,
          discord_guild_id: null,
          discord_channel_id: null,
          discord_message_id: null,
          posted_at: null,
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
        { group_id: entry.group_id, journal_entry_id: entry.id, status: "POSTING", posted_by: user.id, content_hash: hash },
      );
      if (!inserted.response.ok) {
        if (inserted.response.status === 409) return respond({ error: "This Journal entry is already being posted. Refresh in a moment." }, 409);
        throw new Error(`Publication reservation failed (${inserted.response.status}).`);
      }
      publication = inserted.data[0];
    }
    reservedPublicationId = publication.id;

    const webhook = safeDiscordWebhookUrl(Deno.env.get("DISCORD_JOURNAL_WEBHOOK_URL"));
    if (!webhook) {
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
        status: "FAILED",
        last_error: "The Discord Journal webhook is not configured.",
      });
      return respond({ error: "The Discord Journal webhook is not configured. Check the Supabase secret name." }, 503);
    }

    deliveryStarted = true;
    const discordResponse = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!discordResponse.ok) {
      const message = safeFailureMessage(discordResponse.status);
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

    const completed = await serviceWrite(supabaseUrl, `discord_publications?id=eq.${publication.id}`, serviceKey, "PATCH", {
      status: "POSTED",
      discord_guild_id: discordMessage.guild_id || null,
      discord_channel_id: discordMessage.channel_id,
      discord_message_id: discordMessage.id,
      posted_at: new Date().toISOString(),
      last_error: null,
    });
    if (!completed.response.ok || !Array.isArray(completed.data) || !completed.data.length) {
      throw new Error("Discord posted the message, but its publication record could not be completed.");
    }
    publication = completed.data[0];
    return respond({ status: "posted", publication, messageUrl: discordMessageUrl(publication) });
  } catch (error) {
    console.error("Journal publication failed", error);
    if (reservedPublicationId && deliveryStarted) {
      const message = "Discord delivery could not be confirmed. Check the Journal channel; retry is blocked to prevent a duplicate post.";
      await serviceWrite(supabaseUrl, `discord_publications?id=eq.${reservedPublicationId}`, serviceKey, "PATCH", { status: "UNKNOWN", last_error: message }).catch(() => null);
      return respond({ error: message }, 502);
    }
    return respond({ error: "The Journal could not be posted to Discord. Try again." }, 500);
  }
});
