import { browserMovieDetails, canonicalMovieRecord } from "../_shared/movie-canonical.js";

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

function releaseYear(value: unknown) {
  const year = String(value || "").slice(0, 4);
  return /^\d{4}$/.test(year) ? Number(year) : null;
}

function environmentKey(name: string, legacyName?: string) {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  return legacyName ? Deno.env.get(legacyName) || null : null;
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

function authorizationForSupabaseKey(key: string) {
  return key.startsWith("sb_secret_") || key.startsWith("sb_publishable_")
    ? null
    : `Bearer ${key}`;
}

function supabaseHeaders(key: string, authorization: string | null, extra: Record<string, string> = {}) {
  return { apikey: key, ...(authorization ? { Authorization: authorization } : {}), ...extra };
}

async function requireApprovedMember(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = namedEnvironmentKey("SUPABASE_PUBLISHABLE_KEYS")
    || environmentKey("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !authorization) return { ok: false, status: 401 };

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) return { ok: false, status: 401 };
  const user = await userResponse.json();
  if (!user?.id) return { ok: false, status: 401 };

  const membershipResponse = await fetch(
    `${supabaseUrl}/rest/v1/group_memberships?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    { headers: { apikey: anonKey, Authorization: authorization } },
  );
  if (!membershipResponse.ok) return { ok: false, status: 403 };
  const memberships = await membershipResponse.json();
  return { ok: Array.isArray(memberships) && memberships.length > 0, status: 403 };
}

async function upsertCanonicalMovie(base: string, key: string, movie: Record<string, unknown>) {
  const record = canonicalMovieRecord(movie);
  const response = await fetch(`${base}/rest/v1/movies?on_conflict=tmdb_id&select=id`, {
    method: "POST",
    headers: supabaseHeaders(key, authorizationForSupabaseKey(key), {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(record),
  });
  const rows = await response.json().catch(() => null);
  const movieId = Array.isArray(rows) ? rows[0]?.id : null;
  if (!response.ok || typeof movieId !== "string") {
    throw new Error(`Canonical movie write failed (${response.status}).`);
  }
  return { movieId, record };
}

async function tmdbRequest(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    throw new Error(`TMDB request failed (${response.status})${requestId ? ` · ${requestId}` : ""}`);
  }

  return await response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const access = await requireApprovedMember(req);
  if (!access.ok) return respond({ error: access.status === 401 ? "Sign in to search for movies." : "Approved Cine-Cord membership is required." }, access.status);

  const token = Deno.env.get("TMDB_READ_ACCESS_TOKEN");
  if (!token) return respond({ error: "TMDB lookup is not configured yet." }, 503);

  try {
    const body = await req.json();

    if (body?.action === "search") {
      const query = String(body.query || "").trim();
      const year = body.year === null || body.year === undefined || body.year === "" ? null : Number(body.year);
      if (!query || query.length > 200) return respond({ error: "Enter a movie title up to 200 characters." }, 400);
      if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2200)) return respond({ error: "Enter a valid release year." }, 400);

      const params: Record<string, string> = {
        query,
        include_adult: "false",
        language: "en-GB",
        page: "1",
      };
      if (year !== null) params.primary_release_year = String(year);
      const data = await tmdbRequest("search/movie", token, params);
      const matches = (Array.isArray(data.results) ? data.results : []).slice(0, 6).map((movie: Record<string, unknown>) => ({
        tmdbId: Number(movie.id),
        title: String(movie.title || movie.original_title || query),
        year: releaseYear(movie.release_date),
        posterPath: typeof movie.poster_path === "string" ? movie.poster_path : null,
        overview: typeof movie.overview === "string" ? movie.overview.slice(0, 4000) : "",
      }));
      return respond({ matches });
    }

    if (body?.action === "details") {
      const tmdbId = Number(body.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) return respond({ error: "Choose a valid TMDB movie." }, 400);
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = namedEnvironmentKey("SUPABASE_SECRET_KEYS")
        || environmentKey("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) return respond({ error: "The canonical movie catalogue is not configured yet." }, 503);
      const movie = await tmdbRequest(`movie/${tmdbId}`, token, { language: "en-GB" });
      const canonical = await upsertCanonicalMovie(supabaseUrl, serviceKey, movie);
      return respond({ movie: browserMovieDetails(canonical.record, canonical.movieId) });
    }

    return respond({ error: "Unknown lookup action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Movie lookup failed.";
    return respond({ error: message }, 502);
  }
});
