import {
  archiveMatchQueries,
  rankArchiveMovieMatches,
} from "../_shared/archive-match.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function namedEnvironmentKey(name: string) {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw)?.default;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function environmentKey(name: string, legacyName?: string) {
  return Deno.env.get(name) || (legacyName ? Deno.env.get(legacyName) || null : null);
}

function authorizationForSupabaseKey(key: string) {
  return key.startsWith("sb_secret_") || key.startsWith("sb_publishable_")
    ? null
    : `Bearer ${key}`;
}

function supabaseHeaders(key: string, authorization: string | null, extra: Record<string, string> = {}) {
  return { apikey: key, ...(authorization ? { Authorization: authorization } : {}), ...extra };
}

async function restRows(base: string, path: string, key: string, options: RequestInit = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(key, authorizationForSupabaseKey(key)),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}).`);
  return Array.isArray(payload) ? payload : [];
}

async function requireAdmin(req: Request, groupId: string, base: string, secretKey: string) {
  const publishableKey = namedEnvironmentKey("SUPABASE_PUBLISHABLE_KEYS")
    || environmentKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization");
  if (!publishableKey || !authorization) return false;

  const userResponse = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization },
  });
  if (!userResponse.ok) return false;
  const user = await userResponse.json();
  if (!user?.id) return false;

  const memberships = await restRows(
    base,
    `group_memberships?select=role&group_id=eq.${encodeURIComponent(groupId)}&user_id=eq.${encodeURIComponent(user.id)}&role=eq.admin&limit=1`,
    secretKey,
  );
  return memberships.length > 0;
}

async function tmdbRequest(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`TMDB request failed (${response.status}).`);
  return await response.json();
}

async function candidatesForEntry(entry: Record<string, unknown>, token: string) {
  const results: Record<string, unknown>[] = [];
  for (const query of archiveMatchQueries(entry.title)) {
    const data = await tmdbRequest("search/movie", token, {
      query,
      include_adult: "false",
      language: "en-GB",
      page: "1",
    });
    if (Array.isArray(data.results)) results.push(...data.results);
  }
  return rankArchiveMovieMatches({
    archiveTitle: entry.title,
    archiveYear: entry.release_year,
    results,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const base = Deno.env.get("SUPABASE_URL");
  const secretKey = namedEnvironmentKey("SUPABASE_SECRET_KEYS")
    || environmentKey("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("TMDB_READ_ACCESS_TOKEN");
  if (!base || !secretKey) return respond({ error: "The archive matcher is not configured yet." }, 503);
  if (!token) return respond({ error: "TMDB lookup is not configured yet." }, 503);

  try {
    const body = await req.json();
    const groupId = String(body?.groupId || "").trim();
    const requestedIds = Array.isArray(body?.archiveEntryIds)
      ? [...new Set(body.archiveEntryIds.map((id: unknown) => String(id).trim()).filter(Boolean))]
      : [];
    if (!groupId) return respond({ error: "A group is required." }, 400);
    if (requestedIds.length > 50) return respond({ error: "Match at most 50 archive entries per request." }, 400);
    if (!(await requireAdmin(req, groupId, base, secretKey))) {
      return respond({ error: "Only a group administrator can match imported Journal history." }, 403);
    }

    const archivePath = new URLSearchParams({
      select: "id,title,release_year",
      group_id: `eq.${groupId}`,
      order: "entry_sort_number.desc",
    });
    if (requestedIds.length) archivePath.set("id", `in.(${requestedIds.join(",")})`);
    const entries = await restRows(base, `journal_archive_entries?${archivePath.toString()}`, secretKey);
    const allCandidates: Record<string, unknown>[] = [];
    let candidatesStored = 0;

    for (const entry of entries) {
      const candidates = await candidatesForEntry(entry, token);
      await restRows(
        base,
        `archive_history_match_candidates?archive_entry_id=eq.${encodeURIComponent(entry.id)}`,
        secretKey,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
      if (candidates.length) {
        const rows = candidates.map((candidate) => ({
          archive_entry_id: entry.id,
          tmdb_id: candidate.tmdbId,
          title: candidate.title,
          release_year: candidate.year,
          poster_path: candidate.posterPath,
          overview: candidate.overview,
          score: candidate.score,
          title_score: candidate.titleScore,
          year_delta: candidate.yearDelta,
          match_band: candidate.matchBand,
          candidate_rank: candidate.candidateRank,
          search_query: String(entry.title || "").slice(0, 200),
          source: "TMDB",
        }));
        const response = await fetch(`${base}/rest/v1/archive_history_match_candidates?on_conflict=archive_entry_id,tmdb_id`, {
          method: "POST",
          headers: {
            ...supabaseHeaders(secretKey, authorizationForSupabaseKey(secretKey)),
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(rows),
        });
        if (!response.ok) throw new Error(`Could not cache archive match candidates (${response.status}).`);
        candidatesStored += rows.length;
        allCandidates.push(...candidates.map((candidate) => ({
          archiveEntryId: entry.id,
          ...candidate,
        })));
      }
    }

    return respond({ entriesScanned: entries.length, candidatesStored, candidates: allCandidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Archive matching failed.";
    return respond({ error: message }, 502);
  }
});
