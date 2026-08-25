import test from "node:test";
import assert from "node:assert/strict";

import {
  browserMovieDetails,
  canonicalMovieRecord,
} from "../supabase/functions/_shared/movie-canonical.js";

test("TMDB details become a bounded canonical database record", () => {
  const refreshedAt = "2026-08-24T22:30:00.000Z";
  const record = canonicalMovieRecord({
    id: 348,
    title: " Alien ",
    original_title: "Alien",
    release_date: "1979-05-25",
    original_language: "en",
    poster_path: "/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg",
    runtime: 117,
    genres: [{ id: 27, name: "Horror" }, { id: 878, name: "Science Fiction" }, { name: "Horror" }],
    overview: "The crew of the Nostromo encounters a deadly lifeform.",
  }, refreshedAt);

  assert.deepEqual(record, {
    tmdb_id: 348,
    title: "Alien",
    original_title: "Alien",
    release_date: "1979-05-25",
    release_year: 1979,
    original_language: "en",
    poster_path: "/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg",
    runtime_minutes: 117,
    genres: ["Horror", "Science Fiction"],
    overview: "The crew of the Nostromo encounters a deadly lifeform.",
    metadata_updated_at: refreshedAt,
  });
});

test("invalid optional TMDB fields are removed without inventing identity", () => {
  const record = canonicalMovieRecord({
    id: 603,
    original_title: "The Matrix",
    release_date: "not-a-date",
    poster_path: "https://untrusted.example/poster.jpg",
    runtime: 0,
    genres: null,
    overview: "",
  }, "2026-08-24T22:30:00.000Z");

  assert.equal(record.title, "The Matrix");
  assert.equal(record.release_date, null);
  assert.equal(record.release_year, null);
  assert.equal(record.poster_path, null);
  assert.equal(record.runtime_minutes, null);
  assert.deepEqual(record.genres, []);
  assert.equal(record.overview, null);
  assert.throws(() => canonicalMovieRecord({ id: 0, title: "Invalid" }), /invalid movie identifier/i);
  assert.throws(() => canonicalMovieRecord({ id: 1 }), /without a title/i);
});

test("the browser receives the canonical UUID but no server credential", () => {
  const record = canonicalMovieRecord({
    id: 603,
    title: "The Matrix",
    release_date: "1999-03-31",
    runtime: 136,
    genres: [{ name: "Action" }],
  }, "2026-08-24T22:30:00.000Z");
  const details = browserMovieDetails(record, "11111111-1111-4111-8111-111111111111");

  assert.deepEqual(details, {
    movieId: "11111111-1111-4111-8111-111111111111",
    tmdbId: 603,
    title: "The Matrix",
    year: 1999,
    posterPath: null,
    runtime: 136,
    genres: ["Action"],
    overview: "",
  });
  assert.equal("serviceKey" in details, false);
});
