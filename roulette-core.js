const DEFAULT_FILTERS = Object.freeze({
  runtime: "any",
  genre: "all",
  includeWatched: false,
  weightedByAge: true,
});

function normaliseParticipant(participant, index) {
  const name = String(typeof participant === "string" ? participant : participant?.name || "Discordian").trim() || "Discordian";
  const suppliedId = typeof participant === "object" && participant ? participant.id : null;
  return {
    id: suppliedId ? String(suppliedId) : `legacy:${index}:${name}`,
    name,
  };
}

export function rouletteParticipants(session = {}) {
  if (Array.isArray(session.participants) && session.participants.length) {
    return session.participants.map(normaliseParticipant);
  }

  const names = Array.isArray(session.members) ? session.members : [];
  const ids = Array.isArray(session.participantIds) ? session.participantIds : [];
  return names.map((name, index) => normaliseParticipant({ id: ids[index], name }, index));
}

export function createRouletteState(participants = []) {
  return {
    phase: "ready",
    participants: participants.map(normaliseParticipant),
    usedVetoes: [],
    vetoedFilmIds: [],
    excludedFilmIds: [],
    winnerId: null,
    poolOpen: false,
    previewIds: [],
    overviewOpen: false,
    rerollConfirmOpen: false,
    filters: { ...DEFAULT_FILTERS },
  };
}

export function serialiseRouletteState(state) {
  if (!state) return {};
  return {
    version: 3,
    phase: state.phase,
    usedVetoes: [...state.usedVetoes],
    vetoedFilmIds: [...state.vetoedFilmIds],
    excludedFilmIds: [...state.excludedFilmIds],
    winnerId: state.winnerId,
    poolOpen: Boolean(state.poolOpen),
    previewIds: [...state.previewIds],
    overviewOpen: Boolean(state.overviewOpen),
    rerollConfirmOpen: false,
    filters: { ...state.filters },
  };
}

export function restoreRouletteState(session) {
  const participants = rouletteParticipants(session);
  const restored = createRouletteState(participants);
  const saved = session?.gameState && typeof session.gameState === "object" ? session.gameState : {};
  const validPhases = new Set(["ready", "spinning", "settling", "reveal", "confirmed"]);
  const savedPhase = validPhases.has(saved.phase) ? saved.phase : null;
  restored.phase = ["spinning", "settling"].includes(savedPhase)
    ? "reveal"
    : (savedPhase || (session?.status === "CONFIRMED" ? "confirmed" : "ready"));

  const participantIds = new Set(participants.map(({ id }) => id));
  const usedIds = new Set();
  for (const savedVeto of Array.isArray(saved.usedVetoes) ? saved.usedVetoes : []) {
    const value = String(savedVeto);
    if (participantIds.has(value)) {
      usedIds.add(value);
      continue;
    }
    const legacyMatch = participants.find(({ id, name }) => name === value && !usedIds.has(id));
    if (legacyMatch) usedIds.add(legacyMatch.id);
  }
  restored.usedVetoes = [...usedIds];
  restored.vetoedFilmIds = Array.isArray(saved.vetoedFilmIds) ? saved.vetoedFilmIds.map(String) : [];
  restored.excludedFilmIds = Array.isArray(saved.excludedFilmIds) ? saved.excludedFilmIds.map(String) : [];
  restored.winnerId = session?.selectedFilmId || saved.winnerId || null;
  restored.poolOpen = Boolean(saved.poolOpen);
  restored.previewIds = Array.isArray(saved.previewIds) ? saved.previewIds.map(String) : [];
  restored.overviewOpen = Boolean(saved.overviewOpen);
  restored.filters = {
    ...restored.filters,
    ...(saved.filters && typeof saved.filters === "object" ? saved.filters : {}),
  };
  if (session?.status === "CONFIRMED") restored.phase = "confirmed";
  return restored;
}

export function filterRouletteCandidates(movieList, state) {
  if (!state) return [];
  const runtimeLimit = Number(state.filters.runtime) || null;
  return movieList.filter((item) => {
    if (state.vetoedFilmIds.includes(item.id)) return false;
    if (state.excludedFilmIds.includes(item.id)) return false;
    if (!state.filters.includeWatched && item.watched) return false;
    if (runtimeLimit && (!Number.isFinite(item.runtime) || item.runtime > runtimeLimit)) return false;
    if (state.filters.genre !== "all" && !item.genres.some((genre) => genre.toLowerCase() === state.filters.genre)) return false;
    return true;
  });
}

export function calculateRouletteWeights(candidates, weightedByAge = true) {
  const byAge = [...candidates].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const denominator = Math.max(1, byAge.length - 1);
  return new Map(byAge.map((item, index) => {
    const weight = weightedByAge && byAge.length > 1
      ? 4 - Math.floor((index / denominator) * 3)
      : 1;
    return [item.id, Math.max(1, weight)];
  }));
}

export function pickWeightedRouletteCandidate(candidates, weights, random = Math.random) {
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, item) => sum + (weights.get(item.id) || 1), 0);
  let draw = random() * total;
  for (const item of candidates) {
    draw -= weights.get(item.id) || 1;
    if (draw <= 0) return item;
  }
  return candidates.at(-1);
}
