import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPersonalFilmPatch,
  filmsShareIdentity,
  getVisiblePersonalFilms,
  getViewingEventsForMovie,
  normalisePersonalFilm,
  normalisePersonalViewingEvent,
  personalStateLabel,
  reactionForValue,
  viewingOutcomeLabel,
} from "../personal-films-core.js";

const movie = {
  movieId: "movie-pulp-fiction",
  tmdbId: 680,
  title: "Pulp Fiction",
  year: 1994,
  genres: ["Crime", "Drama"],
};

test("normalises a private row with its canonical movie metadata", () => {
  const film = normalisePersonalFilm({
    id: "personal-1",
    owner_id: "member-1",
    movie_id: "movie-1",
    state: "WATCHED",
    rating: 4,
    is_favourite: true,
    movies: {
      id: "movie-1",
      tmdb_id: 680,
      title: "Pulp Fiction",
      release_year: 1994,
      poster_path: "/poster.jpg",
      runtime_minutes: 154,
      genres: ["Crime", "Drama"],
      overview: "Four interwoven stories.",
    },
  });

  assert.equal(film.movieId, "movie-1");
  assert.equal(film.posterUrl, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(film.rating, 4);
  assert.equal(film.isFavourite, true);
});

test("rating marks a film watched unless Did Not Finish is explicit", () => {
  const watched = applyPersonalFilmPatch(null, movie, { rating: 5 }, { id: "personal-1", ownerId: "member-1", now: "2026-08-25T12:00:00Z" });
  assert.equal(watched.state, "WATCHED");
  assert.equal(watched.rating, 5);

  const dnf = applyPersonalFilmPatch({ ...watched, state: "DID_NOT_FINISH" }, movie, { rating: 2 });
  assert.equal(dnf.state, "DID_NOT_FINISH");
  assert.equal(dnf.rating, 2);
});

test("clearing a reaction preserves state and Favourite", () => {
  const existing = { ...movie, id: "personal-1", ownerId: "member-1", state: "WATCHED", rating: 4, isFavourite: true };
  const cleared = applyPersonalFilmPatch(existing, movie, { rating: null });
  assert.equal(cleared.state, "WATCHED");
  assert.equal(cleared.rating, null);
  assert.equal(cleared.isFavourite, true);
});

test("moving a rated film back to Want to Watch clears its reaction", () => {
  const existing = { ...movie, id: "personal-1", ownerId: "member-1", state: "WATCHED", rating: 4, isFavourite: true };
  const moved = applyPersonalFilmPatch(existing, movie, { state: "WANT_TO_WATCH" });
  assert.equal(moved.state, "WANT_TO_WATCH");
  assert.equal(moved.rating, null);
  assert.equal(moved.isFavourite, true);
});

test("identity uses verified ids and limits title fallback to unverified records", () => {
  assert.equal(filmsShareIdentity(movie, { movieId: movie.movieId, title: "Different" }), true);
  assert.equal(filmsShareIdentity({ tmdbId: 680 }, { tmdbId: "680" }), true);
  assert.equal(filmsShareIdentity({ title: "Pulp Fiction", year: 1994 }, { title: "pulp fiction", year: 1994 }), true);
  assert.equal(filmsShareIdentity(movie, { title: "Pulp Fiction", year: 1994 }), false);
  assert.equal(filmsShareIdentity({ tmdbId: 680, title: "Pulp Fiction", year: 1994 }, { tmdbId: 550, title: "Pulp Fiction", year: 1994 }), false);
});

test("private filters and reactions keep the approved wording", () => {
  const films = [
    { ...movie, id: "1", state: "WATCHED", rating: 4, isFavourite: true, createdAt: "2026-08-01", updatedAt: "2026-08-25" },
    { ...movie, id: "2", title: "Alien", year: 1979, genres: ["Horror"], state: "WANT_TO_WATCH", rating: null, isFavourite: false, createdAt: "2026-08-24", updatedAt: "2026-08-24" },
  ];
  assert.deepEqual(getVisiblePersonalFilms(films, { filter: "favourites" }).map(({ id }) => id), ["1"]);
  assert.deepEqual(getVisiblePersonalFilms(films, { query: "horror" }).map(({ id }) => id), ["2"]);
  assert.equal(personalStateLabel("DID_NOT_FINISH"), "Did Not Finish");
  assert.equal(reactionForValue(4).label, "Really liked it");
});

test("personal viewing events normalise and sort repeated history without mixing films", () => {
  const events = [
    normalisePersonalViewingEvent({
      id: "older",
      owner_id: "owner",
      movie_id: "movie-a",
      outcome: "DID_NOT_FINISH",
      watched_on: "2026-03-02",
      source_journal_entry_id: null,
      is_hidden: false,
      created_at: "2026-03-03T12:00:00Z",
    }),
    normalisePersonalViewingEvent({
      id: "newer",
      ownerId: "owner",
      movieId: "movie-a",
      outcome: "FINISHED",
      watchedOn: "2026-08-14",
      sourceJournalEntryId: "journal-entry",
      isHidden: true,
      createdAt: "2026-08-15T12:00:00Z",
    }),
    normalisePersonalViewingEvent({
      id: "other-film",
      owner_id: "owner",
      movie_id: "movie-b",
      outcome: "FINISHED",
      watched_on: "2026-09-01",
    }),
  ];

  assert.deepEqual(getViewingEventsForMovie(events, "movie-a").map(({ id }) => id), ["newer", "older"]);
  assert.equal(events[1].sourceJournalEntryId, "journal-entry");
  assert.equal(events[1].isHidden, true);
  assert.equal(viewingOutcomeLabel("DID_NOT_FINISH"), "Did Not Finish");
});
