import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveMatchQueries,
  normaliseArchiveMatchTitle,
  rankArchiveMovieMatches,
  scoreArchiveMovieMatch,
} from "../supabase/functions/_shared/archive-match.js";

test("normalises punctuation, accents and ampersands without losing title words", () => {
  assert.equal(normaliseArchiveMatchTitle("Amélie & Co."), "amelieandco");
  assert.deepEqual(archiveMatchQueries("Spider-Man: No Way Home"), ["Spider-Man: No Way Home", "spider man no way home"]);
  assert.deepEqual(archiveMatchQueries("Werewolf By Night (Spooktober X)"), [
    "Werewolf By Night (Spooktober X)", "Werewolf By Night", "werewolf by night spooktober x",
  ]);
  assert.deepEqual(archiveMatchQueries("The Goonies - Live"), ["The Goonies - Live", "The Goonies", "the goonies live"]);
});

test("compares title tokens against the spaced candidate title", () => {
  const match = scoreArchiveMovieMatch({
    archiveTitle: "Film Adventure Amazing",
    archiveYear: 2020,
    candidateTitle: "Amazing Film Adventure",
    candidateYear: 2020,
  });
  assert.equal(match.titleScore, 1);
});

test("allows a five-year release window but rejects a wider mismatch", () => {
  assert.equal(scoreArchiveMovieMatch({ archiveTitle: "The Matrix!", archiveYear: 2001, candidateTitle: "The Matrix", candidateYear: 1999 }).yearDelta, 2);
  assert.equal(scoreArchiveMovieMatch({ archiveTitle: "Alien", archiveYear: 1985, candidateTitle: "Alien", candidateYear: 1979 }), null);
});

test("ranks title and year candidates and marks a clear result strong", () => {
  const matches = rankArchiveMovieMatches({
    archiveTitle: "The Grand Adventur",
    archiveYear: 2012,
    results: [
      { id: 2, title: "The Grand Adventure", original_title: "The Grand Adventure", release_date: "2010-01-01" },
      { id: 3, title: "Grand Adventure", original_title: "Grand Adventure", release_date: "2014-01-01" },
    ],
  });
  assert.equal(matches[0].tmdbId, 2);
  assert.equal(matches[0].matchBand, "STRONG");
  assert.equal(matches[0].yearDelta, 2);
  assert.equal(matches[1].matchBand, "REVIEW");
});

test("marks close top candidates ambiguous instead of pretending certainty", () => {
  const matches = rankArchiveMovieMatches({
    archiveTitle: "Twin",
    archiveYear: 2000,
    results: [
      { id: 10, title: "Twin", release_date: "2000-01-01" },
      { id: 11, title: "Twin", release_date: "2000-06-01" },
    ],
  });
  assert.equal(matches[0].matchBand, "AMBIGUOUS");
  assert.equal(matches[1].matchBand, "AMBIGUOUS");
});
