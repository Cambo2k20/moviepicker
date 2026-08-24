import {
  bearerForSupabaseApiKey,
  namedSupabaseKey,
} from "../_shared/discord-journal.js";
import {
  DISCORDIANS_GUILD_ID,
  discordAuthUserId,
  discordServerProfile,
} from "../_shared/discord-server-profile.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };

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

async function serviceWrite(base: string, path: string, key: string, body: unknown) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: "POST",
    headers: restHeaders(key, bearerForSupabaseApiKey(key), {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

function first(rows: Array<Record<string, any>>) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function safeDiscordFailure(status: number) {
  if (status === 401 || status === 403) {
    return "Discord did not grant access to your The Discordians server profile. Reconnect it and approve the requested permission.";
  }
  if (status === 404) return "That Discord account is not a member of The Discordians server.";
  if (status === 429) return "Discord is rate limiting profile refreshes. Try again shortly.";
  return "Discord could not return your The Discordians server profile. Try again.";
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
  if (!supabaseUrl || !publicKey || !serviceKey) {
    return respond({ error: "Discord server-profile synchronisation is not configured." }, 503);
  }
  if (!authorization) return respond({ error: "Sign in to refresh your Discord server profile." }, 401);

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: restHeaders(publicKey, authorization),
    });
    if (!userResponse.ok) return respond({ error: "Sign in to refresh your Discord server profile." }, 401);
    const user = await userResponse.json();
    if (!user?.id) return respond({ error: "Sign in to refresh your Discord server profile." }, 401);

    const authDiscordUserId = discordAuthUserId(user);
    if (!authDiscordUserId) {
      return respond({ error: "This Cine-Cord account is not connected to Discord." }, 409);
    }

    const serviceAuthorization = bearerForSupabaseApiKey(serviceKey);
    const groups = await restRows(
      supabaseUrl,
      "groups?select=id&slug=eq.the-discordians&limit=1",
      serviceKey,
      serviceAuthorization,
    );
    const group = first(groups);
    if (!group?.id) return respond({ error: "The Discordians group is not configured." }, 503);

    const memberships = await restRows(
      supabaseUrl,
      `group_memberships?select=user_id&group_id=eq.${group.id}&user_id=eq.${user.id}&limit=1`,
      serviceKey,
      serviceAuthorization,
    );
    if (!first(memberships)) return respond({ error: "Approved Cine-Cord membership is required." }, 403);

    const body = await req.json().catch(() => null);
    const providerToken = typeof body?.providerToken === "string" ? body.providerToken.trim() : "";
    if (!providerToken || providerToken.length > 4096) {
      return respond({ error: "Reconnect Discord to refresh your server profile." }, 400);
    }

    const discordResponse = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${DISCORDIANS_GUILD_ID}/member`,
      { headers: { Authorization: `Bearer ${providerToken}` } },
    );
    if (!discordResponse.ok) {
      return respond({ error: safeDiscordFailure(discordResponse.status) }, discordResponse.status === 429 ? 429 : 409);
    }

    const serverProfile = discordServerProfile(await discordResponse.json().catch(() => null));
    if (!serverProfile) return respond({ error: "Discord returned an invalid server profile." }, 502);
    if (serverProfile.discordUserId !== authDiscordUserId) {
      return respond({ error: "The authorised Discord account does not match this Cine-Cord account." }, 409);
    }

    const write = await serviceWrite(
      supabaseUrl,
      "rpc/upsert_discord_server_identity",
      serviceKey,
      {
        p_profile_id: user.id,
        p_discord_user_id: serverProfile.discordUserId,
        p_display_name: serverProfile.displayName,
        p_avatar_url: serverProfile.avatarUrl,
      },
    );

    if (!write.response.ok || !Array.isArray(write.data) || !write.data.length) {
      if (write.response.status === 409) {
        return respond({ error: "That Discord account is already connected to another Cine-Cord member." }, 409);
      }
      throw new Error(`Discord identity write failed (${write.response.status}).`);
    }

    const saved = write.data[0];
    return respond({
      identity: {
        profileId: saved.profile_id,
        displayName: saved.display_name,
        avatarUrl: saved.avatar_url,
        syncedAt: saved.synced_at,
      },
    });
  } catch {
    // Do not include the provider token, request body or fetch error details in
    // logs. The caller receives a safe retry instruction instead.
    console.error("Discord server-profile synchronisation failed.");
    return respond({ error: "Your Discord server profile could not be refreshed. Try again." }, 500);
  }
});
