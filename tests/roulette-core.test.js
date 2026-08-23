import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRouletteWeights,
  createRouletteState,
  filterRouletteCandidates,
  pickRouletteLandingAngle,
  pickWeightedRouletteCandidate,
  restoreRouletteState,
  rouletteWaitingSince,
  serialiseRouletteState,
} from "../roulette-core.js";

const films = [
  { id: "old", runtime: 88, watched: false, genres: ["Drama"], createdAt: "2025-01-01T00:00:00Z" },
  { id: "new", runtime: 115, watched: false, genres: ["Comedy"], createdAt: "2026-01-01T00:00:00Z" },
  { id: "unknown", runtime: null, watched: false, genres: ["Drama"], createdAt: "2026-02-01T00:00:00Z" },
];

test("a maximum-runtime filter excludes films with unknown runtimes", () => {
  const state = createRouletteState([]);
  assert.equal(state.filters.runtime, "any");
  assert.deepEqual(filterRouletteCandidates(films, state).map(({ id }) => id), ["old", "new", "unknown"]);
  state.filters.runtime = "120";
  assert.deepEqual(filterRouletteCandidates(films, state).map(({ id }) => id), ["old", "new"]);
  state.filters.runtime = "any";
  assert.deepEqual(filterRouletteCandidates(films, state).map(({ id }) => id), ["old", "new", "unknown"]);
});

test("individual film exclusions filter the current pool and survive restore", () => {
  const state = createRouletteState([]);
  state.excludedFilmIds.push("new");
  assert.deepEqual(filterRouletteCandidates(films, state).map(({ id }) => id), ["old", "unknown"]);

  const restored = restoreRouletteState({
    status: "ACTIVE",
    gameState: serialiseRouletteState(state),
  });
  assert.deepEqual(restored.excludedFilmIds, ["new"]);
});

test("age weighting gives the oldest film four chances and the newest one", () => {
  const weights = calculateRouletteWeights(films, true);
  assert.equal(weights.get("old"), 4);
  assert.equal(weights.get("unknown"), 1);
  assert.equal(pickWeightedRouletteCandidate(films, weights, () => 0), films[0]);
  assert.equal(pickWeightedRouletteCandidate(films, weights, () => 0.999), films[2]);
});

test("rewatch weighting restarts from the most recent watched date", () => {
  const candidates = [
    { id: "rewatched", createdAt: "2020-01-01T00:00:00Z", lastWatchedOn: "2026-08-20" },
    { id: "waiting", createdAt: "2026-01-01T00:00:00Z", lastWatchedOn: null },
    { id: "recent", createdAt: "2026-08-01T00:00:00Z", lastWatchedOn: null },
  ];
  const weights = calculateRouletteWeights(candidates, true);

  assert.equal(rouletteWaitingSince(candidates[0]), "2026-08-20");
  assert.equal(weights.get("waiting"), 4);
  assert.equal(weights.get("recent"), 3);
  assert.equal(weights.get("rewatched"), 1);
});

test("roulette landing points stay inside the winner slice and away from its label", () => {
  const entry = { startAngle: -90, endAngle: -30 };
  const leftLanding = pickRouletteLandingAngle(entry, () => 0.25);
  const rightLanding = pickRouletteLandingAngle(entry, () => 0.75);
  const middleAngle = -60;

  assert.ok(leftLanding > entry.startAngle && leftLanding < middleAngle);
  assert.ok(rightLanding > middleAngle && rightLanding < entry.endAngle);
  assert.ok(Math.abs(leftLanding - middleAngle) >= 4.8);
  assert.ok(Math.abs(rightLanding - middleAngle) >= 4.8);

  const state = createRouletteState([]);
  state.winnerId = "old";
  state.landingAngle = rightLanding;
  const restored = restoreRouletteState({ status: "ACTIVE", gameState: serialiseRouletteState(state) });
  assert.equal(restored.landingAngle, rightLanding);
});

test("vetoes use participant ids so duplicate display names stay independent", () => {
  const state = createRouletteState([{ id: "one", name: "Alex" }, { id: "two", name: "Alex" }]);
  state.usedVetoes.push("one");
  const saved = serialiseRouletteState(state);
  const restored = restoreRouletteState({
    status: "ACTIVE",
    participants: state.participants,
    gameState: saved,
  });
  assert.deepEqual(restored.usedVetoes, ["one"]);
  assert.equal(restored.participants[1].id, "two");
});

test("legacy name vetoes restore once and interrupted spins resume at reveal", () => {
  const restored = restoreRouletteState({
    status: "ACTIVE",
    participants: [{ id: "one", name: "Alex" }, { id: "two", name: "Alex" }],
    gameState: { phase: "spinning", usedVetoes: ["Alex"] },
  });
  assert.equal(restored.phase, "reveal");
  assert.deepEqual(restored.usedVetoes, ["one"]);

  const settling = restoreRouletteState({
    status: "ACTIVE",
    gameState: { phase: "settling", winnerId: "old" },
  });
  assert.equal(settling.phase, "reveal");
});

test("legacy collapsible-pool state is ignored and no longer persisted", () => {
  const restored = restoreRouletteState({
    status: "ACTIVE",
    gameState: { poolOpen: false },
  });
  assert.equal("poolOpen" in restored, false);
  assert.equal("poolOpen" in serialiseRouletteState(restored), false);
});
