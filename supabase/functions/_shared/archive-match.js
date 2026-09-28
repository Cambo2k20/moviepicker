function cleanTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normaliseArchiveMatchTitle(value) {
  return cleanTitle(value).replaceAll(" ", "");
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(cleanTitle(left).split(" ").filter(Boolean));
  const rightTokens = new Set(cleanTitle(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function editSimilarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : 1 + Math.min(previous[column], previous[column - 1], diagonal);
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

export function titleMatchScore(archiveTitle, candidateTitle, candidateOriginalTitle = "") {
  const archiveKey = normaliseArchiveMatchTitle(archiveTitle);
  const titles = [candidateTitle, candidateOriginalTitle].filter(Boolean);
  if (!archiveKey || !titles.length) return 0;
  return Math.max(...titles.map((title) => {
    const candidateKey = normaliseArchiveMatchTitle(title);
    if (candidateKey === archiveKey) return 1;
    const compactEdit = editSimilarity(archiveKey, candidateKey);
    const tokens = tokenSimilarity(archiveTitle, title);
    return Math.max(compactEdit, tokens);
  }));
}

export function scoreArchiveMovieMatch({ archiveTitle, archiveYear, candidateTitle, candidateOriginalTitle, candidateYear }) {
  const titleScore = titleMatchScore(archiveTitle, candidateTitle, candidateOriginalTitle);
  const numericArchiveYear = Number(archiveYear);
  const numericCandidateYear = Number(candidateYear);
  const hasYears = Number.isInteger(numericArchiveYear) && Number.isInteger(numericCandidateYear);
  const yearDelta = hasYears ? Math.abs(numericArchiveYear - numericCandidateYear) : null;
  if (yearDelta !== null && yearDelta > 5) return null;

  const yearScore = yearDelta === null ? 0.45 : Math.max(0, 1 - (yearDelta / 5));
  const score = Number((titleScore * 0.78 + yearScore * 0.22).toFixed(4));
  return { score, titleScore: Number(titleScore.toFixed(4)), yearDelta };
}

export function classifyArchiveMatch({ score, titleScore, yearDelta, rank, margin }) {
  if (rank === 1 && score >= 0.84 && titleScore >= 0.88 && (yearDelta === null || yearDelta <= 2) && margin >= 0.12) return "STRONG";
  if (rank <= 3 && score >= 0.55) return margin < 0.1 ? "AMBIGUOUS" : "REVIEW";
  return "REVIEW";
}

export function rankArchiveMovieMatches({ archiveTitle, archiveYear, results, limit = 5 }) {
  const unique = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const tmdbId = Number(result?.id ?? result?.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || unique.has(tmdbId)) continue;
    const candidateYear = String(result?.release_date || result?.year || "").slice(0, 4);
    const score = scoreArchiveMovieMatch({
      archiveTitle,
      archiveYear,
      candidateTitle: result?.title || result?.name,
      candidateOriginalTitle: result?.original_title,
      candidateYear,
    });
    if (!score) continue;
    unique.set(tmdbId, {
      tmdbId,
      title: String(result?.title || result?.original_title || archiveTitle),
      year: /^\d{4}$/.test(candidateYear) ? Number(candidateYear) : null,
      posterPath: typeof result?.poster_path === "string" ? result.poster_path : null,
      overview: typeof result?.overview === "string" ? result.overview.slice(0, 4000) : "",
      ...score,
    });
  }

  const sorted = [...unique.values()].sort((left, right) => (
    right.score - left.score
    || right.titleScore - left.titleScore
    || (left.yearDelta ?? 99) - (right.yearDelta ?? 99)
    || left.tmdbId - right.tmdbId
  )).slice(0, limit);
  return sorted.map((candidate, index) => ({
    ...candidate,
    candidateRank: index + 1,
    matchBand: classifyArchiveMatch({
      ...candidate,
      rank: index + 1,
      margin: index === 0 ? (candidate.score - (sorted[1]?.score ?? 0)) : (sorted[index - 1]?.score - candidate.score),
    }),
  }));
}

export function archiveMatchQueries(title) {
  const raw = String(title || "").trim();
  const cleaned = cleanTitle(raw);
  const withoutAnnotation = raw
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+-\s+(?:short film|live)\s*$/i, "")
    .trim();
  return [...new Set([raw, withoutAnnotation, cleaned].filter(Boolean))].slice(0, 3);
}
