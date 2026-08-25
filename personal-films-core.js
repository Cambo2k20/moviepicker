export const PERSONAL_FILM_STATES = [
  { value: "WANT_TO_WATCH", label: "Want to Watch" },
  { value: "WATCHED", label: "Watched" },
  { value: "DID_NOT_FINISH", label: "Did Not Finish" },
];

export const REACTION_LEVELS = [
  { value: 1, label: "Didn’t like it" },
  { value: 2, label: "Not for me" },
  { value: 3, label: "It was okay" },
  { value: 4, label: "Really liked it" },
  { value: 5, label: "Loved it" },
];

function movieRecord(row) {
  if (!row?.movies) return row?.movie || {};
  return Array.isArray(row.movies) ? row.movies[0] || {} : row.movies;
}

function posterUrl(path) {
  if (!path) return null;
  return path.startsWith("http") ? path : `https://image.tmdb.org/t/p/w500${path}`;
}

export function normalisePersonalFilm(row) {
  const movie = movieRecord(row);
  return {
    id: row.id,
    ownerId: row.owner_id || row.ownerId || null,
    movieId: row.movie_id || row.movieId || movie.id || null,
    state: row.state || null,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    isFavourite: Boolean(row.is_favourite ?? row.isFavourite),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    title: movie.title || row.title || "Untitled film",
    year: movie.release_year ?? row.year ?? null,
    tmdbId: movie.tmdb_id ?? row.tmdbId ?? null,
    posterPath: movie.poster_path ?? row.posterPath ?? null,
    posterUrl: posterUrl(movie.poster_path ?? row.posterPath ?? row.posterUrl ?? null),
    runtime: Number(movie.runtime_minutes ?? row.runtime) || null,
    genres: Array.isArray(movie.genres ?? row.genres) ? movie.genres ?? row.genres : [],
    overview: movie.overview ?? row.overview ?? "",
    metadataUpdatedAt: movie.metadata_updated_at ?? row.metadataUpdatedAt ?? null,
  };
}

export function filmsShareIdentity(left, right) {
  if (!left || !right) return false;
  if (left.movieId && right.movieId) return left.movieId === right.movieId;
  if (left.tmdbId && right.tmdbId) return Number(left.tmdbId) === Number(right.tmdbId);

  // A title and year can help a person confirm a match, but they are not a
  // safe automatic bridge to a record that already carries canonical identity.
  // This keeps manual queue/history snapshots visibly separate until verified.
  if (left.movieId || right.movieId || left.tmdbId || right.tmdbId) return false;

  return String(left.title || "").trim().toLocaleLowerCase() === String(right.title || "").trim().toLocaleLowerCase()
    && Number(left.year || 0) === Number(right.year || 0);
}

export function findFilmByIdentity(collection, film) {
  return collection.find((candidate) => filmsShareIdentity(candidate, film)) || null;
}

export function reactionForValue(value) {
  return REACTION_LEVELS.find((reaction) => reaction.value === Number(value)) || null;
}

export function personalStateLabel(state) {
  return PERSONAL_FILM_STATES.find((candidate) => candidate.value === state)?.label || "In My Cinema";
}

export function applyPersonalFilmPatch(existing, movie, patch, { id, ownerId, now = new Date().toISOString() } = {}) {
  const base = existing || {
    id,
    ownerId,
    movieId: movie.movieId,
    state: null,
    rating: null,
    isFavourite: false,
    createdAt: now,
    ...movie,
  };
  const next = { ...base, ...patch, updatedAt: now };

  if (Object.hasOwn(patch, "state") && (patch.state === "WANT_TO_WATCH" || patch.state === null)) {
    next.rating = null;
  }
  if (Object.hasOwn(patch, "rating") && patch.rating !== null) {
    next.rating = Number(patch.rating);
    if (next.state !== "DID_NOT_FINISH") next.state = "WATCHED";
  }
  return next;
}

export function getVisiblePersonalFilms(personalFilms, { query = "", filter = "all", sort = "updated" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return personalFilms.filter((film) => {
    const matchesQuery = !needle || [film.title, film.year, ...film.genres].join(" ").toLocaleLowerCase().includes(needle);
    const matchesFilter = filter === "all"
      || (filter === "want" && film.state === "WANT_TO_WATCH")
      || (filter === "watched" && film.state === "WATCHED")
      || (filter === "dnf" && film.state === "DID_NOT_FINISH")
      || (filter === "favourites" && film.isFavourite);
    return matchesQuery && matchesFilter;
  }).sort((left, right) => {
    if (sort === "title") return left.title.localeCompare(right.title);
    if (sort === "added") return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    return new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
  });
}
