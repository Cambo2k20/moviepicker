import { createClient } from "@supabase/supabase-js";
import {
  calculateRouletteWeights,
  createRouletteState,
  filterRouletteCandidates,
  pickRouletteLandingAngle,
  pickWeightedRouletteCandidate,
  restoreRouletteState,
  serialiseRouletteState as serialiseRouletteStateValue,
} from "./roulette-core.js";
import {
  buildAuthRedirectUrl,
  discordProviderEnabled,
  oauthCallbackError,
  preferredAuthDisplayName,
  withoutOAuthError,
} from "./auth-core.js";

const SUPABASE_URL = "https://tbmxxdodprmynyiiaofj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D-ZMbt0ttcYPHEDtghl7AQ_wstwsoti";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const designPreviewMode = ["terminal.local", "localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has("design-preview");
const discordAuthPreviewMode = ["terminal.local", "localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has("discord-auth-preview");

const imageAssets = {
  cameron: new URL("./assets/avatar-cameron.png", import.meta.url).href,
  dean: new URL("./assets/avatar-dean.png", import.meta.url).href,
  kieran: new URL("./assets/avatar-kieran.png", import.meta.url).href,
  andrew: new URL("./assets/avatar-andrew.png", import.meta.url).href,
  ross: new URL("./assets/avatar-ross.png", import.meta.url).href,
  journalFallback: new URL("./assets/hero-journal-web.png", import.meta.url).href,
};
const knownAvatars = {
  cameron: imageAssets.cameron,
  dean: imageAssets.dean,
  kieran: imageAssets.kieran,
  andrew: imageAssets.andrew,
  ross: imageAssets.ross,
};

const decisionModes = [
  { code: "01", title: "Consensus Sprint", tone: "Coming soon", copy: "Private yes, maybe or no voting is designed but is not implemented yet.", available: false },
  { code: "02", title: "Queue Roulette", tone: "Weighted chaos", copy: "Older list entries receive more weight. Each participant has one optional veto.", available: true },
  { code: "03", title: "Reel Bracket", tone: "Coming soon", copy: "Head-to-head voting is designed but is not implemented yet.", available: false }
];

const root = document.querySelector("#view-root");
const partyModal = document.querySelector("#party-modal");
const filmModal = document.querySelector("#film-modal");
const partyMembers = document.querySelector("#party-members");
const partyForm = document.querySelector("#party-form");
const filmForm = document.querySelector("#film-form");
const filmFormTitle = document.querySelector("#film-form-title");
const filmFormIntro = document.querySelector("#film-form-intro");
const filmSearchStatus = document.querySelector("#film-search-status");
const filmMatchResults = document.querySelector("#film-match-results");
const filmManualAdd = document.querySelector("#film-manual-add");
const toast = document.querySelector("#toast");
const sessionPanel = document.querySelector("#session-panel");
const sessionName = document.querySelector("#session-name");

const legacyViewMap = { home: "list", queue: "list", journal: "list", tonight: "pick", wrapped: "stats" };
const initialHash = window.location.hash.replace("#", "");

let currentView = legacyViewMap[initialHash] || initialHash || "list";
let authUser = null;
let currentProfile = null;
let availableGroup = null;
let activeGroup = null;
let members = [];
let accessRequest = null;
let joinRequests = [];
let movieList = [];
let activeSession = null;
let sessionHistory = [];
let discordDraft = null;
let journalDetailsOpen = false;
let listQuery = "";
let listFilter = "all";
let listSort = "votes";
let genreFilter = "all";
let memberFilter = "all";
let listFiltersOpen = false;
let selectedFilmId = null;
const shortlistedFilmIds = new Set();
let rouletteState = null;
let rouletteSpinTimer = null;
let rouletteSpinToken = 0;
let filmEditingId = null;
let pendingFilmDraft = null;
let authMode = "signin";
let discordAuthEnabled = false;
let isLoading = true;
let toastTimer;

const DISCORD_ENTRY_DIVIDER = "————————————————————————————————————————————————————————————————————————————————————";
const ROULETTE_SPIN_DURATION_MS = 4200;
const ROULETTE_SETTLE_DURATION_MS = 2600;
const ROULETTE_REDUCED_SPIN_DURATION_MS = 80;
const ROULETTE_REDUCED_SETTLE_DURATION_MS = 1400;

function loadDesignPreviewWorkspace() {
  authUser = { id: "preview-cameron", email: "preview@cine-cord.local" };
  currentProfile = { id: "preview-cameron", displayName: "Cameron", role: "admin" };
  activeGroup = { id: "preview-group", name: "The Discordians", slug: "discordians" };
  members = [
    { id: "preview-cameron", name: "Cameron", role: "admin", avatar: knownAvatars.cameron },
    { id: "preview-dean", name: "Dean", role: "member", avatar: knownAvatars.dean },
    { id: "preview-kieran", name: "Kieran", role: "member", avatar: knownAvatars.kieran },
    { id: "preview-andrew", name: "Andrew", role: "member", avatar: knownAvatars.andrew },
    { id: "preview-ross", name: "Ross", role: "member", avatar: knownAvatars.ross },
  ];
  movieList = [
    { id: "preview-alien", title: "Alien", year: 1979, posterUrl: "https://image.tmdb.org/t/p/w500/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg", runtime: 117, genres: ["Horror", "Science Fiction"], overview: "During its return to Earth, the crew of the commercial spacecraft Nostromo encounters a deadly lifeform.", createdAt: "2025-11-02T20:00:00Z", suggestedBy: "Dean", suggestedById: "preview-dean", votes: 3, votedByMe: false, watched: false, tmdbId: 348 },
    { id: "preview-matrix", title: "The Matrix", year: 1999, posterUrl: "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", runtime: 136, genres: ["Action", "Science Fiction"], overview: "A computer hacker discovers that the world he knows is a simulated reality and joins a rebellion to break free.", createdAt: "2026-01-14T20:00:00Z", suggestedBy: "Cameron", suggestedById: "preview-cameron", votes: 2, votedByMe: true, watched: false, tmdbId: 603 },
    { id: "preview-home-alone", title: "Home Alone", year: 1990, posterUrl: "https://image.tmdb.org/t/p/w500/onTSipZ8R3bliBdKfPtsDuHTdlL.jpg", runtime: 103, genres: ["Comedy", "Family"], overview: "An eight-year-old is accidentally left home alone and must defend the house from two determined burglars.", createdAt: "2026-03-18T20:00:00Z", suggestedBy: "Kieran", suggestedById: "preview-kieran", votes: 1, votedByMe: false, watched: false, tmdbId: 771 },
    { id: "preview-interstellar", title: "Interstellar", year: 2014, posterUrl: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", runtime: 169, genres: ["Adventure", "Drama", "Science Fiction"], overview: "Explorers travel through a wormhole in space in an attempt to ensure humanity's survival.", createdAt: "2026-05-10T20:00:00Z", suggestedBy: "Andrew", suggestedById: "preview-andrew", votes: 4, votedByMe: false, watched: false, tmdbId: 157336 },
    { id: "preview-fight-club", title: "Fight Club", year: 1999, posterUrl: "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", runtime: 139, genres: ["Drama"], overview: "A disillusioned office worker and a soap maker form an underground club that evolves into something far larger.", createdAt: "2026-06-07T20:00:00Z", suggestedBy: "Ross", suggestedById: "preview-ross", votes: 2, votedByMe: false, watched: false, tmdbId: 550 },
    { id: "preview-spirited-away", title: "Spirited Away", year: 2001, posterUrl: "https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg", runtime: 125, genres: ["Animation", "Family", "Fantasy"], overview: "A young girl enters a world ruled by gods, witches and spirits where humans are changed into beasts.", createdAt: "2026-07-01T20:00:00Z", suggestedBy: "Dean", suggestedById: "preview-dean", votes: 1, votedByMe: false, watched: false, tmdbId: 129 },
    { id: "preview-inception", title: "Inception", year: 2010, posterUrl: "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg", runtime: 148, genres: ["Action", "Science Fiction", "Thriller"], overview: "A skilled extractor is offered a chance to erase his past crimes by planting an idea in another person's mind.", createdAt: "2026-07-24T20:00:00Z", suggestedBy: "Cameron", suggestedById: "preview-cameron", votes: 3, votedByMe: false, watched: false, tmdbId: 27205 },
    { id: "preview-martian", title: "The Martian", year: 2015, posterUrl: "https://image.tmdb.org/t/p/w500/5BHuvQ6p9kfc091Z8RiFNhCwL4b.jpg", runtime: 144, genres: ["Adventure", "Drama", "Science Fiction"], overview: "An astronaut stranded on Mars must rely on ingenuity and determination while Earth works to bring him home.", createdAt: "2026-08-20T20:00:00Z", suggestedBy: "Kieran", suggestedById: "preview-kieran", votes: 1, votedByMe: false, watched: false, tmdbId: 286217 },
  ];
  isLoading = false;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function avatarForName(name) {
  return knownAvatars[String(name).trim().toLowerCase()] || imageAssets.cameron;
}

function isCurrentAdmin() {
  return currentProfile?.role === "admin";
}

function canManageFilm(item) {
  return isCurrentAdmin() || item.suggestedById === authUser?.id;
}

function canManageSession(session = activeSession) {
  return Boolean(session && (isCurrentAdmin() || session.createdById === authUser?.id));
}

function formatRequestDate(value) {
  if (!value) return "Date unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatWaitingTime(value) {
  if (!value) return "Recently added";
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return "Added today";
  if (days === 1) return "1 day waiting";
  if (days < 30) return `${days} days waiting`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} waiting`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "year" : "years"} waiting`;
}

function formatAddedDate(value) {
  if (!value) return "Date unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function normaliseGenres(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") return value.split(",").map((genre) => genre.trim()).filter(Boolean);
  return [];
}

function filmPoster(item) {
  if (item.posterUrl) return item.posterUrl;
  return imageAssets.journalFallback;
}

function tmdbPoster(path, size = "w500") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : imageAssets.journalFallback;
}

function runtimeLabel(item) {
  return item.runtime ? `${item.runtime} min` : "Runtime pending";
}

function metadataLine(item) {
  const parts = [];
  if (item.runtime) parts.push(`${item.runtime} min`);
  if (item.genres.length) parts.push(item.genres.slice(0, 2).join(" · "));
  return parts.join(" · ") || "Movie details pending";
}

function serialiseRouletteState() {
  return serialiseRouletteStateValue(rouletteState);
}

function selectedFilmForSession(session) {
  if (!session) return null;
  return movieList.find((item) => item.id === session.selectedFilmId) || session.selectedFilm || null;
}

function createDiscordDraft(session, film) {
  return {
    sessionId: session.id,
    entryNumber: "",
    title: film?.title || "",
    year: film?.year || "",
    viewers: session.members.join(", "),
    status: "Finished",
    comment: "",
  };
}

function ensureDiscordDraft(session, film) {
  if (!discordDraft || discordDraft.sessionId !== session.id) discordDraft = createDiscordDraft(session, film);
  return discordDraft;
}

function buildDiscordTemplate(draft) {
  const lines = [
    `- Entry #${String(draft.entryNumber || "").trim()}`,
    `- ${String(draft.title || "").trim()}`,
    `- ${String(draft.year || "").trim()}`,
    `- Viewers: ${String(draft.viewers || "").trim()}`,
    `- Status: ${draft.status === "DNF" ? "DNF" : "Finished"}`,
  ];
  const comment = String(draft.comment || "").trim();
  if (comment) lines.push(`- ${comment}`);
  lines.push(DISCORD_ENTRY_DIVIDER);
  return lines.join("\n");
}

function journalDetailsNeedAttention(draft) {
  const year = Number(draft.year);
  return !String(draft.title).trim()
    || !String(draft.viewers).trim()
    || !Number.isInteger(year)
    || year < 1888
    || year > 2200;
}

function renderDiscordTemplate(session, film) {
  const draft = ensureDiscordDraft(session, film);
  // The drawer opens on request, and on its own when a session-filled value is
  // missing, so "collapsed" never hides a problem.
  const detailsOpen = journalDetailsOpen || journalDetailsNeedAttention(draft);
  return `
    <section class="discord-copy-card" aria-labelledby="discord-copy-title">
      <div class="discord-copy-heading">
        <div><span class="eyebrow">Optional Discord handoff</span><h3 id="discord-copy-title">Prepare the Journal post</h3><p>Check the post below, then copy it into Discord yourself.</p></div>
        <span class="copy-only-badge"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>Copy only</span>
      </div>
      <form id="discord-template-form" class="discord-template-form">
        <div class="discord-post-row">
          <label class="discord-preview-field"><span>Discord preview</span><textarea id="discord-template-preview" readonly rows="8">${escapeHTML(buildDiscordTemplate(draft))}</textarea></label>
          <div class="discord-author-fields">
            <label class="discord-entry-field"><span>Entry number</span><input name="entry_number" type="number" min="1" step="1" required value="${escapeHTML(draft.entryNumber)}" placeholder="307" /></label>
            <label class="discord-comment-field"><span>Comment <small>Optional</small></span><textarea name="comment" maxlength="2000" rows="3" placeholder="Add the Journal comment…">${escapeHTML(draft.comment)}</textarea></label>
          </div>
        </div>
        <details class="discord-entry-details" ${detailsOpen ? "open" : ""}>
          <summary data-toggle-journal-details>
            <span class="discord-summary-label"><span class="material-symbols-outlined" aria-hidden="true">tune</span>Edit entry details</span>
            <span class="discord-summary-hint">Title, year, viewers and status — filled in from this session.</span>
            <span class="discord-summary-chevron material-symbols-outlined" aria-hidden="true">expand_more</span>
          </summary>
          <div class="discord-entry-fields">
            <label class="discord-title-field"><span>Title</span><input name="title" required maxlength="200" value="${escapeHTML(draft.title)}" /></label>
            <label class="discord-year-field"><span>Year</span><input name="year" type="number" min="1888" max="2200" required value="${escapeHTML(draft.year)}" /></label>
            <label class="discord-viewers-field"><span>Viewers</span><input name="viewers" required maxlength="500" value="${escapeHTML(draft.viewers)}" /></label>
            <label class="discord-status-field"><span>Status</span><select name="status"><option value="Finished" ${draft.status === "Finished" ? "selected" : ""}>Finished</option><option value="DNF" ${draft.status === "DNF" ? "selected" : ""}>DNF</option></select></label>
          </div>
        </details>
        <div class="discord-copy-actions"><button class="primary-button" type="submit"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>Copy for Discord</button><small>Nothing is posted automatically.</small></div>
      </form>
    </section>`;
}

function updateDiscordDraftPreview(form) {
  if (!form || !activeSession) return;
  const values = new FormData(form);
  discordDraft = {
    sessionId: activeSession.id,
    entryNumber: String(values.get("entry_number") || ""),
    title: String(values.get("title") || ""),
    year: String(values.get("year") || ""),
    viewers: String(values.get("viewers") || ""),
    status: String(values.get("status")) === "DNF" ? "DNF" : "Finished",
    comment: String(values.get("comment") || ""),
  };
  form.querySelector("#discord-template-preview").value = buildDiscordTemplate(discordDraft);
}

function getRouletteCandidates() {
  return filterRouletteCandidates(movieList, rouletteState);
}

function rouletteWeights(candidates) {
  return calculateRouletteWeights(candidates, rouletteState?.filters.weightedByAge);
}

function rouletteWaitLabel(item) {
  const createdAt = new Date(item.createdAt);
  if (Number.isNaN(createdAt.getTime())) return "Waiting time unknown";
  const days = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
  if (days < 2) return "Added today";
  if (days < 30) return `${days} days waiting`;
  const months = Math.max(1, Math.floor(days / 30.44));
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} waiting`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths
    ? `${years}y ${remainingMonths}m waiting`
    : `${years} ${years === 1 ? "year" : "years"} waiting`;
}

function rouletteWedgePolygon(startAngle, endAngle) {
  const points = ["50% 50%"];
  const span = Math.max(0.01, endAngle - startAngle);
  const steps = Math.max(2, Math.ceil(span / 8));
  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (span * index) / steps;
    const radians = (angle * Math.PI) / 180;
    const x = 50 + Math.cos(radians) * 50;
    const y = 50 + Math.sin(radians) * 50;
    points.push(`${x.toFixed(3)}% ${y.toFixed(3)}%`);
  }
  return `polygon(${points.join(",")})`;
}

function rouletteWheelEntries(candidates) {
  const weights = rouletteWeights(candidates);
  const ordered = [...candidates].sort((a, b) => {
    const dateDifference = new Date(a.createdAt) - new Date(b.createdAt);
    return dateDifference || a.title.localeCompare(b.title);
  });
  const totalChances = ordered.reduce((sum, item) => sum + (weights.get(item.id) || 1), 0);
  let usedChances = 0;
  const entries = ordered.map((item, index) => {
    const weight = weights.get(item.id) || 1;
    const startAngle = -90 + (usedChances / totalChances) * 360;
    usedChances += weight;
    const endAngle = -90 + (usedChances / totalChances) * 360;
    const middleAngle = startAngle + (endAngle - startAngle) / 2;
    const radians = (middleAngle * Math.PI) / 180;
    return {
      item,
      index,
      weight,
      percentage: Math.round((weight / totalChances) * 100),
      startAngle,
      endAngle,
      middleAngle,
      labelX: 50 + Math.cos(radians) * 36,
      labelY: 50 + Math.sin(radians) * 36,
      polygon: rouletteWedgePolygon(startAngle, endAngle),
    };
  });
  return { entries, totalChances };
}

function weightedRoulettePick(candidates) {
  return pickWeightedRouletteCandidate(candidates, rouletteWeights(candidates));
}

function roulettePreviewFilms(candidates, winner = null) {
  if (!candidates.length) return [];
  const ordered = winner
    ? [winner, ...candidates.filter((item) => item.id !== winner.id)]
    : [...candidates].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return Array.from({ length: 8 }, (_, index) => ordered[index % ordered.length]);
}

function rouletteFilterLabels() {
  if (!rouletteState) return [];
  const runtime = rouletteState.filters.runtime === "any" ? "Any runtime" : `Under ${rouletteState.filters.runtime} min`;
  const genre = rouletteState.filters.genre === "all"
    ? "Any genre"
    : `${rouletteState.filters.genre[0].toUpperCase()}${rouletteState.filters.genre.slice(1)}`;
  const status = rouletteState.filters.includeWatched ? "Rewatches allowed" : "Ready only";
  return [runtime, genre, status];
}

function rouletteHasActiveFilters() {
  if (!rouletteState) return false;
  return rouletteState.filters.runtime !== "any"
    || rouletteState.filters.genre !== "all"
    || rouletteState.filters.includeWatched
    || rouletteState.excludedFilmIds.length > 0;
}

function resetRouletteOutcome() {
  if (!rouletteState) return;
  rouletteState.phase = "ready";
  rouletteState.winnerId = null;
  rouletteState.landingAngle = null;
  rouletteState.previewIds = [];
  rouletteState.overviewOpen = false;
  rouletteState.rerollConfirmOpen = false;
}

function setFilmSearchStatus(message = "", tone = "neutral") {
  filmSearchStatus.textContent = message;
  filmSearchStatus.dataset.tone = tone;
  filmSearchStatus.hidden = !message;
}

function clearFilmMatches() {
  filmMatchResults.innerHTML = "";
  filmMatchResults.hidden = true;
  filmManualAdd.disabled = false;
  filmManualAdd.hidden = true;
  setFilmSearchStatus();
}

function renderFilmMatches(matches) {
  filmMatchResults.innerHTML = matches.map((match) => `
    <button class="film-match" type="button" data-select-movie-match="${match.tmdbId}">
      <img src="${escapeHTML(tmdbPoster(match.posterPath, "w185"))}" alt="${match.posterPath ? `${escapeHTML(match.title)} poster` : "Cine-Cord artwork placeholder"}" />
      <span class="film-match-copy"><strong>${escapeHTML(match.title)}</strong><span>${match.year || "Year unknown"}</span><small>${escapeHTML(match.overview || "No synopsis available.")}</small></span>
      <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
    </button>`).join("");
  filmMatchResults.hidden = false;
  setFilmSearchStatus(`${matches.length} ${matches.length === 1 ? "match" : "matches"} found. Choose the correct film.`, "success");
}

function metadataPayload(movie) {
  return {
    title: movie.title,
    release_year: movie.year,
    tmdb_id: movie.tmdbId,
    poster_path: movie.posterPath,
    runtime_minutes: movie.runtime,
    genres: movie.genres,
    overview: movie.overview,
    metadata_updated_at: new Date().toISOString(),
  };
}

async function lookupMovie(body) {
  const { data, error } = await supabase.functions.invoke("movie-lookup", { body });
  if (error) {
    let message = error.message || "Movie lookup failed.";
    try {
      const context = await error.context?.json();
      if (context?.error) message = context.error;
    } catch {
      // The generic function error is still useful if no JSON body is available.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function saveMovie(movie = null) {
  if (!authUser || !activeGroup || !pendingFilmDraft) return;
  const payload = movie
    ? metadataPayload(movie)
    : { title: pendingFilmDraft.title, release_year: pendingFilmDraft.year };

  if (filmEditingId) {
    const item = movieList.find((candidate) => candidate.id === filmEditingId);
    if (!item || !canManageFilm(item)) throw new Error("You cannot update this film.");
    const { data, error } = await supabase.from("queue_items").update(payload).eq("id", item.id).eq("group_id", activeGroup.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No film row was updated. Refresh before trying again.");
    return { action: "updated", title: payload.title };
  }

  const { error } = await supabase.from("queue_items").insert({
    group_id: activeGroup.id,
    suggested_by: authUser.id,
    ...payload,
  });
  if (error) throw error;
  return { action: "added", title: payload.title };
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}

async function loadAuthProviderAvailability() {
  if (discordAuthPreviewMode) {
    discordAuthEnabled = true;
    return;
  }
  if (designPreviewMode) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (!response.ok) return;
    discordAuthEnabled = discordProviderEnabled(await response.json());
  } catch {
    discordAuthEnabled = false;
  }
}

function renderLoading() {
  return `<section class="access-view" aria-live="polite"><span class="eyebrow">Shared movie list</span><h1>Opening Cine-Cord…</h1><p>Checking your invite and loading The List.</p></section>`;
}

function renderLogin() {
  const isSignup = authMode === "signup";
  return `
    <section class="access-view" aria-labelledby="login-title">
      <div class="access-card">
        <span class="eyebrow">The Discordians · ${isSignup ? "Request access" : "Private access"}</span>
        <h1 id="login-title">${isSignup ? "Join the waiting list." : "Enter Cine-Cord."}</h1>
        <p>${isSignup ? "Use Discord or create an email account, then request approval from a Cine-Cord administrator." : "Sign in to use the shared movie list and decision room. Discord login does not grant group access by itself."}</p>
        ${discordAuthEnabled ? `
          <div class="oauth-access">
            <button class="discord-auth-button" type="button" data-auth-discord>
              <span class="material-symbols-outlined discord-auth-icon" aria-hidden="true">forum</span>
              <span class="discord-auth-copy"><strong>Continue with Discord</strong><small>Approval is still required</small></span>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
          <div class="auth-divider" aria-hidden="true"><span>or use email</span></div>
        ` : ""}
        <form id="auth-form" class="access-form ${discordAuthEnabled ? "has-oauth" : ""}" data-auth-mode="${isSignup ? "signup" : "signin"}">
          ${isSignup ? `<label><span>Display name</span><input name="display_name" required maxlength="40" autocomplete="nickname" placeholder="How your friends know you" /></label>` : ""}
          <label><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com" /></label>
          <label><span>Password</span><input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="${isSignup ? "8" : "6"}" /></label>
          <button class="primary-button full-width" type="submit">${isSignup ? "Create account" : "Sign in"} <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
        </form>
        <button class="auth-mode-toggle" type="button" data-toggle-auth-mode>${isSignup ? "Already have an account? Sign in" : "New Discordian? Create an account"}</button>
        <span class="access-note">Approval protects the private group list. Authentication alone reveals no group data.</span>
      </div>
    </section>`;
}

function renderPendingAccess() {
  const requestedName = accessRequest?.requested_display_name || currentProfile?.displayName || "";
  return `
    <section class="access-view" aria-labelledby="pending-title">
      <div class="access-card">
        <span class="eyebrow">Account recognised · Group list locked</span>
        <h1 id="pending-title">${accessRequest ? "Waiting for approval." : "Request access."}</h1>
        <p>${accessRequest ? `Your request was sent on ${formatRequestDate(accessRequest.created_at)}. You can update the display name an administrator will see.` : "Choose the name your friends know, then send a request to the website administrator."}</p>
        <form id="request-access-form" class="access-form">
          <label><span>Display name</span><input name="display_name" required maxlength="40" value="${escapeHTML(requestedName)}" /></label>
          <button class="primary-button full-width" type="submit">${accessRequest ? "Update request" : "Request website access"} <span class="material-symbols-outlined" aria-hidden="true">send</span></button>
        </form>
        <div class="access-actions">${accessRequest ? `<button class="text-button" type="button" data-cancel-access-request>Cancel request</button>` : ""}<button class="text-button" type="button" data-sign-out>Sign out</button></div>
      </div>
    </section>`;
}

function getVisibleFilms() {
  const query = listQuery.trim().toLowerCase();
  return movieList.filter((item) => {
    const matchesFilter = listFilter === "all" || (listFilter === "ready" && !item.watched) || (listFilter === "watched" && item.watched);
    const matchesQuery = !query || [item.title, item.year, item.suggestedBy, ...item.genres].join(" ").toLowerCase().includes(query);
    const matchesGenre = genreFilter === "all" || item.genres.some((genre) => genre.toLowerCase() === genreFilter);
    const matchesMember = memberFilter === "all" || item.suggestedById === memberFilter;
    return matchesFilter && matchesQuery && matchesGenre && matchesMember;
  }).sort((a, b) => {
    if (listSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (listSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (b.votes !== a.votes) return b.votes - a.votes;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

function renderFilmCard(item) {
  const selected = item.id === selectedFilmId;
  return `
    <article class="poster-card ${item.watched ? "is-watched" : ""} ${selected ? "is-selected" : ""}">
      <button class="poster-card-open" type="button" data-select-film="${item.id}" aria-label="View details for ${escapeHTML(item.title)}" aria-pressed="${selected}">
        <span class="poster-frame ${item.posterUrl ? "" : "is-placeholder"}">
          <img src="${escapeHTML(filmPoster(item))}" alt="${item.posterUrl ? `${escapeHTML(item.title)} poster` : "Abstract Cine-Cord poster placeholder"}" loading="lazy" />
          ${item.posterUrl ? "" : `<span class="poster-pending"><span class="material-symbols-outlined" aria-hidden="true">movie</span> Artwork pending</span>`}
          <span class="status-pill ${item.watched ? "watched" : "ready"}">${item.watched ? "Watched" : "Ready"}</span>
        </span>
        <span class="poster-copy"><span class="poster-title-line"><strong>${escapeHTML(item.title)}</strong>${item.year ? `<span>${item.year}</span>` : ""}</span><span class="poster-metadata">${escapeHTML(metadataLine(item))}</span></span>
      </button>
      <footer class="poster-card-footer">
        <span class="poster-suggester"><img src="${escapeHTML(avatarForName(item.suggestedBy))}" alt="" /><span>Added by <strong>${escapeHTML(item.suggestedBy)}</strong></span></span>
        <button class="poster-vote ${item.votedByMe ? "is-voted" : ""}" type="button" data-vote="${item.id}" ${item.watched ? "disabled" : ""} aria-label="${item.votedByMe ? "Remove vote from" : "Vote for"} ${escapeHTML(item.title)}"><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span><strong>${item.votes}</strong></button>
      </footer>
    </article>`;
}

function renderFilmDetails(item) {
  const isShortlisted = shortlistedFilmIds.has(item.id);
  return `
    <button class="detail-scrim" type="button" data-close-film-details aria-label="Close film details"></button>
    <aside class="film-detail-drawer" aria-labelledby="film-detail-title" tabindex="-1">
      <div class="detail-drawer-head"><span class="eyebrow">Selected film</span><button class="icon-button" type="button" data-close-film-details aria-label="Close film details"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
      <div class="detail-poster ${item.posterUrl ? "" : "is-placeholder"}"><img src="${escapeHTML(filmPoster(item))}" alt="${item.posterUrl ? `${escapeHTML(item.title)} poster` : "Abstract Cine-Cord poster placeholder"}" />${item.posterUrl ? "" : `<span class="poster-pending"><span class="material-symbols-outlined" aria-hidden="true">movie</span> Artwork pending</span>`}</div>
      <div class="detail-title-row"><div><h2 id="film-detail-title">${escapeHTML(item.title)}</h2><p>${item.year ? escapeHTML(item.year) : "Year pending"}</p></div><span class="status-pill ${item.watched ? "watched" : "ready"}">${item.watched ? "Watched" : "Ready"}</span></div>
      <div class="detail-facts"><span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>${escapeHTML(runtimeLabel(item))}</span>${item.genres.map((genre) => `<span>${escapeHTML(genre)}</span>`).join("")}</div>
      <dl class="detail-ledger"><div><dt>Added by</dt><dd><img src="${escapeHTML(avatarForName(item.suggestedBy))}" alt="" />${escapeHTML(item.suggestedBy)}</dd></div><div><dt>On the list</dt><dd>${escapeHTML(formatAddedDate(item.createdAt))}</dd></div><div><dt>Group votes</dt><dd>${item.votes}</dd></div></dl>
      <p class="detail-overview">${escapeHTML(item.overview || "Full movie details will appear here once this list entry is matched with TMDB. You can still vote, shortlist it and use it in Pick Tonight now.")}</p>
      <div class="detail-actions">
        <button class="primary-button" type="button" data-shortlist-film="${item.id}"><span class="material-symbols-outlined" aria-hidden="true">${isShortlisted ? "check" : "playlist_add"}</span>${isShortlisted ? "Added to Tonight" : "Add to Tonight"}</button>
        <button class="secondary-button" type="button" data-vote="${item.id}" ${item.watched ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>${item.votedByMe ? "Remove vote" : "Vote"} · ${item.votes}</button>
        ${canManageFilm(item) ? `<button class="detail-text-action" type="button" data-match-film="${item.id}">${item.tmdbId ? "Refresh movie details" : "Find poster and details"}</button><button class="detail-text-action" type="button" data-toggle-watched="${item.id}">${item.watched ? "Return to ready list" : "Mark as watched"}</button><button class="detail-text-action danger" type="button" data-remove-film="${item.id}">Remove from list</button>` : ""}
      </div>
    </aside>`;
}

function renderList() {
  const visibleFilms = getVisibleFilms();
  const selectedFilm = movieList.find((item) => item.id === selectedFilmId) || null;
  if (selectedFilmId && !selectedFilm) selectedFilmId = null;
  const genres = [...new Set(movieList.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
  const suggesters = [...new Map(movieList.map((item) => [item.suggestedById, item.suggestedBy])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return `
    <section class="list-view" aria-labelledby="list-title">
      <header class="list-hero">
        <div><span class="eyebrow">The Discordians · Shared watchlist</span><h1 id="list-title" class="page-title">Collective Film Library</h1><p class="page-subtitle">Our shared collection of films to watch or appreciate</p></div>
        <div class="list-hero-actions"><button class="primary-button" type="button" data-open-film><span class="material-symbols-outlined" aria-hidden="true">add</span> Add film to library</button><button class="secondary-button" type="button" data-open-party>Watch a Film <span class="material-symbols-outlined" aria-hidden="true">casino</span></button></div>
      </header>
      <div class="list-toolbar">
        <label class="search-field list-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="list-search" type="search" value="${escapeHTML(listQuery)}" placeholder="Search the list" aria-label="Search The List" /></label>
        <div class="filter-tabs" aria-label="Filter The List">${["all", "ready", "watched"].map((filter) => `<button type="button" class="filter-tab ${listFilter === filter ? "is-active" : ""}" data-list-filter="${filter}">${filter[0].toUpperCase()}${filter.slice(1)}</button>`).join("")}</div>
        <button class="mobile-filter-toggle" type="button" data-toggle-list-filters aria-expanded="${listFiltersOpen}"><span><span class="material-symbols-outlined" aria-hidden="true">tune</span>Filters &amp; sort</span><span class="material-symbols-outlined" aria-hidden="true">${listFiltersOpen ? "expand_less" : "expand_more"}</span></button>
        <div class="list-filter-controls ${listFiltersOpen ? "is-open" : ""}">
          <label class="compact-select"><span class="sr-only">Genre</span><select id="genre-filter" aria-label="Filter by genre"><option value="all">All genres</option>${genres.map((genre) => `<option value="${escapeHTML(genre.toLowerCase())}" ${genreFilter === genre.toLowerCase() ? "selected" : ""}>${escapeHTML(genre)}</option>`).join("")}</select></label>
          <label class="compact-select"><span class="sr-only">Added by</span><select id="member-filter" aria-label="Filter by who added it"><option value="all">Added by anyone</option>${suggesters.map(([id, name]) => `<option value="${escapeHTML(id)}" ${memberFilter === id ? "selected" : ""}>${escapeHTML(name)}</option>`).join("")}</select></label>
          <label class="compact-select sort-field"><span class="sr-only">Sort</span><select id="list-sort" aria-label="Sort The List"><option value="votes" ${listSort === "votes" ? "selected" : ""}>Most voted</option><option value="oldest" ${listSort === "oldest" ? "selected" : ""}>Longest waiting</option><option value="newest" ${listSort === "newest" ? "selected" : ""}>Newest</option></select></label>
        </div>
      </div>
      <div class="library-layout ${selectedFilm ? "has-selection" : ""}">
        <div class="poster-grid" aria-live="polite">${visibleFilms.length ? visibleFilms.map(renderFilmCard).join("") : `<div class="empty-state list-empty"><span class="material-symbols-outlined" aria-hidden="true">movie</span><h2>${movieList.length ? "No films match that view." : "The List is empty."}</h2><p>${movieList.length ? "Try another search or filter." : "Add the first suggestion and give the group something to argue about."}</p><button class="secondary-button" type="button" data-open-film>Add a film</button></div>`}</div>
        ${selectedFilm ? renderFilmDetails(selectedFilm) : ""}
      </div>
    </section>`;
}

function renderRouletteVetoSummary() {
  if (!rouletteState) return "";
  const remainingVetoes = rouletteState.participants.filter(({ id }) => !rouletteState.usedVetoes.includes(id));
  return `
    <div class="roulette-session-vetoes" aria-label="Watch party players. ${remainingVetoes.length} of ${rouletteState.participants.length} veto tokens remaining">
      <div class="roulette-player-summary-head"><span class="eyebrow">Players</span><small>${remainingVetoes.length}/${rouletteState.participants.length} vetoes</small></div>
      <div class="roulette-veto-list" role="list">${rouletteState.participants.map(({ id, name }) => { const used = rouletteState.usedVetoes.includes(id); return `<span class="roulette-veto-player" role="listitem" aria-label="${escapeHTML(name)}: ${used ? "veto used" : "one veto available"}" title="${escapeHTML(name)} · ${used ? "veto used" : "one veto available"}"><span class="roulette-veto-token ${used ? "is-used" : ""}"><img src="${escapeHTML(avatarForName(name))}" alt="" /><strong>${used ? "Used" : "1"}</strong></span><small aria-hidden="true">${escapeHTML(name)}</small></span>`; }).join("")}</div>
    </div>`;
}

function renderRouletteSpinButton(candidates) {
  const isSpinning = rouletteState?.phase === "spinning";
  const isSettling = rouletteState?.phase === "settling";
  const isBusy = isSpinning || isSettling;
  const canManage = canManageSession();
  const visibleLabel = !candidates.length
    ? "Empty"
    : isSpinning
      ? "Spinning"
      : isSettling
        ? "Landed"
        : canManage
          ? "Spin"
          : "Wait";
  const accessibleLabel = !candidates.length
    ? "No eligible films to spin"
    : isSpinning
      ? "Spinning the list"
      : isSettling
        ? "The wheel has landed"
        : canManage
          ? "Spin the list"
          : `Waiting for ${escapeHTML(activeSession.hostName)} to spin the list`;
  return `<button class="roulette-hub roulette-spin-button" type="button" data-spin-roulette aria-label="${accessibleLabel}" aria-busy="${isBusy}" ${!candidates.length || isBusy || !canManage ? "disabled" : ""}><strong>${visibleLabel}</strong></button>`;
}

function renderRouletteChanceRows(candidates, className) {
  const { entries, totalChances } = rouletteWheelEntries(candidates);
  if (!entries.length) return "";
  const canManage = canManageSession();
  const canRemove = canManage && rouletteState?.phase === "ready" && entries.length > 1;
  return `
    <div class="${className}" aria-label="Current weighted chances">
      ${entries.map(({ item, index, weight, percentage }) => `
        <div class="roulette-chance-row ${canManage ? "has-removal" : ""} ${rouletteState?.phase === "settling" && item.id === rouletteState.winnerId ? "is-winner" : ""}">
          <span class="roulette-chance-number">${String(index + 1).padStart(2, "0")}</span>
          <img src="${escapeHTML(filmPoster(item))}" alt="" />
          <span><strong>${escapeHTML(item.title)}</strong><small>${item.year ? `${escapeHTML(item.year)} · ` : ""}${escapeHTML(rouletteWaitLabel(item))}</small></span>
          <span class="roulette-chance-value"><strong>${weight}</strong><small>${weight === 1 ? "chance" : "chances"} · ${percentage}%</small></span>
          ${canManage ? `<button class="roulette-chance-remove" type="button" data-exclude-roulette-film="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.title)} from this Roulette pool" title="Remove from this round" ${canRemove ? "" : "disabled"}><span class="material-symbols-outlined" aria-hidden="true">close</span></button>` : ""}
        </div>`).join("")}
      <p>${entries.length} ${entries.length === 1 ? "film" : "films"} share ${totalChances} weighted ${totalChances === 1 ? "chance" : "chances"}.</p>
    </div>`;
}

function renderRoulettePool(candidates) {
  if (!rouletteState) return "";
  const genres = [...new Set(movieList.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
  const omittedFilms = [
    ...rouletteState.vetoedFilmIds.map((id) => ({ item: movieList.find((candidate) => candidate.id === id), reason: "Vetoed" })),
    ...rouletteState.excludedFilmIds.map((id) => ({ item: movieList.find((candidate) => candidate.id === id), reason: "Removed" })),
  ].filter(({ item }) => item);
  const isBusy = ["spinning", "settling"].includes(rouletteState.phase);
  const controlsDisabled = canManageSession() && !isBusy ? "" : "disabled";
  const clearDisabled = !canManageSession() || isBusy || !rouletteHasActiveFilters();
  return `
    <section class="roulette-pool" aria-labelledby="roulette-pool-title">
      <div class="roulette-pool-head">
        <div class="roulette-pool-title">
          <span class="material-symbols-outlined" aria-hidden="true">tune</span>
          <span><h2 id="roulette-pool-title">Adjust pool</h2><small>${candidates.length} eligible ${candidates.length === 1 ? "film" : "films"}</small></span>
        </div>
        <button class="roulette-clear-filters" type="button" data-clear-roulette-filters ${clearDisabled ? "disabled" : ""} aria-label="Clear Roulette filters and restore removed films" title="Clear filters"><span class="material-symbols-outlined" aria-hidden="true">filter_alt_off</span><span>Clear</span></button>
      </div>
      <div class="roulette-pool-controls">
        ${renderRouletteVetoSummary()}
        <label><span>Maximum runtime</span><select id="roulette-runtime" ${controlsDisabled}><option value="any" ${rouletteState.filters.runtime === "any" ? "selected" : ""}>Any runtime</option><option value="90" ${rouletteState.filters.runtime === "90" ? "selected" : ""}>Under 90 min</option><option value="120" ${rouletteState.filters.runtime === "120" ? "selected" : ""}>Under 120 min</option><option value="150" ${rouletteState.filters.runtime === "150" ? "selected" : ""}>Under 150 min</option></select></label>
        <label><span>Genre</span><select id="roulette-genre" ${controlsDisabled}><option value="all">Any genre</option>${genres.map((genre) => `<option value="${escapeHTML(genre.toLowerCase())}" ${rouletteState.filters.genre === genre.toLowerCase() ? "selected" : ""}>${escapeHTML(genre)}</option>`).join("")}</select></label>
        <label class="roulette-switch"><input id="roulette-rewatches" type="checkbox" ${rouletteState.filters.includeWatched ? "checked" : ""} ${controlsDisabled} /><span><strong>Allow rewatches</strong><small>Include films already marked watched.</small></span></label>
        <label class="roulette-switch"><input id="roulette-age-weight" type="checkbox" ${rouletteState.filters.weightedByAge ? "checked" : ""} ${controlsDisabled} /><span><strong>Weight older entries</strong><small>The longest-waiting films get up to 4× chance.</small></span></label>
        ${omittedFilms.length ? `<div class="roulette-vetoed-films"><span class="eyebrow">Out this round</span><div>${omittedFilms.map(({ item, reason }) => `<span><img src="${escapeHTML(filmPoster(item))}" alt="" /><strong>${escapeHTML(item.title)}</strong><small>${reason}</small></span>`).join("")}</div></div>` : ""}
      </div>
    </section>`;
}

function renderRouletteWheel(candidates, { resultSummary = false } = {}) {
  if (!rouletteState) return "";
  const { entries, totalChances } = rouletteWheelEntries(candidates);
  const winnerEntry = entries.find(({ item }) => item.id === rouletteState.winnerId);
  const landingAngle = winnerEntry && Number.isFinite(rouletteState.landingAngle)
    ? Math.min(winnerEntry.endAngle, Math.max(winnerEntry.startAngle, rouletteState.landingAngle))
    : winnerEntry?.middleAngle;
  const winnerOffset = Number.isFinite(landingAngle) ? -90 - landingAngle : 0;
  const spinEnd = 1440 + winnerOffset;
  const isSpinning = rouletteState.phase === "spinning";
  const isSettling = rouletteState.phase === "settling";
  const showWinner = Boolean(winnerEntry && (isSettling || resultSummary));
  const winnerNumber = winnerEntry ? String(winnerEntry.index + 1).padStart(2, "0") : "";
  const winnerChanceLabel = winnerEntry ? `${winnerEntry.weight} ${winnerEntry.weight === 1 ? "chance" : "chances"}` : "";
  return `
    <div class="roulette-wheel-stage ${isSettling ? "is-settling" : ""} ${resultSummary ? "is-result-summary" : ""}" role="group" aria-label="Queue Roulette wheel containing ${candidates.length} films and ${totalChances} weighted chances. Wider slices have more chances.">
      <span class="roulette-pointer material-symbols-outlined" aria-hidden="true">arrow_drop_down</span>
      <div class="roulette-wheel-track ${isSpinning && !resultSummary ? "is-spinning" : ""} ${showWinner ? "is-settling" : ""}" data-roulette-wheel style="--roulette-spin-end:${spinEnd.toFixed(3)}deg;--roulette-label-counter:${(-spinEnd).toFixed(3)}deg">
        ${entries.map(({ item, index, polygon }) => `<span class="roulette-segment tone-${index % 3} ${showWinner && item.id === rouletteState.winnerId ? "is-winner" : ""}" style="clip-path:${polygon}"></span>`).join("")}
        ${entries.map(({ startAngle }) => `<span class="roulette-divider" aria-hidden="true" style="--divider-angle:${(startAngle + 90).toFixed(3)}deg"></span>`).join("")}
        ${entries.map(({ item, index, weight, startAngle, endAngle, labelX, labelY }) => `<span class="roulette-wedge-label ${endAngle - startAngle < 24 ? "is-narrow" : ""} ${showWinner && item.id === rouletteState.winnerId ? "is-winner" : ""}" aria-hidden="true" title="${escapeHTML(item.title)} · ${weight} ${weight === 1 ? "chance" : "chances"}" style="--label-x:${labelX.toFixed(3)}%;--label-y:${labelY.toFixed(3)}%"><strong>${String(index + 1).padStart(2, "0")}</strong><b>${escapeHTML(item.title)}</b><em>${item.year ? escapeHTML(item.year) : ""}</em><small>${weight}×</small></span>`).join("")}
      </div>
      ${resultSummary ? `<span class="roulette-hub roulette-result-hub" aria-hidden="true"><strong>${winnerNumber || "—"}</strong><small>Selected</small></span>` : renderRouletteSpinButton(candidates)}
    </div>
    ${showWinner ? `<div class="roulette-landed-callout ${resultSummary ? "is-summary" : ""}" role="status" aria-live="polite"><span class="material-symbols-outlined" aria-hidden="true">trophy</span><span><small>Landed on</small><strong><em>${winnerNumber}</em>${escapeHTML(winnerEntry.item.title)}</strong><b>${escapeHTML(winnerChanceLabel)}${resultSummary ? "" : " · revealing shortly"}</b></span></div>` : ""}
    ${resultSummary ? "" : renderRouletteChanceRows(candidates, "roulette-chance-strip")}`;
}

function renderRouletteReady(candidates) {
  const filterLabels = rouletteFilterLabels();
  return `
    <div class="roulette-ready-layout">
      <div class="roulette-stage-column">
        ${renderRouletteWheel(candidates)}
        <div class="roulette-filter-summary" aria-label="Current candidate filters">${filterLabels.map((label, index) => `<span><span class="material-symbols-outlined" aria-hidden="true">${["schedule", "local_offer", "check_circle"][index]}</span>${escapeHTML(label)}</span>`).join("")}</div>
        <p class="roulette-weight-note"><span class="material-symbols-outlined" aria-hidden="true">info</span>${rouletteState.filters.weightedByAge ? "Each film has one slice. Wider slices have more chances because they have waited longer." : "Each film has one equally sized slice and one chance."}</p>
      </div>
      <aside class="roulette-control-column">
        ${renderRoulettePool(candidates)}
        ${candidates.length ? "" : `<p class="roulette-empty-warning">No films match these filters. Adjust the pool to continue.</p>`}
      </aside>
    </div>`;
}

function renderRouletteReveal(candidates, winner) {
  const weights = rouletteWeights(candidates);
  const weight = weights.get(winner.id) || 1;
  const confirmed = rouletteState.phase === "confirmed";
  const canManage = canManageSession();
  const overview = winner.overview || "The wheel has made its choice. Confirm it for tonight, spin again, or let one player spend their veto.";
  // Before the decision this reads as live odds; afterwards it is history.
  const chanceReason = !rouletteState.filters.weightedByAge
    ? (confirmed ? "Won at even odds" : "1 equal chance")
    : confirmed
      ? `Won at ${weight}× odds · ${rouletteWaitLabel(winner)}`
      : `${weight} ${weight === 1 ? "chance" : "chances"} · ${rouletteWaitLabel(winner)}`;
  return `
    <div class="roulette-result-layout ${confirmed ? "is-confirmed" : ""}">
      <div class="roulette-result-stage">
        ${confirmed ? "" : `<div class="roulette-result-wheel">${renderRouletteWheel(candidates, { resultSummary: true })}</div>`}
        <figure class="roulette-winning-poster"><img src="${escapeHTML(filmPoster(winner))}" alt="${escapeHTML(winner.title)} poster" /><figcaption title="${escapeHTML(chanceReason)}"><span class="material-symbols-outlined" aria-hidden="true">stars</span>${weight}×</figcaption></figure>
      </div>
      <section class="roulette-result-copy" aria-labelledby="roulette-winner-title">
        <span class="eyebrow">${confirmed ? "Tonight's film" : "Roulette selected"}</span>
        <div class="roulette-winner-heading"><div><h2 id="roulette-winner-title" tabindex="-1">${escapeHTML(winner.title)}</h2><p>${winner.year ? escapeHTML(winner.year) : "Year pending"}</p></div><span class="status-pill ${winner.watched ? "watched" : "ready"}">${winner.watched ? "Rewatch" : "Ready"}</span></div>
        <div class="roulette-winner-facts"><span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>${escapeHTML(runtimeLabel(winner))}</span>${winner.genres.slice(0, 3).map((genre) => `<span>${escapeHTML(genre)}</span>`).join("")}<span title="${escapeHTML(chanceReason)}"><span class="material-symbols-outlined" aria-hidden="true">weight</span>${escapeHTML(chanceReason)}</span></div>
        <div class="roulette-overview-block"><p class="roulette-winner-overview ${rouletteState.overviewOpen ? "is-expanded" : ""}">${escapeHTML(overview)}</p>${overview.length > 150 ? `<button class="roulette-overview-toggle" type="button" data-toggle-roulette-overview aria-expanded="${rouletteState.overviewOpen}">${rouletteState.overviewOpen ? "Show less" : "Read more"}</button>` : ""}</div>
        ${confirmed ? `
          <div class="roulette-confirmed-note" role="status"><span class="material-symbols-outlined" aria-hidden="true">cloud_done</span><div><strong>Choice confirmed and saved</strong><p>This session will survive refresh. The movie list and Discord have not been changed.</p></div></div>` : canManage ? `
          <section class="roulette-result-vetoes" aria-labelledby="result-veto-title"><span class="eyebrow" id="result-veto-title">Use a veto to spin again</span><div>${rouletteState.participants.map(({ id, name }) => { const used = rouletteState.usedVetoes.includes(id); return `<button type="button" data-veto-member="${escapeHTML(id)}" ${used ? "disabled" : ""} aria-label="${used ? `${escapeHTML(name)} has used their veto` : `${escapeHTML(name)} vetoes ${escapeHTML(winner.title)}`}" title="${escapeHTML(name)}${used ? " · veto used" : " · one veto available"}"><img src="${escapeHTML(avatarForName(name))}" alt="" /><span><strong>${escapeHTML(name)}</strong><small>${used ? "Veto already used" : "One veto available"}</small></span><em>${used ? "Used" : "1"}</em></button>`; }).join("")}</div></section>
          <div class="roulette-decision-actions">
            <button class="primary-button roulette-wide-action" type="button" data-confirm-roulette><span class="material-symbols-outlined" aria-hidden="true">check</span>Confirm for tonight</button>
            <button class="secondary-button roulette-wide-action" type="button" data-request-reroll><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Spin again</button>
            ${rouletteState.rerollConfirmOpen ? `<div class="roulette-reroll-confirm" role="alert"><p>Re-spin without spending anyone's veto?</p><div><button class="secondary-button" type="button" data-cancel-reroll>Cancel</button><button class="primary-button" type="button" data-reroll-roulette>Yes, re-spin</button></div></div>` : ""}
          </div>` : `<div class="roulette-confirmed-note" role="status"><span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><div><strong>Waiting for the host</strong><p>${escapeHTML(activeSession.hostName)} can confirm this result or spin again.</p></div></div>`}
      </section>
      ${confirmed ? `
      <div class="roulette-result-handoff">${renderDiscordTemplate(activeSession, winner)}</div>
      <div class="roulette-session-actions">
        <span class="roulette-session-note">Session saved · Hosted by ${escapeHTML(activeSession.hostName)}</span>
        ${canManage ? `<button class="ghost-button" type="button" data-new-roulette><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Start another round</button>` : ""}
        <button class="secondary-button" type="button" data-view="list">Return to The List</button>
      </div>` : ""}
    </div>`;
}

function renderQueueRoulette() {
  const candidates = getRouletteCandidates();
  const winner = rouletteState?.winnerId
    ? (movieList.find((item) => item.id === rouletteState.winnerId) || selectedFilmForSession(activeSession))
    : selectedFilmForSession(activeSession);
  return `
    <section class="roulette-game ${winner && ["reveal", "confirmed"].includes(rouletteState.phase) ? "has-result" : ""}" aria-labelledby="roulette-title">
      <header class="roulette-header">
        <div><span class="eyebrow">Pick Tonight · Weighted chaos</span><h1 id="roulette-title">Queue Roulette</h1></div>
        ${canManageSession() ? `<button class="icon-button roulette-close" type="button" data-close-roulette aria-label="End Queue Roulette"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>` : ""}
      </header>
      ${winner && ["reveal", "confirmed"].includes(rouletteState.phase) ? renderRouletteReveal(candidates, winner) : renderRouletteReady(candidates)}
    </section>`;
}

function renderPick() {
  if (activeSession?.mode === "Queue Roulette" && rouletteState) return renderQueueRoulette();
  const candidateCount = movieList.filter((item) => !item.watched).length;
  return `
    <section class="page-view" aria-labelledby="pick-title">
      <header class="page-header"><div><span class="eyebrow">${candidateCount} eligible ${candidateCount === 1 ? "film" : "films"}</span><h1 id="pick-title" class="page-title">Pick Tonight</h1><p class="page-subtitle">Choose the group, choose the rules, then let the website settle the argument.</p></div><button class="primary-button" type="button" data-open-party ${candidateCount ? "" : "disabled"}>Start a Session <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button></header>
      <div class="pick-callout"><span class="material-symbols-outlined" aria-hidden="true">cloud_done</span><div><strong>Independent of Discord</strong><p>These games use the shared website list and continue working while the bot is offline.</p></div></div>
      <div class="mode-list">${decisionModes.map((mode) => `<article class="mode-row ${mode.available ? "" : "is-unavailable"}"><span class="mode-icon">${mode.code}</span><div><span class="mode-tone">${mode.tone}</span><h3>${mode.title}</h3><p>${mode.copy}</p></div><button class="secondary-button" type="button" data-select-mode="${mode.title}" ${candidateCount && mode.available ? "" : "disabled"}>${mode.available ? "Choose" : "Coming soon"}</button></article>`).join("")}</div>
    </section>`;
}

function renderSessions() {
  const rouletteWinner = selectedFilmForSession(activeSession);
  const canManage = canManageSession();
  return `
    <section class="page-view" aria-labelledby="sessions-title">
      <header class="page-header"><div><span class="eyebrow">Persistent decision rooms</span><h1 id="sessions-title" class="page-title">Sessions</h1><p class="page-subtitle">Movie-night choices now survive refresh. Discord remains a separate, manual handoff.</p></div>${activeSession?.mode === "Queue Roulette" ? `<button class="primary-button" type="button" data-continue-roulette>Open Active Session <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>` : activeSession ? "" : `<button class="primary-button" type="button" data-open-party>New Session <span class="material-symbols-outlined" aria-hidden="true">add</span></button>`}</header>
      ${activeSession ? `<article class="active-session session-feature ${rouletteWinner ? "has-film" : ""}">${rouletteWinner ? `<img class="session-film-poster" src="${escapeHTML(filmPoster(rouletteWinner))}" alt="${escapeHTML(rouletteWinner.title)} poster" />` : ""}<div class="active-session-head"><div><span class="eyebrow">${escapeHTML(activeSession.status === "CONFIRMED" ? "Confirmed" : "Active")} · ${escapeHTML(activeSession.mode)} · Hosted by ${escapeHTML(activeSession.hostName)}</span><h3>${activeSession.mode === "Queue Roulette" ? (rouletteWinner ? `${escapeHTML(rouletteWinner.title)} is confirmed for tonight.` : "The wheel is ready when you are.") : "This legacy session uses a mode that is not implemented."}</h3><p class="session-members">${activeSession.members.map(escapeHTML).join(", ")}</p><p>${activeSession.candidateCount} list ${activeSession.candidateCount === 1 ? "film" : "films"} available when this session started.</p></div><div class="session-actions">${activeSession.mode === "Queue Roulette" ? `<button class="primary-button compact" type="button" data-continue-roulette>${rouletteWinner ? "View result" : "Continue Roulette"}</button>` : ""}${canManage ? `<button class="secondary-button" type="button" data-end-session>End Session</button>` : ""}</div></div></article>${rouletteWinner ? renderDiscordTemplate(activeSession, rouletteWinner) : ""}` : `<div class="empty-state session-empty"><span class="material-symbols-outlined" aria-hidden="true">groups</span><h2>No active session.</h2><p>Queue Roulette is ready now. Consensus Sprint and Reel Bracket are coming later.</p><button class="secondary-button" type="button" data-open-party>Start Queue Roulette</button></div>`}
      ${sessionHistory.length ? `<section class="session-history" aria-labelledby="session-history-title"><div class="section-heading"><div><span class="eyebrow">Saved history</span><h2 id="session-history-title">Previous sessions</h2></div><span class="request-count">${sessionHistory.length}</span></div><div class="session-history-list">${sessionHistory.map((session) => { const film = selectedFilmForSession(session); return `<article class="session-history-row">${film ? `<img src="${escapeHTML(filmPoster(film))}" alt="" />` : `<span class="session-history-placeholder material-symbols-outlined" aria-hidden="true">casino</span>`}<div><span>${escapeHTML(formatAddedDate(session.startedAt))} · ${escapeHTML(session.mode)}</span><strong>${film ? escapeHTML(film.title) : "Session ended without a confirmed film"}</strong><small>${session.members.map(escapeHTML).join(", ")}</small></div><span class="status-pill watched">Ended</span></article>`; }).join("")}</div></section>` : ""}
    </section>`;
}

function renderStats() {
  const ready = movieList.filter((item) => !item.watched);
  const watched = movieList.filter((item) => item.watched);
  const totalVotes = movieList.reduce((sum, item) => sum + item.votes, 0);
  const oldest = [...ready].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
  const favourite = [...ready].sort((a, b) => b.votes - a.votes)[0];
  return `
    <section class="page-view" aria-labelledby="stats-title">
      <header class="page-header"><div><span class="eyebrow">List behaviour, not Journal history</span><h1 id="stats-title" class="page-title">List Stats</h1><p class="page-subtitle">A small snapshot of suggestions and votes. Selection-game awards arrive later.</p></div></header>
      <div class="list-stat-grid"><article><span class="material-symbols-outlined" aria-hidden="true">movie</span><strong>${ready.length}</strong><p>Films ready to watch</p></article><article><span class="material-symbols-outlined" aria-hidden="true">how_to_vote</span><strong>${totalVotes}</strong><p>Total active votes</p></article><article><span class="material-symbols-outlined" aria-hidden="true">done_all</span><strong>${watched.length}</strong><p>Marked as watched</p></article></div>
      <div class="stat-feature-list"><article><span class="eyebrow">Current favourite</span><h2>${favourite ? escapeHTML(favourite.title) : "No votes yet"}</h2><p>${favourite ? `${favourite.votes} ${favourite.votes === 1 ? "vote" : "votes"}` : "Vote on The List to create a frontrunner."}</p></article><article><span class="eyebrow">Longest waiting</span><h2>${oldest ? escapeHTML(oldest.title) : "Nothing waiting"}</h2><p>${oldest ? escapeHTML(formatWaitingTime(oldest.createdAt)) : "Add a suggestion to begin the queue."}</p></article></div>
    </section>`;
}

function renderMembers() {
  if (!isCurrentAdmin()) return renderList();
  const accessUrl = `${window.location.origin}${window.location.pathname}`;
  const sortedMembers = [...members].sort((a, b) => a.role !== b.role ? (a.role === "admin" ? -1 : 1) : a.name.localeCompare(b.name));
  return `
    <section class="page-view" aria-labelledby="members-title">
      <header class="page-header"><div><span class="eyebrow">Website access · Admin only</span><h1 id="members-title" class="page-title">Members</h1><p class="page-subtitle">Approve friends, keep list names consistent and control access to Cine-Cord.</p></div><span class="member-count">${members.length} approved</span></header>
      <article class="invite-panel"><div><span class="eyebrow">Invite a friend</span><h2>Share the private entrance.</h2><p>They create an account, request access and remain locked out until an administrator approves them here.</p></div><div class="invite-link-row"><input value="${escapeHTML(accessUrl)}" readonly aria-label="Website invite link" /><button class="secondary-button" type="button" data-copy-invite>Copy link</button></div></article>
      <section class="management-section" aria-labelledby="requests-title"><div class="section-heading"><div><span class="eyebrow">Waiting room</span><h2 id="requests-title">Access requests</h2></div><span class="request-count">${joinRequests.length}</span></div><div class="request-list">${joinRequests.length ? joinRequests.map((request) => `<article class="request-row"><div class="request-identity"><span class="member-initial">${escapeHTML(request.requested_display_name.slice(0, 1).toUpperCase())}</span><div><h3>${escapeHTML(request.requested_display_name)}</h3><p>${escapeHTML(request.requester_email)} · ${formatRequestDate(request.created_at)}</p></div></div><div class="request-actions"><button class="primary-button compact" type="button" data-approve-request="${request.id}">Approve</button><button class="text-button danger" type="button" data-decline-request="${request.id}">Decline</button></div></article>`).join("") : `<div class="empty-state compact-empty">No one is waiting for access.</div>`}</div></section>
      <section class="management-section" aria-labelledby="approved-title"><div class="section-heading"><div><span class="eyebrow">Cine-Cord roster</span><h2 id="approved-title">Approved members</h2></div></div><div class="member-admin-list">${sortedMembers.map((member) => `<form class="member-admin-row" data-member-form data-user-id="${member.id}"><div class="member-admin-identity"><img src="${member.avatar}" alt="" /><div><strong>${escapeHTML(member.name)}</strong><span>${member.id === authUser.id ? "Your account" : "Website member"}</span></div></div><label><span>Display name</span><input name="display_name" maxlength="40" required value="${escapeHTML(member.name)}" /></label><label><span>Role</span><select name="role"><option value="member" ${member.role === "member" ? "selected" : ""}>Member</option><option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option></select></label><div class="member-admin-actions"><button class="secondary-button compact" type="submit">Save</button>${member.id !== authUser.id ? `<button class="text-button danger" type="button" data-remove-member="${member.id}">Remove access</button>` : ""}</div></form>`).join("")}</div></section>
    </section>`;
}

function updateShellState() {
  const hasWorkspace = Boolean(authUser && activeGroup);
  const isAdmin = hasWorkspace && isCurrentAdmin();
  document.body.classList.toggle("is-locked", !hasWorkspace);
  document.body.classList.toggle("is-admin", isAdmin);
  document.body.classList.toggle("has-film-detail", hasWorkspace && currentView === "list" && Boolean(selectedFilmId));
  document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = !isAdmin; });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.disabled = !hasWorkspace || (button.dataset.view === "members" && !isAdmin);
    button.classList.toggle("is-active", hasWorkspace && button.dataset.view === currentView);
  });
  if (sessionPanel) sessionPanel.hidden = !authUser;
  if (sessionName) sessionName.textContent = currentProfile?.displayName || authUser?.email || "Signed in";
}

function bindListSearch() {
  const search = document.querySelector("#list-search");
  search?.addEventListener("input", (event) => {
    listQuery = event.target.value;
    root.innerHTML = renderList();
    updateShellState();
    bindListSearch();
    const refreshed = document.querySelector("#list-search");
    refreshed?.focus();
    refreshed?.setSelectionRange(refreshed.value.length, refreshed.value.length);
  });
}

function render() {
  if (isLoading) {
    root.innerHTML = renderLoading();
    updateShellState();
    return;
  }
  if (!authUser) {
    root.innerHTML = renderLogin();
    updateShellState();
    return;
  }
  if (!activeGroup) {
    root.innerHTML = renderPendingAccess();
    updateShellState();
    return;
  }
  const renderers = { list: renderList, pick: renderPick, sessions: renderSessions, stats: renderStats, members: renderMembers };
  if (!renderers[currentView] || (currentView === "members" && !isCurrentAdmin())) currentView = "list";
  root.innerHTML = renderers[currentView]();
  updateShellState();
  if (currentView === "list") bindListSearch();
}

function navigate(view) {
  if (!authUser || !activeGroup) return;
  if (view === "members" && !isCurrentAdmin()) return;
  currentView = legacyViewMap[view] || view;
  if (currentView !== "list") selectedFilmId = null;
  window.location.hash = currentView;
  render();
  root.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPartyModal(mode = "Queue Roulette") {
  const selectedMode = decisionModes.find((candidate) => candidate.title === mode);
  if (!selectedMode?.available) {
    showToast(`${mode} is coming soon. Queue Roulette is the available decision game.`);
    return;
  }
  if (activeSession) {
    showToast("A movie-night session is already open. End it before starting another.");
    navigate("sessions");
    return;
  }
  if (!movieList.some((item) => !item.watched)) {
    showToast("Add at least one ready film before starting a session.");
    return;
  }
  partyMembers.innerHTML = members.map((member, index) => `<label class="member-choice"><input type="checkbox" name="members" value="${escapeHTML(member.id)}" ${index < 3 ? "checked" : ""} /><img src="${member.avatar}" alt="" /><span>${escapeHTML(member.name)}</span></label>`).join("");
  const radio = partyForm.querySelector(`input[name="mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  partyModal.hidden = false;
  document.body.style.overflow = "hidden";
  partyModal.querySelector("input:checked")?.focus();
}

function closePartyModal() {
  partyModal.hidden = true;
  document.body.style.overflow = "";
}

function stopRouletteSpin() {
  rouletteSpinToken += 1;
  window.clearTimeout(rouletteSpinTimer);
  rouletteSpinTimer = null;
}

function cloneRouletteState(state = rouletteState) {
  if (!state) return null;
  return {
    ...state,
    participants: state.participants.map((participant) => ({ ...participant })),
    usedVetoes: [...state.usedVetoes],
    vetoedFilmIds: [...state.vetoedFilmIds],
    excludedFilmIds: [...state.excludedFilmIds],
    previewIds: [...state.previewIds],
    filters: { ...state.filters },
  };
}

async function updateActiveMovieSession(patch) {
  if (!activeSession || !activeGroup) throw new Error("There is no active session to update.");
  if (!canManageSession()) throw new Error("Only the session host or a website administrator can change this session.");
  if (designPreviewMode) return;

  const { data, error } = await supabase
    .from("movie_sessions")
    .update(patch)
    .eq("id", activeSession.id)
    .eq("group_id", activeGroup.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No session row was updated. Refresh before trying again.");
}

async function persistRouletteState() {
  if (!activeSession) return;
  const gameState = serialiseRouletteState();
  await updateActiveMovieSession({ game_state: gameState });
  activeSession.gameState = gameState;
}

async function createMovieSession(participantIds, mode) {
  const selectedMembers = participantIds.map((id) => members.find((member) => member.id === id)).filter(Boolean);
  const memberNames = selectedMembers.map((member) => member.name);
  const candidateCount = movieList.filter((item) => !item.watched).length;
  const initialRoulette = mode === "Queue Roulette" ? createRouletteState(selectedMembers) : null;
  const gameState = initialRoulette ? serialiseRouletteStateValue(initialRoulette) : {};

  if (designPreviewMode) {
    activeSession = {
      id: `preview-session-${Date.now()}`,
      groupId: activeGroup.id,
      createdById: authUser.id,
      hostName: currentProfile.displayName,
      mode,
      status: "ACTIVE",
      candidateCount,
      participantIds,
      participants: selectedMembers.map(({ id, name }) => ({ id, name })),
      members: memberNames,
      selectedFilmId: null,
      selectedFilm: null,
      gameState,
      startedAt: new Date().toISOString(),
    };
    rouletteState = initialRoulette;
    return;
  }

  const { error } = await supabase.rpc("create_movie_session", {
    p_group_id: activeGroup.id,
    p_mode: mode,
    p_participant_ids: participantIds,
    p_candidate_count: candidateCount,
    p_game_state: gameState,
  });
  if (error) {
    if (error.code === "23505") throw new Error("A movie-night session is already open. End it before starting another.");
    throw error;
  }
  await loadWorkspace();
}

async function confirmMovieSession(winner) {
  if (!activeSession || !rouletteState) return;
  const previousPhase = rouletteState.phase;
  rouletteState.phase = "confirmed";
  const gameState = serialiseRouletteState();
  try {
    await updateActiveMovieSession({
      status: "CONFIRMED",
      selected_queue_item_id: winner.id,
      selected_title: winner.title,
      selected_release_year: winner.year || null,
      selected_tmdb_id: winner.tmdbId || null,
      selected_poster_path: winner.posterPath || null,
      selected_runtime_minutes: winner.runtime || null,
      selected_genres: winner.genres || [],
      selected_overview: winner.overview || null,
      game_state: gameState,
    });
  } catch (error) {
    rouletteState.phase = previousPhase;
    throw error;
  }
  activeSession.status = "CONFIRMED";
  activeSession.selectedFilmId = winner.id;
  activeSession.selectedFilm = { ...winner };
  activeSession.gameState = gameState;
  activeSession.confirmedAt = new Date().toISOString();
  discordDraft = createDiscordDraft(activeSession, winner);
}

async function resetMovieSessionRoulette() {
  if (!activeSession) return;
  const nextRouletteState = createRouletteState(activeSession.participants || []);
  const gameState = serialiseRouletteStateValue(nextRouletteState);
  await updateActiveMovieSession({
    status: "ACTIVE",
    selected_queue_item_id: null,
    selected_title: null,
    selected_release_year: null,
    selected_tmdb_id: null,
    selected_poster_path: null,
    selected_runtime_minutes: null,
    selected_genres: [],
    selected_overview: null,
    game_state: gameState,
  });
  rouletteState = nextRouletteState;
  activeSession.status = "ACTIVE";
  activeSession.selectedFilmId = null;
  activeSession.selectedFilm = null;
  activeSession.confirmedAt = null;
  activeSession.gameState = gameState;
  discordDraft = null;
}

async function endMovieSession() {
  if (!activeSession) return;
  stopRouletteSpin();
  if (!designPreviewMode) {
    await updateActiveMovieSession({ status: "ENDED", game_state: serialiseRouletteState() });
    await loadWorkspace();
  } else {
    sessionHistory.unshift({ ...activeSession, status: "ENDED", endedAt: new Date().toISOString() });
    activeSession = null;
    rouletteState = null;
    discordDraft = null;
  }
}

async function spinRoulette(vetoParticipantId = null) {
  if (!rouletteState || ["spinning", "settling"].includes(rouletteState.phase) || !canManageSession()) return;
  const previousState = cloneRouletteState();
  let candidates = getRouletteCandidates();
  if (!candidates.length) {
    showToast("No films match the current Roulette filters.");
    return;
  }
  if (vetoParticipantId) {
    const participant = rouletteState.participants.find(({ id }) => id === vetoParticipantId);
    if (!participant || rouletteState.usedVetoes.includes(vetoParticipantId)) return;
    if (candidates.length <= 1) {
      showToast("The final remaining film cannot be vetoed. Confirm it or start a new round.");
      return;
    }
    rouletteState.usedVetoes.push(vetoParticipantId);
    if (rouletteState.winnerId && !rouletteState.vetoedFilmIds.includes(rouletteState.winnerId)) rouletteState.vetoedFilmIds.push(rouletteState.winnerId);
    candidates = getRouletteCandidates();
  }
  const winner = weightedRoulettePick(candidates);
  const winnerEntry = rouletteWheelEntries(candidates).entries.find(({ item }) => item.id === winner.id);
  const preview = roulettePreviewFilms(candidates, winner);
  rouletteState.winnerId = winner.id;
  rouletteState.landingAngle = pickRouletteLandingAngle(winnerEntry);
  rouletteState.previewIds = preview.map((item) => item.id);
  rouletteState.overviewOpen = false;
  rouletteState.rerollConfirmOpen = false;
  rouletteState.phase = "spinning";
  const spinToken = ++rouletteSpinToken;
  try { await persistRouletteState(); }
  catch (error) {
    rouletteState = previousState;
    render();
    showToast(`Roulette state was not saved: ${error.message}`);
    return;
  }
  render();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spinDuration = reducedMotion ? ROULETTE_REDUCED_SPIN_DURATION_MS : ROULETTE_SPIN_DURATION_MS;
  const settleDuration = reducedMotion ? ROULETTE_REDUCED_SETTLE_DURATION_MS : ROULETTE_SETTLE_DURATION_MS;
  rouletteSpinTimer = window.setTimeout(async () => {
    if (!rouletteState || rouletteSpinToken !== spinToken) return;
    rouletteState.phase = "settling";
    render();
    try { await persistRouletteState(); }
    catch (error) { showToast(`Roulette stopped state was not saved: ${error.message}`); }
    if (!rouletteState || rouletteSpinToken !== spinToken) return;
    rouletteSpinTimer = window.setTimeout(async () => {
      if (!rouletteState || rouletteSpinToken !== spinToken) return;
      rouletteState.phase = "reveal";
      try { await persistRouletteState(); }
      catch (error) { showToast(`Roulette result was not saved: ${error.message}`); }
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, settleDuration);
  }, spinDuration);
}

function openFilmModal(item = null) {
  filmEditingId = item?.id || null;
  pendingFilmDraft = null;
  filmForm.reset();
  clearFilmMatches();
  filmFormTitle.textContent = item ? "Match movie details" : "Add a film";
  filmFormIntro.textContent = item
    ? "Search for the correct TMDB result to add or refresh its poster, runtime, genres and synopsis."
    : "Search TMDB for the correct film, poster and details.";
  filmForm.elements.title.value = item?.title || "";
  filmForm.elements.year.value = item?.year || "";
  filmModal.hidden = false;
  document.body.style.overflow = "hidden";
  filmForm.elements.title.focus();
}

function closeFilmModal() {
  filmModal.hidden = true;
  document.body.style.overflow = "";
  filmEditingId = null;
  pendingFilmDraft = null;
  filmForm.reset();
  clearFilmMatches();
}

async function loadWorkspace() {
  const { data: groups, error: groupError } = await supabase.from("groups").select("id,name,slug").eq("slug", "the-discordians").limit(1);
  if (groupError) throw groupError;
  availableGroup = groups?.[0] || null;
  activeGroup = null;
  currentProfile = null;
  members = [];
  accessRequest = null;
  joinRequests = [];
  movieList = [];
  activeSession = null;
  sessionHistory = [];
  rouletteState = null;
  discordDraft = null;
  if (!availableGroup) return;

  const [selfProfileResult, selfMembershipResult, selfRequestResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name").eq("id", authUser.id).maybeSingle(),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle(),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle()
  ]);
  const accessError = [selfProfileResult.error, selfMembershipResult.error, selfRequestResult.error].find(Boolean);
  if (accessError) throw accessError;
  currentProfile = { id: authUser.id, displayName: selfProfileResult.data?.display_name || preferredAuthDisplayName(authUser), role: selfMembershipResult.data?.role || null };
  accessRequest = selfRequestResult.data || null;
  if (!selfMembershipResult.data) return;

  activeGroup = availableGroup;
  const [profilesResult, membershipsResult, queueResult, votesResult, requestsResult, sessionsResult, participantsResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name"),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", activeGroup.id),
    supabase.from("queue_items").select("*").eq("group_id", activeGroup.id).order("created_at", { ascending: true }),
    supabase.from("queue_votes").select("queue_item_id,user_id,created_at"),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", activeGroup.id).order("created_at", { ascending: true }),
    supabase.from("movie_sessions").select("*").eq("group_id", activeGroup.id).order("started_at", { ascending: false }).limit(20),
    supabase.from("movie_session_participants").select("session_id,profile_id,display_name_snapshot,added_at").order("added_at", { ascending: true })
  ]);
  const firstError = [profilesResult.error, membershipsResult.error, queueResult.error, votesResult.error, requestsResult.error, sessionsResult.error, participantsResult.error].find(Boolean);
  if (firstError) throw firstError;

  const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  currentProfile = { id: authUser.id, displayName: profileMap.get(authUser.id)?.display_name || currentProfile.displayName, role: selfMembershipResult.data.role };
  members = (membershipsResult.data || []).map((membership) => {
    const name = profileMap.get(membership.user_id)?.display_name || "Discordian";
    return { id: membership.user_id, name, role: membership.role, avatar: avatarForName(name) };
  });
  joinRequests = isCurrentAdmin() ? (requestsResult.data || []) : [];
  const votesByItem = new Map();
  for (const vote of votesResult.data || []) {
    const voters = votesByItem.get(vote.queue_item_id) || [];
    voters.push(vote.user_id);
    votesByItem.set(vote.queue_item_id, voters);
  }
  movieList = (queueResult.data || []).map((item) => {
    const voters = votesByItem.get(item.id) || [];
    const posterUrl = item.poster_url || (item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null);
    return {
      id: item.id,
      title: item.title,
      year: item.release_year,
      suggestedById: item.suggested_by,
      suggestedBy: profileMap.get(item.suggested_by)?.display_name || "Former member",
      watched: item.watched,
      createdAt: item.created_at,
      votes: voters.length,
      votedByMe: voters.includes(authUser.id),
      posterUrl,
      posterPath: item.poster_path || null,
      tmdbId: item.tmdb_id || null,
      metadataUpdatedAt: item.metadata_updated_at || null,
      runtime: Number(item.runtime_minutes) || null,
      genres: normaliseGenres(item.genres),
      overview: item.overview || ""
    };
  });
  const participantsBySession = new Map();
  for (const participant of participantsResult.data || []) {
    const current = participantsBySession.get(participant.session_id) || [];
    current.push({ id: participant.profile_id, name: participant.display_name_snapshot });
    participantsBySession.set(participant.session_id, current);
  }
  const sessions = (sessionsResult.data || []).map((session) => {
    const participants = participantsBySession.get(session.id) || [];
    const selectedFromList = movieList.find((item) => item.id === session.selected_queue_item_id);
    const selectedFilm = selectedFromList || (session.selected_title ? {
      id: session.selected_queue_item_id || `session-${session.id}`,
      title: session.selected_title,
      year: session.selected_release_year,
      tmdbId: session.selected_tmdb_id,
      posterPath: session.selected_poster_path,
      posterUrl: session.selected_poster_path ? tmdbPoster(session.selected_poster_path) : null,
      runtime: Number(session.selected_runtime_minutes) || null,
      genres: normaliseGenres(session.selected_genres),
      overview: session.selected_overview || "",
      watched: false,
      createdAt: session.started_at,
    } : null);
    return {
      id: session.id,
      groupId: session.group_id,
      createdById: session.created_by,
      hostName: profileMap.get(session.created_by)?.display_name || "Former member",
      mode: session.mode,
      status: session.status,
      candidateCount: session.candidate_count,
      participantIds: participants.map((participant) => participant.id).filter(Boolean),
      participants: participants.map(({ id, name }) => ({ id, name })),
      members: participants.map((participant) => participant.name),
      selectedFilmId: session.selected_queue_item_id,
      selectedFilm,
      gameState: session.game_state || {},
      startedAt: session.started_at,
      confirmedAt: session.confirmed_at,
      endedAt: session.ended_at,
    };
  });
  activeSession = sessions.find((session) => ["ACTIVE", "CONFIRMED"].includes(session.status)) || null;
  sessionHistory = sessions.filter((session) => session.status === "ENDED");
  if (activeSession?.mode === "Queue Roulette") rouletteState = restoreRouletteState(activeSession);
  if (selectedFilmId && !movieList.some((item) => item.id === selectedFilmId)) selectedFilmId = null;
}

async function syncSession(session) {
  isLoading = true;
  authUser = session?.user || null;
  availableGroup = null;
  activeGroup = null;
  currentProfile = null;
  members = [];
  accessRequest = null;
  joinRequests = [];
  movieList = [];
  activeSession = null;
  sessionHistory = [];
  rouletteState = null;
  discordDraft = null;
  selectedFilmId = null;
  shortlistedFilmIds.clear();
  render();
  if (authUser) {
    try { await loadWorkspace(); }
    catch (error) { showToast(`Could not load The List: ${error.message}`); }
  }
  isLoading = false;
  render();
}

document.addEventListener("submit", async (event) => {
  if (event.target.matches("#discord-template-form")) {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const form = new FormData(event.target);
    discordDraft = {
      sessionId: activeSession.id,
      entryNumber: String(form.get("entry_number")).trim(),
      title: String(form.get("title")).trim(),
      year: String(form.get("year")).trim(),
      viewers: String(form.get("viewers")).trim(),
      status: String(form.get("status")) === "DNF" ? "DNF" : "Finished",
      comment: String(form.get("comment")).trim(),
    };
    const template = buildDiscordTemplate(discordDraft);
    try {
      await navigator.clipboard.writeText(template);
      showToast("Discord Journal template copied. Nothing was posted automatically.");
    } catch {
      const preview = event.target.querySelector("#discord-template-preview");
      preview.value = template;
      preview.focus();
      preview.select();
      showToast("Automatic copy was blocked. The template is selected so you can copy it manually.");
    }
    return;
  }

  if (event.target.matches("#auth-form")) {
    event.preventDefault();
    const form = new FormData(event.target);
    const submit = event.target.querySelector("button[type='submit']");
    const mode = event.target.dataset.authMode;
    submit.disabled = true;
    submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
    const credentials = { email: String(form.get("email")).trim(), password: String(form.get("password")) };
    const { data, error } = mode === "signup" ? await supabase.auth.signUp({ ...credentials, options: { data: { display_name: String(form.get("display_name")).trim() }, emailRedirectTo: `${window.location.origin}${window.location.pathname}` } }) : await supabase.auth.signInWithPassword(credentials);
    if (error) {
      submit.disabled = false;
      submit.innerHTML = `${mode === "signup" ? "Create account" : "Sign in"} <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>`;
      showToast(error.message);
      return;
    }
    if (mode === "signup" && !data.session) {
      authMode = "signin";
      render();
      showToast("Account created. Check your email, then sign in to request access.");
      return;
    }
    await syncSession(data.session);
    if (mode === "signup") showToast("Account created. Send your website access request next.");
    return;
  }

  if (event.target.matches("#request-access-form")) {
    event.preventDefault();
    const form = new FormData(event.target);
    const submit = event.target.querySelector("button[type='submit']");
    submit.disabled = true;
    const { error } = await supabase.rpc("request_group_access", { p_group_slug: "the-discordians", p_display_name: String(form.get("display_name")).trim() });
    submit.disabled = false;
    if (error) { showToast(`Request was not sent: ${error.message}`); return; }
    await loadWorkspace();
    render();
    showToast("Access request sent to The Discordians administrators.");
    return;
  }

  if (event.target.matches("#film-form")) {
    event.preventDefault();
    if (!authUser || !activeGroup) return;
    const form = new FormData(event.target);
    const title = String(form.get("title")).trim();
    const yearValue = String(form.get("year")).trim();
    const year = yearValue ? Number(yearValue) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2200)) { showToast("Enter a valid four-digit release year, or leave it blank."); return; }
    const submit = event.target.querySelector("button[type='submit']");
    submit.disabled = true;
    submit.innerHTML = `Searching… <span class="material-symbols-outlined" aria-hidden="true">progress_activity</span>`;
    pendingFilmDraft = { title, year };
    clearFilmMatches();
    setFilmSearchStatus("Searching TMDB for the best matches…");
    try {
      const { matches = [] } = await lookupMovie({ action: "search", query: title, year });
      if (matches.length) {
        renderFilmMatches(matches);
      } else {
        setFilmSearchStatus("No matching films were found. Try a broader title or add it without artwork.", "warning");
        filmManualAdd.hidden = Boolean(filmEditingId);
      }
    } catch (error) {
      setFilmSearchStatus(`${error.message} You can still keep the website list usable without artwork.`, "warning");
      filmManualAdd.hidden = Boolean(filmEditingId);
    } finally {
      submit.disabled = false;
      submit.innerHTML = `Find Movie <span class="material-symbols-outlined" aria-hidden="true">search</span>`;
    }
    return;
  }

  if (event.target.matches("[data-member-form]")) {
    event.preventDefault();
    if (!activeGroup || !isCurrentAdmin()) return;
    const form = new FormData(event.target);
    const submit = event.target.querySelector("button[type='submit']");
    submit.disabled = true;
    const { error } = await supabase.rpc("update_group_member", { p_group_id: activeGroup.id, p_user_id: event.target.dataset.userId, p_display_name: String(form.get("display_name")).trim(), p_role: String(form.get("role")) });
    submit.disabled = false;
    if (error) { showToast(`Member was not updated: ${error.message}`); return; }
    await loadWorkspace();
    render();
    showToast("Member details saved.");
  }
});

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { navigate(viewButton.dataset.view); return; }
  if (event.target.closest("[data-toggle-auth-mode]")) { authMode = authMode === "signin" ? "signup" : "signin"; render(); return; }
  const discordButton = event.target.closest("[data-auth-discord]");
  if (discordButton) {
    if (!discordAuthEnabled) return;
    discordButton.disabled = true;
    discordButton.querySelector("strong").textContent = "Opening Discord…";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: buildAuthRedirectUrl(window.location) },
    });
    if (error) {
      discordButton.disabled = false;
      discordButton.querySelector("strong").textContent = "Continue with Discord";
      showToast(`Discord sign-in could not start: ${error.message}`);
    }
    return;
  }
  if (event.target.closest("[data-nav='list']")) { event.preventDefault(); navigate("list"); return; }
  if (event.target.closest("[data-sign-out]")) { await supabase.auth.signOut(); await syncSession(null); showToast("Signed out of Cine-Cord."); return; }

  if (event.target.closest("[data-cancel-access-request]")) {
    if (!accessRequest || !window.confirm("Cancel your website access request?")) return;
    const { data, error } = await supabase.from("group_join_requests").delete().eq("id", accessRequest.id).select("id").maybeSingle();
    if (error) { showToast(`Request was not cancelled: ${error.message}`); return; }
    if (!data) { showToast("The request was not cancelled. Refresh before trying again."); return; }
    await loadWorkspace(); render(); showToast("Access request cancelled."); return;
  }
  if (event.target.closest("[data-copy-invite]")) {
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}`); showToast("Website access link copied."); }
    catch { showToast("Copy was blocked. Press and hold the link to copy it manually."); }
    return;
  }

  const approveButton = event.target.closest("[data-approve-request]");
  if (approveButton) {
    approveButton.disabled = true;
    const { error } = await supabase.rpc("approve_group_join_request", { p_request_id: approveButton.dataset.approveRequest });
    if (error) { approveButton.disabled = false; showToast(`Access was not approved: ${error.message}`); return; }
    await loadWorkspace(); render(); showToast("Member approved. Their Cine-Cord access is active."); return;
  }
  const declineButton = event.target.closest("[data-decline-request]");
  if (declineButton) {
    if (!window.confirm("Decline this website access request?")) return;
    declineButton.disabled = true;
    const { error } = await supabase.rpc("decline_group_join_request", { p_request_id: declineButton.dataset.declineRequest });
    if (error) { declineButton.disabled = false; showToast(`Request was not declined: ${error.message}`); return; }
    await loadWorkspace(); render(); showToast("Access request declined."); return;
  }
  const removeButton = event.target.closest("[data-remove-member]");
  if (removeButton) {
    const member = members.find((candidate) => candidate.id === removeButton.dataset.removeMember);
    if (!member || !window.confirm(`Remove ${member.name}'s website access? Their account will remain, but the private list will be locked.`)) return;
    removeButton.disabled = true;
    const { error } = await supabase.rpc("remove_group_member", { p_group_id: activeGroup.id, p_user_id: member.id });
    if (error) { removeButton.disabled = false; showToast(`Member was not removed: ${error.message}`); return; }
    await loadWorkspace(); render(); showToast(`${member.name}'s website access was removed.`); return;
  }

  if (event.target.closest("[data-open-film]")) { openFilmModal(); return; }
  if (event.target.closest("[data-close-film]") || event.target === filmModal) { closeFilmModal(); return; }
  if (event.target.closest("[data-open-party]")) { openPartyModal(); return; }
  if (event.target.closest("[data-close-modal]") || event.target === partyModal) { closePartyModal(); return; }

  const filterButton = event.target.closest("[data-list-filter]");
  if (filterButton) { listFilter = filterButton.dataset.listFilter; render(); return; }
  if (event.target.closest("[data-toggle-list-filters]")) {
    listFiltersOpen = !listFiltersOpen;
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-toggle-list-filters]")?.focus({ preventScroll: true }));
    return;
  }

  const selectFilmButton = event.target.closest("[data-select-film]");
  if (selectFilmButton) {
    selectedFilmId = selectFilmButton.dataset.selectFilm;
    render();
    window.requestAnimationFrame(() => document.querySelector(".film-detail-drawer")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-close-film-details]")) { selectedFilmId = null; render(); return; }

  const matchFilmButton = event.target.closest("[data-match-film]");
  if (matchFilmButton) {
    const item = movieList.find((candidate) => candidate.id === matchFilmButton.dataset.matchFilm);
    if (!item || !canManageFilm(item)) return;
    openFilmModal(item);
    return;
  }

  const movieMatchButton = event.target.closest("[data-select-movie-match]");
  if (movieMatchButton) {
    movieMatchButton.disabled = true;
    setFilmSearchStatus("Loading the full movie details…");
    try {
      const { movie } = await lookupMovie({ action: "details", tmdbId: Number(movieMatchButton.dataset.selectMovieMatch) });
      if (!movie) throw new Error("The movie details could not be loaded.");
      const result = await saveMovie(movie);
      closeFilmModal();
      await loadWorkspace();
      if (result.action === "added") selectedFilmId = movieList.find((item) => item.tmdbId === movie.tmdbId)?.id || null;
      render();
      showToast(`${result.title} ${result.action} with its poster and movie details.`);
    } catch (error) {
      movieMatchButton.disabled = false;
      setFilmSearchStatus(`Movie details were not saved: ${error.message}`, "warning");
    }
    return;
  }

  if (event.target.closest("[data-add-film-manually]")) {
    if (!pendingFilmDraft || filmEditingId) return;
    filmManualAdd.disabled = true;
    try {
      const result = await saveMovie();
      closeFilmModal();
      await loadWorkspace();
      render();
      showToast(`${result.title} added without artwork. You can match it later.`);
    } catch (error) {
      filmManualAdd.disabled = false;
      setFilmSearchStatus(`Film was not added: ${error.message}`, "warning");
    }
    return;
  }

  const shortlistButton = event.target.closest("[data-shortlist-film]");
  if (shortlistButton) {
    const item = movieList.find((candidate) => candidate.id === shortlistButton.dataset.shortlistFilm);
    if (!item) return;
    if (shortlistedFilmIds.has(item.id)) shortlistedFilmIds.delete(item.id);
    else shortlistedFilmIds.add(item.id);
    render();
    showToast(shortlistedFilmIds.has(item.id) ? `${item.title} added to tonight's shortlist.` : `${item.title} removed from tonight's shortlist.`);
    return;
  }

  const voteButton = event.target.closest("[data-vote]");
  if (voteButton) {
    const item = movieList.find((candidate) => candidate.id === voteButton.dataset.vote);
    if (!item || item.watched) return;
    voteButton.disabled = true;
    const query = item.votedByMe ? supabase.from("queue_votes").delete().eq("queue_item_id", item.id).eq("user_id", authUser.id) : supabase.from("queue_votes").insert({ queue_item_id: item.id, user_id: authUser.id });
    const { data, error } = await query.select("queue_item_id").maybeSingle();
    if (error) { voteButton.disabled = false; showToast(`Vote was not changed: ${error.message}`); return; }
    if (!data) { voteButton.disabled = false; showToast("The vote was not changed. Refresh before trying again."); return; }
    await loadWorkspace(); render(); showToast(item.votedByMe ? `Vote removed from ${item.title}.` : `Vote added for ${item.title}.`); return;
  }

  const watchedButton = event.target.closest("[data-toggle-watched]");
  if (watchedButton) {
    const item = movieList.find((candidate) => candidate.id === watchedButton.dataset.toggleWatched);
    if (!item || !canManageFilm(item)) return;
    watchedButton.disabled = true;
    const { data, error } = await supabase.from("queue_items").update({ watched: !item.watched }).eq("id", item.id).eq("group_id", activeGroup.id).select("id").maybeSingle();
    if (error) { watchedButton.disabled = false; showToast(`Film status was not changed: ${error.message}`); return; }
    if (!data) { watchedButton.disabled = false; showToast("Film status was not changed. Refresh before trying again."); return; }
    await loadWorkspace(); render(); showToast(`${item.title} marked ${item.watched ? "ready" : "watched"}.`); return;
  }

  const deleteFilmButton = event.target.closest("[data-remove-film]");
  if (deleteFilmButton) {
    const item = movieList.find((candidate) => candidate.id === deleteFilmButton.dataset.removeFilm);
    if (!item || !canManageFilm(item) || !window.confirm(`Remove ${item.title} from the website list? This does not change Discord.`)) return;
    deleteFilmButton.disabled = true;
    const { data, error } = await supabase.from("queue_items").delete().eq("id", item.id).eq("group_id", activeGroup.id).select("id").maybeSingle();
    if (error) { deleteFilmButton.disabled = false; showToast(`Film was not removed: ${error.message}`); return; }
    if (!data) { deleteFilmButton.disabled = false; showToast("The film was not removed. Refresh before trying again."); return; }
    selectedFilmId = null;
    shortlistedFilmIds.delete(item.id);
    await loadWorkspace(); render(); showToast(`${item.title} removed from the website list. Discord was not changed.`); return;
  }

  const modeButton = event.target.closest("[data-select-mode]");
  if (modeButton) { openPartyModal(modeButton.dataset.selectMode); return; }
  if (event.target.closest("[data-clear-roulette-filters]")) {
    if (!rouletteState || !canManageSession() || ["spinning", "settling"].includes(rouletteState.phase) || !rouletteHasActiveFilters()) return;
    const previousState = cloneRouletteState();
    rouletteState.filters.runtime = "any";
    rouletteState.filters.genre = "all";
    rouletteState.filters.includeWatched = false;
    rouletteState.excludedFilmIds = [];
    resetRouletteOutcome();
    render();
    try {
      await persistRouletteState();
      showToast("Roulette filters cleared and removed films restored.");
    } catch (error) {
      rouletteState = previousState;
      render();
      showToast(`Roulette filters were not cleared: ${error.message}`);
    }
    return;
  }
  const excludeRouletteFilmButton = event.target.closest("[data-exclude-roulette-film]");
  if (excludeRouletteFilmButton) {
    if (!rouletteState || !canManageSession() || rouletteState.phase !== "ready") return;
    const item = movieList.find((candidate) => candidate.id === excludeRouletteFilmButton.dataset.excludeRouletteFilm);
    const candidates = getRouletteCandidates();
    if (!item || !candidates.some((candidate) => candidate.id === item.id)) return;
    if (candidates.length <= 1) {
      showToast("The final eligible film cannot be removed from this round.");
      return;
    }
    const previousState = cloneRouletteState();
    rouletteState.excludedFilmIds.push(item.id);
    resetRouletteOutcome();
    render();
    try {
      await persistRouletteState();
      showToast(`${item.title} removed from this round. Clear filters to restore it.`);
    } catch (error) {
      rouletteState = previousState;
      render();
      showToast(`The film was not removed from Roulette: ${error.message}`);
    }
    return;
  }
  if (event.target.closest("[data-spin-roulette]")) { await spinRoulette(); return; }
  const vetoButton = event.target.closest("[data-veto-member]");
  if (vetoButton) { await spinRoulette(vetoButton.dataset.vetoMember); return; }
  if (event.target.closest("[data-toggle-journal-details]")) {
    event.preventDefault();
    journalDetailsOpen = !journalDetailsOpen;
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-toggle-journal-details]")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-toggle-roulette-overview]")) {
    rouletteState.overviewOpen = !rouletteState.overviewOpen;
    render();
    return;
  }
  if (event.target.closest("[data-request-reroll]")) {
    rouletteState.rerollConfirmOpen = true;
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-reroll-roulette]")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-cancel-reroll]")) {
    rouletteState.rerollConfirmOpen = false;
    render();
    return;
  }
  if (event.target.closest("[data-reroll-roulette]")) { await spinRoulette(); return; }
  if (event.target.closest("[data-confirm-roulette]")) {
    if (!rouletteState?.winnerId || !activeSession) return;
    const winner = movieList.find((item) => item.id === rouletteState.winnerId);
    if (!winner || !canManageSession()) return;
    const confirmButton = event.target.closest("[data-confirm-roulette]");
    confirmButton.disabled = true;
    try {
      await confirmMovieSession(winner);
      render();
      window.requestAnimationFrame(() => document.querySelector("#roulette-winner-title")?.focus({ preventScroll: true }));
    } catch (error) {
      confirmButton.disabled = false;
      showToast(`The session was not confirmed: ${error.message}`);
    }
    return;
  }
  if (event.target.closest("[data-new-roulette]")) {
    if (!canManageSession()) return;
    try {
      await resetMovieSessionRoulette();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("A new round is ready. The previous choice was not sent to Discord.");
    } catch (error) { showToast(`The new round was not started: ${error.message}`); }
    return;
  }
  if (event.target.closest("[data-continue-roulette]")) { navigate(activeSession?.mode === "Queue Roulette" ? "pick" : "sessions"); return; }
  if (event.target.closest("[data-close-roulette]")) {
    if (!canManageSession() || !window.confirm("End this Queue Roulette session? Its saved history will remain, and the movie list and Discord will not change.")) return;
    try {
      await endMovieSession();
      navigate("sessions");
      showToast("Queue Roulette ended and was kept in session history. Discord was not changed.");
    } catch (error) { showToast(`The session was not ended: ${error.message}`); }
    return;
  }
  if (event.target.closest("[data-end-session]")) {
    if (!canManageSession() || !window.confirm("End this movie-night session? Its saved history will remain.")) return;
    try { await endMovieSession(); render(); showToast("Session ended and saved to history. Discord was not changed."); }
    catch (error) { showToast(`The session was not ended: ${error.message}`); }
  }
});

document.addEventListener("input", (event) => {
  const form = event.target.closest("#discord-template-form");
  if (form) updateDiscordDraftPreview(form);
});

document.addEventListener("change", async (event) => {
  const discordForm = event.target.closest("#discord-template-form");
  if (discordForm) { updateDiscordDraftPreview(discordForm); return; }
  if (event.target.matches("#list-sort")) { listSort = event.target.value; render(); }
  if (event.target.matches("#genre-filter")) { genreFilter = event.target.value; render(); }
  if (event.target.matches("#member-filter")) { memberFilter = event.target.value; render(); }
  const isRouletteControl = event.target.matches("#roulette-runtime, #roulette-genre, #roulette-rewatches, #roulette-age-weight");
  if (isRouletteControl && !canManageSession()) {
    render();
    showToast("Only the session host or a website administrator can change Roulette filters.");
    return;
  }
  if (isRouletteControl && ["spinning", "settling"].includes(rouletteState?.phase)) {
    render();
    return;
  }
  const previousRouletteState = isRouletteControl ? cloneRouletteState() : null;
  let rouletteChanged = false;
  if (event.target.matches("#roulette-runtime")) { rouletteState.filters.runtime = event.target.value; rouletteChanged = true; }
  if (event.target.matches("#roulette-genre")) { rouletteState.filters.genre = event.target.value; rouletteChanged = true; }
  if (event.target.matches("#roulette-rewatches")) { rouletteState.filters.includeWatched = event.target.checked; rouletteChanged = true; }
  if (event.target.matches("#roulette-age-weight")) { rouletteState.filters.weightedByAge = event.target.checked; rouletteChanged = true; }
  if (rouletteChanged) {
    resetRouletteOutcome();
    render();
    try { await persistRouletteState(); }
    catch (error) {
      rouletteState = previousRouletteState;
      render();
      showToast(`Roulette filters were not saved: ${error.message}`);
    }
  }
});

partyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(partyForm);
  const selectedMemberIds = form.getAll("members").map(String);
  if (!selectedMemberIds.length) { showToast("Choose at least one Discordian."); return; }
  const mode = String(form.get("mode"));
  if (!decisionModes.some((candidate) => candidate.title === mode && candidate.available)) {
    showToast("That decision game is not available yet. Choose Queue Roulette.");
    return;
  }
  const submit = partyForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await createMovieSession(selectedMemberIds, mode);
    closePartyModal();
    navigate(mode === "Queue Roulette" ? "pick" : "sessions");
    showToast(`${mode} session created and saved for ${selectedMemberIds.length} people.`);
  } catch (error) {
    showToast(`The session was not created: ${error.message}`);
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (selectedFilmId) { selectedFilmId = null; render(); return; }
  if (!partyModal.hidden) closePartyModal();
  if (!filmModal.hidden) closeFilmModal();
});

window.addEventListener("hashchange", () => {
  const requestedView = window.location.hash.replace("#", "");
  const nextView = legacyViewMap[requestedView] || requestedView;
  if (nextView && nextView !== currentView && authUser && activeGroup) { currentView = nextView; render(); }
});

if (designPreviewMode) {
  loadDesignPreviewWorkspace();
  render();
} else {
  await loadAuthProviderAvailability();
  const callbackError = oauthCallbackError(window.location);
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => { if (session?.user?.id !== authUser?.id) syncSession(session); }, 0);
  });

  const { data: sessionData } = await supabase.auth.getSession();
  await syncSession(sessionData.session);
  if (callbackError) {
    window.history.replaceState({}, "", withoutOAuthError(window.location.href));
    showToast(`Discord sign-in failed: ${callbackError}`);
  }
}
