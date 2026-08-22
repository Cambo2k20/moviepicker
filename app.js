import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tbmxxdodprmynyiiaofj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D-ZMbt0ttcYPHEDtghl7AQ_wstwsoti";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const designPreviewMode = ["terminal.local", "localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has("design-preview");

const knownAvatars = {
  cameron: "./assets/avatar-cameron.png",
  dean: "./assets/avatar-dean.png",
  kieran: "./assets/avatar-kieran.png",
  andrew: "./assets/avatar-andrew.png",
  ross: "./assets/avatar-ross.png"
};

const decisionModes = [
  { code: "01", title: "Consensus Sprint", tone: "Fair and fast", copy: "Everyone privately chooses yes, maybe or no. The strongest shared approval becomes tonight's finalist." },
  { code: "02", title: "Queue Roulette", tone: "Weighted chaos", copy: "Older list entries receive more weight. Add one veto each, or turn on No Cowards mode." },
  { code: "03", title: "Reel Bracket", tone: "Competitive", copy: "Put the shortlist through head-to-head votes until only one film survives." }
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
let listQuery = "";
let listFilter = "all";
let listSort = "votes";
let genreFilter = "all";
let memberFilter = "all";
let selectedFilmId = null;
const shortlistedFilmIds = new Set();
let rouletteState = null;
let rouletteSpinTimer = null;
let rouletteSpinToken = 0;
let filmEditingId = null;
let pendingFilmDraft = null;
let authMode = "signin";
let isLoading = true;
let toastTimer;

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
  return knownAvatars[String(name).trim().toLowerCase()] || "./assets/avatar-cameron.png";
}

function isCurrentAdmin() {
  return currentProfile?.role === "admin";
}

function canManageFilm(item) {
  return isCurrentAdmin() || item.suggestedById === authUser?.id;
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
  return "./assets/hero-journal-web.png";
}

function tmdbPoster(path, size = "w500") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : "./assets/hero-journal-web.png";
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

function createRouletteState(sessionMembers) {
  return {
    phase: "ready",
    members: [...sessionMembers],
    usedVetoes: [],
    winnerId: null,
    poolOpen: false,
    previewIds: [],
    filters: {
      runtime: "120",
      genre: "all",
      includeWatched: false,
      weightedByAge: true,
    },
  };
}

function getRouletteCandidates() {
  if (!rouletteState) return [];
  const runtimeLimit = Number(rouletteState.filters.runtime) || null;
  return movieList.filter((item) => {
    if (!rouletteState.filters.includeWatched && item.watched) return false;
    if (runtimeLimit && item.runtime && item.runtime > runtimeLimit) return false;
    if (rouletteState.filters.genre !== "all" && !item.genres.some((genre) => genre.toLowerCase() === rouletteState.filters.genre)) return false;
    return true;
  });
}

function rouletteWeights(candidates) {
  const byAge = [...candidates].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const denominator = Math.max(1, byAge.length - 1);
  return new Map(byAge.map((item, index) => {
    const weight = rouletteState?.filters.weightedByAge && byAge.length > 1
      ? 4 - Math.floor((index / denominator) * 3)
      : 1;
    return [item.id, Math.max(1, weight)];
  }));
}

function weightedRoulettePick(candidates) {
  const weights = rouletteWeights(candidates);
  const total = candidates.reduce((sum, item) => sum + (weights.get(item.id) || 1), 0);
  let draw = Math.random() * total;
  for (const item of candidates) {
    draw -= weights.get(item.id) || 1;
    if (draw <= 0) return item;
  }
  return candidates.at(-1);
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
    const { error } = await supabase.from("queue_items").update(payload).eq("id", item.id).eq("group_id", activeGroup.id);
    if (error) throw error;
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
        <p>${isSignup ? "Create an account, confirm your email if asked, then request approval from a Cine-Cord administrator." : "Sign in to use the shared movie list and decision room. The website works even when the Discord bot is offline."}</p>
        <form id="auth-form" class="access-form" data-auth-mode="${isSignup ? "signup" : "signin"}">
          ${isSignup ? `<label><span>Display name</span><input name="display_name" required maxlength="40" autocomplete="nickname" placeholder="How your friends know you" /></label>` : ""}
          <label><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com" /></label>
          <label><span>Password</span><input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="${isSignup ? "8" : "6"}" /></label>
          <button class="primary-button full-width" type="submit">${isSignup ? "Create account" : "Sign in"} <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
        </form>
        <button class="auth-mode-toggle" type="button" data-toggle-auth-mode>${isSignup ? "Already have an account? Sign in" : "New Discordian? Create an account"}</button>
        <span class="access-note">Approval protects the private group list. Creating an account alone reveals no group data.</span>
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
        <div><span class="eyebrow">The Discordians · Shared watchlist</span><h1 id="list-title" class="page-title">The List</h1><p class="page-subtitle">The films we’re saving for the right time.</p></div>
        <div class="list-hero-actions"><button class="primary-button" type="button" data-open-film><span class="material-symbols-outlined" aria-hidden="true">add</span> Add Film</button><button class="secondary-button" type="button" data-open-party>Pick Tonight <span class="material-symbols-outlined" aria-hidden="true">casino</span></button></div>
      </header>
      <div class="list-toolbar">
        <label class="search-field list-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="list-search" type="search" value="${escapeHTML(listQuery)}" placeholder="Search the list" aria-label="Search The List" /></label>
        <div class="filter-tabs" aria-label="Filter The List">${["all", "ready", "watched"].map((filter) => `<button type="button" class="filter-tab ${listFilter === filter ? "is-active" : ""}" data-list-filter="${filter}">${filter[0].toUpperCase()}${filter.slice(1)}</button>`).join("")}</div>
        <label class="compact-select"><span class="sr-only">Genre</span><select id="genre-filter" aria-label="Filter by genre"><option value="all">All genres</option>${genres.map((genre) => `<option value="${escapeHTML(genre.toLowerCase())}" ${genreFilter === genre.toLowerCase() ? "selected" : ""}>${escapeHTML(genre)}</option>`).join("")}</select></label>
        <label class="compact-select"><span class="sr-only">Added by</span><select id="member-filter" aria-label="Filter by who added it"><option value="all">Added by anyone</option>${suggesters.map(([id, name]) => `<option value="${escapeHTML(id)}" ${memberFilter === id ? "selected" : ""}>${escapeHTML(name)}</option>`).join("")}</select></label>
        <label class="compact-select sort-field"><span class="sr-only">Sort</span><select id="list-sort" aria-label="Sort The List"><option value="votes" ${listSort === "votes" ? "selected" : ""}>Most voted</option><option value="oldest" ${listSort === "oldest" ? "selected" : ""}>Longest waiting</option><option value="newest" ${listSort === "newest" ? "selected" : ""}>Newest</option></select></label>
      </div>
      <div class="library-layout ${selectedFilm ? "has-selection" : ""}">
        <div class="poster-grid" aria-live="polite">${visibleFilms.length ? visibleFilms.map(renderFilmCard).join("") : `<div class="empty-state list-empty"><span class="material-symbols-outlined" aria-hidden="true">movie</span><h2>${movieList.length ? "No films match that view." : "The List is empty."}</h2><p>${movieList.length ? "Try another search or filter." : "Add the first suggestion and give the group something to argue about."}</p><button class="secondary-button" type="button" data-open-film>Add a film</button></div>`}</div>
        ${selectedFilm ? renderFilmDetails(selectedFilm) : ""}
      </div>
    </section>`;
}

function renderRouletteParticipants() {
  if (!rouletteState) return "";
  return rouletteState.members.map((name) => `
    <span class="roulette-player" title="${escapeHTML(name)}">
      <img src="${escapeHTML(avatarForName(name))}" alt="" />
      <span>${escapeHTML(name)}</span>
    </span>`).join("");
}

function renderRoulettePool(candidates) {
  if (!rouletteState) return "";
  const genres = [...new Set(movieList.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
  return `
    <section class="roulette-pool ${rouletteState.poolOpen ? "is-open" : ""}" aria-labelledby="roulette-pool-title">
      <button class="roulette-pool-toggle" type="button" data-adjust-roulette aria-expanded="${rouletteState.poolOpen}">
        <span><span class="material-symbols-outlined" aria-hidden="true">tune</span><strong id="roulette-pool-title">Adjust pool</strong><small>${candidates.length} eligible ${candidates.length === 1 ? "film" : "films"}</small></span>
        <span class="material-symbols-outlined" aria-hidden="true">${rouletteState.poolOpen ? "expand_less" : "expand_more"}</span>
      </button>
      <div class="roulette-pool-controls" ${rouletteState.poolOpen ? "" : "hidden"}>
        <label><span>Maximum runtime</span><select id="roulette-runtime"><option value="any" ${rouletteState.filters.runtime === "any" ? "selected" : ""}>Any runtime</option><option value="90" ${rouletteState.filters.runtime === "90" ? "selected" : ""}>Under 90 min</option><option value="120" ${rouletteState.filters.runtime === "120" ? "selected" : ""}>Under 120 min</option><option value="150" ${rouletteState.filters.runtime === "150" ? "selected" : ""}>Under 150 min</option></select></label>
        <label><span>Genre</span><select id="roulette-genre"><option value="all">Any genre</option>${genres.map((genre) => `<option value="${escapeHTML(genre.toLowerCase())}" ${rouletteState.filters.genre === genre.toLowerCase() ? "selected" : ""}>${escapeHTML(genre)}</option>`).join("")}</select></label>
        <label class="roulette-switch"><input id="roulette-rewatches" type="checkbox" ${rouletteState.filters.includeWatched ? "checked" : ""} /><span><strong>Allow rewatches</strong><small>Include films already marked watched.</small></span></label>
        <label class="roulette-switch"><input id="roulette-age-weight" type="checkbox" ${rouletteState.filters.weightedByAge ? "checked" : ""} /><span><strong>Weight older entries</strong><small>The longest-waiting films get up to 4× chance.</small></span></label>
      </div>
    </section>`;
}

function renderRouletteWheel(candidates) {
  if (!rouletteState) return "";
  const preview = rouletteState.previewIds.length
    ? rouletteState.previewIds.map((id) => candidates.find((item) => item.id === id) || movieList.find((item) => item.id === id)).filter(Boolean)
    : roulettePreviewFilms(candidates);
  const filledPreview = preview.length ? Array.from({ length: 8 }, (_, index) => preview[index % preview.length]) : [];
  return `
    <div class="roulette-wheel-stage" aria-label="Queue Roulette wheel containing ${candidates.length} eligible films">
      <span class="roulette-pointer material-symbols-outlined" aria-hidden="true">arrow_drop_down</span>
      <div class="roulette-wheel-track ${rouletteState.phase === "spinning" ? "is-spinning" : ""}" data-roulette-wheel>
        ${filledPreview.map((item, index) => `<span class="roulette-segment" style="--segment-index:${index}"><img src="${escapeHTML(filmPoster(item))}" alt="" /></span>`).join("")}
        <span class="roulette-hub"><strong>${candidates.length}</strong><small>Eligible</small></span>
      </div>
    </div>`;
}

function renderRouletteReady(candidates) {
  const isSpinning = rouletteState?.phase === "spinning";
  const filterLabels = rouletteFilterLabels();
  const remainingVetoes = rouletteState.members.filter((name) => !rouletteState.usedVetoes.includes(name));
  return `
    <div class="roulette-ready-layout">
      <div class="roulette-stage-column">
        ${renderRouletteWheel(candidates)}
        <div class="roulette-filter-summary" aria-label="Current candidate filters">${filterLabels.map((label, index) => `<span><span class="material-symbols-outlined" aria-hidden="true">${["schedule", "local_offer", "check_circle"][index]}</span>${escapeHTML(label)}</span>`).join("")}</div>
        <p class="roulette-weight-note"><span class="material-symbols-outlined" aria-hidden="true">info</span>${rouletteState.filters.weightedByAge ? "Older list entries have extra weight." : "Every eligible film has an equal chance."}</p>
      </div>
      <aside class="roulette-control-column">
        ${renderRoulettePool(candidates)}
        <section class="roulette-veto-panel" aria-labelledby="roulette-veto-title"><span class="eyebrow" id="roulette-veto-title">Veto tokens</span><p>Each player can reject one result.</p><div class="roulette-veto-list">${rouletteState.members.map((name) => `<span class="roulette-veto-token ${rouletteState.usedVetoes.includes(name) ? "is-used" : ""}"><img src="${escapeHTML(avatarForName(name))}" alt="" /><strong>${rouletteState.usedVetoes.includes(name) ? "Used" : "1"}</strong></span>`).join("")}</div><small>${remainingVetoes.length} remaining</small></section>
        <button class="primary-button roulette-spin-button" type="button" data-spin-roulette ${!candidates.length || isSpinning ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">casino</span>${isSpinning ? "Spinning…" : "Spin the list"}</button>
        ${candidates.length ? "" : `<p class="roulette-empty-warning">No films match these filters. Adjust the pool to continue.</p>`}
      </aside>
    </div>`;
}

function renderRouletteReveal(candidates, winner) {
  const weights = rouletteWeights(candidates);
  const weight = weights.get(winner.id) || 1;
  const orbitFilms = [...candidates.filter((item) => item.id !== winner.id), ...movieList.filter((item) => item.id !== winner.id)].slice(0, 4);
  const confirmed = rouletteState.phase === "confirmed";
  return `
    <div class="roulette-result-layout ${confirmed ? "is-confirmed" : ""}">
      <div class="roulette-result-stage">
        <div class="roulette-orbit" aria-hidden="true">
          ${orbitFilms.map((item, index) => `<span class="roulette-orbit-card orbit-${index + 1}"><img src="${escapeHTML(filmPoster(item))}" alt="" /></span>`).join("")}
          <div class="roulette-winning-poster"><img src="${escapeHTML(filmPoster(winner))}" alt="${escapeHTML(winner.title)} poster" /><span>${weight}×</span></div>
        </div>
      </div>
      <section class="roulette-result-copy" aria-labelledby="roulette-winner-title">
        <span class="eyebrow">${confirmed ? "Tonight's film" : "Roulette selected"}</span>
        <div class="roulette-winner-heading"><div><h2 id="roulette-winner-title">${escapeHTML(winner.title)}</h2><p>${winner.year ? escapeHTML(winner.year) : "Year pending"}</p></div><span class="status-pill ${winner.watched ? "watched" : "ready"}">${winner.watched ? "Rewatch" : "Ready"}</span></div>
        <div class="roulette-winner-facts"><span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>${escapeHTML(runtimeLabel(winner))}</span>${winner.genres.slice(0, 3).map((genre) => `<span>${escapeHTML(genre)}</span>`).join("")}<span><span class="material-symbols-outlined" aria-hidden="true">weight</span>${weight}× chance</span></div>
        <p class="roulette-winner-overview">${escapeHTML(winner.overview || "The wheel has made its choice. Confirm it for tonight, spin again, or let one player spend their veto.")}</p>
        ${confirmed ? `
          <div class="roulette-confirmed-note"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span><div><strong>Choice confirmed</strong><p>The website list and Discord have not been changed.</p></div></div>
          <button class="primary-button roulette-wide-action" type="button" data-new-roulette><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Start another round</button>
          <button class="secondary-button roulette-wide-action" type="button" data-view="list">Return to The List</button>` : `
          <section class="roulette-result-vetoes" aria-labelledby="result-veto-title"><span class="eyebrow" id="result-veto-title">Use a veto to spin again</span><div>${rouletteState.members.map((name) => { const used = rouletteState.usedVetoes.includes(name); return `<button type="button" data-veto-member="${escapeHTML(name)}" ${used ? "disabled" : ""} aria-label="${used ? `${escapeHTML(name)} has used their veto` : `${escapeHTML(name)} vetoes ${escapeHTML(winner.title)}`}"><img src="${escapeHTML(avatarForName(name))}" alt="" /><span>${escapeHTML(name)}</span><strong>${used ? "Used" : "Veto"}</strong></button>`; }).join("")}</div></section>
          <button class="primary-button roulette-wide-action" type="button" data-confirm-roulette><span class="material-symbols-outlined" aria-hidden="true">check</span>Confirm for tonight</button>
          <button class="secondary-button roulette-wide-action" type="button" data-reroll-roulette><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Spin again without a veto</button>`}
      </section>
    </div>`;
}

function renderQueueRoulette() {
  const candidates = getRouletteCandidates();
  const winner = rouletteState?.winnerId ? movieList.find((item) => item.id === rouletteState.winnerId) : null;
  return `
    <section class="roulette-game" aria-labelledby="roulette-title">
      <header class="roulette-header">
        <div><span class="eyebrow">Pick Tonight · Weighted chaos</span><h1 id="roulette-title">Queue Roulette</h1></div>
        <button class="icon-button roulette-close" type="button" data-close-roulette aria-label="End Queue Roulette"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
      </header>
      <div class="roulette-session-strip"><div class="roulette-players">${renderRouletteParticipants()}</div><span><strong>${candidates.length}</strong> eligible</span></div>
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
      <div class="mode-list">${decisionModes.map((mode) => `<article class="mode-row"><span class="mode-icon">${mode.code}</span><div><span class="mode-tone">${mode.tone}</span><h3>${mode.title}</h3><p>${mode.copy}</p></div><button class="secondary-button" type="button" data-select-mode="${mode.title}" ${candidateCount ? "" : "disabled"}>Choose</button></article>`).join("")}</div>
    </section>`;
}

function renderSessions() {
  const rouletteWinner = activeSession?.confirmedFilmId ? movieList.find((item) => item.id === activeSession.confirmedFilmId) : null;
  return `
    <section class="page-view" aria-labelledby="sessions-title">
      <header class="page-header"><div><span class="eyebrow">Decision rooms</span><h1 id="sessions-title" class="page-title">Sessions</h1><p class="page-subtitle">The place for live film-picking rooms—not the Discord Journal.</p></div><button class="primary-button" type="button" data-open-party>New Session <span class="material-symbols-outlined" aria-hidden="true">add</span></button></header>
      ${activeSession ? `<article class="active-session session-feature"><div class="active-session-head"><div><span class="eyebrow">Active session · ${escapeHTML(activeSession.mode)}</span><h3>${activeSession.mode === "Queue Roulette" ? (rouletteWinner ? `${escapeHTML(rouletteWinner.title)} is confirmed for tonight.` : "The wheel is ready when you are.") : "This game is prepared for a future build."}</h3><p class="session-members">${activeSession.members.map(escapeHTML).join(", ")}</p><p>${activeSession.candidateCount} list ${activeSession.candidateCount === 1 ? "film" : "films"} available for this session.</p></div><div class="session-actions">${activeSession.mode === "Queue Roulette" ? `<button class="primary-button compact" type="button" data-continue-roulette>${rouletteWinner ? "View result" : "Continue Roulette"}</button>` : ""}<button class="secondary-button" type="button" data-end-session>End Session</button></div></div></article>` : `<div class="empty-state session-empty"><span class="material-symbols-outlined" aria-hidden="true">groups</span><h2>No active session.</h2><p>Start with Consensus Sprint, Queue Roulette or a Reel Bracket.</p><button class="secondary-button" type="button" data-open-party>Choose a game</button></div>`}
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

function openPartyModal(mode = "Consensus Sprint") {
  if (!movieList.some((item) => !item.watched)) {
    showToast("Add at least one ready film before starting a session.");
    return;
  }
  partyMembers.innerHTML = members.map((member, index) => `<label class="member-choice"><input type="checkbox" name="members" value="${escapeHTML(member.name)}" ${index < 3 ? "checked" : ""} /><img src="${member.avatar}" alt="" /><span>${escapeHTML(member.name)}</span></label>`).join("");
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

function spinRoulette(vetoMember = null) {
  if (!rouletteState || rouletteState.phase === "spinning") return;
  const candidates = getRouletteCandidates();
  if (!candidates.length) {
    showToast("No films match the current Roulette filters.");
    return;
  }
  if (vetoMember) {
    if (!rouletteState.members.includes(vetoMember) || rouletteState.usedVetoes.includes(vetoMember)) return;
    rouletteState.usedVetoes.push(vetoMember);
  }
  const winner = weightedRoulettePick(candidates);
  const preview = roulettePreviewFilms(candidates, winner);
  rouletteState.winnerId = winner.id;
  rouletteState.previewIds = preview.map((item) => item.id);
  rouletteState.phase = "spinning";
  const spinToken = ++rouletteSpinToken;
  render();
  rouletteSpinTimer = window.setTimeout(() => {
    if (!rouletteState || rouletteSpinToken !== spinToken) return;
    rouletteState.phase = "reveal";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 1800);
}

function endRoulette() {
  stopRouletteSpin();
  rouletteState = null;
  if (activeSession?.mode === "Queue Roulette") activeSession = null;
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
  if (!availableGroup) return;

  const [selfProfileResult, selfMembershipResult, selfRequestResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name").eq("id", authUser.id).maybeSingle(),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle(),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle()
  ]);
  const accessError = [selfProfileResult.error, selfMembershipResult.error, selfRequestResult.error].find(Boolean);
  if (accessError) throw accessError;
  currentProfile = { id: authUser.id, displayName: selfProfileResult.data?.display_name || authUser.email?.split("@")[0] || "Discordian", role: selfMembershipResult.data?.role || null };
  accessRequest = selfRequestResult.data || null;
  if (!selfMembershipResult.data) return;

  activeGroup = availableGroup;
  const [profilesResult, membershipsResult, queueResult, votesResult, requestsResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name"),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", activeGroup.id),
    supabase.from("queue_items").select("*").eq("group_id", activeGroup.id).order("created_at", { ascending: true }),
    supabase.from("queue_votes").select("queue_item_id,user_id,created_at"),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", activeGroup.id).order("created_at", { ascending: true })
  ]);
  const firstError = [profilesResult.error, membershipsResult.error, queueResult.error, votesResult.error, requestsResult.error].find(Boolean);
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
      tmdbId: item.tmdb_id || null,
      metadataUpdatedAt: item.metadata_updated_at || null,
      runtime: Number(item.runtime_minutes) || null,
      genres: normaliseGenres(item.genres),
      overview: item.overview || ""
    };
  });
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
  if (event.target.closest("[data-nav='list']")) { event.preventDefault(); navigate("list"); return; }
  if (event.target.closest("[data-sign-out]")) { await supabase.auth.signOut(); await syncSession(null); showToast("Signed out of Cine-Cord."); return; }

  if (event.target.closest("[data-cancel-access-request]")) {
    if (!accessRequest || !window.confirm("Cancel your website access request?")) return;
    const { error } = await supabase.from("group_join_requests").delete().eq("id", accessRequest.id);
    if (error) { showToast(`Request was not cancelled: ${error.message}`); return; }
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
    const { error } = await query;
    if (error) { voteButton.disabled = false; showToast(`Vote was not changed: ${error.message}`); return; }
    await loadWorkspace(); render(); showToast(item.votedByMe ? `Vote removed from ${item.title}.` : `Vote added for ${item.title}.`); return;
  }

  const watchedButton = event.target.closest("[data-toggle-watched]");
  if (watchedButton) {
    const item = movieList.find((candidate) => candidate.id === watchedButton.dataset.toggleWatched);
    if (!item || !canManageFilm(item)) return;
    watchedButton.disabled = true;
    const { error } = await supabase.from("queue_items").update({ watched: !item.watched }).eq("id", item.id);
    if (error) { watchedButton.disabled = false; showToast(`Film status was not changed: ${error.message}`); return; }
    await loadWorkspace(); render(); showToast(`${item.title} marked ${item.watched ? "ready" : "watched"}.`); return;
  }

  const deleteFilmButton = event.target.closest("[data-remove-film]");
  if (deleteFilmButton) {
    const item = movieList.find((candidate) => candidate.id === deleteFilmButton.dataset.removeFilm);
    if (!item || !canManageFilm(item) || !window.confirm(`Remove ${item.title} from the website list? This does not change Discord.`)) return;
    deleteFilmButton.disabled = true;
    const { error } = await supabase.from("queue_items").delete().eq("id", item.id).eq("group_id", activeGroup.id);
    if (error) { deleteFilmButton.disabled = false; showToast(`Film was not removed: ${error.message}`); return; }
    selectedFilmId = null;
    shortlistedFilmIds.delete(item.id);
    await loadWorkspace(); render(); showToast(`${item.title} removed from the website list. Discord was not changed.`); return;
  }

  const modeButton = event.target.closest("[data-select-mode]");
  if (modeButton) { openPartyModal(modeButton.dataset.selectMode); return; }
  if (event.target.closest("[data-adjust-roulette]")) { rouletteState.poolOpen = !rouletteState.poolOpen; render(); return; }
  if (event.target.closest("[data-spin-roulette]")) { spinRoulette(); return; }
  const vetoButton = event.target.closest("[data-veto-member]");
  if (vetoButton) { spinRoulette(vetoButton.dataset.vetoMember); return; }
  if (event.target.closest("[data-reroll-roulette]")) { spinRoulette(); return; }
  if (event.target.closest("[data-confirm-roulette]")) {
    if (!rouletteState?.winnerId || !activeSession) return;
    rouletteState.phase = "confirmed";
    activeSession.confirmedFilmId = rouletteState.winnerId;
    render();
    showToast("Tonight's film is confirmed. The list and Discord were not changed.");
    return;
  }
  if (event.target.closest("[data-new-roulette]")) {
    const sessionMembers = [...rouletteState.members];
    rouletteState = createRouletteState(sessionMembers);
    if (activeSession) delete activeSession.confirmedFilmId;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (event.target.closest("[data-continue-roulette]")) { navigate("pick"); return; }
  if (event.target.closest("[data-close-roulette]")) {
    if (!window.confirm("End this Queue Roulette session? The movie list and Discord will not change.")) return;
    endRoulette();
    render();
    showToast("Queue Roulette ended. The movie list was not changed.");
    return;
  }
  if (event.target.closest("[data-end-session]")) { endRoulette(); activeSession = null; render(); showToast("Session ended. The movie list was not changed."); }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#list-sort")) { listSort = event.target.value; render(); }
  if (event.target.matches("#genre-filter")) { genreFilter = event.target.value; render(); }
  if (event.target.matches("#member-filter")) { memberFilter = event.target.value; render(); }
  if (event.target.matches("#roulette-runtime")) { rouletteState.filters.runtime = event.target.value; rouletteState.winnerId = null; rouletteState.previewIds = []; render(); }
  if (event.target.matches("#roulette-genre")) { rouletteState.filters.genre = event.target.value; rouletteState.winnerId = null; rouletteState.previewIds = []; render(); }
  if (event.target.matches("#roulette-rewatches")) { rouletteState.filters.includeWatched = event.target.checked; rouletteState.winnerId = null; rouletteState.previewIds = []; render(); }
  if (event.target.matches("#roulette-age-weight")) { rouletteState.filters.weightedByAge = event.target.checked; rouletteState.winnerId = null; rouletteState.previewIds = []; render(); }
});

partyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(partyForm);
  const selectedMembers = form.getAll("members");
  if (!selectedMembers.length) { showToast("Choose at least one Discordian."); return; }
  activeSession = { members: selectedMembers, mode: String(form.get("mode")), candidateCount: movieList.filter((item) => !item.watched).length };
  closePartyModal();
  if (activeSession.mode === "Queue Roulette") {
    rouletteState = createRouletteState(selectedMembers);
    navigate("pick");
  } else {
    rouletteState = null;
    navigate("sessions");
  }
  showToast(`${activeSession.mode} session created for ${selectedMembers.length} people.`);
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
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => { if (session?.user?.id !== authUser?.id) syncSession(session); }, 0);
  });

  const { data: sessionData } = await supabase.auth.getSession();
  await syncSession(sessionData.session);
}
