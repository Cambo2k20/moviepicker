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

async function requireApprovedMember(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
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
      const movie = await tmdbRequest(`movie/${tmdbId}`, token, { language: "en-GB" });
      return respond({
        movie: {
          tmdbId: Number(movie.id),
          title: String(movie.title || movie.original_title || "Untitled"),
          year: releaseYear(movie.release_date),
          posterPath: typeof movie.poster_path === "string" ? movie.poster_path : null,
          runtime: Number(movie.runtime) || null,
          genres: (Array.isArray(movie.genres) ? movie.genres : []).map((genre: Record<string, unknown>) => String(genre.name || "")).filter(Boolean).slice(0, 12),
          overview: typeof movie.overview === "string" ? movie.overview.slice(0, 4000) : "",
        },
      });
    }

    return respond({ error: "Unknown lookup action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Movie lookup failed.";
    return respond({ error: message }, 502);
  }
});
