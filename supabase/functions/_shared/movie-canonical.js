function optionalText(value, maximum) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maximum) : null;
}

function tmdbReleaseDate(value) {
  const text = optionalText(value, 10);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function genreNames(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((genre) => optionalText(typeof genre === "string" ? genre : genre?.name, 60))
    .filter(Boolean))]
    .slice(0, 12);
}

export function canonicalMovieRecord(movie, refreshedAt = new Date().toISOString()) {
  const tmdbId = Number(movie?.id ?? movie?.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new Error("TMDB returned an invalid movie identifier.");

  const title = optionalText(movie?.title || movie?.original_title, 200);
  if (!title) throw new Error("TMDB returned a movie without a title.");

  const releaseDate = tmdbReleaseDate(movie?.release_date);
  const runtimeValue = Number(movie?.runtime);
  const runtime = Number.isInteger(runtimeValue) && runtimeValue >= 1 && runtimeValue <= 1440
    ? runtimeValue
    : null;
  const posterPath = optionalText(movie?.poster_path, 300);

  return {
    tmdb_id: tmdbId,
    title,
    original_title: optionalText(movie?.original_title, 200),
    release_date: releaseDate,
    release_year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    original_language: optionalText(movie?.original_language, 12),
    poster_path: posterPath?.startsWith("/") ? posterPath : null,
    runtime_minutes: runtime,
    genres: genreNames(movie?.genres),
    overview: optionalText(movie?.overview, 4000),
    metadata_updated_at: refreshedAt,
  };
}

export function browserMovieDetails(record, movieId) {
  return {
    movieId,
    tmdbId: record.tmdb_id,
    title: record.title,
    year: record.release_year,
    posterPath: record.poster_path,
    runtime: record.runtime_minutes,
    genres: record.genres,
    overview: record.overview || "",
  };
}
