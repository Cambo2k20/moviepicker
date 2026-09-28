import { createClient } from "@supabase/supabase-js";
import {
  calculateRouletteWeights,
  createRouletteState,
  filterRouletteCandidates,
  pickRouletteLandingAngle,
  pickWeightedRouletteCandidate,
  restoreRouletteState,
  rouletteWaitingSince,
  serialiseRouletteState as serialiseRouletteStateValue,
} from "./roulette-core.js";
import {
  discordOAuthOptions,
  discordProviderEnabled,
  oauthCallbackError,
  preferredAuthDisplayName,
  withoutOAuthError,
} from "./auth-core.js";
import {
  PERSONAL_FILM_STATES,
  REACTION_LEVELS,
  VIEWING_OUTCOMES,
  applyPersonalFilmPatch,
  findFilmByIdentity,
  getPublishedReviewsForMovie,
  getVisiblePersonalFilms,
  getViewingEventsForMovie,
  normalisePersonalFilm,
  normalisePersonalReview,
  normalisePublishedReview,
  normalisePersonalViewingEvent,
  personalStateLabel,
  reactionForValue,
  reviewHasUnpublishedChanges,
  viewingOutcomeLabel,
} from "./personal-films-core.js";
import { settleOptionalQuery } from "./workspace-core.js";
import { fetchArchiveHistoryCandidates, fetchArchiveHistoryPreview } from "./archive-reconciliation-core.js";

const SUPABASE_URL = "https://tbmxxdodprmynyiiaofj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D-ZMbt0ttcYPHEDtghl7AQ_wstwsoti";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const designPreviewMode = ["terminal.local", "localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has("design-preview");
const designPreviewVariant = designPreviewMode
  ? new URLSearchParams(window.location.search).get("design-preview")
  : null;
const designPreviewPersonalFilmsError = designPreviewMode
  && new URLSearchParams(window.location.search).get("preview-failure") === "personal-films";
const designPreviewViewingHistoryError = designPreviewMode
  && new URLSearchParams(window.location.search).get("preview-failure") === "viewing-history";
const discordAuthPreviewMode = ["terminal.local", "localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has("discord-auth-preview");

const imageAssets = {
  cameron: new URL("./assets/avatar-cameron.png", import.meta.url).href,
  dean: new URL("./assets/avatar-dean.png", import.meta.url).href,
  kieran: new URL("./assets/avatar-kieran.png", import.meta.url).href,
  andrew: new URL("./assets/avatar-andrew.png", import.meta.url).href,
  ross: new URL("./assets/avatar-ross.png", import.meta.url).href,
  journalFallback: new URL("./assets/hero-journal-web.png", import.meta.url).href,
  reactionFaces: {
    1: new URL("./assets/reaction-face-1-didnt-like-it-v1.webp", import.meta.url).href,
    2: new URL("./assets/reaction-face-2-not-for-me-v1.webp", import.meta.url).href,
    3: new URL("./assets/reaction-face-3-it-was-okay-v1.webp", import.meta.url).href,
    4: new URL("./assets/reaction-face-4-really-liked-it-v1.webp", import.meta.url).href,
    5: new URL("./assets/reaction-face-5-loved-it-v1.webp", import.meta.url).href,
  },
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
  { code: "02", title: "Queue Roulette", tone: "Weighted chaos", copy: "The longer a film has waited, the wider its slice — up to 4× weight, shown as “4× weight · waiting 5 months”. Each participant has one optional veto.", available: true },
  { code: "03", title: "Reel Bracket", tone: "Coming soon", copy: "Head-to-head voting is designed but is not implemented yet.", available: false }
];

const root = document.querySelector("#view-root");
const partyModal = document.querySelector("#party-modal");
const filmModal = document.querySelector("#film-modal");
const journalDeleteModal = document.querySelector("#journal-delete-modal");
const journalDeleteDescription = document.querySelector("#journal-delete-description");
const journalDeleteNumber = document.querySelector("#journal-delete-number");
const journalDeleteFilm = document.querySelector("#journal-delete-film");
const journalDeleteDate = document.querySelector("#journal-delete-date");
const journalDeleteDiscordNote = document.querySelector("#journal-delete-discord-note");
const journalDeleteError = document.querySelector("#journal-delete-error");
const journalDeleteConfirm = document.querySelector("#journal-delete-confirm");
const partyMembers = document.querySelector("#party-members");
const partyForm = document.querySelector("#party-form");
const filmForm = document.querySelector("#film-form");
const filmFormEyebrow = document.querySelector("#film-form-eyebrow");
const filmFormTitle = document.querySelector("#film-form-title");
const filmFormIntro = document.querySelector("#film-form-intro");
const filmSearchStatus = document.querySelector("#film-search-status");
const filmMatchResults = document.querySelector("#film-match-results");
const filmManualAdd = document.querySelector("#film-manual-add");
const toast = document.querySelector("#toast");
const sessionPanel = document.querySelector("#session-panel");
const sessionName = document.querySelector("#session-name");
const sessionAvatar = document.querySelector("#session-avatar");
const sessionIdentitySource = document.querySelector("#session-identity-source");
const discordProfileRefresh = document.querySelector("#discord-profile-refresh");

const legacyViewMap = { home: "list", queue: "list", tonight: "pick", wrapped: "stats" };

function routeFromHash(rawHash = window.location.hash) {
  const value = String(rawHash || "").replace(/^#/, "");
  if (value.startsWith("profile/")) {
    return { view: "profile", profileId: decodeURIComponent(value.slice("profile/".length)) };
  }
  return { view: legacyViewMap[value] || value || "list", profileId: null };
}

const initialRoute = routeFromHash();
let currentView = initialRoute.view;
let selectedProfileId = initialRoute.profileId;
let authUser = null;
let currentProfile = null;
let availableGroup = null;
let activeGroup = null;
let members = [];
let accessRequest = null;
let joinRequests = [];
let movieList = [];
let personalFilms = [];
let personalFilmsLoadError = false;
let personalViewingEvents = [];
let personalViewingEventsLoadError = false;
let personalReviews = [];
let publishedReviews = [];
let personalReviewsLoadError = false;
let publishedReviewsLoadError = false;
let memberProfiles = [];
let memberProfilesLoadError = false;
let memberProfileDraft = emptyMemberProfileDraft();
let memberProfileBusy = false;
let memberProfileDraftSaved = false;
let reviewEditorOpen = false;
let reviewPendingAction = "";
let reviewLiveMessage = "";
let viewingEventsRetrying = false;
let viewingEventEditorId = null;
let viewingEventPendingId = null;
let viewingEventLiveMessage = "";
let activeSession = null;
let sessionHistory = [];
let journalCatalog = [];
let discordDraft = null;
let journalDetailsOpen = false;
let sessionDetailsEditing = null;
let journalSessionId = null;
let journalDraftTimer = 0;
let journalPublishPendingId = null;
let journalEditingId = null;
let journalSyncPendingId = null;
let journalDeletePendingId = null;
let journalDeleteReturnFocus = null;
let discordProfileSyncInFlight = null;
let discordProfileSyncError = "";
let discordProfileSyncNotice = "";
let journalQuery = "";
let journalSourceFilter = "all";
let journalStatusFilter = "all";
let journalYearFilter = "all";
let journalViewerFilter = "all";
let journalVisibleLimit = 60;
let journalFocusedEntryId = null;
let journalReconciliationRows = null;
let journalReconciliationBusy = false;
let journalReconciliationMatchBusy = false;
let journalReconciliationMatchProgress = 0;
let journalReconciliationMatchTotal = 0;
let journalReconciliationError = "";
let journalReconciliationCandidates = new Map();
let journalReconciliationQuery = "";
let journalReconciliationStatusFilter = "all";
let journalReconciliationVisibleLimit = 24;
let journalReconciliationReviewBusyId = null;
let journalBulkPreview = null;
let journalBulkBusy = false;
let journalBulkSelectedIds = new Set();
let journalBulkError = "";
let journalTriagePreview = null;
let journalTriageBusy = false;
let journalTriageError = "";
let journalTriageCategory = "SUGGESTED";
let journalTriageVisibleLimit = 24;
let journalTriageApprovedIds = new Set();
let journalTriageSkippedIds = new Set();
let journalTriageManualIds = new Set();
let previewNextEntryNumber = 1317;
let listQuery = "";
let listFilter = "all";
let listSort = "votes";
let genreFilter = "all";
let memberFilter = "all";
let listFiltersOpen = false;
let myFilmsQuery = "";
let myFilmsFilter = "all";
let myFilmsSort = "updated";
let myFilmsFiltersOpen = false;
let selectedFilmId = null;
let filmDetailReturnScrollY = 0;
let reactionEditorExpanded = false;
let reactionLiveMessage = "";
let rouletteState = null;
let rouletteSpinTimer = null;
let rouletteSpinToken = 0;
let pendingPartyFilmId = null;
let filmEditingId = null;
let filmModalPurpose = "shared";
let pendingFilmDraft = null;
let authMode = "signin";
let discordAuthEnabled = false;
let isLoading = true;
let toastTimer;

const DISCORD_ENTRY_DIVIDER = "————————————————————————————————————————————————————————————————————————————————————";
const DISCORD_PROFILE_SYNC_MARKER = "cine-cord-discord-server-profile-sync";
let discordProfileSyncRequested = (() => {
  try { return window.sessionStorage.getItem(DISCORD_PROFILE_SYNC_MARKER) === "requested"; }
  catch { return false; }
})();
const ROULETTE_SPIN_DURATION_MS = 4200;
const ROULETTE_SETTLE_DURATION_MS = 2600;
const ROULETTE_REDUCED_SPIN_DURATION_MS = 80;
const ROULETTE_REDUCED_SETTLE_DURATION_MS = 1400;

const DESIGN_PREVIEW_STORAGE_KEY = "cine-cord-design-preview-state";

// Preview mode has no database. Persisting here is what lets the confirm ->
// edit -> save -> mark watched flow be assessed across a refresh.
function persistDesignPreviewWorkspace() {
  if (!designPreviewMode) return;
  try {
    window.localStorage.setItem(DESIGN_PREVIEW_STORAGE_KEY, JSON.stringify({
      activeSession,
      sessionHistory,
      rouletteState: rouletteState ? serialiseRouletteStateValue(rouletteState) : null,
      journalSessionId,
      discordDraft,
      previewNextEntryNumber,
      personalFilms,
      personalViewingEvents,
      personalReviews,
      publishedReviews,
      memberProfiles,
      memberProfileDraft,
      watchState: movieList.map(({ id, watched, watchCount, lastWatchedOn, votes, votedByMe }) => ({ id, watched, watchCount, lastWatchedOn, votes, votedByMe })),
    }));
  } catch { /* a full or blocked store must not break the preview */ }
}

function restoreDesignPreviewWorkspace() {
  if (!designPreviewMode) return;
  let saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(DESIGN_PREVIEW_STORAGE_KEY) || "null"); } catch { saved = null; }
  if (!saved) return;
  for (const entry of saved.watchState || []) {
    const item = movieList.find((film) => film.id === entry.id);
    if (item) {
      item.watched = Boolean(entry.watched);
      item.watchCount = Number(entry.watchCount) || 0;
      item.lastWatchedOn = entry.lastWatchedOn || null;
      if (Number.isFinite(Number(entry.votes))) item.votes = Math.max(0, Number(entry.votes));
      if (Object.hasOwn(entry, "votedByMe")) item.votedByMe = Boolean(entry.votedByMe);
    }
  }
  if (Array.isArray(saved.personalFilms)) personalFilms = saved.personalFilms.map(normalisePersonalFilm);
  if (Array.isArray(saved.personalViewingEvents)) personalViewingEvents = saved.personalViewingEvents.map(normalisePersonalViewingEvent);
  if (Array.isArray(saved.personalReviews)) personalReviews = saved.personalReviews.map(normalisePersonalReview);
  if (Array.isArray(saved.publishedReviews)) publishedReviews = saved.publishedReviews.map(normalisePublishedReview);
  if (Array.isArray(saved.memberProfiles)) memberProfiles = saved.memberProfiles.map(normaliseMemberProfile);
  if (saved.memberProfileDraft) memberProfileDraft = normaliseMemberProfileDraft(saved.memberProfileDraft);
  activeSession = saved.activeSession || null;
  sessionHistory = Array.isArray(saved.sessionHistory) ? saved.sessionHistory : [];
  journalSessionId = null;
  discordDraft = saved.discordDraft || null;
  previewNextEntryNumber = Math.max(1317, Number(saved.previewNextEntryNumber) || 1317);
  const draftSession = discordDraft && sessionHistory.find((session) => session.id === discordDraft.sessionId);
  if (draftSession) draftSession.journalDraft = discordDraft;
  if (activeSession?.mode === "Queue Roulette") {
    rouletteState = saved.rouletteState
      ? restoreRouletteState({ ...activeSession, gameState: saved.rouletteState })
      : restoreRouletteState(activeSession);
  }
}

function clearDesignPreviewWorkspace() {
  if (!designPreviewMode) return;
  try { window.localStorage.removeItem(DESIGN_PREVIEW_STORAGE_KEY); } catch { /* ignore */ }
}

function loadDesignPreviewWorkspace() {
  discordAuthEnabled = true;
  const previewVariant = designPreviewVariant;
  const previewObserver = previewVariant === "observer";
  const previewIdentity = previewObserver
    ? { id: "preview-dean", displayName: "Dean", email: "dean@cine-cord.local" }
    : { id: "preview-cameron", displayName: "Cameron", email: "preview@cine-cord.local" };
  authUser = { id: previewIdentity.id, email: previewIdentity.email };
  // member is a non-admin host; observer is a non-admin participant. The same
  // saved preview session can therefore exercise both permission surfaces.
  const previewRole = ["member", "observer"].includes(previewVariant) ? "member" : "admin";
  currentProfile = {
    id: previewIdentity.id,
    displayName: previewIdentity.displayName,
    discordServerDisplayName: previewObserver ? "Dean" : "Basil Brush",
    discordServerAvatar: previewObserver ? knownAvatars.dean : knownAvatars.cameron,
    discordServerProfileSyncedAt: "2026-08-24T14:00:00.000Z",
    role: previewRole,
  };
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
    { id: "preview-pulp-fiction", title: "Pulp Fiction", year: 1994, posterUrl: "https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", runtime: 154, genres: ["Crime", "Drama"], overview: "The lives of two mob hitmen, a boxer, a gangster’s wife and a pair of diner bandits intertwine in four tales of violence and redemption.", createdAt: "2026-03-14T20:00:00Z", suggestedBy: "Dean", suggestedById: "preview-dean", votes: 3, votedByMe: false, watched: false, tmdbId: 680 },
    { id: "preview-home-alone", title: "Home Alone", year: 1990, posterUrl: "https://image.tmdb.org/t/p/w500/onTSipZ8R3bliBdKfPtsDuHTdlL.jpg", runtime: 103, genres: ["Comedy", "Family"], overview: "An eight-year-old is accidentally left home alone and must defend the house from two determined burglars.", createdAt: "2026-03-18T20:00:00Z", suggestedBy: "Kieran", suggestedById: "preview-kieran", votes: 1, votedByMe: false, watched: false, tmdbId: 771 },
    { id: "preview-interstellar", title: "Interstellar", year: 2014, posterUrl: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", runtime: 169, genres: ["Adventure", "Drama", "Science Fiction"], overview: "Explorers travel through a wormhole in space in an attempt to ensure humanity's survival.", createdAt: "2026-05-10T20:00:00Z", suggestedBy: "Andrew", suggestedById: "preview-andrew", votes: 4, votedByMe: false, watched: false, tmdbId: 157336 },
    { id: "preview-fight-club", title: "Fight Club", year: 1999, posterUrl: "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", runtime: 139, genres: ["Drama"], overview: "A disillusioned office worker and a soap maker form an underground club that evolves into something far larger.", createdAt: "2026-06-07T20:00:00Z", suggestedBy: "Ross", suggestedById: "preview-ross", votes: 2, votedByMe: false, watched: false, tmdbId: 550 },
    { id: "preview-spirited-away", title: "Spirited Away", year: 2001, posterUrl: "https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg", runtime: 125, genres: ["Animation", "Family", "Fantasy"], overview: "A young girl enters a world ruled by gods, witches and spirits where humans are changed into beasts.", createdAt: "2026-07-01T20:00:00Z", suggestedBy: "Dean", suggestedById: "preview-dean", votes: 1, votedByMe: false, watched: false, tmdbId: 129 },
    { id: "preview-inception", title: "Inception", year: 2010, posterUrl: "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg", runtime: 148, genres: ["Action", "Science Fiction", "Thriller"], overview: "A skilled extractor is offered a chance to erase his past crimes by planting an idea in another person's mind.", createdAt: "2026-07-24T20:00:00Z", suggestedBy: "Cameron", suggestedById: "preview-cameron", votes: 3, votedByMe: false, watched: false, tmdbId: 27205 },
    { id: "preview-martian", title: "The Martian", year: 2015, posterUrl: "https://image.tmdb.org/t/p/w500/5BHuvQ6p9kfc091Z8RiFNhCwL4b.jpg", runtime: 144, genres: ["Adventure", "Drama", "Science Fiction"], overview: "An astronaut stranded on Mars must rely on ingenuity and determination while Earth works to bring him home.", createdAt: "2026-08-20T20:00:00Z", suggestedBy: "Kieran", suggestedById: "preview-kieran", votes: 1, votedByMe: false, watched: false, tmdbId: 286217 },
  ];
  const previewBackdropsByTmdb = {
    129: "/Ab8mkHmkYADjU7wQiOkia9BzGvS.jpg",
    348: "/AmR3JG1VQVxU8TfAvljUhfSFUOx.jpg",
    550: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
    603: "/icmmSD4vTTDKOq2vvdulafOGw93.jpg",
    680: "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg",
    771: "/5jkE2SzR5uR2egEb1rRhF22JyWN.jpg",
    27205: "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
    157336: "/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
    286217: "/sy6DvAu72kjoseZEjocnm2ZZ09i.jpg",
  };
  movieList.find((item) => item.id === "preview-alien").suggestedByAvatar = `${knownAvatars.dean}?source=discord-server-profile`;
  for (const item of movieList) {
    item.movieId = `preview-movie-${item.tmdbId}`;
    item.watchCount = 0;
    item.backdropPath = previewBackdropsByTmdb[item.tmdbId] || null;
    item.backdropUrl = item.backdropPath ? tmdbPoster(item.backdropPath, "w1280") : null;
  }
  personalFilms = [
    normalisePersonalFilm({
      id: "preview-personal-pulp-fiction",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-680",
      state: "WATCHED",
      rating: 4,
      isFavourite: true,
      createdAt: "2026-03-14T20:00:00Z",
      updatedAt: "2026-08-24T20:00:00Z",
      title: "Pulp Fiction",
      year: 1994,
      tmdbId: 680,
      posterPath: "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg",
      runtime: 154,
      genres: ["Crime", "Drama"],
      overview: "The lives of two mob hitmen, a boxer, a gangster’s wife and a pair of diner bandits intertwine in four tales of violence and redemption.",
    }),
    normalisePersonalFilm({
      ...movieList.find((item) => item.tmdbId === 603),
      id: "preview-personal-matrix",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-603",
      state: "WATCHED",
      rating: 4,
      isFavourite: true,
      createdAt: "2026-01-15T20:00:00Z",
      updatedAt: "2026-08-21T20:00:00Z",
    }),
    normalisePersonalFilm({
      ...movieList.find((item) => item.tmdbId === 348),
      id: "preview-personal-alien",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-348",
      state: "WANT_TO_WATCH",
      rating: null,
      isFavourite: false,
      createdAt: "2026-08-17T20:00:00Z",
      updatedAt: "2026-08-17T20:00:00Z",
    }),
    normalisePersonalFilm({
      ...movieList.find((item) => item.tmdbId === 129),
      id: "preview-personal-spirited-away",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-129",
      state: "WATCHED",
      rating: 5,
      isFavourite: false,
      createdAt: "2026-07-04T20:00:00Z",
      updatedAt: "2026-08-12T20:00:00Z",
    }),
    normalisePersonalFilm({
      ...movieList.find((item) => item.tmdbId === 27205),
      id: "preview-personal-inception",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-27205",
      state: "WATCHED",
      rating: 3,
      isFavourite: false,
      createdAt: "2026-07-24T20:00:00Z",
      updatedAt: "2026-08-08T20:00:00Z",
    }),
  ];
  personalViewingEvents = [
    normalisePersonalViewingEvent({
      id: "preview-viewing-pulp-source",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-680",
      outcome: "FINISHED",
      watchedOn: "2026-08-02",
      sourceJournalEntryId: "preview-journal-1323",
      isHidden: false,
      createdAt: "2026-08-03T00:18:00Z",
      updatedAt: "2026-08-03T00:18:00Z",
    }),
    normalisePersonalViewingEvent({
      id: "preview-viewing-pulp-manual-finished",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-680",
      outcome: "FINISHED",
      watchedOn: "2024-05-12",
      sourceJournalEntryId: null,
      isHidden: false,
      createdAt: "2026-08-24T19:20:00Z",
      updatedAt: "2026-08-24T19:20:00Z",
    }),
    normalisePersonalViewingEvent({
      id: "preview-viewing-pulp-manual-dnf",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-680",
      outcome: "DID_NOT_FINISH",
      watchedOn: "2023-11-04",
      sourceJournalEntryId: null,
      isHidden: false,
      createdAt: "2026-08-24T19:18:00Z",
      updatedAt: "2026-08-24T19:18:00Z",
    }),
  ];
  const previewOtherMemberId = previewObserver ? "preview-cameron" : "preview-dean";
  personalReviews = [
    normalisePersonalReview({
      id: "preview-review-pulp",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-680",
      body: "Wildly confident, endlessly quotable and much funnier than I remembered.",
      containsSpoilers: false,
      createdAt: "2026-08-24T19:30:00Z",
      updatedAt: "2026-08-24T19:30:00Z",
    }),
  ];
  publishedReviews = [
    normalisePublishedReview({
      reviewId: "preview-review-pulp",
      ownerId: previewIdentity.id,
      movieId: "preview-movie-680",
      body: "Wildly confident, endlessly quotable and much funnier than I remembered.",
      containsSpoilers: false,
      rating: 4,
      publishedAt: "2026-08-24T19:35:00Z",
      updatedAt: "2026-08-24T19:35:00Z",
    }),
    normalisePublishedReview({
      reviewId: "preview-review-other-pulp",
      ownerId: previewOtherMemberId,
      movieId: "preview-movie-680",
      body: "The structure still feels daring, and the performances make every detour worth it.",
      containsSpoilers: true,
      rating: null,
      publishedAt: "2026-08-23T18:00:00Z",
      updatedAt: "2026-08-23T18:00:00Z",
    }),
  ];
  const previewProfileFilms = [
    { ownerId: "preview-cameron", tmdbIds: [680, 603, 129, 27205, 348], introduction: "Five films I would defend in court.", bannerTmdbId: 603, memberSince: "2025-11-02T20:00:00Z", stats: [184, 72, 4.1, 96], recentTmdbIds: [680, 129, 27205], genres: [["Drama", 54], ["Science Fiction", 42], ["Crime", 31]], ratings: [4, 4, 5, 3, null] },
    { ownerId: "preview-dean", tmdbIds: [348, 157336, 680, 550, 286217], introduction: "Big swings, strange worlds and the occasional perfect crime.", bannerTmdbId: 348, memberSince: "2025-11-06T20:00:00Z", stats: [221, 89, 3.8, 91], recentTmdbIds: [348, 286217, 680], genres: [["Science Fiction", 61], ["Drama", 49], ["Horror", 37]], ratings: [5, 4, 4, 3, 4] },
    { ownerId: "preview-kieran", tmdbIds: [771, 286217, 603, 129, 348], introduction: "Comfort films with a little danger around the edges.", bannerTmdbId: 771, memberSince: "2025-11-18T20:00:00Z", stats: [143, 64, 4.0, 98], recentTmdbIds: [771, 129, 603], genres: [["Comedy", 38], ["Family", 34], ["Science Fiction", 29]], ratings: [5, 4, 4, 5, 3] },
    { ownerId: "preview-andrew", tmdbIds: [157336, 550, 27205, 680, 771], introduction: "Give me a great premise and enough runtime to get lost in it.", bannerTmdbId: 157336, memberSince: "2025-12-03T20:00:00Z", stats: [207, 83, 3.9, 94], recentTmdbIds: [157336, 27205, 550], genres: [["Drama", 58], ["Science Fiction", 47], ["Thriller", 35]], ratings: [5, 4, 4, 3, 4] },
    { ownerId: "preview-ross", tmdbIds: [550, 348, 603, 286217, 157336], introduction: "A small collection of films that refuse to behave.", bannerTmdbId: 550, memberSince: "2026-01-11T20:00:00Z", stats: [126, 51, 3.7, 88], recentTmdbIds: [550, 348, 286217], genres: [["Drama", 41], ["Science Fiction", 33], ["Action", 27]], ratings: [4, 5, 4, 3, 4] },
  ];
  const previewMoviesByTmdb = new Map(movieList.map((film) => [Number(film.tmdbId), film]));
  memberProfiles = previewProfileFilms.map((definition) => {
    const banner = previewMoviesByTmdb.get(definition.bannerTmdbId);
    return normaliseMemberProfile({
    owner_id: definition.ownerId,
    display_name: members.find((member) => member.id === definition.ownerId)?.name,
    avatar_url: members.find((member) => member.id === definition.ownerId)?.avatar,
    introduction: definition.introduction,
    member_since: definition.memberSince,
    published_at: "2026-08-24T20:00:00.000Z",
    banner_movie_id: banner?.movieId,
    banner_title: banner?.title,
    banner_backdrop_path: banner?.backdropPath,
    banner_poster_path: banner?.posterUrl,
    films_watched_count: definition.stats[0],
    sessions_attended_count: definition.stats[1],
    average_rating: definition.stats[2],
    completion_rate: definition.stats[3],
    recent_watches: definition.recentTmdbIds.map((tmdbId, index) => {
      const film = previewMoviesByTmdb.get(tmdbId);
      return { position: index + 1, movie_id: film?.movieId, title: film?.title, release_year: film?.year, tmdb_id: film?.tmdbId, poster_url: film?.posterUrl, watched_on: ["2026-08-24", "2026-08-17", "2026-08-09"][index], outcome: index === 2 && definition.ownerId === "preview-ross" ? "DID_NOT_FINISH" : "FINISHED", rating: definition.ratings[index], session_label: index === 0 ? "Queue Roulette" : null };
    }),
    genre_breakdown: definition.genres.map(([genre, watchCount], index) => ({ position: index + 1, genre, watch_count: watchCount })),
    films: definition.tmdbIds.map((tmdbId, index) => {
      const film = previewMoviesByTmdb.get(tmdbId);
      return { slot: index + 1, movie_id: film?.movieId, title: film?.title, release_year: film?.year, tmdb_id: film?.tmdbId, poster_url: film?.posterUrl, rating: definition.ratings[index] };
    }),
  });
  });
  const currentPreviewProfile = memberProfiles.find((profile) => profile.ownerId === previewIdentity.id) || memberProfiles[0];
  memberProfileDraft = {
    introduction: currentPreviewProfile?.introduction || "",
    movieIds: currentPreviewProfile?.films.map((film) => film.movieId).filter(Boolean) || [],
    bannerMovieId: currentPreviewProfile?.bannerMovieId || null,
    includeRecentWatches: Boolean(currentPreviewProfile?.recentWatches.length),
    includeGenreBreakdown: Boolean(currentPreviewProfile?.genreBreakdown.length),
  };
  memberProfileDraftSaved = false;
  restoreDesignPreviewWorkspace();
  const previewRoute = routeFromHash();
  currentView = previewRoute.view;
  selectedProfileId = previewRoute.profileId;
  isLoading = false;
  personalFilmsLoadError = designPreviewPersonalFilmsError;
  if (personalFilmsLoadError) personalFilms = [];
  personalViewingEventsLoadError = designPreviewViewingHistoryError;
  if (personalViewingEventsLoadError) personalViewingEvents = [];
  journalCatalog = [
    {
      catalogId: "current:preview-journal-1323",
      sourceType: "CINE_CORD",
      recordId: "preview-journal-1323",
      journalEntryId: "preview-journal-1323",
      entryLabel: "1323",
      entrySortNumber: 1323,
      title: "Pulp Fiction",
      year: 1994,
      watchedAt: "2026-08-02",
      status: "FINISHED",
      comment: "A current Cine-Cord entry linked through verified member and movie identities.",
      viewerNames: ["Cameron", "Dean"],
      viewerIds: ["preview-cameron", "preview-dean"],
      createdById: "preview-cameron",
      authorName: "Cameron",
      volumeName: "Cine-Cord",
      discordUrl: null,
      sourceCreatedAt: "2026-08-03T00:18:00.000+01:00",
      parserStatus: "PARSED",
      publicationStatus: null,
      publication: null,
      discordOutOfDate: false,
      canEdit: currentProfile.id === "preview-cameron" || isCurrentAdmin(),
    },
    {
      catalogId: "current:preview-journal-1324",
      sourceType: "CINE_CORD",
      recordId: "preview-journal-1324",
      journalEntryId: "preview-journal-1324",
      entryLabel: "1324",
      entrySortNumber: 1324,
      title: "Filth",
      year: 2013,
      watchedAt: "2026-08-16",
      status: "FINISHED",
      comment: "Same rules still apply — corrected on Cine-Cord after posting.",
      viewerNames: ["Dean", "Kieran"],
      viewerIds: ["preview-dean", "preview-kieran"],
      createdById: "preview-cameron",
      authorName: "Cameron",
      volumeName: "Cine-Cord",
      discordUrl: "https://discord.com/channels/272427070779293697/1353823481413763132/1538675059584143380",
      sourceCreatedAt: "2026-08-16T23:25:21.405+01:00",
      parserStatus: "PARSED",
      publicationStatus: "POSTED",
      publication: {
        id: "preview-publication-1324",
        journal_entry_id: "preview-journal-1324",
        status: "POSTED",
        discord_guild_id: "272427070779293697",
        discord_channel_id: "1353823481413763132",
        discord_message_id: "1538675059584143380",
        poster_display_name: "Cameron",
        discord_out_of_date: true,
      },
      discordOutOfDate: true,
      canEdit: currentProfile.id === "preview-cameron" || isCurrentAdmin(),
    },
    {
      catalogId: "archive:preview-1000",
      sourceType: "DISCORD_ARCHIVE",
      recordId: "preview-1000",
      journalEntryId: null,
      entryLabel: "687 (#1000)",
      entrySortNumber: 687,
      title: "American Pie Reunion",
      year: 2006,
      watchedAt: "2025-08-03",
      status: "FINISHED",
      comment: "The snap that started it all. We are inevitable...",
      viewerNames: ["Brad", "Cameron", "Dean", "Innes", "Jake", "Kieran", "Ross"],
      viewerIds: [],
      authorName: "Dean",
      volumeName: "The Journal Strikes Back",
      discordUrl: "https://discord.com/channels/272427070779293697/995528992985710682/1401343985519296613",
      sourceCreatedAt: "2025-08-03T00:20:41.860+01:00",
      parserStatus: "PARSED",
      publicationStatus: null,
      discordOutOfDate: false,
      canEdit: false,
    },
    {
      catalogId: "archive:preview-12-1",
      sourceType: "DISCORD_ARCHIVE",
      recordId: "preview-12-1",
      journalEntryId: null,
      entryLabel: "12.1",
      entrySortNumber: 12.1,
      title: "Ghostland",
      year: 2018,
      watchedAt: "2020-06-07",
      status: "FINISHED",
      comment: "A preserved entry from the first Discord Journal channel.",
      viewerNames: ["Adam", "Andrew"],
      viewerIds: [],
      authorName: "Cameron",
      volumeName: "The Journal",
      discordUrl: "https://discord.com/channels/272427070779293697/713935563912118293/719022021823954986",
      sourceCreatedAt: "2020-06-07T03:56:48.786+01:00",
      parserStatus: "PARSED",
      publicationStatus: null,
      discordOutOfDate: false,
      canEdit: false,
    },
  ];
  for (const session of sessionHistory) upsertCurrentJournalCatalogEntry(session);
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

function avatarForFilm(item) {
  return item?.suggestedByAvatar || avatarForName(item?.suggestedBy);
}

function isCurrentAdmin() {
  return currentProfile?.role === "admin";
}

function canManageFilm(item) {
  return isCurrentAdmin() || item.suggestedById === authUser?.id;
}

function canManageSession(session = activeSession) {
  return Boolean(session && (isCurrentAdmin() || session.hostId === authUser?.id));
}

function canManageJournalEntry(entry, session = null) {
  if (!entry) return canManageSession(session);
  const creatorId = entry.createdById || entry.created_by || entry.createdBy;
  return Boolean(isCurrentAdmin() || (creatorId && creatorId === authUser?.id));
}

function canEditSessionDetails(session) {
  if (!canManageSession(session)) return false;
  if (session?.status !== "WATCHED" || !session.journalEntry) return true;
  return canManageJournalEntry(session.journalEntry, session);
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

function formatSavedDate(value, options = { day: "numeric", month: "short", year: "numeric" }, locale = "en-GB") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Date unknown";
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Date unknown";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}

function normaliseGenres(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") return value.split(",").map((genre) => genre.trim()).filter(Boolean);
  return [];
}

function normaliseMemberProfileFilm(row) {
  const posterPath = row.poster_path || row.posterPath || null;
  return {
    slot: Number(row.slot) || 0,
    movieId: row.movie_id || row.movieId || null,
    title: row.title || "Untitled film",
    year: row.release_year ?? row.year ?? null,
    tmdbId: row.tmdb_id ?? row.tmdbId ?? null,
    posterPath,
    posterUrl: row.poster_url || (posterPath ? tmdbPoster(posterPath) : null),
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
  };
}

function normaliseMemberProfileRecentWatch(row) {
  const posterPath = row.poster_path || row.posterPath || null;
  return {
    position: Number(row.position) || 0,
    movieId: row.movie_id || row.movieId || null,
    title: row.title || "Untitled film",
    year: row.release_year ?? row.year ?? null,
    tmdbId: row.tmdb_id ?? row.tmdbId ?? null,
    posterPath,
    posterUrl: row.poster_url || (posterPath ? tmdbPoster(posterPath) : null),
    watchedOn: row.watched_on ?? row.watchedOn ?? null,
    outcome: row.outcome || "FINISHED",
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    sessionLabel: row.session_label || row.sessionLabel || null,
  };
}

function normaliseMemberProfileGenre(row) {
  return {
    position: Number(row.position) || 0,
    genre: String(row.genre || "Other"),
    watchCount: Math.max(0, Number(row.watch_count ?? row.watchCount) || 0),
  };
}

function normaliseMemberProfile(row) {
  const films = Array.isArray(row.films)
    ? row.films.map(normaliseMemberProfileFilm).sort((left, right) => left.slot - right.slot)
    : [];
  const recentWatches = Array.isArray(row.recent_watches ?? row.recentWatches)
    ? (row.recent_watches ?? row.recentWatches).map(normaliseMemberProfileRecentWatch).sort((left, right) => left.position - right.position)
    : [];
  const genreBreakdown = Array.isArray(row.genre_breakdown ?? row.genreBreakdown)
    ? (row.genre_breakdown ?? row.genreBreakdown).map(normaliseMemberProfileGenre).sort((left, right) => left.position - right.position)
    : [];
  const bannerBackdropPath = row.banner_backdrop_path || row.bannerBackdropPath || null;
  const bannerPosterPath = row.banner_poster_path || row.bannerPosterPath || null;
  return {
    ownerId: row.owner_id || row.ownerId || null,
    displayName: row.display_name || row.displayName || "Discordian",
    avatarUrl: row.avatar_url || row.avatarUrl || null,
    introduction: String(row.introduction || ""),
    memberSince: row.member_since || row.memberSince || null,
    publishedAt: row.published_at || row.publishedAt || null,
    bannerMovieId: row.banner_movie_id || row.bannerMovieId || null,
    bannerTitle: row.banner_title || row.bannerTitle || null,
    bannerBackdropPath,
    bannerBackdropUrl: row.banner_backdrop_url || row.bannerBackdropUrl || (bannerBackdropPath ? tmdbPoster(bannerBackdropPath, "w1280") : null),
    bannerPosterPath,
    bannerPosterUrl: row.banner_poster_url || row.bannerPosterUrl || (bannerPosterPath ? tmdbPoster(bannerPosterPath) : null),
    filmsWatchedCount: Math.max(0, Number(row.films_watched_count ?? row.filmsWatchedCount) || 0),
    sessionsAttendedCount: Math.max(0, Number(row.sessions_attended_count ?? row.sessionsAttendedCount) || 0),
    averageRating: row.average_rating === null || row.average_rating === undefined
      ? (row.averageRating === null || row.averageRating === undefined ? null : Number(row.averageRating))
      : Number(row.average_rating),
    completionRate: row.completion_rate === null || row.completion_rate === undefined
      ? (row.completionRate === null || row.completionRate === undefined ? null : Number(row.completionRate))
      : Number(row.completion_rate),
    recentWatches,
    genreBreakdown,
    films,
  };
}

function aggregateMemberProfileRows(rows) {
  const profiles = new Map();
  for (const row of rows || []) {
    const ownerId = row.owner_id || row.ownerId;
    if (!ownerId) continue;
    const profile = profiles.get(ownerId) || normaliseMemberProfile({ ...row, films: [] });
    profile.films.push(normaliseMemberProfileFilm(row));
    profile.films.sort((left, right) => left.slot - right.slot);
    profiles.set(ownerId, profile);
  }
  return [...profiles.values()];
}

function emptyMemberProfileDraft() {
  return {
    introduction: "",
    movieIds: [],
    bannerMovieId: null,
    includeRecentWatches: false,
    includeGenreBreakdown: false,
  };
}

function normaliseMemberProfileDraft(row) {
  const films = Array.isArray(row?.films)
    ? row.films
    : Array.isArray(row?.member_profile_draft_films)
      ? row.member_profile_draft_films
      : [];
  return {
    introduction: String(row?.introduction || ""),
    movieIds: films
      .map((film) => ({ slot: Number(film.slot) || 0, movieId: film.movie_id || film.movieId }))
      .filter((film) => film.movieId)
      .sort((left, right) => left.slot - right.slot)
      .map((film) => film.movieId),
    bannerMovieId: row?.banner_movie_id || row?.bannerMovieId || null,
    includeRecentWatches: Boolean(row?.include_recent_watches ?? row?.includeRecentWatches),
    includeGenreBreakdown: Boolean(row?.include_genre_breakdown ?? row?.includeGenreBreakdown),
  };
}

function filmPoster(item) {
  if (item.posterUrl) return item.posterUrl;
  return imageAssets.journalFallback;
}

function tmdbPoster(path, size = "w500") {
  if (!path) return imageAssets.journalFallback;
  return path.startsWith("http") ? path : `https://image.tmdb.org/t/p/${size}${path}`;
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

function isDirectWatchSession(session = activeSession) {
  return session?.gameState?.selectionMode === "direct";
}

function sessionModeLabel(session) {
  return isDirectWatchSession(session) ? "Direct watch" : session?.mode || "Watch session";
}

function createDiscordDraft(session, film) {
  const entry = session?.journalEntry;
  const entryViewerIds = (entry?.viewerIds || []).filter(Boolean);
  const entryViewerNames = (entry?.viewerNames || entryViewerIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean));
  return {
    sessionId: session.id,
    entryNumber: entry?.entryNumber ? String(entry.entryNumber) : "",
    title: entry?.title || film?.title || "",
    year: entry?.year || film?.year || "",
    viewerIds: entry ? entryViewerIds : (session.participantIds || []).filter(Boolean),
    viewers: entry ? entryViewerNames.join(", ") : session.members.join(", "),
    runtime: Number(film?.runtime) || null,
    genres: normaliseGenres(film?.genres),
    status: entry?.status === "DNF" ? "DNF" : "Finished",
    comment: entry?.comment || "",
  };
}

function sessionForId(sessionId) {
  if (!sessionId) return null;
  if (activeSession?.id === sessionId) return activeSession;
  return sessionHistory.find((session) => session.id === sessionId) || null;
}

function journalSession() {
  return sessionForId(journalSessionId);
}

function sessionEditorMode(session) {
  return sessionDetailsEditing && session && sessionDetailsEditing.sessionId === session.id
    ? sessionDetailsEditing.mode
    : null;
}

function ensureDiscordDraft(session, film) {
  if (!discordDraft || discordDraft.sessionId !== session.id) {
    discordDraft = session.journalDraft
      ? { ...session.journalDraft, sessionId: session.id }
      : createDiscordDraft(session, film);
  }
  const entry = session.journalEntry;
  discordDraft.viewerIds = entry ? [...(entry.viewerIds || [])] : (session.participantIds || []).filter(Boolean);
  discordDraft.viewers = entry
    ? (entry.viewerNames || discordDraft.viewerIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean)).join(", ")
    : session.members.join(", ");
  discordDraft.runtime = Number(film?.runtime) || null;
  discordDraft.genres = normaliseGenres(film?.genres);
  return discordDraft;
}

function buildDiscordTemplate(draft) {
  const lines = [
    `- Entry #${String(draft.entryNumber || "assigned when saved").trim()}`,
    `- ${String(draft.title || "").trim()}`,
    `- ${String(draft.year || "").trim()}`,
    `- Runtime: ${draft.runtime ? `${Number(draft.runtime)} min` : "Unavailable"}`,
    `- Genres: ${normaliseGenres(draft.genres).join(", ") || "Unavailable"}`,
    `- Viewers: ${String(draft.viewers || "").trim()}`,
    `- Status: ${draft.status === "DNF" ? "DNF" : "Finished"}`,
  ];
  const comment = String(draft.comment || "").trim();
  if (comment) lines.push(`- ${comment}`);
  lines.push(DISCORD_ENTRY_DIVIDER);
  return lines.join("\n");
}

function discordPublicationUrl(publication) {
  const guild = String(publication?.discord_guild_id || "").trim();
  const channel = String(publication?.discord_channel_id || "").trim();
  const message = String(publication?.discord_message_id || "").trim();
  if (!guild || !channel || !message) return null;
  return `https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(channel)}/${encodeURIComponent(message)}`;
}

function renderDiscordFancyPreview(session, film, draft) {
  const poster = film ? filmPoster(film) : null;
  const genres = normaliseGenres(film?.genres);
  const comment = String(draft.comment || "").trim();
  return `
    <section class="discord-embed-preview" aria-label="Discord embed preview">
      <div class="discord-embed-accent"></div>
      <div class="discord-embed-body">
        <span class="discord-embed-author">Entry #${escapeHTML(draft.entryNumber || "assigned when saved")}</span>
        <strong class="discord-embed-title" data-discord-preview-title>${escapeHTML(draft.title || "Untitled")}</strong>
        <dl class="discord-embed-fields">
          <div><dt>Film</dt><dd data-discord-preview-film>${escapeHTML(draft.year || "Year unavailable")} · ${escapeHTML(runtimeLabel(film || {}))}</dd></div>
          <div><dt>Genres</dt><dd data-discord-preview-genres>${escapeHTML(genres.join(" · ") || "Genres unavailable")}</dd></div>
          <div><dt>Viewers</dt><dd data-discord-preview-viewers>${escapeHTML(draft.viewers || "No viewers recorded")}</dd></div>
          <div><dt>Status</dt><dd data-discord-preview-status>${escapeHTML(draft.status)}</dd></div>
        </dl>
        <blockquote data-discord-preview-comment ${comment ? "" : "hidden"}>${escapeHTML(comment)}</blockquote>
        <small>Submitted by ${escapeHTML(currentProfile?.discordServerDisplayName || "server profile not synced")} via Cine-Cord</small>
      </div>
      ${poster ? `<img src="${escapeHTML(poster)}" alt="" />` : ""}
    </section>`;
}

function renderDiscordPublicationActions(session) {
  const publication = session.journalPublication;
  const canPublish = canManageJournalEntry(session.journalEntry, session);
  const hasMessage = Boolean(publication?.discord_message_id);
  const outOfDate = Boolean(publication?.discord_out_of_date || publication?.outOfDate);
  const syncing = journalSyncPendingId === session.journalEntry?.id;
  if (hasMessage && publication?.status === "UPDATING") {
    return `<div class="discord-publication-state" role="status"><span class="material-symbols-outlined" aria-hidden="true">progress_activity</span><div><strong>Updating Discord post…</strong><small>The existing message is being edited; no new message will be created.</small></div></div>`;
  }
  if (hasMessage && (outOfDate || publication?.status === "UPDATE_FAILED")) {
    const messageUrl = discordPublicationUrl(publication);
    return `<div class="discord-publication-state has-warning" role="alert"><span class="material-symbols-outlined" aria-hidden="true">sync_problem</span><div><strong>Discord copy is out of date</strong><small>${escapeHTML(publication.last_error || "The website entry changed after this message was posted.")}</small></div>${canPublish ? `<button class="primary-button compact" type="button" data-update-journal ${syncing ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">sync</span>${syncing ? "Updating…" : "Update Discord post"}</button>` : ""}${messageUrl ? `<a class="secondary-button compact" href="${escapeHTML(messageUrl)}" target="_blank" rel="noopener noreferrer">View post</a>` : ""}</div>`;
  }
  if (hasMessage && publication?.status === "POSTED") {
    const messageUrl = discordPublicationUrl(publication);
    return `<div class="discord-publication-state is-posted" role="status"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span><div><strong>Discord copy is current</strong><small>${publication.poster_display_name ? `Originally posted as ${escapeHTML(publication.poster_display_name)}. ` : ""}${publication.last_synced_at ? `Last synchronized ${escapeHTML(formatAddedDate(publication.last_synced_at))}.` : ""}</small></div>${messageUrl ? `<a class="secondary-button compact" href="${escapeHTML(messageUrl)}" target="_blank" rel="noopener noreferrer">View in Discord <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span></a>` : ""}</div>`;
  }
  if (publication?.status === "POSTING") {
    return `<div class="discord-publication-state" role="status"><span class="material-symbols-outlined" aria-hidden="true">progress_activity</span><div><strong>Posting to Discord…</strong><small>Refresh in a moment if this does not update.</small></div></div>`;
  }
  if (publication?.status === "UNKNOWN") {
    return `<div class="discord-publication-state has-warning" role="alert"><span class="material-symbols-outlined" aria-hidden="true">warning</span><div><strong>Discord delivery is uncertain</strong><small>${escapeHTML(publication.last_error || "Check the Journal channel. Posting again is blocked so the entry is not duplicated.")}</small></div></div>`;
  }
  if (!canPublish) return "";
  if (!currentProfile?.discordServerDisplayName) {
    return `<div class="discord-publication-state has-warning" role="alert"><span class="material-symbols-outlined" aria-hidden="true">account_circle</span><div><strong>Discord server profile required</strong><small>Connect your The Discordians profile to post with your server name and avatar. Copy for Discord still works.</small></div><button class="secondary-button compact" type="button" data-refresh-discord-profile><span class="material-symbols-outlined" aria-hidden="true">sync</span>Connect profile</button></div>`;
  }
  const failed = publication?.status === "FAILED";
  const pending = journalPublishPendingId === session.id || syncing;
  return `<div class="discord-publish-action ${failed ? "has-failed" : ""}">${failed ? `<p role="alert"><strong>Discord post failed.</strong> ${escapeHTML(publication.last_error || "The saved Journal entry is safe; try posting it again.")}</p>` : ""}<button class="primary-button discord-post-button" type="button" data-post-journal ${pending ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">${pending ? "progress_activity" : "send"}</span>${pending ? "Posting…" : failed ? "Retry Discord post" : "Post to Discord"}</button><small>This is explicit: it saves the Journal entry, then sends one embed to the configured Journal channel.</small></div>`;
}

function journalDetailsNeedAttention(draft) {
  const year = Number(draft.year);
  return !String(draft.title).trim()
    || !String(draft.viewers).trim()
    || !Number.isInteger(year)
    || year < 1888
    || year > 2200;
}

function renderSessionSummary(session, { editorMode = null } = {}) {
  const canManage = canEditSessionDetails(session);
  const date = session.sessionDate || isoDateOnly(session.startedAt);
  const participants = session.participants || [];
  if (editorMode && canManage) {
    const markingWatched = editorMode === "watch";
    const hostControl = isCurrentAdmin()
      ? `<label class="session-host-field"><span>Host</span><select name="host_id" required>${members.map((member) => `<option value="${escapeHTML(member.id)}" ${member.id === session.hostId ? "selected" : ""}>${escapeHTML(member.name)}</option>`).join("")}</select><small>Only administrators can transfer the host.</small></label>`
      : `<div class="session-host-field"><span class="session-field-label">Host</span><p>${escapeHTML(session.hostName)}</p><input type="hidden" name="host_id" value="${escapeHTML(session.hostId)}" /><small>Ask an administrator to transfer the host.</small></div>`;
    return `
      <section class="session-summary is-editing" aria-labelledby="session-summary-title">
        <div class="session-summary-head"><div><span class="eyebrow">${markingWatched ? "Final watch details" : "Session details"}</span><h3 id="session-summary-title">${markingWatched ? "Review before marking watched" : session.status === "WATCHED" ? "Edit watched session" : "Edit this session"}</h3>${markingWatched ? "<p>Confirm the actual date, host and everyone who watched. This is what the viewing history and Journal will use.</p>" : ""}</div></div>
        <form id="session-details-form" class="session-details-form">
          <input type="hidden" name="session_id" value="${escapeHTML(session.id)}" />
          <input type="hidden" name="intent" value="${markingWatched ? "watch" : "save"}" />
          <label class="session-date-field"><span>Watch date</span><input name="watch_date" type="date" required value="${escapeHTML(date)}" /><small>${session.status === "WATCHED" ? "This is the date shown in watch history and the Journal." : "Today is filled in automatically; change it if needed."}</small></label>
          ${hostControl}
          <fieldset class="session-participants-field">
            <legend class="session-field-label">Participants</legend>
            <div>${members.map((member) => `<label class="session-participant-toggle"><input type="checkbox" name="participant" value="${escapeHTML(member.id)}" ${participants.some((participant) => participant.id === member.id) ? "checked" : ""} /><img src="${escapeHTML(member.avatar)}" alt="" /><span>${escapeHTML(member.name)}</span></label>`).join("")}</div>
          </fieldset>
          <div class="session-summary-actions">
            <button class="primary-button" type="submit"><span class="material-symbols-outlined" aria-hidden="true">${markingWatched ? "check_circle" : "save"}</span>${markingWatched ? "Confirm and mark watched" : "Save session details"}</button>
            <button class="secondary-button" type="button" data-cancel-session-edit>Cancel</button>
            ${!markingWatched ? (session.journalEntry
              ? `<small class="session-delete-note">Delete the linked Journal entry before deleting this session.</small>`
              : `<button class="secondary-button compact danger-button" type="button" data-delete-session="${escapeHTML(session.id)}"><span class="material-symbols-outlined" aria-hidden="true">delete</span>Delete session</button>`) : ""}
          </div>
        </form>
      </section>`;
  }
  return `
    <section class="session-summary" aria-labelledby="session-summary-title">
      <div class="session-summary-head">
        <div><span class="eyebrow">${session.status === "WATCHED" ? "Watched session" : "Session details"}</span><h3 id="session-summary-title">${escapeHTML(session.selectedFilm?.title || "Tonight's film")} ${session.status === "WATCHED" ? `was watched ${escapeHTML(sessionDateLabel(date))}.` : `is confirmed ${escapeHTML(sessionDateLabel(date))}.`}</h3></div>
        ${canManage ? `<button class="secondary-button compact" type="button" data-edit-session-details="${escapeHTML(session.id)}"><span class="material-symbols-outlined" aria-hidden="true">edit</span>Edit</button>` : ""}
      </div>
      <dl class="session-summary-grid">
        <div><dt>Watch date</dt><dd>${escapeHTML(formatSavedDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, navigator.language))}</dd></div>
        <div><dt>Host</dt><dd>${escapeHTML(session.hostName)}</dd></div>
        <div><dt>Participants</dt><dd>${participants.length ? escapeHTML(participants.map(({ name }) => name).join(", ")) : "No one added yet"}</dd></div>
      </dl>
      ${session.status === "CONFIRMED" ? (canManage ? `<div class="session-summary-actions"><button class="primary-button" type="button" data-review-session-watched="${escapeHTML(session.id)}"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Mark as watched</button><small>You will review the final date, host and participants before anything is completed.</small></div>` : `<p class="session-summary-note">${escapeHTML(session.hostName)} can mark this session watched once you have all seen it.</p>`) : ""}
    </section>`;
}

function renderDiscordTemplate(session, film) {
  const draft = ensureDiscordDraft(session, film);
  const canEdit = canManageJournalEntry(session.journalEntry, session);
  const hasSavedEntry = Boolean(session.journalEntry);
  const readOnly = canEdit ? "" : "readonly";
  // The drawer opens on request, and on its own when a session-filled value is
  // missing, so "collapsed" never hides a problem.
  const detailsOpen = journalDetailsOpen || journalDetailsNeedAttention(draft);
  return `
    <section class="discord-copy-card" aria-labelledby="discord-copy-title">
      <div class="discord-copy-heading">
        <div><span class="eyebrow">${hasSavedEntry ? `Journal entry #${escapeHTML(draft.entryNumber)}` : "Optional Discord handoff"}</span><h3 id="discord-copy-title">${canEdit ? "Prepare the Journal post" : "Journal post"}</h3><p>${canEdit ? "Preview the Discord card, then post it directly or keep using manual copy." : "This saved entry can be viewed or copied. Only its creator or an administrator can post or change it."}</p></div>
        </div>
      <form id="discord-template-form" class="discord-template-form">
        ${renderDiscordFancyPreview(session, film, draft)}
        <div class="discord-post-row">
          <label class="discord-preview-field"><span>Manual copy preview</span><textarea id="discord-template-preview" readonly rows="10">${escapeHTML(buildDiscordTemplate(draft))}</textarea></label>
          <div class="discord-author-fields">
            <label class="discord-entry-field"><span>Entry number</span><input name="entry_number" type="number" min="1" step="1" value="${escapeHTML(draft.entryNumber)}" placeholder="Assigned when saved" ${readOnly} /><small>Leave blank for the next number. Change it only to correct an entry.</small></label>
            <label class="discord-comment-field"><span>Comment <small>Optional</small></span><textarea name="comment" maxlength="2000" rows="3" placeholder="Add the Journal comment…" ${readOnly}>${escapeHTML(draft.comment)}</textarea></label>
          </div>
        </div>
        <details class="discord-entry-details" ${detailsOpen ? "open" : ""}>
          <summary data-toggle-journal-details>
            <span class="discord-summary-label"><span class="material-symbols-outlined" aria-hidden="true">tune</span>Edit entry details</span>
            <span class="discord-summary-hint">Title, year, viewers and status — filled in from this session.</span>
            <span class="discord-summary-chevron material-symbols-outlined" aria-hidden="true">expand_more</span>
          </summary>
          <div class="discord-entry-fields">
            <label class="discord-title-field"><span>Title</span><input name="title" required maxlength="200" value="${escapeHTML(draft.title)}" ${readOnly} /></label>
            <label class="discord-year-field"><span>Year</span><input name="year" type="number" min="1888" max="2200" required value="${escapeHTML(draft.year)}" ${readOnly} /></label>
            <label class="discord-viewers-field"><span>Viewers</span><input name="viewers" required maxlength="500" value="${escapeHTML(draft.viewers)}" readonly /><small>Use the main Journal editor to correct a saved entry's viewers.</small></label>
            <label class="discord-status-field"><span>Status</span><select name="status" ${canEdit ? "" : "disabled"}><option value="Finished" ${draft.status === "Finished" ? "selected" : ""}>Finished</option><option value="DNF" ${draft.status === "DNF" ? "selected" : ""}>DNF</option></select></label>
          </div>
        </details>
        <div class="discord-copy-actions"><button class="secondary-button" type="${canEdit ? "submit" : "button"}" ${canEdit ? "" : "data-copy-saved-journal"}><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>Copy for Discord</button>${canEdit && canManageSession(session) ? `<button class="secondary-button" type="button" data-save-journal-draft><span class="material-symbols-outlined" aria-hidden="true">save</span>Save draft</button>` : ""}<small>Nothing is posted automatically. Copying puts the text on your clipboard; you paste it into Discord yourself.</small></div>
        ${renderDiscordPublicationActions(session)}
      </form>
    </section>`;
}

function updateDiscordDraftPreview(form) {
  // The Journal is often written after the session stops being the active one.
  const session = journalSession();
  if (!form || !session) return;
  const values = new FormData(form);
  const film = selectedFilmForSession(session);
  const existingEntry = session.journalEntry;
  const viewerIds = existingEntry ? [...(existingEntry.viewerIds || [])] : (session.participantIds || []).filter(Boolean);
  const viewerNames = existingEntry
    ? (existingEntry.viewerNames || viewerIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean))
    : session.members;
  discordDraft = {
    sessionId: session.id,
    entryNumber: String(values.get("entry_number") || ""),
    title: String(values.get("title") || ""),
    year: String(values.get("year") || ""),
    viewerIds,
    viewers: viewerNames.join(", "),
    runtime: Number(film?.runtime) || null,
    genres: normaliseGenres(film?.genres),
    status: String(values.get("status")) === "DNF" ? "DNF" : "Finished",
    comment: String(values.get("comment") || ""),
  };
  form.querySelector("#discord-template-preview").value = buildDiscordTemplate(discordDraft);
  const fancy = form.querySelector(".discord-embed-preview");
  if (fancy) {
    fancy.querySelector("[data-discord-preview-title]").textContent = discordDraft.title || "Untitled";
    fancy.querySelector("[data-discord-preview-film]").textContent = `${discordDraft.year || "Year unavailable"} · ${runtimeLabel(film || {})}`;
    fancy.querySelector("[data-discord-preview-genres]").textContent = normaliseGenres(film?.genres).join(" · ") || "Genres unavailable";
    fancy.querySelector("[data-discord-preview-viewers]").textContent = discordDraft.viewers || "No viewers recorded";
    fancy.querySelector("[data-discord-preview-status]").textContent = discordDraft.status;
    const comment = fancy.querySelector("[data-discord-preview-comment]");
    comment.textContent = discordDraft.comment;
    comment.hidden = !discordDraft.comment;
  }
  session.journalDraft = discordDraft;
  persistDesignPreviewWorkspace();
  if (canManageSession(session)) scheduleJournalDraftSave(session);
}

// Typing should not fire a write per keystroke, and a draft should not depend on
// remembering to press Copy. Save shortly after typing stops, and on the way out.
function scheduleJournalDraftSave(session) {
  if (designPreviewMode || !session) return;
  clearJournalDraftSaveTimer();
  journalDraftTimer = window.setTimeout(() => {
    journalDraftTimer = 0;
    saveJournalDraft(session).catch(() => {});
  }, 1200);
}

function clearJournalDraftSaveTimer() {
  if (journalDraftTimer) window.clearTimeout(journalDraftTimer);
  journalDraftTimer = 0;
}

function flushJournalDraftSave() {
  const session = journalSession();
  clearJournalDraftSaveTimer();
  if (!session || !discordDraft || !canManageSession(session)) return Promise.resolve(false);
  return saveJournalDraft(session).then(() => true);
}

async function saveJournalDraft(session = journalSession()) {
  clearJournalDraftSaveTimer();
  if (!session || !discordDraft) return;
  if (!canManageSession(session)) throw new Error("Only the session host or a website administrator can save this draft.");
  const snapshot = { ...discordDraft };
  if (designPreviewMode) {
    session.journalDraft = snapshot;
    persistDesignPreviewWorkspace();
    return;
  }
  const { data, error } = await supabase
    .from("movie_sessions")
    .update({ journal_draft: snapshot })
    .eq("id", session.id)
    .eq("group_id", activeGroup.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No session row was updated. Refresh before trying again.");
  session.journalDraft = snapshot;
}

async function saveJournalEntry(session, draft) {
  if (!session || session.status !== "WATCHED") throw new Error("The Journal is available after the film is marked watched.");
  const existingEntry = session.journalEntry;
  if (existingEntry ? !canManageJournalEntry(existingEntry, session) : !canManageSession(session)) {
    throw new Error(existingEntry
      ? "Only the entry creator or a website administrator can edit this Journal entry."
      : "Only the session host or a website administrator can create this Journal entry.");
  }
  const requestedNumber = String(draft.entryNumber || "").trim();
  const viewerIds = existingEntry
    ? [...(draft.viewerIds || existingEntry.viewerIds || [])]
    : [...(session.participantIds || [])];
  const viewerNames = viewerIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean);
  let saved;
  if (designPreviewMode) {
    const entryNumber = requestedNumber ? Number(requestedNumber) : (session.journalEntry?.entryNumber || previewNextEntryNumber);
    if (!Number.isInteger(entryNumber) || entryNumber < 1) throw new Error("Entry number must be a positive whole number.");
    if (sessionHistory.some((candidate) => candidate.id !== session.id && Number(candidate.journalEntry?.entryNumber) === entryNumber)) {
      throw new Error(`Journal entry #${entryNumber} already exists.`);
    }
    previewNextEntryNumber = Math.max(previewNextEntryNumber, entryNumber + 1);
    saved = {
      id: session.journalEntry?.id || `preview-journal-${session.id}`,
      entryNumber,
      title: draft.title,
      year: Number(draft.year),
      watchedAt: session.sessionDate,
      status: draft.status === "DNF" ? "DNF" : "FINISHED",
      comment: draft.comment,
      createdById: existingEntry?.createdById || authUser.id,
      viewerIds,
      viewerNames,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const request = existingEntry
      ? supabase.rpc("update_journal_entry", {
        p_entry_id: existingEntry.id,
        p_entry_number: requestedNumber ? Number(requestedNumber) : existingEntry.entryNumber,
        p_title: String(draft.title).trim(),
        p_release_year: Number(draft.year),
        p_watched_at: existingEntry.watchedAt || session.sessionDate,
        p_status: draft.status === "DNF" ? "DNF" : "FINISHED",
        p_comment: String(draft.comment || "").trim(),
        p_viewer_ids: viewerIds,
      })
      : supabase.rpc("save_movie_session_journal", {
        p_session_id: session.id,
        p_title: String(draft.title).trim(),
        p_release_year: Number(draft.year),
        p_status: draft.status === "DNF" ? "DNF" : "FINISHED",
        p_comment: String(draft.comment || "").trim(),
        p_entry_number: requestedNumber ? Number(requestedNumber) : null,
      });
    const { data, error } = await request;
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The Journal entry was not saved. Refresh before trying again.");
    saved = {
      id: row.id,
      entryNumber: row.entry_number,
      title: row.title,
      year: row.release_year,
      watchedAt: row.watched_at,
      status: row.status,
      comment: row.comment || "",
      createdById: row.created_by,
      viewerIds,
      viewerNames,
      updatedAt: row.updated_at,
    };
  }
  if (session.journalPublication?.discord_message_id && existingEntry) {
    session.journalPublication = { ...session.journalPublication, discord_out_of_date: true };
  }
  session.journalEntry = saved;
  discordDraft = {
    ...draft,
    sessionId: session.id,
    entryNumber: String(saved.entryNumber),
    viewerIds,
    viewers: viewerNames.join(", "),
  };
  session.journalDraft = { ...discordDraft };
  upsertCurrentJournalCatalogEntry(session);
  persistDesignPreviewWorkspace();
  return discordDraft;
}

async function refreshPersonalCinema({ rerender = false } = {}) {
  if (designPreviewMode || !authUser || !activeGroup) return;
  const [personalFilmsResult, personalViewingEventsResult] = await Promise.all([
    fetchPersonalFilms(),
    fetchPersonalViewingEvents(),
  ]);
  applyPersonalFilmsResult(personalFilmsResult);
  applyPersonalViewingEventsResult(personalViewingEventsResult);
  if (rerender && currentView === "my-films") render();
}

async function moveSavedSessionToJournal(session) {
  if (!session?.journalEntry?.id) return;
  await refreshPersonalCinema();
  journalSessionId = null;
  discordDraft = null;
  journalDetailsOpen = false;
  sessionDetailsEditing = null;
  journalEditingId = null;
  journalQuery = "";
  journalSourceFilter = "all";
  journalStatusFilter = "all";
  journalYearFilter = "all";
  journalViewerFilter = "all";
  journalVisibleLimit = 60;
  upsertCurrentJournalCatalogEntry(session);
  persistDesignPreviewWorkspace();
  navigate("journal");
}

async function publishJournalToDiscord(session, action = "publish") {
  if (!session?.journalEntry?.id) throw new Error("Save the Journal entry before posting it to Discord.");
  if (!canManageJournalEntry(session.journalEntry, session)) throw new Error("Only the entry creator or a website administrator can post or update this Journal entry.");
  if (action === "publish" && session.journalPublication?.discord_message_id) return session.journalPublication;
  if (designPreviewMode) {
    if (designPreviewVariant === "discord-error") throw new Error("Preview Discord delivery failed.");
    const now = new Date().toISOString();
    const publication = action === "update" && session.journalPublication
      ? { ...session.journalPublication, status: "POSTED", discord_out_of_date: false, last_synced_by: currentProfile.id, last_synced_at: now, discord_updated_at: now, last_error: null }
      : {
        id: `preview-publication-${session.journalEntry.id}`,
        journal_entry_id: session.journalEntry.id,
        status: "POSTED",
        discord_guild_id: "preview-guild",
        discord_channel_id: "preview-channel",
        discord_message_id: `preview-${session.journalEntry.entryNumber}`,
        posted_at: now,
        posted_by: currentProfile.id,
        poster_display_name: currentProfile.discordServerDisplayName,
        last_synced_by: currentProfile.id,
        last_synced_at: now,
        discord_out_of_date: false,
        last_error: null,
      };
    session.journalPublication = publication;
    persistDesignPreviewWorkspace();
    return publication;
  }
  const { data, error } = await supabase.functions.invoke("publish-journal-to-discord", { body: { journalEntryId: session.journalEntry.id, action } });
  if (error) {
    let message = error.message || "The Journal could not be posted to Discord.";
    try {
      const payload = await error.context?.json();
      if (payload?.error) message = payload.error;
    } catch { /* keep the safe function error */ }
    throw new Error(message);
  }
  if (!data?.publication) throw new Error("Discord did not return a publication record. Refresh before trying again.");
  data.publication.discord_out_of_date = Boolean(data.outOfDate);
  session.journalPublication = data.publication;
  return data.publication;
}

async function syncCatalogJournalToDiscord(entry, action) {
  if (!entry?.journalEntryId || !entry.canEdit) throw new Error("Only the entry creator or a website administrator can post or update this Journal entry.");
  const session = journalSessionForEntry(entry);
  if (session) {
    const publication = await publishJournalToDiscord(session, action);
    entry.publication = publication;
    entry.publicationStatus = publication.status;
    entry.discordOutOfDate = Boolean(publication.discord_out_of_date);
    entry.discordUrl = discordPublicationUrl(publication) || entry.discordUrl;
    return publication;
  }
  if (designPreviewMode) {
    const now = new Date().toISOString();
    entry.publication = action === "update" && entry.publication
      ? { ...entry.publication, status: "POSTED", discord_out_of_date: false, last_synced_by: currentProfile.id, last_synced_at: now, discord_updated_at: now, last_error: null }
      : {
        id: `preview-publication-${entry.journalEntryId}`,
        journal_entry_id: entry.journalEntryId,
        status: "POSTED",
        discord_guild_id: "preview-guild",
        discord_channel_id: "preview-channel",
        discord_message_id: `preview-${entry.entryLabel}`,
        posted_at: now,
        posted_by: currentProfile.id,
        poster_display_name: currentProfile.discordServerDisplayName,
        discord_out_of_date: false,
      };
    entry.publicationStatus = "POSTED";
    entry.discordOutOfDate = false;
    entry.discordUrl = discordPublicationUrl(entry.publication) || entry.discordUrl;
    return entry.publication;
  }

  const { data, error } = await supabase.functions.invoke("publish-journal-to-discord", {
    body: { journalEntryId: entry.journalEntryId, action },
  });
  if (error) {
    let message = error.message || `The Journal could not be ${action === "update" ? "updated in" : "posted to"} Discord.`;
    try {
      const payload = await error.context?.json();
      if (payload?.error) message = payload.error;
    } catch { /* keep the safe function error */ }
    throw new Error(message);
  }
  if (!data?.publication) throw new Error("Discord did not return a publication record. Refresh before trying again.");
  entry.publication = data.publication;
  entry.publicationStatus = data.publication.status;
  entry.discordOutOfDate = Boolean(data.outOfDate);
  entry.discordUrl = data.messageUrl || discordPublicationUrl(data.publication) || entry.discordUrl;
  return data.publication;
}

async function saveCatalogJournalEntry(form) {
  const entry = journalCatalog.find((candidate) => candidate.journalEntryId === form.dataset.entryId);
  if (!entry?.canEdit || entry.sourceType !== "CINE_CORD" || !entry.journalEntryId) {
    throw new Error("Only current Cine-Cord entries can be edited by their creator or a website administrator.");
  }
  const values = new FormData(form);
  const viewerIds = values.getAll("viewer").map(String);
  if (!viewerIds.length) throw new Error("Choose at least one viewer.");
  if (designPreviewMode) {
    entry.entryLabel = String(values.get("entry_number"));
    entry.entrySortNumber = Number(entry.entryLabel);
    entry.title = String(values.get("title")).trim();
    entry.year = Number(values.get("release_year"));
    entry.watchedAt = String(values.get("watched_at"));
    entry.status = String(values.get("status")) === "DNF" ? "DNF" : "FINISHED";
    entry.comment = String(values.get("comment") || "").trim();
    entry.viewerIds = viewerIds;
    entry.viewerNames = viewerIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean);
    entry.discordOutOfDate = Boolean(entry.discordUrl);
    if (entry.publication) entry.publication.discord_out_of_date = entry.discordOutOfDate;
    return entry;
  }
  const { data, error } = await supabase.rpc("update_journal_entry", {
    p_entry_id: entry.journalEntryId,
    p_entry_number: Number(values.get("entry_number")),
    p_title: String(values.get("title")).trim(),
    p_release_year: Number(values.get("release_year")),
    p_watched_at: String(values.get("watched_at")),
    p_status: String(values.get("status")) === "DNF" ? "DNF" : "FINISHED",
    p_comment: String(values.get("comment") || "").trim(),
    p_viewer_ids: viewerIds,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

function journalEntryHasDiscordMessage(entry) {
  return Boolean(entry?.discordUrl || entry?.publication?.discord_message_id);
}

function openJournalDeleteModal(entry, opener) {
  if (!entry?.canEdit || entry.sourceType !== "CINE_CORD" || !entry.journalEntryId) return;
  const hasDiscordMessage = journalEntryHasDiscordMessage(entry);
  journalDeleteModal.dataset.entryId = entry.journalEntryId;
  journalDeleteReturnFocus = opener || document.activeElement;
  journalDeleteNumber.textContent = `Entry #${entry.entryLabel}`;
  journalDeleteFilm.textContent = entry.title;
  journalDeleteDate.textContent = entry.watchedAt ? formatAddedDate(entry.watchedAt) : "Watch date not recorded";
  journalDeleteDescription.textContent = hasDiscordMessage
    ? "This permanently removes the Cine-Cord entry and its existing Discord message. The watched session will remain."
    : "This permanently removes the Cine-Cord entry. The watched session will remain.";
  journalDeleteDiscordNote.hidden = !hasDiscordMessage;
  journalDeleteError.hidden = true;
  journalDeleteError.textContent = "";
  journalDeleteConfirm.disabled = false;
  journalDeleteConfirm.querySelector("span:last-child").textContent = hasDiscordMessage ? "Delete entry and Discord post" : "Delete entry";
  journalDeleteModal.hidden = false;
  document.body.style.overflow = "hidden";
  journalDeleteModal.querySelector(".journal-delete-actions [data-close-journal-delete]")?.focus();
}

function closeJournalDeleteModal({ restoreFocus = true } = {}) {
  if (journalDeletePendingId) return;
  journalDeleteModal.hidden = true;
  journalDeleteModal.removeAttribute("data-entry-id");
  document.body.style.overflow = "";
  if (restoreFocus && journalDeleteReturnFocus?.isConnected) journalDeleteReturnFocus.focus({ preventScroll: true });
  journalDeleteReturnFocus = null;
}

function removeDeletedJournalEntryFromLocalState(entry) {
  const session = journalSessionForEntry(entry);
  journalCatalog = journalCatalog.filter((candidate) => candidate.journalEntryId !== entry.journalEntryId);
  if (!session) return;
  session.journalEntry = null;
  session.journalPublication = null;
  session.journalDraft = null;
  if (journalSessionId === session.id) discordDraft = null;
}

async function deleteCatalogJournalEntry(entry) {
  if (!entry?.canEdit || entry.sourceType !== "CINE_CORD" || !entry.journalEntryId) {
    throw new Error("Only current Cine-Cord entries can be deleted by their creator or a website administrator.");
  }
  if (designPreviewMode) {
    removeDeletedJournalEntryFromLocalState(entry);
    persistDesignPreviewWorkspace();
    return { status: "deleted", discordDeleted: journalEntryHasDiscordMessage(entry) };
  }

  const { data, error } = await supabase.functions.invoke("publish-journal-to-discord", {
    body: { journalEntryId: entry.journalEntryId, action: "delete" },
  });
  if (error) {
    let message = error.message || "The Journal entry could not be deleted.";
    try {
      const payload = await error.context?.json();
      if (payload?.error) message = payload.error;
    } catch { /* keep the safe function error */ }
    throw new Error(message);
  }
  if (data?.status !== "deleted") throw new Error("Cine-Cord did not confirm that the Journal entry was deleted. Refresh before trying again.");
  return data;
}

async function copyJournalToClipboard(draft, preview) {
  const template = buildDiscordTemplate(draft);
  try {
    await navigator.clipboard.writeText(template);
    return true;
  } catch {
    if (preview) {
      preview.value = template;
      preview.focus();
      preview.select();
    }
    return false;
  }
}

function getRouletteCandidates() {
  return filterRouletteCandidates(movieList, rouletteState);
}

function rouletteWeights(candidates) {
  return calculateRouletteWeights(candidates, rouletteState?.filters.weightedByAge);
}

function rouletteWaitLabel(item) {
  const createdAt = new Date(rouletteWaitingSince(item));
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

function isoDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sessionDateLabel(value) {
  const today = isoDateOnly(new Date());
  if (value === today) return "tonight";
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (value === isoDateOnly(yesterday)) return "last night";
  const label = formatSavedDate(value, { day: "numeric", month: "long" }, navigator.language);
  return label === "Date unknown" ? "tonight" : `on ${label}`;
}

function rouletteWeightSummary(weight, item, { weighted }) {
  if (!weighted) return "Even odds";
  return `${weight}× weight · waiting ${rouletteWaitLabel(item).replace(/ waiting$/, "").toLowerCase()}`;
}

function rouletteWeightExplanation(weight, item, { weighted }) {
  if (!weighted) return "Age weighting was off for this round, so every film carried the same wheel weight.";
  if (weight === 1) return "Standard wheel weight. This film has not been waiting long enough to earn extra chances.";
  return `${weight} times the standard wheel weight, because this film has been waiting ${rouletteWaitLabel(item).replace(/ waiting$/, "").toLowerCase()}.`;
}

// The list stores a boolean, so a watched film reads as one viewing until a real
// count exists; the ladder is here so it becomes correct the moment one does.
function watchHistoryLabel(item) {
  const recordedCount = Number.isInteger(item.watchCount) ? item.watchCount : 0;
  const count = Math.max(recordedCount, item.watched ? 1 : 0);
  if (count <= 0) return "Never watched";
  if (count === 1) return "Watched once";
  return `Watched ${count} times`;
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
    movie_id: movie.movieId || null,
    title: movie.title,
    release_year: movie.year,
    tmdb_id: movie.tmdbId,
    poster_path: movie.posterPath,
    backdrop_path: movie.backdropPath,
    runtime_minutes: movie.runtime,
    genres: movie.genres,
    overview: movie.overview,
    metadata_updated_at: new Date().toISOString(),
  };
}

async function lookupMovie(body) {
  if (designPreviewMode) {
    const catalog = [...new Map([...movieList, ...personalFilms].map((film) => [Number(film.tmdbId), film])).values()];
    if (body?.action === "search") {
      const query = String(body.query || "").trim().toLocaleLowerCase();
      const year = body.year === null || body.year === undefined || body.year === "" ? null : Number(body.year);
      const matches = catalog
        .filter((film) => (!query || film.title.toLocaleLowerCase().includes(query)) && (!year || Number(film.year) === year))
        .slice(0, 6)
        .map((film) => ({ tmdbId: film.tmdbId, title: film.title, year: film.year, posterPath: film.posterPath || film.posterUrl, overview: film.overview }));
      return { matches };
    }
    if (body?.action === "details") {
      const film = catalog.find((candidate) => Number(candidate.tmdbId) === Number(body.tmdbId));
      return { movie: film ? {
        movieId: film.movieId,
        tmdbId: film.tmdbId,
        title: film.title,
        year: film.year,
        posterPath: film.posterPath || film.posterUrl,
        backdropPath: film.backdropPath || film.backdropUrl,
        runtime: film.runtime,
        genres: film.genres,
        overview: film.overview,
      } : null };
    }
  }
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

const PERSONAL_FILM_SELECT = "id,owner_id,movie_id,state,rating,is_favourite,created_at,updated_at,movies(id,tmdb_id,title,release_year,poster_path,backdrop_path,runtime_minutes,genres,overview,metadata_updated_at)";
const PERSONAL_VIEWING_EVENT_SELECT = "id,owner_id,movie_id,outcome,watched_on,source_journal_entry_id,is_hidden,created_at,updated_at";
const PERSONAL_REVIEW_SELECT = "id,owner_id,movie_id,body,contains_spoilers,created_at,updated_at";
const PUBLISHED_REVIEW_SELECT = "review_id,owner_id,movie_id,body,contains_spoilers,rating,published_at,updated_at";

function personalWritePatch(existing, patch) {
  const payload = {};
  if (Object.hasOwn(patch, "state")) payload.state = patch.state;
  if (Object.hasOwn(patch, "rating")) payload.rating = patch.rating;
  if (Object.hasOwn(patch, "isFavourite")) payload.is_favourite = Boolean(patch.isFavourite);
  if (Object.hasOwn(patch, "state") && (patch.state === "WANT_TO_WATCH" || patch.state === null) && existing?.rating !== null) payload.rating = null;
  return payload;
}

function replacePersonalFilm(film) {
  const existingIndex = personalFilms.findIndex((candidate) => candidate.id === film.id);
  if (existingIndex >= 0) personalFilms.splice(existingIndex, 1, film);
  else personalFilms.unshift(film);
}

function clearLocalPublishedRating(movieId) {
  publishedReviews = publishedReviews.map((review) => review.ownerId === authUser?.id && review.movieId === movieId
    ? { ...review, rating: null, updatedAt: new Date().toISOString() }
    : review);
}

async function savePersonalFilm(movie, patch) {
  if (!authUser || !activeGroup || !movie?.movieId) throw new Error("This film needs matched movie details before it can be saved privately.");
  const existing = findFilmByIdentity(personalFilms, movie);
  const writePatch = personalWritePatch(existing, patch);
  if (designPreviewMode) {
    const saved = applyPersonalFilmPatch(existing, movie, patch, {
      id: existing?.id || `preview-personal-${movie.tmdbId || Date.now()}`,
      ownerId: authUser.id,
    });
    replacePersonalFilm(saved);
    if (saved.rating === null) clearLocalPublishedRating(saved.movieId);
    persistDesignPreviewWorkspace();
    return saved;
  }

  const query = existing
    ? supabase.from("personal_films").update(writePatch).eq("id", existing.id)
    : supabase.from("personal_films").insert({ owner_id: authUser.id, movie_id: movie.movieId, ...writePatch });
  const { data, error } = await query.select(PERSONAL_FILM_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No private film row was saved. Refresh before trying again.");
  const saved = normalisePersonalFilm(data);
  replacePersonalFilm(saved);
  if (saved.rating === null) clearLocalPublishedRating(saved.movieId);
  return saved;
}

async function removePersonalFilm(film) {
  const existing = findFilmByIdentity(personalFilms, film);
  if (!existing) return;
  if (designPreviewMode) {
    personalFilms = personalFilms.filter((candidate) => candidate.id !== existing.id);
    clearLocalPublishedRating(existing.movieId);
    persistDesignPreviewWorkspace();
    return;
  }
  const { data, error } = await supabase.from("personal_films").delete().eq("id", existing.id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The private film was not removed. Refresh before trying again.");
  personalFilms = personalFilms.filter((candidate) => candidate.id !== existing.id);
  clearLocalPublishedRating(existing.movieId);
}

function replacePersonalViewingEvent(event) {
  const existingIndex = personalViewingEvents.findIndex((candidate) => candidate.id === event.id);
  if (existingIndex >= 0) personalViewingEvents.splice(existingIndex, 1, event);
  else personalViewingEvents.push(event);
}

async function saveManualViewingEvent(movie, event, { outcome, watchedOn }) {
  if (!authUser || !activeGroup || !movie?.movieId) throw new Error("This film needs a canonical movie record before history can be saved.");
  if (!VIEWING_OUTCOMES.some((candidate) => candidate.value === outcome)) throw new Error("Choose Finished or Did Not Finish.");
  if (event?.sourceJournalEntryId) throw new Error("Source-linked facts must be corrected through the Journal.");

  const payload = { outcome, watched_on: watchedOn || null };
  if (designPreviewMode) {
    const now = new Date().toISOString();
    const saved = normalisePersonalViewingEvent({
      ...(event || {}),
      id: event?.id || `preview-viewing-${Date.now()}`,
      ownerId: authUser.id,
      movieId: movie.movieId,
      sourceJournalEntryId: null,
      isHidden: false,
      outcome,
      watchedOn: watchedOn || null,
      createdAt: event?.createdAt || now,
      updatedAt: now,
    });
    replacePersonalViewingEvent(saved);
    persistDesignPreviewWorkspace();
    return saved;
  }

  const query = event
    ? supabase.from("personal_viewing_events").update(payload).eq("id", event.id).eq("owner_id", authUser.id).is("source_journal_entry_id", null)
    : supabase.from("personal_viewing_events").insert({
      owner_id: authUser.id,
      movie_id: movie.movieId,
      ...payload,
    });
  const { data, error } = await query.select(PERSONAL_VIEWING_EVENT_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No viewing event was saved. Refresh before trying again.");
  const saved = normalisePersonalViewingEvent(data);
  replacePersonalViewingEvent(saved);
  return saved;
}

async function setSourceViewingEventHidden(event, isHidden) {
  if (!event?.sourceJournalEntryId) throw new Error("Manual viewing events cannot be hidden; delete them instead.");
  if (designPreviewMode) {
    const saved = { ...event, isHidden: Boolean(isHidden), updatedAt: new Date().toISOString() };
    replacePersonalViewingEvent(saved);
    persistDesignPreviewWorkspace();
    return saved;
  }
  const { data, error } = await supabase
    .from("personal_viewing_events")
    .update({ is_hidden: Boolean(isHidden) })
    .eq("id", event.id)
    .eq("owner_id", authUser.id)
    .select(PERSONAL_VIEWING_EVENT_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The source-linked event was not changed. Refresh before trying again.");
  const saved = normalisePersonalViewingEvent(data);
  replacePersonalViewingEvent(saved);
  return saved;
}

async function deleteManualViewingEvent(event) {
  if (!event || event.sourceJournalEntryId) throw new Error("Source-linked events are hidden or corrected through the Journal, not deleted here.");
  if (designPreviewMode) {
    personalViewingEvents = personalViewingEvents.filter((candidate) => candidate.id !== event.id);
    persistDesignPreviewWorkspace();
    return;
  }
  const { data, error } = await supabase.rpc("delete_manual_personal_viewing_event", { p_event_id: event.id });
  if (error) throw error;
  if (!data) throw new Error("The manual viewing event was not deleted. Refresh before trying again.");
  personalViewingEvents = personalViewingEvents.filter((candidate) => candidate.id !== event.id);
}

function replacePersonalReview(review) {
  const existingIndex = personalReviews.findIndex((candidate) => candidate.id === review.id);
  if (existingIndex >= 0) personalReviews.splice(existingIndex, 1, review);
  else personalReviews.push(review);
}

function replacePublishedReview(review) {
  const existingIndex = publishedReviews.findIndex((candidate) => candidate.reviewId === review.reviewId);
  if (existingIndex >= 0) publishedReviews.splice(existingIndex, 1, review);
  else publishedReviews.push(review);
}

async function savePersonalReview(movie, review, { body, containsSpoilers }) {
  const cleanBody = String(body || "").trim();
  if (!authUser || !activeGroup || !movie?.movieId) throw new Error("This film needs a canonical movie record before a review can be saved.");
  if (!cleanBody) throw new Error("Write something before saving the review.");
  if (cleanBody.length > 1000) throw new Error("Keep the review to 1,000 characters or fewer.");

  if (designPreviewMode) {
    const now = new Date().toISOString();
    const saved = normalisePersonalReview({
      ...(review || {}),
      id: review?.id || `preview-review-${Date.now()}`,
      ownerId: authUser.id,
      movieId: movie.movieId,
      body: cleanBody,
      containsSpoilers,
      createdAt: review?.createdAt || now,
      updatedAt: now,
    });
    replacePersonalReview(saved);
    persistDesignPreviewWorkspace();
    return saved;
  }

  const payload = { body: cleanBody, contains_spoilers: Boolean(containsSpoilers) };
  const query = review
    ? supabase.from("personal_reviews").update(payload).eq("id", review.id).eq("owner_id", authUser.id)
    : supabase.from("personal_reviews").insert({ owner_id: authUser.id, movie_id: movie.movieId, ...payload });
  const { data, error } = await query.select(PERSONAL_REVIEW_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No private review was saved. Refresh before trying again.");
  const saved = normalisePersonalReview(data);
  replacePersonalReview(saved);
  return saved;
}

async function publishPersonalReview(review, movie) {
  if (!review || review.ownerId !== authUser?.id) throw new Error("Save your private review before publishing it.");
  if (designPreviewMode) {
    const now = new Date().toISOString();
    const personal = findFilmByIdentity(personalFilms, movie);
    const published = normalisePublishedReview({
      reviewId: review.id,
      ownerId: review.ownerId,
      movieId: review.movieId,
      body: review.body.trim(),
      containsSpoilers: review.containsSpoilers,
      rating: personal?.rating ?? null,
      publishedAt: now,
      updatedAt: now,
    });
    replacePublishedReview(published);
    persistDesignPreviewWorkspace();
    return published;
  }

  const { data: published, error: publishError } = await supabase.rpc("publish_personal_review", { p_review_id: review.id });
  if (publishError) throw publishError;
  if (!published) throw new Error("The review was not published. Refresh before trying again.");
  const { data, error } = await supabase.from("published_reviews").select(PUBLISHED_REVIEW_SELECT).eq("review_id", review.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The published review could not be loaded. Refresh before trying again.");
  const snapshot = normalisePublishedReview(data);
  replacePublishedReview(snapshot);
  return snapshot;
}

async function unpublishPersonalReview(review) {
  if (!review || review.ownerId !== authUser?.id) throw new Error("Only the review author can unpublish it.");
  if (designPreviewMode) {
    publishedReviews = publishedReviews.filter((candidate) => candidate.reviewId !== review.id);
    persistDesignPreviewWorkspace();
    return;
  }
  const { data, error } = await supabase.rpc("unpublish_personal_review", { p_review_id: review.id });
  if (error) throw error;
  if (!data) throw new Error("The review was not unpublished. Refresh before trying again.");
  publishedReviews = publishedReviews.filter((candidate) => candidate.reviewId !== review.id);
}

async function deletePersonalReview(review) {
  if (!review || review.ownerId !== authUser?.id) throw new Error("Only the review author can delete it.");
  if (designPreviewMode) {
    personalReviews = personalReviews.filter((candidate) => candidate.id !== review.id);
    publishedReviews = publishedReviews.filter((candidate) => candidate.reviewId !== review.id);
    persistDesignPreviewWorkspace();
    return;
  }
  const { data, error } = await supabase.from("personal_reviews").delete().eq("id", review.id).eq("owner_id", authUser.id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The review was not deleted. Refresh before trying again.");
  personalReviews = personalReviews.filter((candidate) => candidate.id !== review.id);
  publishedReviews = publishedReviews.filter((candidate) => candidate.reviewId !== review.id);
}

async function suggestPersonalFilm(movie) {
  if (!authUser || !activeGroup || !movie?.movieId) throw new Error("This film needs matched movie details before it can be suggested.");
  const existing = findFilmByIdentity(movieList, movie);
  if (existing) return existing;
  if (designPreviewMode) {
    const item = {
      ...movie,
      id: `preview-shared-${movie.tmdbId || Date.now()}`,
      suggestedById: authUser.id,
      suggestedBy: currentProfile?.displayName || "Cameron",
      suggestedByAvatar: currentProfile?.discordServerAvatar || avatarForName(currentProfile?.displayName),
      createdAt: new Date().toISOString(),
      watched: false,
      watchCount: 0,
      votes: 0,
      votedByMe: false,
    };
    movieList.push(item);
    persistDesignPreviewWorkspace();
    return item;
  }
  const { data, error } = await supabase.from("queue_items").insert({
    group_id: activeGroup.id,
    suggested_by: authUser.id,
    ...metadataPayload(movie),
  }).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The shared suggestion was not saved. Refresh before trying again.");
  await loadWorkspace();
  return findFilmByIdentity(movieList, movie);
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

async function fetchAllJournalCatalog(groupId) {
  const pageSize = 500;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("journal_catalog")
      .select("*")
      .eq("group_id", groupId)
      .order("source_created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function normaliseJournalCatalogRow(row, viewerIdsByEntry, publicationByEntry) {
  const publication = row.journal_entry_id ? publicationByEntry.get(row.journal_entry_id) || null : null;
  const viewerNames = Array.isArray(row.viewer_names) ? row.viewer_names.filter(Boolean) : [];
  return {
    catalogId: row.catalog_id,
    sourceType: row.source_type,
    recordId: row.record_id,
    journalEntryId: row.journal_entry_id,
    archiveEntryId: row.archive_entry_id,
    groupId: row.group_id,
    entryLabel: row.entry_label,
    entrySortNumber: Number(row.entry_sort_number),
    title: row.title,
    year: row.release_year,
    watchedAt: row.watched_at,
    status: row.status,
    comment: row.comment || "",
    viewerNames,
    viewerIds: row.journal_entry_id ? viewerIdsByEntry.get(row.journal_entry_id) || [] : [],
    createdById: row.created_by,
    authorName: row.author_display_name || "Unknown Discordian",
    volumeId: row.volume_id,
    volumeName: row.volume_name,
    discordUrl: row.discord_jump_url || null,
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    parserStatus: row.parser_status,
    publicationStatus: publication?.status || row.publication_status || null,
    publication,
    postedBy: row.posted_by,
    posterDisplayName: row.poster_display_name,
    posterAvatarUrl: row.poster_avatar_url,
    postedAt: row.posted_at,
    lastSyncedBy: row.last_synced_by,
    lastSyncedAt: row.last_synced_at,
    discordUpdatedAt: row.discord_updated_at,
    discordOutOfDate: Boolean(row.discord_out_of_date),
    canEdit: Boolean(row.can_edit),
  };
}

function upsertCurrentJournalCatalogEntry(session) {
  const entry = session?.journalEntry;
  if (!entry?.id) return;
  const existingIndex = journalCatalog.findIndex((candidate) => candidate.journalEntryId === entry.id);
  const existing = existingIndex >= 0 ? journalCatalog[existingIndex] : null;
  const publication = session.journalPublication || existing?.publication || null;
  const catalogEntry = {
    ...(existing || {}),
    catalogId: `current:${entry.id}`,
    sourceType: "CINE_CORD",
    recordId: entry.id,
    journalEntryId: entry.id,
    archiveEntryId: null,
    groupId: session.groupId || activeGroup?.id,
    entryLabel: String(entry.entryNumber),
    entrySortNumber: Number(entry.entryNumber),
    title: entry.title,
    year: entry.year,
    watchedAt: entry.watchedAt,
    status: entry.status,
    comment: entry.comment || "",
    viewerNames: [...(entry.viewerNames || [])],
    viewerIds: [...(entry.viewerIds || [])],
    createdById: entry.createdById,
    authorName: members.find((member) => member.id === entry.createdById)?.name || currentProfile?.displayName || "Discordian",
    volumeId: null,
    volumeName: "Cine-Cord",
    discordUrl: discordPublicationUrl(publication),
    sourceCreatedAt: existing?.sourceCreatedAt || new Date().toISOString(),
    sourceUpdatedAt: entry.updatedAt || new Date().toISOString(),
    parserStatus: "PARSED",
    publicationStatus: publication?.status || null,
    publication,
    discordOutOfDate: Boolean(publication?.discord_message_id && (publication.discord_out_of_date ?? true)),
    canEdit: canManageJournalEntry(entry, session),
  };
  if (existingIndex >= 0) journalCatalog.splice(existingIndex, 1, catalogEntry);
  else journalCatalog.unshift(catalogEntry);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}

function requestDiscordProfileSync() {
  discordProfileSyncRequested = true;
  try { window.sessionStorage.setItem(DISCORD_PROFILE_SYNC_MARKER, "requested"); }
  catch { /* the in-memory flag still survives until navigation */ }
}

function clearDiscordProfileSyncRequest() {
  discordProfileSyncRequested = false;
  try { window.sessionStorage.removeItem(DISCORD_PROFILE_SYNC_MARKER); }
  catch { /* no stored marker to clear */ }
}

async function syncDiscordServerProfile(providerToken) {
  const token = String(providerToken || "").trim();
  if (!token) throw new Error("Reconnect Discord to refresh your server profile.");
  if (discordProfileSyncInFlight) return discordProfileSyncInFlight;

  discordProfileSyncInFlight = (async () => {
    const { data, error } = await supabase.functions.invoke("sync-discord-server-profile", {
      body: { providerToken: token },
    });
    if (error) {
      let message = error.message || "Your Discord server profile could not be refreshed.";
      try {
        const payload = await error.context?.json();
        if (payload?.error) message = payload.error;
      } catch { /* keep the safe function error */ }
      throw new Error(message);
    }
    if (!data?.identity?.displayName) throw new Error("Discord did not return a usable server profile.");
    return data.identity;
  })();

  try {
    return await discordProfileSyncInFlight;
  } finally {
    // Never keep a second application copy of Discord's provider token or retry
    // it silently on later page loads. The user can explicitly refresh again.
    clearDiscordProfileSyncRequest();
    discordProfileSyncInFlight = null;
  }
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
              <span class="discord-auth-copy"><strong>Continue with Discord</strong><small>Uses your server name/avatar · approval is still required</small></span>
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
      <span class="poster-frame ${item.posterUrl ? "" : "is-placeholder"}">
        <button class="poster-card-open" type="button" data-select-film="${item.id}" aria-label="View details for ${escapeHTML(item.title)}" aria-pressed="${selected}">
          <img src="${escapeHTML(filmPoster(item))}" alt="${item.posterUrl ? `${escapeHTML(item.title)} poster` : "Abstract Cine-Cord poster placeholder"}" loading="lazy" />
          ${item.posterUrl ? "" : `<span class="poster-pending"><span class="material-symbols-outlined" aria-hidden="true">movie</span> Artwork pending</span>`}
          <span class="status-pill ${item.watched ? "watched" : "ready"}">${escapeHTML(watchHistoryLabel(item))}</span>
        </button>
        <span class="poster-card-actions" aria-label="Actions for ${escapeHTML(item.title)}">
          <button class="poster-action poster-action-watch" type="button" data-watch-now="${item.id}"><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span>Watch now</button>
          <button class="poster-action poster-action-details" type="button" data-select-film="${item.id}"><span class="material-symbols-outlined" aria-hidden="true">info</span>Film details</button>
        </span>
      </span>
      <span class="poster-copy"><span class="poster-title-line"><strong>${escapeHTML(item.title)}</strong>${item.year ? `<span>${item.year}</span>` : ""}</span><span class="poster-metadata">${escapeHTML(metadataLine(item))}</span></span>
      <footer class="poster-card-footer">
        <span class="poster-suggester"><img src="${escapeHTML(avatarForFilm(item))}" alt="" /><span>Added by <strong>${escapeHTML(item.suggestedBy)}</strong></span></span>
        <button class="poster-vote ${item.votedByMe ? "is-voted" : ""}" type="button" data-vote="${item.id}" ${item.watched ? "disabled" : ""} aria-label="${item.votedByMe ? "Remove vote from" : "Vote for"} ${escapeHTML(item.title)}"><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span><strong>${item.votes}</strong></button>
      </footer>
    </article>`;
}

function selectedFilmContext() {
  if (currentView === "my-films") {
    const personal = personalFilms.find((film) => film.id === selectedFilmId) || null;
    if (!personal) return null;
    const shared = findFilmByIdentity(movieList, personal);
    return { origin: "my-films", movie: personal, personal, shared };
  }
  const shared = movieList.find((film) => film.id === selectedFilmId) || null;
  if (!shared) return null;
  const personal = findFilmByIdentity(personalFilms, shared);
  return { origin: "list", movie: personal ? { ...shared, ...personal } : shared, personal, shared };
}

function filmMatchesSession(film, session) {
  const selected = selectedFilmForSession(session);
  return Boolean(selected && findFilmByIdentity([selected], film));
}

function setReactionLabel(control, value) {
  const label = control?.querySelector("[data-rating-label]");
  const reaction = reactionForValue(value);
  if (label) label.textContent = reaction ? `${reaction.value} — ${reaction.label}` : "Choose a rating";
}

function restoreReactionLabel(control) {
  setReactionLabel(control, control?.dataset.savedReactionValue);
}

function previewReactionChoice(choice) {
  const reaction = reactionForValue(choice?.dataset.reactionValue);
  const control = choice?.closest(".reaction-control");
  if (!control || !reaction) return;
  setReactionLabel(control, reaction.value);
}

function activeReactionPreview(control) {
  const focused = control?.querySelector("[data-reaction-choice]:focus");
  if (focused) return focused;
  return [...(control?.querySelectorAll("[data-reaction-choice]") || [])]
    .find((choice) => choice.matches(":hover")) || null;
}

function renderReactionControl(movie, personal) {
  const savedReaction = reactionForValue(personal?.rating);
  return `
    <section class="reaction-control film-rating" aria-labelledby="reaction-question" data-saved-reaction-value="${savedReaction?.value || ""}">
      <div class="film-rating-heading"><span id="reaction-question" tabindex="-1">Your rating</span>${savedReaction ? `<button class="detail-text-action" type="button" data-clear-reaction aria-label="Clear rating">Clear</button>` : ""}</div>
      <div class="film-rating-row">
        <div class="film-rating-choices" role="group" aria-labelledby="reaction-question">${REACTION_LEVELS.map((reaction, index) => {
        const selected = reaction.value === savedReaction?.value;
        const tabIndex = selected || (!savedReaction && index === 0) ? 0 : -1;
        return `<button class="film-rating-number" type="button" aria-pressed="${selected}" aria-label="Level ${reaction.value} of 5, ${escapeHTML(reaction.label)}" title="${escapeHTML(reaction.label)}" tabindex="${tabIndex}" data-reaction-choice data-reaction-value="${reaction.value}">${reaction.value}</button>`;
        }).join("")}</div>
        <span class="film-rating-label" data-rating-label aria-live="polite" aria-atomic="true">${savedReaction ? `${savedReaction.value} — ${escapeHTML(savedReaction.label)}` : "Choose a rating"}</span>
      </div>
      <span class="sr-only" role="status" aria-live="polite">${escapeHTML(reactionLiveMessage)}</span>
    </section>`;
}

function journalEntryForViewingEvent(viewingEvent) {
  if (!viewingEvent?.sourceJournalEntryId) return null;
  return journalCatalog.find((entry) => entry.journalEntryId === viewingEvent.sourceJournalEntryId) || null;
}

function renderViewingEventEditor(viewingEvent = null) {
  const outcome = viewingEvent?.outcome || "FINISHED";
  const watchedOn = viewingEvent?.watchedOn ?? isoDateOnly(new Date());
  const pending = viewingEventPendingId === (viewingEvent?.id || "new");
  return `
    <form class="viewing-event-editor" data-viewing-event-form data-viewing-event-id="${escapeHTML(viewingEvent?.id || "")}">
      <label><span>Outcome</span><select name="outcome" ${pending ? "disabled" : ""}>${VIEWING_OUTCOMES.map((candidate) => `<option value="${candidate.value}" ${candidate.value === outcome ? "selected" : ""}>${escapeHTML(candidate.label)}</option>`).join("")}</select></label>
      <label><span>Date <small>Optional</small></span><input name="watched_on" type="date" value="${escapeHTML(watchedOn)}" ${pending ? "disabled" : ""} /></label>
      <div class="viewing-event-editor-actions"><button class="primary-button compact" type="submit" ${pending ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">${pending ? "progress_activity" : "save"}</span>${pending ? "Saving…" : viewingEvent ? "Save changes" : "Add viewing"}</button><button class="quiet-button compact" type="button" data-cancel-viewing-event ${pending ? "disabled" : ""}>Cancel</button></div>
      <small class="viewing-event-editor-note">Private to you. This does not change Cine-Cord, the Journal, your current state or rating.</small>
    </form>`;
}

function renderViewingEventRow(viewingEvent) {
  const sourceEntry = journalEntryForViewingEvent(viewingEvent);
  const isSourceLinked = Boolean(viewingEvent.sourceJournalEntryId);
  const isEditing = !isSourceLinked && viewingEventEditorId === viewingEvent.id;
  const pending = viewingEventPendingId === viewingEvent.id;
  const dateLabel = viewingEvent.watchedOn ? formatSavedDate(viewingEvent.watchedOn) : "Date not recorded";
  const sourceLabel = isSourceLinked
    ? (sourceEntry ? `From Journal entry #${sourceEntry.entryLabel}` : "From a current Journal entry")
    : "Added manually";
  if (isEditing) {
    return `<article class="viewing-event-row is-editing" data-viewing-event-row="${escapeHTML(viewingEvent.id)}" tabindex="-1">${renderViewingEventEditor(viewingEvent)}</article>`;
  }
  return `
    <article class="viewing-event-row ${isSourceLinked ? "is-source-linked" : "is-manual"} ${viewingEvent.isHidden ? "is-hidden-event" : ""}" data-viewing-event-row="${escapeHTML(viewingEvent.id)}" tabindex="-1">
      <div class="viewing-event-facts"><span class="viewing-outcome ${viewingEvent.outcome === "DID_NOT_FINISH" ? "is-dnf" : "is-finished"}">${escapeHTML(viewingOutcomeLabel(viewingEvent.outcome))}</span>${viewingEvent.watchedOn ? `<time datetime="${escapeHTML(viewingEvent.watchedOn)}">${escapeHTML(dateLabel)}</time>` : `<span>${escapeHTML(dateLabel)}</span>`}</div>
      <small class="viewing-event-source"><span class="material-symbols-outlined" aria-hidden="true">${isSourceLinked ? "menu_book" : "edit_calendar"}</span>${escapeHTML(sourceLabel)}</small>
      <div class="viewing-event-actions">
        ${isSourceLinked ? `<button class="detail-text-action" type="button" data-toggle-viewing-event-hidden="${escapeHTML(viewingEvent.id)}" ${pending ? "disabled" : ""}>${pending ? "Saving…" : viewingEvent.isHidden ? "Reveal in My Cinema" : "Hide from My Cinema"}</button><button class="detail-text-action" type="button" data-open-source-journal="${escapeHTML(viewingEvent.id)}">${sourceEntry?.canEdit ? "Correct in Journal" : "View in Journal"}</button>` : `<button class="detail-text-action" type="button" data-edit-viewing-event="${escapeHTML(viewingEvent.id)}" ${pending ? "disabled" : ""}>Edit</button><button class="detail-text-action danger" type="button" data-delete-viewing-event="${escapeHTML(viewingEvent.id)}" ${pending ? "disabled" : ""}>${pending ? "Deleting…" : "Delete"}</button>`}
      </div>
    </article>`;
}

function renderViewingHistory(context) {
  const events = getViewingEventsForMovie(personalViewingEvents, context.movie?.movieId);
  const visibleEvents = events.filter((viewingEvent) => !viewingEvent.isHidden);
  const hiddenEvents = events.filter((viewingEvent) => viewingEvent.isHidden);
  const canAddManual = Boolean(context.personal && !personalFilmsLoadError && context.movie?.movieId);
  if (!context.personal && !events.length && !personalViewingEventsLoadError) return "";

  if (personalViewingEventsLoadError) {
    return `
      <section class="viewing-history" aria-labelledby="viewing-history-title">
        <header class="viewing-history-header"><div><span class="eyebrow">Private history</span><h2 id="viewing-history-title" tabindex="-1">Viewing history</h2></div></header>
        <div class="feature-error-state is-compact viewing-history-error" role="alert"><span class="material-symbols-outlined" aria-hidden="true">history_off</span><div><strong>Viewing history couldn’t load.</strong><p>Your film state, rating and Favourite are still available.</p></div><button class="secondary-button compact" type="button" data-retry-viewing-history ${viewingEventsRetrying ? "disabled" : ""}>${viewingEventsRetrying ? "Trying again…" : "Try again"}</button></div>
      </section>`;
  }

  return `
    <section class="viewing-history" aria-labelledby="viewing-history-title">
      <header class="viewing-history-header"><div><span class="eyebrow">Private history</span><h2 id="viewing-history-title" tabindex="-1">Viewing history</h2><small>${visibleEvents.length} visible ${visibleEvents.length === 1 ? "event" : "events"}${hiddenEvents.length ? ` · ${hiddenEvents.length} hidden` : ""}</small></div>${canAddManual && viewingEventEditorId !== "new" ? `<button class="secondary-button compact" type="button" data-add-viewing-event><span class="material-symbols-outlined" aria-hidden="true">add</span>Add viewing</button>` : ""}</header>
      ${viewingEventEditorId === "new" && canAddManual ? renderViewingEventEditor() : ""}
      <div class="viewing-event-list">${visibleEvents.length ? visibleEvents.map(renderViewingEventRow).join("") : `<div class="viewing-history-empty"><span class="material-symbols-outlined" aria-hidden="true">history</span><div><strong>No visible history yet.</strong><p>${hiddenEvents.length ? "Your source-linked event is hidden below." : canAddManual ? "Add a Finished or Did Not Finish viewing when you want to remember it." : "Add this film to My Cinema before recording a manual viewing."}</p></div></div>`}</div>
      ${hiddenEvents.length ? `<details class="viewing-hidden-events"><summary>${hiddenEvents.length} hidden source ${hiddenEvents.length === 1 ? "event" : "events"}</summary><div class="viewing-event-list">${hiddenEvents.map(renderViewingEventRow).join("")}</div></details>` : ""}
      <span class="sr-only" role="status" aria-live="polite">${escapeHTML(viewingEventLiveMessage)}</span>
    </section>`;
}

function personalReviewForMovie(movieId) {
  return personalReviews.find((review) => review.ownerId === authUser?.id && review.movieId === movieId) || null;
}

function publishedReviewForDraft(review) {
  return review ? publishedReviews.find((publication) => publication.reviewId === review.id) || null : null;
}

function renderReviewEditor(context, review, publication) {
  const pending = Boolean(reviewPendingAction);
  const publishLabel = publication ? "Update published review" : "Publish to Cine-Cord";
  return `
    <form class="personal-review-editor" data-personal-review-form>
      <label for="personal-review-body"><span>Your review</span><textarea id="personal-review-body" name="body" rows="5" maxlength="1000" required placeholder="What did you think?" ${pending ? "disabled" : ""}>${escapeHTML(review?.body || "")}</textarea></label>
      <div class="personal-review-options"><label class="spoiler-toggle"><input type="checkbox" name="contains_spoilers" ${review?.containsSpoilers ? "checked" : ""} ${pending ? "disabled" : ""} /><span>Contains spoilers</span></label><small><span data-review-character-count>${review?.body.length || 0}</span>/1,000</small></div>
      <div class="personal-review-editor-actions">
        <button class="secondary-button compact" type="submit" name="review_action" value="save" ${pending ? "disabled" : ""}>${reviewPendingAction === "save" ? "Saving…" : "Save privately"}</button>
        <button class="primary-button compact" type="submit" name="review_action" value="publish" ${pending ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">public</span>${reviewPendingAction === "publish" ? "Publishing…" : publishLabel}</button>
        <button class="quiet-button compact" type="button" data-cancel-review-editor ${pending ? "disabled" : ""}>Cancel</button>
      </div>
      <small class="personal-review-note">Publishing shares this text with approved Cine-Cord members. A rating is optional; if you have one, its current value is included in the published snapshot.</small>
    </form>`;
}

function renderPersonalReview(context) {
  if (!context.movie?.movieId) return "";
  if (personalReviewsLoadError) {
    return `<section class="personal-review" aria-labelledby="personal-review-title"><div class="feature-error-state is-compact" role="alert"><span class="material-symbols-outlined" aria-hidden="true">rate_review</span><div><strong>Your review couldn’t load.</strong><p>Your other film details are still available.</p></div><button class="secondary-button compact" type="button" data-retry-reviews>Try again</button></div></section>`;
  }

  const review = personalReviewForMovie(context.movie.movieId);
  const publication = publishedReviewForDraft(review);
  const hasChanges = reviewHasUnpublishedChanges(review, publication, context.personal?.rating ?? null);
  const pending = Boolean(reviewPendingAction);
  if (reviewEditorOpen) return `<section class="personal-review is-editing" aria-labelledby="personal-review-title"><header class="personal-review-header"><div><span class="eyebrow">Private draft</span><h2 id="personal-review-title">${review ? "Edit your review" : "Write a review"}</h2></div></header>${renderReviewEditor(context, review, publication)}</section>`;

  const status = publication ? (hasChanges ? "Unpublished changes" : "Published") : "Private";
  return `
    <section class="personal-review" aria-labelledby="personal-review-title">
      <header class="personal-review-header"><div><span class="eyebrow">Your review</span><h2 id="personal-review-title">Review</h2></div><span class="review-visibility ${publication ? "is-published" : ""}">${escapeHTML(status)}</span></header>
      ${review ? `<div class="personal-review-summary"><p>${escapeHTML(review.body)}</p>${review.containsSpoilers ? `<span class="spoiler-label"><span class="material-symbols-outlined" aria-hidden="true">visibility_off</span>Contains spoilers</span>` : ""}<div class="personal-review-actions"><button class="detail-text-action" type="button" data-edit-personal-review ${pending ? "disabled" : ""}>Edit</button>${!publication || hasChanges ? `<button class="detail-text-action" type="button" data-publish-personal-review ${pending ? "disabled" : ""}>${reviewPendingAction === "publish" ? "Publishing…" : publication ? "Update published review" : "Publish to Cine-Cord"}</button>` : ""}${publication ? `<button class="detail-text-action" type="button" data-unpublish-personal-review ${pending ? "disabled" : ""}>${reviewPendingAction === "unpublish" ? "Unpublishing…" : "Unpublish"}</button>` : ""}<button class="detail-text-action danger" type="button" data-delete-personal-review ${pending ? "disabled" : ""}>${reviewPendingAction === "delete" ? "Deleting…" : "Delete"}</button></div></div>` : `<div class="personal-review-empty"><p>Keep a private short review, then publish it to approved members when you choose.</p><button class="secondary-button compact" type="button" data-write-personal-review><span class="material-symbols-outlined" aria-hidden="true">edit</span>Write a review</button></div>`}
      <span class="sr-only" role="status" aria-live="polite">${escapeHTML(reviewLiveMessage)}</span>
    </section>`;
}

function renderPublishedReview(review) {
  const author = members.find((member) => member.id === review.ownerId);
  const authorName = author?.name || (review.ownerId === authUser?.id ? currentProfile?.displayName : null) || "Discordian";
  const avatar = author?.avatar || avatarForName(authorName);
  const reaction = reactionForValue(review.rating);
  const reviewBody = review.containsSpoilers
    ? `<details class="published-review-spoiler"><summary><span class="material-symbols-outlined" aria-hidden="true">visibility_off</span>Contains spoilers — reveal review</summary><p>${escapeHTML(review.body)}</p></details>`
    : `<p class="published-review-body">${escapeHTML(review.body)}</p>`;
  return `
    <article class="published-review-card" data-published-review="${escapeHTML(review.reviewId)}">
      <header><img src="${escapeHTML(avatar)}" alt="" /><div><strong>${escapeHTML(authorName)}${review.ownerId === authUser?.id ? " · You" : ""}</strong><small>Published ${escapeHTML(formatAddedDate(review.publishedAt))}</small></div>${reaction ? `<span class="published-review-rating">${reaction.value} — ${escapeHTML(reaction.label)}</span>` : `<span class="published-review-rating is-text-only">Text review</span>`}</header>
      ${reviewBody}
    </article>`;
}

function renderPublishedReviews(context) {
  if (!context.movie?.movieId) return "";
  if (publishedReviewsLoadError) {
    return `<section class="member-reviews" aria-labelledby="member-reviews-title"><header class="member-reviews-header"><div><span class="eyebrow">Cine-Cord reviews</span><h2 id="member-reviews-title">Member reviews</h2></div></header><div class="feature-error-state is-compact" role="alert"><span class="material-symbols-outlined" aria-hidden="true">reviews</span><div><strong>Published reviews couldn’t load.</strong><p>The rest of this film page is still available.</p></div><button class="secondary-button compact" type="button" data-retry-reviews>Try again</button></div></section>`;
  }
  const reviews = getPublishedReviewsForMovie(publishedReviews, context.movie.movieId);
  return `
    <section class="member-reviews" aria-labelledby="member-reviews-title">
      <header class="member-reviews-header"><div><span class="eyebrow">Shared with approved members</span><h2 id="member-reviews-title">Member reviews</h2></div><small>${reviews.length} ${reviews.length === 1 ? "review" : "reviews"}</small></header>
      ${reviews.length ? `<div class="published-review-list">${reviews.map(renderPublishedReview).join("")}</div>` : `<div class="member-reviews-empty"><span class="material-symbols-outlined" aria-hidden="true">reviews</span><div><strong>No published reviews yet.</strong><p>Private drafts stay private until their author chooses Publish to Cine-Cord.</p></div></div>`}
    </section>`;
}

function renderPageHeader({ id, eyebrow, title, description = "", actions = "", className = "", titleClass = "page-title" }) {
  return `
    <header class="page-header layout-page-header ${className}">
      <div class="layout-page-header-copy">
        <span class="eyebrow">${escapeHTML(eyebrow)}</span>
        <h1 id="${id}" class="${titleClass}">${escapeHTML(title)}</h1>
        ${description ? `<p class="page-subtitle">${escapeHTML(description)}</p>` : ""}
      </div>
      ${actions ? `<div class="page-header-actions">${actions}</div>` : ""}
    </header>`;
}

function renderPersonalFilmsUnavailable({ compact = false } = {}) {
  return `
    <div class="feature-error-state ${compact ? "is-compact" : ""}" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">cloud_off</span>
      <div><strong>My Cinema couldn’t load.</strong><p>Your private films are unavailable right now. The List, Sessions and Journal are still available.</p></div>
      <button class="secondary-button" type="button" data-retry-personal-films>Try My Cinema again</button>
    </div>`;
}

function renderPrivateFilmPanel(context) {
  const { movie, personal } = context;
  const viewingHistory = renderViewingHistory(context);
  const personalReview = renderPersonalReview(context);
  if (personalFilmsLoadError) {
    return `
      <section class="film-context-panel private-panel layout-container layout-container-private is-empty" aria-labelledby="private-panel-title">
        <header class="context-panel-header"><span id="private-panel-title"><i aria-hidden="true"></i>My Cinema · Temporarily unavailable</span><small>Cine-Cord remains available</small></header>
        ${renderPersonalFilmsUnavailable({ compact: true })}
        ${personalReview}
        ${viewingHistory}
      </section>`;
  }
  if (!personal) {
    return `
      <section class="film-context-panel private-panel layout-container layout-container-private is-empty" aria-labelledby="private-panel-title">
        <header class="context-panel-header"><span id="private-panel-title"><i aria-hidden="true"></i>My Cinema · Private</span></header>
        <div class="private-empty-actions">
          <details class="film-add-menu"><summary>Add to My Cinema</summary><div class="film-add-options">${PERSONAL_FILM_STATES.map((state) => `<button class="secondary-button" type="button" data-personal-state="${state.value}" ${movie.movieId ? "" : "disabled"}>${escapeHTML(state.label)}</button>`).join("")}</div></details>
          <button class="secondary-button" type="button" data-open-reaction ${movie.movieId ? "" : "disabled"}>I have seen it — rate it</button>
          <p>${movie.movieId ? "Not in your library yet. Adding or rating saves it privately." : "Match this film with TMDB before saving private state."}</p>
        </div>
        ${reactionEditorExpanded && movie.movieId ? renderReactionControl(movie, null) : ""}
        ${personalReview}
        ${viewingHistory}
      </section>`;
  }

  const stateButtons = PERSONAL_FILM_STATES.map((state) => {
    const active = personal.state === state.value;
    return `<button class="private-state-button ${active ? "is-active" : ""}" type="button" data-personal-state="${state.value}" aria-pressed="${active}">${escapeHTML(state.label)}</button>`;
  }).join("");
  return `
    <section class="film-context-panel private-panel layout-container layout-container-private" aria-labelledby="private-panel-title">
      <header class="context-panel-header"><span id="private-panel-title"><i aria-hidden="true"></i>My Cinema · Private</span><small>Only you</small></header>
      <div class="private-controls">
        <div class="private-state-group" role="group" aria-label="My film state">${stateButtons}</div>
        <button class="favourite-switch ${personal.isFavourite ? "is-active" : ""}" type="button" role="switch" aria-checked="${personal.isFavourite}" data-toggle-favourite><span class="material-symbols-outlined" aria-hidden="true">favorite</span>Favourite <small>${personal.isFavourite ? "On" : "Off"}</small></button>
      </div>
      ${renderReactionControl(movie, personal)}
      ${personalReview}
      ${viewingHistory}
    </section>`;
}

function renderSharedFilmPanel(context) {
  const { movie, shared, origin } = context;
  if (!shared) {
    return `
      <section class="film-context-panel shared-panel layout-container layout-container-neutral is-empty" aria-labelledby="shared-panel-title">
        <header class="context-panel-header"><span id="shared-panel-title"><i aria-hidden="true"></i>Cine-Cord · Not on the shared list</span><small>Suggesting is a deliberate, separate action</small></header>
        <div class="shared-empty-actions"><button class="secondary-button" type="button" data-suggest-personal-film>Suggest for Cine-Cord</button><p>Your state, reaction and Favourite stay private if you do. Suggesting adds the film to The List with your name — it does not publish your reaction.</p></div>
      </section>`;
  }

  const matchingSessions = [activeSession, ...sessionHistory].filter((session) => session && filmMatchesSession(movie, session));
  const journalEntries = matchingSessions.map((session) => session.journalEntry).filter(Boolean);
  if (origin === "my-films") {
    return `
      <section class="film-context-panel shared-panel layout-container layout-container-shared is-compact" aria-labelledby="shared-panel-title">
        <header class="context-panel-header"><span id="shared-panel-title"><i aria-hidden="true"></i>Cine-Cord · Shared with the group</span><small>This film is also on the shared list</small></header>
        <div class="shared-compact-row"><button class="secondary-button" type="button" data-vote="${shared.id}" ${shared.watched ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>${shared.votedByMe ? "Remove vote" : "Vote for this film"} · ${shared.votes}</button><p>${escapeHTML(watchHistoryLabel(shared))} by the group · suggested by ${escapeHTML(shared.suggestedBy)}${matchingSessions.length ? ` · ${matchingSessions.length} ${matchingSessions.length === 1 ? "session" : "sessions"}` : ""}</p><button class="detail-text-action" type="button" data-open-detail-area="list">Open in Cine-Cord</button></div>
      </section>`;
  }

  return `
    <section class="film-context-panel shared-panel layout-container layout-container-shared" aria-labelledby="shared-panel-title">
      <header class="context-panel-header"><span id="shared-panel-title"><i aria-hidden="true"></i>Cine-Cord · Shared with the group</span><small>Everyone approved can see this</small></header>
      <div class="shared-panel-body">
        <div class="shared-primary-actions"><button class="primary-button" type="button" data-vote="${shared.id}" ${shared.watched ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>${shared.votedByMe ? "Remove vote" : "Vote for this film"} <small>${shared.votes} ${shared.votes === 1 ? "vote" : "votes"}</small></button><span class="group-status">Group status: <strong>${escapeHTML(watchHistoryLabel(shared))}</strong></span>${activeSession ? `<button class="secondary-button" type="button" data-open-current-session>Open current session</button>` : `<button class="secondary-button" type="button" data-open-party>Start a session</button>`}</div>
        <dl class="shared-film-ledger"><div><dt>Suggested by</dt><dd>${escapeHTML(shared.suggestedBy)} · ${escapeHTML(formatAddedDate(shared.createdAt))}</dd></div><div><dt>Sessions</dt><dd>${matchingSessions.length ? `${matchingSessions.length} recorded` : "No group session yet"}</dd></div><div><dt>Journal</dt><dd>${journalEntries.length ? `${journalEntries.length} ${journalEntries.length === 1 ? "entry" : "entries"}` : "No group entry yet"}</dd></div></dl>
        <p>Voting, sessions and Journal facts are group data. Nothing here changes your private library.</p>
      </div>
    </section>`;
}

function renderFilmDetails() {
  const context = selectedFilmContext();
  if (!context) return currentView === "my-films" ? renderMyFilms() : renderList();
  const { movie, origin } = context;
  const backLabel = origin === "my-films" ? "My Films" : "The List";
  const detailMeta = [movie.year, movie.runtime ? `${movie.runtime} min` : null, ...movie.genres].filter(Boolean).join(" · ");
  const primaryPanel = origin === "my-films" ? renderPrivateFilmPanel(context) : renderSharedFilmPanel(context);
  const secondaryPanel = origin === "my-films" ? renderSharedFilmPanel(context) : renderPrivateFilmPanel(context);
  const memberReviews = renderPublishedReviews(context);
  return `
    <section class="film-detail-view compact-film-detail ${origin === "my-films" ? "is-private-origin" : "is-shared-origin"}" aria-labelledby="film-detail-title" tabindex="-1">
      <nav class="film-back-row" aria-label="Film navigation"><button class="quiet-button film-detail-back" type="button" data-close-film-details><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Back to ${escapeHTML(backLabel)}</button></nav>
      <div class="film-detail-composition">
        <div class="film-artwork">
          <div class="detail-poster ${movie.posterUrl ? "" : "is-placeholder"}"><img src="${escapeHTML(filmPoster(movie))}" alt="${movie.posterUrl ? `${escapeHTML(movie.title)} poster` : "Abstract Cine-Cord poster placeholder"}" />${movie.posterUrl ? "" : `<span class="poster-pending"><span class="material-symbols-outlined" aria-hidden="true">movie</span> Artwork pending</span>`}</div>
        </div>
        ${renderPageHeader({
        id: "film-detail-title",
        eyebrow: origin === "my-films" ? "My Cinema · Private to you" : "Cine-Cord · Shared with the group",
        title: movie.title,
        description: detailMeta || "Movie details",
        titleClass: "film-page-title",
        className: "film-detail-page-header",
      })}
        <div class="film-primary-context">${primaryPanel}</div>
        <section class="film-synopsis" aria-labelledby="film-synopsis-title"><h2 id="film-synopsis-title">Synopsis</h2><p>${escapeHTML(movie.overview || "A synopsis is not available for this film yet.")}</p></section>
        <div class="film-secondary-context">${secondaryPanel}</div>
        ${memberReviews}
        ${context.personal && !personalFilmsLoadError ? `<details class="film-more-actions"><summary>More options</summary><button class="detail-text-action" type="button" data-remove-personal-film>Remove from My Cinema</button></details>` : ""}
      </div>
    </section>`;
}

function renderPersonalFilmCard(item) {
  const reaction = reactionForValue(item.rating);
  return `
    <article class="poster-card personal-poster-card">
      <button class="poster-card-open" type="button" data-select-film="${item.id}" aria-label="View details for ${escapeHTML(item.title)}">
        <span class="poster-frame ${item.posterUrl ? "" : "is-placeholder"}"><img src="${escapeHTML(filmPoster(item))}" alt="${item.posterUrl ? `${escapeHTML(item.title)} poster` : "Abstract Cine-Cord poster placeholder"}" loading="lazy" /><span class="status-pill personal-state">${escapeHTML(personalStateLabel(item.state))}</span>${item.isFavourite ? `<span class="personal-favourite material-symbols-outlined" aria-label="Favourite">favorite</span>` : ""}</span>
        <span class="poster-copy"><span class="poster-title-line"><strong>${escapeHTML(item.title)}</strong>${item.year ? `<span>${item.year}</span>` : ""}</span><span class="poster-metadata">${escapeHTML(metadataLine(item))}</span></span>
      </button>
      <footer class="personal-card-footer">${reaction ? `<span class="personal-card-reaction"><img src="${escapeHTML(imageAssets.reactionFaces[reaction.value])}" alt="" /><strong>${escapeHTML(reaction.label)}</strong></span>` : `<span>No reaction yet</span>`}<span>Private</span></footer>
    </article>`;
}

function renderMyFilms() {
  if (personalFilmsLoadError) selectedFilmId = null;
  const selectedFilm = personalFilms.find((item) => item.id === selectedFilmId) || null;
  if (selectedFilmId && !selectedFilm) selectedFilmId = null;
  if (selectedFilm) return renderFilmDetails();
  const visibleFilms = getVisiblePersonalFilms(personalFilms, { query: myFilmsQuery, filter: myFilmsFilter, sort: myFilmsSort });
  const countLabel = personalFilmsLoadError
    ? "My Cinema · Private to you"
    : `My Cinema · Private to you · ${personalFilms.length} ${personalFilms.length === 1 ? "film" : "films"}`;
  return `
    <section class="page-view list-view my-films-view" aria-labelledby="my-films-title">
      ${renderPageHeader({
        id: "my-films-title",
        eyebrow: countLabel,
        title: "My Films",
        description: "Your private films, states, reactions and Favourites. Nothing is shared unless you deliberately suggest it to Cine-Cord.",
        className: "list-hero my-films-hero",
        actions: personalFilmsLoadError ? "" : `<button class="primary-button" type="button" data-open-personal-film><span class="material-symbols-outlined" aria-hidden="true">add</span>Add a film</button>`,
      })}
      ${personalFilmsLoadError ? renderPersonalFilmsUnavailable() : `<div class="list-toolbar my-films-toolbar"><label class="search-field list-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="my-films-search" type="search" value="${escapeHTML(myFilmsQuery)}" placeholder="Search My Films" aria-label="Search My Films" /></label><button class="mobile-filter-toggle" type="button" data-toggle-my-films-filters aria-expanded="${myFilmsFiltersOpen}" aria-label="${myFilmsFiltersOpen ? "Hide" : "Show"} My Films filters and sort"><span class="mobile-filter-toggle-copy"><span class="material-symbols-outlined" aria-hidden="true">tune</span><span class="mobile-filter-label">Filters &amp; sort</span></span><span class="mobile-filter-chevron material-symbols-outlined" aria-hidden="true">${myFilmsFiltersOpen ? "expand_less" : "expand_more"}</span></button><div class="filter-tabs my-film-filter-tabs ${myFilmsFiltersOpen ? "is-open" : ""}" aria-label="Filter My Films">${[["all", "All"], ["want", "Want to Watch"], ["watched", "Watched"], ["dnf", "Did Not Finish"], ["favourites", "Favourites"]].map(([value, label]) => `<button type="button" class="filter-tab ${myFilmsFilter === value ? "is-active" : ""}" data-my-films-filter="${value}">${label}</button>`).join("")}</div><div class="list-filter-controls my-film-sort-control ${myFilmsFiltersOpen ? "is-open" : ""}"><label class="compact-select"><span class="sr-only">Sort My Films</span><select id="my-films-sort" aria-label="Sort My Films"><option value="updated" ${myFilmsSort === "updated" ? "selected" : ""}>Recently updated</option><option value="added" ${myFilmsSort === "added" ? "selected" : ""}>Recently added</option><option value="title" ${myFilmsSort === "title" ? "selected" : ""}>Title A–Z</option></select></label></div></div>
      <div class="poster-grid personal-poster-grid" aria-live="polite">${visibleFilms.length ? visibleFilms.map(renderPersonalFilmCard).join("") : `<div class="empty-state list-empty"><span class="material-symbols-outlined" aria-hidden="true">theaters</span><h2>${personalFilms.length ? "No films match that view." : "My Cinema is empty."}</h2><p>${personalFilms.length ? "Try another search or filter." : "Add something you want to watch, or rate a film you have already seen."}</p><button class="secondary-button" type="button" data-open-personal-film>Add a film</button></div>`}</div>`}
    </section>`;
}

function renderList() {
  const visibleFilms = getVisibleFilms();
  const selectedFilm = movieList.find((item) => item.id === selectedFilmId) || null;
  if (selectedFilmId && !selectedFilm) selectedFilmId = null;
  if (selectedFilm) return renderFilmDetails();
  const readyCount = movieList.filter((item) => !item.watched).length;
  const genres = [...new Set(movieList.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
  const suggesters = [...new Map(movieList.map((item) => [item.suggestedById, item.suggestedBy])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return `
    <section class="page-view list-view" aria-labelledby="list-title">
      ${renderPageHeader({
        id: "list-title",
        eyebrow: `Cine-Cord · Shared with the group · ${movieList.length} ${movieList.length === 1 ? "film" : "films"} · ${readyCount} ready`,
        title: "The List",
        description: "The Discordians’ shared film library. Everything here is visible to every approved member.",
        className: "list-hero",
        actions: `<button class="primary-button" type="button" data-open-party><span class="material-symbols-outlined" aria-hidden="true">casino</span>Watch a Film</button><button class="secondary-button" type="button" data-open-film aria-label="Add film to library"><span class="material-symbols-outlined" aria-hidden="true">add</span>Add film</button>`,
      })}
      <div class="list-toolbar">
        <label class="search-field list-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="list-search" type="search" value="${escapeHTML(listQuery)}" placeholder="Search the list" aria-label="Search The List" /></label>
        <button class="mobile-filter-toggle" type="button" data-toggle-list-filters aria-expanded="${listFiltersOpen}" aria-label="${listFiltersOpen ? "Hide" : "Show"} filters and sort"><span class="mobile-filter-toggle-copy"><span class="material-symbols-outlined" aria-hidden="true">tune</span><span class="mobile-filter-label">Filters &amp; sort</span></span><span class="mobile-filter-chevron material-symbols-outlined" aria-hidden="true">${listFiltersOpen ? "expand_less" : "expand_more"}</span></button>
        <div class="filter-tabs ${listFiltersOpen ? "is-open" : ""}" aria-label="Filter The List">${["all", "ready", "watched"].map((filter) => `<button type="button" class="filter-tab ${listFilter === filter ? "is-active" : ""}" data-list-filter="${filter}">${filter[0].toUpperCase()}${filter.slice(1)}</button>`).join("")}</div>
        <div class="list-filter-controls ${listFiltersOpen ? "is-open" : ""}">
          <label class="compact-select"><span class="sr-only">Genre</span><select id="genre-filter" aria-label="Filter by genre"><option value="all">All genres</option>${genres.map((genre) => `<option value="${escapeHTML(genre.toLowerCase())}" ${genreFilter === genre.toLowerCase() ? "selected" : ""}>${escapeHTML(genre)}</option>`).join("")}</select></label>
          <label class="compact-select"><span class="sr-only">Added by</span><select id="member-filter" aria-label="Filter by who added it"><option value="all">Added by anyone</option>${suggesters.map(([id, name]) => `<option value="${escapeHTML(id)}" ${memberFilter === id ? "selected" : ""}>${escapeHTML(name)}</option>`).join("")}</select></label>
          <label class="compact-select sort-field"><span class="sr-only">Sort</span><select id="list-sort" aria-label="Sort The List"><option value="votes" ${listSort === "votes" ? "selected" : ""}>Most voted</option><option value="oldest" ${listSort === "oldest" ? "selected" : ""}>Longest waiting</option><option value="newest" ${listSort === "newest" ? "selected" : ""}>Newest</option></select></label>
        </div>
      </div>
      <div class="library-layout">
        <div class="poster-grid" aria-live="polite">${visibleFilms.length ? visibleFilms.map(renderFilmCard).join("") : `<div class="empty-state list-empty"><span class="material-symbols-outlined" aria-hidden="true">movie</span><h2>${movieList.length ? "No films match that view." : "The List is empty."}</h2><p>${movieList.length ? "Try another search or filter." : "Add the first suggestion and give the group something to argue about."}</p><button class="secondary-button" type="button" data-open-film>Add a film</button></div>`}</div>
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
  const weighted = Boolean(rouletteState.filters.weightedByAge);
  const weightSummary = rouletteWeightSummary(weight, winner, { weighted });
  const weightExplanation = rouletteWeightExplanation(weight, winner, { weighted });
  return `
    <div class="roulette-result-layout ${confirmed ? "is-confirmed" : ""}">
      <div class="roulette-result-stage">
        <figure class="roulette-winning-poster"><img src="${escapeHTML(filmPoster(winner))}" alt="${escapeHTML(winner.title)} poster" /><figcaption title="${escapeHTML(weightExplanation)}"><span class="material-symbols-outlined" aria-hidden="true">stars</span><span aria-hidden="true">${weight}×</span><span class="sr-only">${escapeHTML(weightExplanation)}</span></figcaption></figure>
      </div>
      <section class="roulette-result-copy" aria-labelledby="roulette-winner-title">
        <span class="eyebrow">${confirmed ? "Tonight's film" : "Roulette selected"}</span>
        <div class="roulette-winner-heading"><div><h2 id="roulette-winner-title" tabindex="-1">${escapeHTML(winner.title)}</h2><p>${winner.year ? escapeHTML(winner.year) : "Year pending"}</p></div><span class="status-pill ${winner.watched ? "watched" : "ready"}">${escapeHTML(watchHistoryLabel(winner))}</span></div>
        <div class="roulette-winner-facts"><span><span class="material-symbols-outlined" aria-hidden="true">schedule</span>${escapeHTML(runtimeLabel(winner))}</span>${winner.genres.slice(0, 3).map((genre) => `<span>${escapeHTML(genre)}</span>`).join("")}<span title="${escapeHTML(weightExplanation)}"><span class="material-symbols-outlined" aria-hidden="true">weight</span>${escapeHTML(weightSummary)}</span></div>
        <div class="roulette-overview-block"><p class="roulette-winner-overview ${rouletteState.overviewOpen ? "is-expanded" : ""}">${escapeHTML(overview)}</p>${overview.length > 150 ? `<button class="roulette-overview-toggle" type="button" data-toggle-roulette-overview aria-expanded="${rouletteState.overviewOpen}">${rouletteState.overviewOpen ? "Show less" : "Read more"}</button>` : ""}</div>
        ${confirmed ? `
          <div class="roulette-confirmed-note" role="status"><span class="material-symbols-outlined" aria-hidden="true">cloud_done</span><div><strong>Session confirmed</strong><p>Check the details below. Nothing has been posted to Discord, and the Journal post comes after you watch.</p></div></div>` : canManage ? `
          <section class="roulette-result-vetoes" aria-labelledby="result-veto-title"><span class="eyebrow" id="result-veto-title">Use a veto to spin again</span><div>${rouletteState.participants.map(({ id, name }) => { const used = rouletteState.usedVetoes.includes(id); return `<button type="button" data-veto-member="${escapeHTML(id)}" ${used ? "disabled" : ""} aria-label="${used ? `${escapeHTML(name)} has used their veto` : `${escapeHTML(name)} vetoes ${escapeHTML(winner.title)}`}" title="${escapeHTML(name)}${used ? " · veto used" : " · one veto available"}"><img src="${escapeHTML(avatarForName(name))}" alt="" /><span><strong>${escapeHTML(name)}</strong><small>${used ? "Veto already used" : "One veto available"}</small></span><em>${used ? "Used" : "1"}</em></button>`; }).join("")}</div></section>
          <div class="roulette-decision-actions">
            <button class="primary-button roulette-wide-action" type="button" data-confirm-roulette><span class="material-symbols-outlined" aria-hidden="true">check</span>Confirm Movie and Create Session</button>
            <button class="secondary-button roulette-wide-action" type="button" data-request-reroll><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Spin again</button>
            ${rouletteState.rerollConfirmOpen ? `<div class="roulette-reroll-confirm" role="alert"><p>Re-spin without spending anyone's veto?</p><div><button class="secondary-button" type="button" data-cancel-reroll>Cancel</button><button class="primary-button" type="button" data-reroll-roulette>Yes, re-spin</button></div></div>` : ""}
          </div>` : `<div class="roulette-confirmed-note" role="status"><span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><div><strong>Waiting for the host</strong><p>${escapeHTML(activeSession.hostName)} can confirm this result or spin again.</p></div></div>`}
      </section>
      ${confirmed ? `
      <div class="roulette-result-handoff">${renderSessionSummary(activeSession, { editorMode: sessionEditorMode(activeSession) })}</div>
      <div class="roulette-session-actions">
        <span class="roulette-session-note">Session saved · Hosted by ${escapeHTML(activeSession.hostName)}</span>
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
      ${renderPageHeader({
        id: "roulette-title",
        eyebrow: "Watch a Film · Weighted chaos",
        title: "Queue Roulette",
        className: "roulette-header",
        actions: `<button class="icon-button roulette-close" type="button" data-close-roulette aria-label="Close Queue Roulette"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>`,
      })}
      ${winner && ["reveal", "confirmed"].includes(rouletteState.phase) ? renderRouletteReveal(candidates, winner) : renderRouletteReady(candidates)}
    </section>`;
}

function renderPick() {
  if (activeSession?.mode === "Queue Roulette" && rouletteState && !isDirectWatchSession()) return renderQueueRoulette();
  const candidateCount = movieList.filter((item) => !item.watched).length;
  return `
    <section class="page-view" aria-labelledby="pick-title">
      ${renderPageHeader({
        id: "pick-title",
        eyebrow: `Cine-Cord · ${candidateCount} eligible ${candidateCount === 1 ? "film" : "films"}`,
        title: "Watch a Film",
        description: "Choose the group, choose the rules, then let the website settle the argument.",
        actions: `<button class="primary-button" type="button" data-open-party ${candidateCount ? "" : "disabled"}>Start a Session</button>`,
      })}
      <div class="pick-callout layout-container layout-container-neutral"><span class="material-symbols-outlined" aria-hidden="true">cloud_done</span><div><strong>Independent of Discord</strong><p>These games use the shared website list and continue working while the bot is offline.</p></div></div>
      <div class="mode-list">${decisionModes.map((mode) => `<article class="mode-row layout-container layout-container-shared ${mode.available ? "" : "is-unavailable"}"><span class="mode-icon">${mode.code}</span><div><span class="mode-tone">${mode.tone}</span><h3>${mode.title}</h3><p>${mode.copy}</p></div><button class="secondary-button" type="button" data-select-mode="${mode.title}" ${candidateCount && mode.available ? "" : "disabled"}>${mode.available ? "Choose" : "Coming soon"}</button></article>`).join("")}</div>
    </section>`;
}

function renderSessions() {
  const rouletteWinner = selectedFilmForSession(activeSession);
  const watched = sessionHistory.filter((session) => session.status === "WATCHED" && !session.journalEntry);
  const openJournalFor = journalSession();
  const journalIsWatched = Boolean(openJournalFor && openJournalFor.status === "WATCHED");
  const activeCanManage = canManageSession(activeSession);
  const activeEditor = sessionEditorMode(activeSession);
  return `
    <section class="page-view" aria-labelledby="sessions-title">
      ${renderPageHeader({
        id: "sessions-title",
        eyebrow: "Cine-Cord · Movie-night records",
        title: "Sessions",
        description: "Record the film and viewers, then hand the finished entry to The Journal.",
        actions: activeSession?.mode === "Queue Roulette" && !isDirectWatchSession(activeSession)
          ? `<button class="primary-button" type="button" data-continue-roulette>Open current session</button>`
          : activeSession
            ? ""
            : `<button class="primary-button" type="button" data-open-party><span class="material-symbols-outlined" aria-hidden="true">add</span>Pick a Movie</button>`,
      })}
      ${activeSession ? `
        <article class="active-session session-feature layout-container layout-container-shared ${rouletteWinner ? "has-film" : ""}">
          ${rouletteWinner ? `<img class="session-film-poster" src="${escapeHTML(filmPoster(rouletteWinner))}" alt="${escapeHTML(rouletteWinner.title)} poster" />` : ""}
          <div class="active-session-head">
            <div>
              <span class="eyebrow">${escapeHTML(activeSession.status === "CONFIRMED" ? "Confirmed" : "Session in progress")} &middot; ${escapeHTML(sessionModeLabel(activeSession))} &middot; Hosted by ${escapeHTML(activeSession.hostName)}</span>
              <h3>${activeSession.mode === "Queue Roulette" ? (rouletteWinner ? `${escapeHTML(rouletteWinner.title)} is confirmed ${escapeHTML(sessionDateLabel(activeSession.sessionDate || isoDateOnly(activeSession.startedAt)))}.` : "The wheel is ready when you are.") : "This session uses a mode that is not implemented yet."}</h3>
              <p class="session-members">${activeSession.participants?.length ? activeSession.members.map(escapeHTML).join(", ") : "No participants added yet"}</p>
              <p>${activeSession.candidateCount} list ${activeSession.candidateCount === 1 ? "film was" : "films were"} available when this session started.</p>
            </div>
            <div class="session-actions">
              ${activeSession.mode === "Queue Roulette" && !isDirectWatchSession(activeSession) ? `<button class="secondary-button compact" type="button" data-continue-roulette>${rouletteWinner ? "View session" : "Continue Roulette"}</button>` : ""}
              ${activeCanManage && activeSession.status === "CONFIRMED" ? `<button class="secondary-button compact" type="button" data-review-session-watched="${escapeHTML(activeSession.id)}"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Mark as watched</button>` : ""}
              ${activeCanManage ? `<button class="text-button danger" type="button" data-end-session>Cancel session</button>` : ""}
            </div>
          </div>
        </article>
        ${activeSession.status === "CONFIRMED" ? renderSessionSummary(activeSession, { editorMode: activeEditor }) : ""}` : `<div class="empty-state session-empty"><span class="material-symbols-outlined" aria-hidden="true">groups</span><h2>No current session.</h2><p>Queue Roulette is ready now. Consensus Sprint and Reel Bracket are coming later.</p></div>`}
      ${journalIsWatched ? `<section class="session-journal-open" aria-label="Journal post for ${escapeHTML(openJournalFor.selectedFilm?.title || "this session")}">${renderDiscordTemplate(openJournalFor, selectedFilmForSession(openJournalFor))}</section>` : ""}
      ${watched.length ? `<section class="session-history" aria-labelledby="watched-history-title"><div class="section-heading"><div><span class="eyebrow">Journal outstanding</span><h2 id="watched-history-title">Watched sessions awaiting an entry</h2></div><span class="request-count">${watched.length}</span></div><div class="session-history-list">${watched.map((session) => {
        const film = selectedFilmForSession(session);
        const canManage = canManageSession(session);
        const canEditDetails = canEditSessionDetails(session);
        const canEditJournal = canManageJournalEntry(session.journalEntry, session);
        const journalLabel = session.journalEntry ? (canEditJournal ? "Edit Journal post" : "View Journal post") : session.journalDraft ? "Continue Journal post" : "Write Journal post";
        const canOpenJournal = canEditJournal || canManage || session.journalEntry;
        return `<div class="session-history-item"><article class="session-history-row layout-container layout-container-neutral">${film ? `<img src="${escapeHTML(filmPoster(film))}" alt="" />` : `<span class="session-history-placeholder material-symbols-outlined" aria-hidden="true">casino</span>`}<div><span>${escapeHTML(formatSavedDate(session.sessionDate))} &middot; ${escapeHTML(sessionModeLabel(session))} &middot; Hosted by ${escapeHTML(session.hostName)}</span><strong>${film ? escapeHTML(film.title) : "Watched film"}</strong><small>${session.members.map(escapeHTML).join(", ") || "No participants recorded"}</small></div><div class="session-history-actions"><span class="status-pill watched">Watched</span>${canEditDetails ? `<button class="secondary-button compact" type="button" data-edit-session-details="${escapeHTML(session.id)}">Edit session</button>` : ""}${canOpenJournal && journalSessionId !== session.id ? `<button class="secondary-button compact" type="button" data-open-journal="${escapeHTML(session.id)}">${journalLabel}</button>` : ""}</div></article>${sessionEditorMode(session) ? renderSessionSummary(session, { editorMode: sessionEditorMode(session) }) : ""}</div>`;
      }).join("")}</div></section>` : ""}
    </section>`;
}

function journalStatusLabel(status) {
  if (status === "DNF") return "DNF";
  if (status === "FINISHED") return "Finished";
  return "Status unconfirmed";
}

function getFilteredJournalEntries() {
  const query = journalQuery.trim().toLowerCase();
  return journalCatalog.filter((entry) => {
    const matchesQuery = !query || `${entry.title} ${entry.entryLabel}`.toLowerCase().includes(query);
    const matchesSource = journalSourceFilter === "all"
      || (journalSourceFilter === "CINE_CORD" && entry.sourceType === "CINE_CORD")
      || entry.volumeName === journalSourceFilter;
    const matchesStatus = journalStatusFilter === "all" || entry.status === journalStatusFilter;
    const matchesYear = journalYearFilter === "all" || String(entry.year || "unknown") === journalYearFilter;
    const matchesViewer = journalViewerFilter === "all" || entry.viewerNames.includes(journalViewerFilter);
    return matchesQuery && matchesSource && matchesStatus && matchesYear && matchesViewer;
  }).sort((left, right) => {
    const leftDate = new Date(left.watchedAt || left.sourceCreatedAt || 0).getTime();
    const rightDate = new Date(right.watchedAt || right.sourceCreatedAt || 0).getTime();
    return rightDate - leftDate || right.entrySortNumber - left.entrySortNumber;
  });
}

function journalSessionForEntry(entry) {
  if (!entry?.journalEntryId) return null;
  return sessionHistory.find((session) => session.journalEntry?.id === entry.journalEntryId)
    || (activeSession?.journalEntry?.id === entry.journalEntryId ? activeSession : null);
}

function journalDraftForCatalogEntry(entry) {
  const session = journalSessionForEntry(entry);
  const film = selectedFilmForSession(session);
  return {
    sessionId: session?.id || null,
    entryNumber: entry.entryLabel,
    title: entry.title,
    year: entry.year || "",
    viewerIds: [...entry.viewerIds],
    viewers: entry.viewerNames.join(", "),
    runtime: Number(film?.runtime) || null,
    genres: normaliseGenres(film?.genres),
    status: entry.status === "DNF" ? "DNF" : "Finished",
    comment: entry.comment || "",
  };
}

function renderJournalEditor(entry) {
  return `
    <form class="journal-entry-editor" data-journal-entry-form data-entry-id="${escapeHTML(entry.journalEntryId)}">
      <div class="journal-editor-grid">
        <label><span>Entry number</span><input name="entry_number" type="number" min="1" step="1" required value="${escapeHTML(entry.entryLabel)}" /></label>
        <label class="journal-editor-title"><span>Title</span><input name="title" maxlength="200" required value="${escapeHTML(entry.title)}" /></label>
        <label><span>Release year</span><input name="release_year" type="number" min="1888" max="2200" required value="${escapeHTML(entry.year || "")}" /></label>
        <label><span>Watched on</span><input name="watched_at" type="date" required value="${escapeHTML(entry.watchedAt || "")}" /></label>
        <label><span>Status</span><select name="status"><option value="FINISHED" ${entry.status === "FINISHED" ? "selected" : ""}>Finished</option><option value="DNF" ${entry.status === "DNF" ? "selected" : ""}>DNF</option></select></label>
        <label class="journal-editor-comment"><span>Comment <small>Optional</small></span><textarea name="comment" maxlength="2000" rows="4">${escapeHTML(entry.comment)}</textarea></label>
      </div>
      <fieldset class="journal-editor-viewers">
        <legend>Viewers</legend>
        <div>${members.map((member) => `<label><input type="checkbox" name="viewer" value="${escapeHTML(member.id)}" ${entry.viewerIds.includes(member.id) ? "checked" : ""} /><img src="${escapeHTML(member.avatar)}" alt="" /><span>${escapeHTML(member.name)}</span></label>`).join("")}</div>
      </fieldset>
      <div class="journal-editor-actions"><button class="primary-button compact" type="submit"><span class="material-symbols-outlined" aria-hidden="true">save</span>Save entry</button><button class="secondary-button compact" type="button" data-cancel-journal-edit>Cancel</button><button class="secondary-button compact danger-button" type="button" data-delete-journal-entry="${escapeHTML(entry.journalEntryId)}"><span class="material-symbols-outlined" aria-hidden="true">delete</span>Delete entry</button><small>Saving changes marks the existing Discord copy out of date; it is never updated automatically.</small></div>
    </form>`;
}

function journalTitleFitClass(title) {
  const length = [...String(title || "").trim()].length;
  if (length > 30) return "is-very-long";
  if (length > 18) return "is-long";
  return "";
}

function journalPostedDate(entry) {
  const value = entry.postedAt || entry.sourceCreatedAt;
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return { value, label: formatSavedDate(String(value).slice(0, 10)) };
}

function renderJournalCard(entry) {
  const isArchive = entry.sourceType === "DISCORD_ARCHIVE";
  const isEditing = !isArchive
    && Boolean(entry.journalEntryId)
    && entry.canEdit
    && journalEditingId === entry.journalEntryId;
  const publication = entry.publication;
  const hasDiscordMessage = Boolean(entry.discordUrl || publication?.discord_message_id);
  const isOutOfDate = Boolean(entry.discordOutOfDate || publication?.status === "UPDATE_FAILED");
  const isSyncing = !isArchive
    && Boolean(entry.journalEntryId)
    && (journalSyncPendingId === entry.journalEntryId || ["POSTING", "UPDATING"].includes(publication?.status));
  const sourceCopy = isArchive
    ? `${entry.volumeName} · Original Discord message`
    : `Cine-Cord · Created by ${entry.authorName}`;
  const postedDate = journalPostedDate(entry);
  const actionStateClass = isArchive
    ? "is-archive"
    : (hasDiscordMessage ? (isOutOfDate ? "is-stale" : "is-current") : "is-not-posted");
  const discordState = isArchive
    ? ""
    : (hasDiscordMessage
      ? (isOutOfDate ? `<span class="journal-discord-state is-stale" role="status" aria-live="polite"><span class="material-symbols-outlined" aria-hidden="true">sync_problem</span>Discord copy out of date</span>` : `<span class="journal-discord-state is-current" role="status" aria-live="polite"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Discord copy current</span>`)
      : `<span class="journal-discord-state is-not-posted" role="status" aria-live="polite"><span class="material-symbols-outlined" aria-hidden="true">draft</span>Not posted to Discord</span>`);
  return `
    <article class="journal-entry-card layout-container ${isArchive ? "layout-container-neutral is-archive" : "layout-container-shared is-current"} ${isEditing ? "is-editing" : ""} ${journalFocusedEntryId === entry.journalEntryId ? "is-focused-source" : ""}" data-journal-entry-id="${escapeHTML(entry.journalEntryId || "")}" tabindex="-1">
      <div class="journal-entry-head">
        <div><span class="journal-entry-number">Entry #${escapeHTML(entry.entryLabel)}</span><span class="journal-source-label">${escapeHTML(sourceCopy)}</span></div>
        <span class="status-pill ${entry.status === "DNF" ? "journal-dnf" : "watched"}">${escapeHTML(journalStatusLabel(entry.status))}</span>
      </div>
      <div class="journal-entry-body">
        <div class="journal-entry-copy">
          <div class="journal-entry-title-line"><h2 class="${journalTitleFitClass(entry.title)}" title="${escapeHTML(entry.title)}">${escapeHTML(entry.title)}</h2><span class="journal-entry-year">${entry.year ? escapeHTML(entry.year) : "Year not recorded"}</span></div>
          <p class="journal-entry-fact"><span>Viewers — </span><strong>${entry.viewerNames.length ? entry.viewerNames.map(escapeHTML).join(", ") : "No viewers parsed"}</strong></p>
          <p class="journal-entry-fact journal-entry-attribution"><span>Recorded by </span><strong>${escapeHTML(entry.authorName)}</strong>${postedDate ? ` <span class="journal-entry-attribution-separator" aria-hidden="true">·</span> <time class="journal-entry-posted-date" datetime="${escapeHTML(postedDate.value)}">${escapeHTML(postedDate.label)}</time>` : ""}</p>
          ${entry.comment ? `<p class="journal-entry-comment">${escapeHTML(entry.comment)}</p>` : ""}
          ${entry.parserStatus === "REVIEW" ? `<p class="journal-review-note"><span class="material-symbols-outlined" aria-hidden="true">rate_review</span>Imported safely, but one field needs a manual source check.</p>` : ""}
        </div>
      </div>
      <footer class="journal-entry-actions ${actionStateClass} ${isSyncing ? "is-syncing" : ""}" aria-label="Actions for ${escapeHTML(entry.title)}">
        ${discordState}
        <div class="journal-entry-action-buttons">
          ${entry.canEdit && !hasDiscordMessage ? (currentProfile?.discordServerDisplayName ? `<button class="primary-button compact journal-action-primary" type="button" data-post-catalog-journal="${escapeHTML(entry.journalEntryId)}" ${isSyncing ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">send</span>${isSyncing ? "Posting…" : "Post to Discord"}</button>` : `<button class="secondary-button compact journal-action-setup" type="button" data-refresh-discord-profile><span class="material-symbols-outlined" aria-hidden="true">sync</span>Connect Discord profile</button>`) : ""}
          ${entry.canEdit && hasDiscordMessage && isOutOfDate ? `<button class="primary-button compact journal-action-primary" type="button" data-update-catalog-journal="${escapeHTML(entry.journalEntryId)}" ${isSyncing ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">sync</span>${isSyncing ? "Updating…" : "Update Discord post"}</button>` : ""}
          ${entry.discordUrl ? `<a class="secondary-button compact journal-action-destination" href="${escapeHTML(entry.discordUrl)}" target="_blank" rel="noopener noreferrer"><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>${isArchive ? "Open original" : "View in Discord"}</a>` : ""}
          ${!isArchive ? `<button class="quiet-button compact journal-action-utility journal-action-copy" type="button" data-copy-journal-entry="${escapeHTML(entry.catalogId)}"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>Copy for Discord</button>` : ""}
          ${entry.canEdit ? `<button class="quiet-button compact journal-action-utility journal-action-edit" type="button" data-edit-journal-entry="${escapeHTML(entry.journalEntryId)}"><span class="material-symbols-outlined" aria-hidden="true">edit</span>Edit</button>` : ""}
        </div>
      </footer>
      ${isEditing ? renderJournalEditor(entry) : ""}
    </article>`;
}

function renderJournal() {
  const filtered = getFilteredJournalEntries();
  const displayed = filtered.slice(0, journalVisibleLimit);
  const sources = [...new Set(journalCatalog.filter((entry) => entry.sourceType === "DISCORD_ARCHIVE").map((entry) => entry.volumeName))];
  const years = [...new Set(journalCatalog.map((entry) => entry.year).filter(Boolean))].sort((a, b) => b - a);
  const viewers = [...new Set(journalCatalog.flatMap((entry) => entry.viewerNames))].sort((a, b) => a.localeCompare(b));
  const currentCount = journalCatalog.filter((entry) => entry.sourceType === "CINE_CORD").length;
  const archiveCount = journalCatalog.length - currentCount;
  return `
    <section class="page-view journal-view" aria-labelledby="journal-title">
      ${renderPageHeader({
        id: "journal-title",
        eyebrow: `${journalCatalog.length.toLocaleString()} movie-night records · ${archiveCount.toLocaleString()} archived · ${currentCount.toLocaleString()} editable`,
        title: "The Journal",
        description: "Search every preserved Discord entry and new Cine-Cord movie night in one history.",
        className: "journal-header",
      })}
      <div class="journal-toolbar">
        <label class="search-field journal-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="journal-search" type="search" value="${escapeHTML(journalQuery)}" placeholder="Search titles or entry numbers" aria-label="Search the Journal" /></label>
        <label class="compact-select"><span class="sr-only">Source</span><select id="journal-source-filter" aria-label="Filter Journal by source"><option value="all">All sources</option><option value="CINE_CORD" ${journalSourceFilter === "CINE_CORD" ? "selected" : ""}>Cine-Cord entries</option>${sources.map((source) => `<option value="${escapeHTML(source)}" ${journalSourceFilter === source ? "selected" : ""}>${escapeHTML(source)}</option>`).join("")}</select></label>
        <label class="compact-select"><span class="sr-only">Year</span><select id="journal-year-filter" aria-label="Filter Journal by release year"><option value="all">All years</option>${years.map((year) => `<option value="${year}" ${journalYearFilter === String(year) ? "selected" : ""}>${year}</option>`).join("")}</select></label>
        <label class="compact-select"><span class="sr-only">Status</span><select id="journal-status-filter" aria-label="Filter Journal by status"><option value="all">All statuses</option><option value="FINISHED" ${journalStatusFilter === "FINISHED" ? "selected" : ""}>Finished</option><option value="DNF" ${journalStatusFilter === "DNF" ? "selected" : ""}>DNF</option><option value="UNKNOWN" ${journalStatusFilter === "UNKNOWN" ? "selected" : ""}>Unconfirmed</option></select></label>
        <label class="compact-select"><span class="sr-only">Viewer</span><select id="journal-viewer-filter" aria-label="Filter Journal by viewer"><option value="all">All viewers</option>${viewers.map((viewer) => `<option value="${escapeHTML(viewer)}" ${journalViewerFilter === viewer ? "selected" : ""}>${escapeHTML(viewer)}</option>`).join("")}</select></label>
      </div>
      <div class="journal-results-heading"><span>${filtered.length.toLocaleString()} ${filtered.length === 1 ? "entry" : "entries"}</span>${filtered.length !== journalCatalog.length ? `<button class="text-button" type="button" data-clear-journal-filters>Clear filters</button>` : ""}</div>
      <div class="journal-entry-list" aria-live="polite">${displayed.length ? displayed.map(renderJournalCard).join("") : `<div class="empty-state"><span class="material-symbols-outlined" aria-hidden="true">menu_book</span><h2>No Journal entries match.</h2><p>Try another title, source, year, status or viewer.</p><button class="secondary-button" type="button" data-clear-journal-filters>Clear filters</button></div>`}</div>
      ${displayed.length < filtered.length ? `<button class="secondary-button journal-show-more" type="button" data-show-more-journal>Show ${Math.min(60, filtered.length - displayed.length)} more</button>` : ""}
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
      ${renderPageHeader({
        id: "stats-title",
        eyebrow: "Cine-Cord · Shared list behaviour",
        title: "Group Stats",
        description: "A snapshot of shared suggestions and votes. Selection-game awards arrive later.",
      })}
      <div class="list-stat-grid"><article class="layout-container layout-container-shared"><span class="material-symbols-outlined" aria-hidden="true">movie</span><strong>${ready.length}</strong><p>Films ready to watch</p></article><article class="layout-container layout-container-shared"><span class="material-symbols-outlined" aria-hidden="true">how_to_vote</span><strong>${totalVotes}</strong><p>Total active votes</p></article><article class="layout-container layout-container-shared"><span class="material-symbols-outlined" aria-hidden="true">done_all</span><strong>${watched.length}</strong><p>Marked as watched</p></article></div>
      <div class="stat-feature-list"><article class="layout-container layout-container-shared"><span class="eyebrow">Current favourite</span><h2>${favourite ? escapeHTML(favourite.title) : "No votes yet"}</h2><p>${favourite ? `${favourite.votes} ${favourite.votes === 1 ? "vote" : "votes"}` : "Vote on The List to create a frontrunner."}</p></article><article class="layout-container layout-container-shared"><span class="eyebrow">Longest waiting</span><h2>${oldest ? escapeHTML(oldest.title) : "Nothing waiting"}</h2><p>${oldest ? escapeHTML(formatWaitingTime(oldest.createdAt)) : "Add a suggestion to begin the queue."}</p></article></div>
    </section>`;
}

const journalReconciliationStatusLabels = {
  READY: "Ready to sync",
  ALREADY_SYNCED: "Already synced",
  SKIPPED: "Skipped",
  NEEDS_REVIEW: "Needs review",
  NO_CANONICAL_MOVIE: "No canonical movie",
  AMBIGUOUS_MOVIE: "Ambiguous movie",
  NO_CONFIRMED_VIEWER: "No confirmed viewer",
  MISSING_TARGET_PROFILE: "Missing account",
};

const journalReconciliationStatusFilters = [
  ["all", "All statuses"],
  ["review", "Needs review"],
  ["no-viewer", "Missing viewer/account"],
  ["ready", "Ready to sync"],
  ["already-synced", "Already synced"],
  ["skipped", "Skipped"],
];

function reconciliationViewerChoices() {
  const cambo = members.find((member) => ["cambo", "camebo", "cameron"].includes(String(member.name).trim().toLowerCase()));
  const dean = members.find((member) => ["dean", "deanshelton17"].includes(String(member.name).trim().toLowerCase()));
  return [
    { key: "cambo", label: cambo?.name || "Cambo", source: "Cambo / Camebo / Cameron", available: Boolean(cambo) },
    { key: "dean", label: dean?.name || "deanshelton17", source: "Dean", available: Boolean(dean) },
  ];
}

function reconciliationViewerKeyFromName(name) {
  const value = String(name || "").trim().toLowerCase();
  if (value === "cambo" || value === "camebo" || value === "cameron") return "cambo";
  if (value === "dean" || value === "deanshelton17") return "dean";
  return null;
}

function journalReconciliationRowsForDisplay() {
  const query = journalReconciliationQuery.trim().toLowerCase();
  const status = journalReconciliationStatusFilter;
  const statusMatches = (row) => {
    if (status === "review") return ["NEEDS_REVIEW", "NO_CANONICAL_MOVIE", "AMBIGUOUS_MOVIE"].includes(row.match_status);
    if (status === "no-viewer") return ["NO_CONFIRMED_VIEWER", "MISSING_TARGET_PROFILE"].includes(row.match_status);
    if (status === "ready") return row.match_status === "READY";
    if (status === "already-synced") return row.match_status === "ALREADY_SYNCED";
    if (status === "skipped") return row.match_status === "SKIPPED";
    return true;
  };
  return (journalReconciliationRows || []).filter((row) => {
    const searchable = [
      row.entry_label,
      row.title,
      row.release_year,
      row.match_reason,
      ...(row.viewer_names || []),
      ...(row.target_viewers || []),
    ].join(" ").toLowerCase();
    return statusMatches(row) && (!query || searchable.includes(query));
  });
}

function renderJournalReconciliationCandidates(matches) {
  if (!matches.length) return `<p class="journal-reconciliation-search-note">No matching films found. Try a broader title or remove the year.</p>`;
  return matches.map((match) => `
    <button class="journal-reconciliation-candidate" type="button" data-reconciliation-select-movie="${escapeHTML(match.tmdbId)}">
      <span><strong>${escapeHTML(match.title)}</strong><small>${match.year || "Year unknown"}${match.score === undefined ? "" : ` · ${Math.round(Number(match.score) * 100)}% match · ${String(match.matchBand || "REVIEW").toLocaleLowerCase()}`}</small></span>
      <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
    </button>`).join("");
}

function reconciliationCandidatesForRow(row) {
  return journalReconciliationCandidates.get(row?.archive_entry_id) || [];
}

function renderJournalReconciliationReview(row) {
  if (row.match_status === "ALREADY_SYNCED") return "";
  const selectedViewerKeys = Array.isArray(row.reviewed_viewer_keys) && row.reviewed_viewer_keys.length
    ? row.reviewed_viewer_keys
    : (row.target_viewers || []).map(reconciliationViewerKeyFromName).filter(Boolean);
  const selectedMovieId = row.reviewed_movie_id || row.movie_id || "";
  const selectedMovieTitle = row.canonical_title || "";
  const choices = reconciliationViewerChoices();
  const suggestedMatches = reconciliationCandidatesForRow(row);
  return `
    <details class="journal-reconciliation-review" ${row.review_decision === "APPROVED" ? "open" : ""}>
      <summary><span class="material-symbols-outlined" aria-hidden="true">rule</span>${row.review_decision === "APPROVED" ? "Edit review" : "Review this entry"}</summary>
      <form data-reconciliation-review-form data-archive-entry-id="${escapeHTML(row.archive_entry_id)}" data-movie-id="${escapeHTML(selectedMovieId)}">
        <div class="journal-reconciliation-review-heading"><div><strong>Confirm the private-history match</strong><p>Choose the canonical film and the current accounts that should receive a private viewing event. The imported Discord entry stays unchanged.</p></div></div>
        <div class="journal-reconciliation-search">
          <label><span>Search canonical films</span><input name="movie_query" value="${escapeHTML(row.title || "")}" maxlength="200" /></label>
          <label><span>Release year <small>Optional</small></span><input name="movie_year" type="number" min="1888" max="2200" value="${escapeHTML(row.release_year || "")}" /></label>
          <button class="secondary-button compact" type="button" data-reconciliation-search-movie><span class="material-symbols-outlined" aria-hidden="true">search</span>Search</button>
        </div>
        <div class="journal-reconciliation-selected-movie" data-reconciliation-selected-movie>${selectedMovieId ? `<span class="material-symbols-outlined" aria-hidden="true">movie</span><span>Selected: <strong>${escapeHTML(selectedMovieTitle || "Canonical movie selected")}</strong></span>` : `<span class="material-symbols-outlined" aria-hidden="true">help</span><span>No canonical film selected yet.</span>`}</div>
        <div class="journal-reconciliation-candidates" data-reconciliation-candidates aria-live="polite">${suggestedMatches.length ? `<span class="journal-reconciliation-candidates-label">TMDB suggestions</span>${renderJournalReconciliationCandidates(suggestedMatches)}` : ""}</div>
        <fieldset class="journal-reconciliation-viewers"><legend>Private history viewers</legend><p>Source names: ${escapeHTML((row.viewer_names || []).join(", ") || "None recorded")}</p><div>${choices.map((choice) => `<label class="journal-reconciliation-viewer"><input type="checkbox" name="viewer_key" value="${choice.key}" ${selectedViewerKeys.includes(choice.key) ? "checked" : ""} ${choice.available ? "" : "disabled"} /><span><strong>${escapeHTML(choice.label)}</strong><small>Matches ${escapeHTML(choice.source)}${choice.available ? "" : " · account not in this group"}</small></span></label>`).join("")}</div></fieldset>
        <div class="journal-reconciliation-review-actions"><button class="primary-button compact" type="submit"><span class="material-symbols-outlined" aria-hidden="true">check</span>Approve match</button><button class="quiet-button danger compact" type="button" data-reconciliation-skip>Skip this entry</button></div>
        <p class="journal-reconciliation-review-status" data-reconciliation-review-status role="status"></p>
      </form>
    </details>`;
}

function reconciliationMovieSummary(row) {
  if (!row?.canonical_title) return "";
  const approximate = ["NEEDS_REVIEW", "AMBIGUOUS_MOVIE"].includes(row.match_status);
  return `<p>${approximate ? "Closest match" : "Canonical film"}: ${escapeHTML(row.canonical_title)}</p>`;
}

function designPreviewJournalReconciliationRows() {
  return [
    {
      archive_entry_id: "preview-archive-resident-evil",
      entry_label: "#1345",
      title: "Resident Evil",
      release_year: 2026,
      watched_at: "2026-09-26",
      archive_status: "FINISHED",
      parser_status: "PARSED",
      viewer_names: ["Adam", "Andrew", "Cameron", "Danny", "Dean", "Kieran"],
      target_viewers: ["Cameron", "Dean"],
      already_synced_viewers: [],
      movie_id: "preview-movie-resident-evil",
      canonical_title: "Resident Evil",
      candidate_count: 1,
      match_status: "READY",
      match_reason: "Exact title and year match; private history can be created.",
    },
    {
      archive_entry_id: "preview-archive-green-lantern",
      entry_label: "#1346",
      title: "Green Lantern: Beware My Power",
      release_year: 2022,
      watched_at: "2026-09-27",
      archive_status: "FINISHED",
      parser_status: "PARSED",
      viewer_names: ["Andrew", "Dean"],
      target_viewers: ["Dean"],
      already_synced_viewers: [],
      movie_id: null,
      canonical_title: null,
      candidate_count: 0,
      match_status: "NO_CANONICAL_MOVIE",
      match_reason: "No canonical movie has the same title and release year.",
    },
    {
      archive_entry_id: "preview-archive-showcase",
      entry_label: "#1344",
      title: "Xbox Showcase",
      release_year: 2025,
      watched_at: "2026-09-25",
      archive_status: "FINISHED",
      parser_status: "PARSED",
      viewer_names: ["Cameron"],
      target_viewers: ["Cambo"],
      already_synced_viewers: [],
      movie_id: null,
      canonical_title: null,
      candidate_count: 0,
      match_status: "NO_CANONICAL_MOVIE",
      match_reason: "No canonical movie has the same title and release year.",
    },
    {
      archive_entry_id: "preview-archive-firm",
      entry_label: "#1343",
      title: "The Firm",
      release_year: 2007,
      watched_at: "2026-09-24",
      archive_status: "FINISHED",
      parser_status: "PARSED",
      viewer_names: ["Cameron", "Dean"],
      target_viewers: ["Cambo", "deanshelton17"],
      already_synced_viewers: [],
      movie_id: null,
      canonical_title: null,
      candidate_count: 2,
      match_status: "AMBIGUOUS_MOVIE",
      match_reason: "More than one possible film was found.",
    },
  ];
}

function renderJournalBulkApproval() {
  const proposals = journalBulkPreview?.proposals || [];
  const selectedCount = journalBulkSelectedIds.size;
  return `
    <div class="journal-bulk-approval" aria-label="Bulk archive approval">
      <div class="journal-bulk-heading"><div><h3>Review clear matches in bulk</h3><p>Exact and high-scoring TMDB matches for confirmed current viewers.</p></div><button class="secondary-button compact" type="button" data-preview-journal-bulk ${journalBulkBusy || journalReconciliationBusy || journalReconciliationMatchBusy ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">fact_check</span>${journalBulkBusy ? "Checking…" : "Preview clear matches"}</button></div>
      ${journalBulkError ? `<p class="journal-bulk-error" role="alert">${escapeHTML(journalBulkError)}</p>` : ""}
      ${journalBulkPreview ? `
        <div class="journal-bulk-summary" role="status"><strong>${Number(journalBulkPreview.eligibleCount || 0).toLocaleString()}</strong> clear match${Number(journalBulkPreview.eligibleCount) === 1 ? "" : "es"} <span>${Number(journalBulkPreview.reusedCount || 0).toLocaleString()} previously approved · ${Number(journalBulkPreview.exactCount || 0).toLocaleString()} exact · ${Number(journalBulkPreview.strongCount || 0).toLocaleString()} high-scoring</span></div>
        ${proposals.length ? `<div class="journal-bulk-select-actions"><span>${selectedCount.toLocaleString()} selected</span><button class="quiet-button compact" type="button" data-select-all-journal-bulk ${journalBulkBusy || selectedCount === proposals.length ? "disabled" : ""}>Select all</button><button class="quiet-button compact" type="button" data-clear-journal-bulk ${journalBulkBusy || !selectedCount ? "disabled" : ""}>Clear</button></div>
          <div class="journal-bulk-list">${proposals.map((proposal) => `<label class="journal-bulk-row"><input type="checkbox" data-select-journal-bulk value="${escapeHTML(proposal.archive_entry_id)}" ${journalBulkSelectedIds.has(proposal.archive_entry_id) ? "checked" : ""} ${journalBulkBusy ? "disabled" : ""} /><span class="journal-bulk-entry">${escapeHTML(proposal.entry_label || "Entry")}</span><span class="journal-bulk-film journal-bulk-archive"><strong>${escapeHTML(proposal.archive_title || "Untitled")} <small>${escapeHTML(proposal.archive_year || "")}</small></strong><small>Journal entry</small></span><span class="material-symbols-outlined journal-bulk-arrow" aria-hidden="true">arrow_forward</span><span class="journal-bulk-film journal-bulk-target"><strong>${escapeHTML(proposal.movie_title || "Untitled")} <small>${escapeHTML(proposal.movie_year || "")}</small></strong><small>${proposal.source === "EXISTING_REVIEW" ? "Previously approved film" : proposal.source === "TMDB_EXACT" ? "Exact title and year" : `TMDB score ${Math.round(Number(proposal.match_score || 0) * 100)}/100 · ${Number(proposal.year_delta || 0)}-year difference`}</small></span><span class="journal-bulk-viewers">${escapeHTML((proposal.viewer_keys || []).map((key) => key === "dean" ? "Dean" : "Cambo").join(", "))}</span></label>`).join("")}</div>
          <div class="journal-bulk-footer"><p>Approval saves film and viewer decisions. Sync creates private viewing history separately.</p><button class="primary-button compact" type="button" data-apply-journal-bulk ${journalBulkBusy || !selectedCount ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">done_all</span>Approve ${selectedCount.toLocaleString()} match${selectedCount === 1 ? "" : "es"}</button></div>` : `<p class="journal-bulk-empty">No clear matches found. The remaining entries need individual review.</p>`}
      ` : ""}
    </div>`;
}

function journalManualApprovalIssue(proposal) {
  const source = (journalReconciliationRows || []).find((row) => row.archive_entry_id === proposal.archive_entry_id);
  if (!source || source.parser_status !== "PARSED" || !source.watched_at || !["FINISHED", "DNF"].includes(source.archive_status)) return "Source entry needs individual review";
  if (!proposal.poster_path || !proposal.movie_year || !source.release_year || Math.abs(proposal.movie_year - source.release_year) > 5) return "Poster or release year needs individual review";
  const viewers = (source.target_viewers || []).map((name) => name.toLowerCase() === "cambo" ? "cambo" : name.toLowerCase() === "deanshelton17" ? "dean" : null);
  if (!viewers.length || viewers.includes(null) || viewers.length !== (proposal.viewer_keys || []).length || viewers.some((key) => !proposal.viewer_keys.includes(key))) return "Viewer assignment needs individual review";
  return "";
}

function renderJournalTriage() {
  const proposals = journalTriagePreview?.proposals || [];
  const categoryRows = proposals.filter((row) => row.category === journalTriageCategory);
  const visibleRows = categoryRows.slice(0, journalTriageVisibleLimit);
  const approvedCount = journalTriageApprovedIds.size;
  const skippedCount = journalTriageSkippedIds.size;
  const manualCount = journalTriageManualIds.size;
  const selectedCount = approvedCount + skippedCount;
  const visibleManual = visibleRows.filter((row) => row.category === "MANUAL" && !journalManualApprovalIssue(row));
  const remainingManual = categoryRows.filter((row) => row.category === "MANUAL" && !journalManualApprovalIssue(row) && !journalTriageManualIds.has(row.archive_entry_id));
  const categories = [
    ["SUGGESTED", "Suggested", journalTriagePreview?.suggestedCount],
    ["NO_CANDIDATE", "No match", journalTriagePreview?.noCandidateCount],
    ["MANUAL", "Individual", journalTriagePreview?.manualCount],
  ];
  return `
    <div class="journal-triage" aria-label="Journal review queue">
      <div class="journal-bulk-heading"><div><h3>Review the remaining entries</h3><p>Check suggested films in batches. A missing TMDB suggestion does not mean an entry is not a film.</p></div><button class="secondary-button compact" type="button" data-preview-journal-triage ${journalTriageBusy || journalReconciliationBusy || journalReconciliationMatchBusy || journalBulkBusy ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">fact_check</span>${journalTriageBusy ? "Loading…" : journalTriagePreview ? "Refresh queue" : "Load review queue"}</button></div>
      ${journalTriageError ? `<p class="journal-bulk-error" role="alert">${escapeHTML(journalTriageError)}</p>` : ""}
      ${journalTriagePreview ? `
        <div class="journal-triage-tabs" role="group" aria-label="Review category">${categories.map(([key, label, count]) => `<button type="button" data-triage-category="${key}" aria-pressed="${journalTriageCategory === key}">${escapeHTML(label)} <strong>${Number(count || 0).toLocaleString()}</strong></button>`).join("")}</div>
        <div class="journal-bulk-select-actions"><span>${approvedCount.toLocaleString()} suggested · ${manualCount.toLocaleString()} individual · ${skippedCount.toLocaleString()} archive only</span><div>${journalTriageCategory === "SUGGESTED" ? `<button class="quiet-button compact" type="button" data-triage-select-visible ${visibleRows.every((row) => journalTriageApprovedIds.has(row.archive_entry_id)) ? "disabled" : ""}>Select visible suggestions</button>` : ""}${journalTriageCategory === "MANUAL" ? `<button class="quiet-button compact" type="button" data-triage-select-manual ${!visibleManual.length || visibleManual.every((row) => journalTriageManualIds.has(row.archive_entry_id)) || manualCount >= 100 ? "disabled" : ""}>Select visible verified matches</button><button class="quiet-button compact" type="button" data-triage-select-next ${!remainingManual.length || manualCount >= 100 ? "disabled" : ""}>Select up to 100</button>` : ""}<button class="quiet-button compact" type="button" data-triage-clear ${selectedCount + manualCount ? "" : "disabled"}>Clear selections</button></div></div>
        <div class="journal-triage-list">${visibleRows.length ? visibleRows.map((row) => {
          const canApprove = row.category === "SUGGESTED" && row.can_approve === true;
          const isManual = row.category === "MANUAL";
          const manualIssue = isManual ? journalManualApprovalIssue(row) : "";
          const selected = isManual ? journalTriageManualIds.has(row.archive_entry_id) : canApprove ? journalTriageApprovedIds.has(row.archive_entry_id) : journalTriageSkippedIds.has(row.archive_entry_id);
          const poster = row.poster_path ? `<img src="${escapeHTML(tmdbPoster(row.poster_path, "w185"))}" alt="" loading="lazy" />` : `<span class="material-symbols-outlined" aria-hidden="true">movie</span>`;
          const source = (journalReconciliationRows || []).find((item) => item.archive_entry_id === row.archive_entry_id);
          return `<article class="journal-triage-row"><label><input type="checkbox" ${isManual ? "data-triage-manual" : canApprove ? "data-triage-approve" : "data-triage-skip"} value="${escapeHTML(row.archive_entry_id)}" ${selected ? "checked" : ""} ${journalTriageBusy || manualIssue ? "disabled" : ""} aria-label="${isManual ? "Approve displayed TMDB film for" : canApprove ? "Approve suggested film for" : "Keep archive only for"} ${escapeHTML(row.archive_title)}" /><span class="journal-triage-poster">${poster}</span><span class="journal-triage-content"><span class="journal-triage-source">${escapeHTML(row.entry_label || "Entry")} · ${escapeHTML(row.archive_title)} ${escapeHTML(row.archive_year || "")}</span><strong>${escapeHTML(row.movie_title || (row.category === "NO_CANDIDATE" ? "No TMDB film suggested" : "Choose individually"))}${row.movie_year ? ` <small>${escapeHTML(row.movie_year)}</small>` : ""}</strong><small>${isManual ? "TMDB candidate · " : ""}${canApprove || isManual ? `TMDB ${Math.round(Number(row.match_score || 0) * 100)}/100 · ${Number(row.year_delta || 0)}-year difference` : escapeHTML(row.match_reason || "Needs individual review")} · ${escapeHTML((row.viewer_keys || []).map((key) => key === "dean" ? "Dean" : "Cambo").join(", "))}</small>${isManual && source?.canonical_title ? `<small class="journal-triage-warning">Existing canonical match: ${escapeHTML(source.canonical_title)}. Confirm the poster before replacing this entry's match.</small>` : ""}${manualIssue ? `<small class="journal-triage-warning">${escapeHTML(manualIssue)}</small>` : ""}${row.overview ? `<span class="journal-triage-overview">${escapeHTML(row.overview)}</span>` : ""}</span></label><div class="journal-triage-actions">${isManual ? `<label><input type="checkbox" data-triage-skip value="${escapeHTML(row.archive_entry_id)}" aria-label="Keep archive only for ${escapeHTML(row.archive_title)}" ${journalTriageSkippedIds.has(row.archive_entry_id) ? "checked" : ""} ${journalTriageBusy ? "disabled" : ""} />Archive only</label>` : ""}<button class="quiet-button compact" type="button" data-triage-open="${escapeHTML(row.archive_entry_id)}">Review individually</button></div></article>`;
        }).join("") : `<p class="journal-bulk-empty">No entries in this category.</p>`}</div>
        ${visibleRows.length < categoryRows.length ? `<button class="secondary-button compact journal-triage-more" type="button" data-triage-more>Show more</button>` : ""}
        <div class="journal-bulk-footer"><p>Approval saves the film and confirmed viewers; archive-only is reversible. Neither action creates private history. Sync is separate.</p><div class="journal-triage-footer-actions"><button class="secondary-button compact" type="button" data-apply-journal-triage ${journalTriageBusy || !selectedCount || selectedCount > 100 ? "disabled" : ""}>Save ${selectedCount.toLocaleString()} decision${selectedCount === 1 ? "" : "s"}</button>${journalTriageCategory === "MANUAL" ? `<button class="primary-button compact" type="button" data-apply-journal-manual ${journalTriageBusy || !manualCount || manualCount > 100 ? "disabled" : ""}>Approve ${manualCount.toLocaleString()} verified match${manualCount === 1 ? "" : "es"}</button>` : ""}</div></div>
        ${selectedCount > 100 || manualCount > 100 ? `<p class="journal-bulk-error">Save at most 100 decisions in one batch.</p>` : ""}
      ` : ""}
    </div>`;
}

function renderJournalReconciliationPanel() {
  const rows = journalReconciliationRows || [];
  const counts = rows.reduce((result, row) => {
    result[row.match_status] = (result[row.match_status] || 0) + 1;
    return result;
  }, {});
  const readyCount = counts.READY || 0;
  const filteredRows = journalReconciliationRowsForDisplay();
  const displayedRows = filteredRows.slice(0, journalReconciliationVisibleLimit);
  return `
    <section class="management-section journal-reconciliation" aria-labelledby="journal-reconciliation-title">
      <div class="section-heading"><div><span class="eyebrow">Private history repair</span><h2 id="journal-reconciliation-title">Reconcile Journal history</h2></div><span class="request-count">${rows.length ? rows.length.toLocaleString() : "—"}</span></div>
      <article class="invite-panel layout-container layout-container-neutral">
        <div><h3>Review archive matches before creating private history.</h3><p>Exact local matches stay safe and unchanged. Find likely TMDB films for the remaining entries, compare ranked title and year suggestions, then approve only what you recognise. The imported archive stays read-only, the shared list stays unchanged and approved matches remain idempotent.</p></div>
        <div class="journal-reconciliation-actions"><button class="secondary-button compact" type="button" data-refresh-journal-reconciliation ${journalReconciliationBusy || journalReconciliationMatchBusy || journalBulkBusy ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">fact_check</span>${journalReconciliationBusy ? "Checking…" : "Preview matches"}</button><button class="secondary-button compact" type="button" data-discover-journal-reconciliation ${journalReconciliationBusy || journalReconciliationMatchBusy || journalBulkBusy || !rows.length ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">travel_explore</span>${journalReconciliationMatchBusy ? `Finding ${journalReconciliationMatchProgress}/${journalReconciliationMatchTotal}…` : "Find likely TMDB matches"}</button><button class="primary-button compact" type="button" data-apply-journal-reconciliation ${journalReconciliationBusy || journalReconciliationMatchBusy || journalBulkBusy || !readyCount ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">sync</span>${journalReconciliationBusy ? "Syncing…" : `Sync ${readyCount || "eligible"} film${readyCount === 1 ? "" : "s"}`}</button></div>
      </article>
      ${journalReconciliationError ? `<div class="feature-error-state is-compact" role="alert"><span class="material-symbols-outlined" aria-hidden="true">error</span><div><strong>Journal history preview failed.</strong><p>${escapeHTML(journalReconciliationError)}</p></div><button class="secondary-button compact" type="button" data-refresh-journal-reconciliation>Try again</button></div>` : ""}
      ${journalReconciliationRows !== null ? renderJournalBulkApproval() + renderJournalTriage() : ""}
      ${journalReconciliationRows === null ? `<div class="empty-state compact-empty"><span class="material-symbols-outlined" aria-hidden="true">manage_search</span><p>Preview the imported Journal before making any private-history changes.</p></div>` : `
        <div class="journal-reconciliation-summary" aria-label="Journal history reconciliation summary">
          <span><strong>${counts.READY || 0}</strong> ready</span><span><strong>${counts.ALREADY_SYNCED || 0}</strong> already synced</span><span><strong>${(counts.NEEDS_REVIEW || 0) + (counts.AMBIGUOUS_MOVIE || 0) + (counts.NO_CANONICAL_MOVIE || 0)}</strong> need review</span><span><strong>${(counts.NO_CONFIRMED_VIEWER || 0) + (counts.MISSING_TARGET_PROFILE || 0)}</strong> missing viewer/account</span>
        </div>
        <form class="journal-reconciliation-filters" data-journal-reconciliation-filter-form>
          <label><span>Find an archive entry</span><input name="query" value="${escapeHTML(journalReconciliationQuery)}" placeholder="Title, entry number or viewer" /></label>
          <label><span>Status</span><select name="status">${journalReconciliationStatusFilters.map(([value, label]) => `<option value="${value}" ${journalReconciliationStatusFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <button class="secondary-button compact" type="submit"><span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>Filter</button>
          <span class="journal-reconciliation-filter-count">Showing ${displayedRows.length.toLocaleString()} of ${filteredRows.length.toLocaleString()} matching entries</span>
        </form>
        <div class="journal-reconciliation-list">${displayedRows.length ? displayedRows.map((row) => {
          const statusLabel = journalReconciliationStatusLabels[row.match_status] || row.match_status;
          const statusClass = String(row.match_status || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const targetViewers = Array.isArray(row.target_viewers) && row.target_viewers.length ? row.target_viewers.join(", ") : "None recognised";
          return `<article class="journal-reconciliation-row" data-reconciliation-entry-id="${escapeHTML(row.archive_entry_id)}"><div><strong>${escapeHTML(row.entry_label || "Journal entry")}</strong><h3>${escapeHTML(row.title || "Untitled")}${row.release_year ? ` <span>${row.release_year}</span>` : ""}</h3><p>Private-history viewers: ${escapeHTML(targetViewers)}</p>${reconciliationMovieSummary(row)}</div><div class="journal-reconciliation-result"><span class="status-pill ${statusClass}">${escapeHTML(statusLabel)}</span><small>${escapeHTML(row.match_reason || "")}</small></div>${renderJournalReconciliationReview(row)}</article>`;
        }).join("") : `<div class="empty-state compact-empty">No imported Journal rows were found.</div>`}</div>
        ${filteredRows.length > displayedRows.length ? `<button class="secondary-button compact journal-reconciliation-more-button" type="button" data-show-more-journal-reconciliation>Show more entries</button>` : ""}
      `}
    </section>`;
}

function mergeJournalReconciliationCandidates(candidates = []) {
  const next = new Map(journalReconciliationCandidates);
  for (const candidate of candidates) {
    const entryId = candidate.archiveEntryId || candidate.archive_entry_id;
    if (!entryId) continue;
    const existing = next.get(entryId) || [];
    const normalized = {
      tmdbId: Number(candidate.tmdbId ?? candidate.tmdb_id),
      title: candidate.title || "Untitled film",
      year: candidate.year ?? candidate.release_year ?? null,
      posterPath: candidate.posterPath ?? candidate.poster_path ?? null,
      overview: candidate.overview || "",
      score: candidate.score === undefined ? undefined : Number(candidate.score),
      titleScore: candidate.titleScore === undefined ? undefined : Number(candidate.titleScore),
      yearDelta: candidate.yearDelta ?? candidate.year_delta ?? null,
      matchBand: candidate.matchBand || candidate.match_band || "REVIEW",
      candidateRank: Number(candidate.candidateRank ?? candidate.candidate_rank ?? existing.length + 1),
    };
    if (!Number.isInteger(normalized.tmdbId) || normalized.tmdbId <= 0) continue;
    const withoutDuplicate = existing.filter((item) => item.tmdbId !== normalized.tmdbId);
    next.set(entryId, [...withoutDuplicate, normalized].sort((left, right) => left.candidateRank - right.candidateRank));
  }
  journalReconciliationCandidates = next;
}

async function loadCachedJournalReconciliationCandidates() {
  if (designPreviewMode || !activeGroup?.id) return;
  try {
    const candidates = await fetchArchiveHistoryCandidates(supabase, activeGroup.id);
    journalReconciliationCandidates = new Map();
    mergeJournalReconciliationCandidates(candidates);
  } catch {
    journalReconciliationCandidates = new Map();
  }
}

async function refreshJournalReconciliation() {
  if (!isCurrentAdmin() || !activeGroup?.id) return;
  journalReconciliationBusy = true;
  journalReconciliationError = "";
  journalBulkPreview = null;
  journalBulkSelectedIds = new Set();
  journalBulkError = "";
  journalTriagePreview = null;
  journalTriageApprovedIds = new Set();
  journalTriageSkippedIds = new Set();
  journalTriageManualIds = new Set();
  journalTriageError = "";
  render();
  try {
    if (designPreviewMode) {
      journalReconciliationRows = designPreviewJournalReconciliationRows();
      journalReconciliationCandidates = new Map([
        ["preview-archive-green-lantern", [{ tmdbId: 946310, title: "Green Lantern: Beware My Power", year: 2022, score: 1, titleScore: 1, yearDelta: 0, matchBand: "STRONG", candidateRank: 1 }]],
      ]);
    } else {
      journalReconciliationRows = await fetchArchiveHistoryPreview(supabase, activeGroup.id);
      await loadCachedJournalReconciliationCandidates();
    }
  } catch (error) {
    journalReconciliationRows = null;
    journalReconciliationError = error.message || "The administrator preview could not be loaded.";
  } finally {
    journalReconciliationBusy = false;
    render();
  }
}

async function discoverJournalReconciliationMatches() {
  if (!isCurrentAdmin() || !activeGroup?.id || journalReconciliationMatchBusy || journalBulkBusy || journalTriageBusy) return;
  const targets = (journalReconciliationRows || [])
    .filter((row) => ["NEEDS_REVIEW", "NO_CANONICAL_MOVIE", "AMBIGUOUS_MOVIE"].includes(row.match_status))
    .map((row) => row.archive_entry_id)
    .filter(Boolean);
  if (!targets.length) {
    showToast("There are no unresolved archive matches to search.");
    return;
  }
  journalReconciliationMatchBusy = true;
  journalReconciliationMatchProgress = 0;
  journalReconciliationMatchTotal = targets.length;
  journalReconciliationError = "";
  journalBulkPreview = null;
  journalTriagePreview = null;
  journalTriageApprovedIds = new Set();
  journalTriageSkippedIds = new Set();
  journalTriageManualIds = new Set();
  render();
  try {
    if (designPreviewMode) {
      showToast("Likely TMDB matches found for the unresolved entries.");
      return;
    }
    const batchSize = 20;
    let scanned = 0;
    for (let start = 0; start < targets.length; start += batchSize) {
      const archiveEntryIds = targets.slice(start, start + batchSize);
      const { data, error } = await supabase.functions.invoke("match-archive-history", {
        body: { groupId: activeGroup.id, archiveEntryIds },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      archiveEntryIds.forEach((entryId) => journalReconciliationCandidates.delete(entryId));
      mergeJournalReconciliationCandidates(data?.candidates || []);
      scanned += Number(data?.entriesScanned) || archiveEntryIds.length;
      journalReconciliationMatchProgress = scanned;
      render();
    }
    showToast(`TMDB suggestions found for ${scanned} archive ${scanned === 1 ? "entry" : "entries"}.`);
  } catch (error) {
    journalReconciliationError = error.message || "TMDB archive matching failed.";
    showToast(`TMDB matching was not completed: ${journalReconciliationError}`);
  } finally {
    journalReconciliationMatchBusy = false;
    journalReconciliationMatchProgress = 0;
    journalReconciliationMatchTotal = 0;
    render();
  }
}

async function previewJournalBulkApproval() {
  if (!isCurrentAdmin() || !activeGroup?.id || journalBulkBusy || journalReconciliationBusy || journalReconciliationMatchBusy) return;
  journalBulkBusy = true;
  journalBulkPreview = null;
  journalBulkSelectedIds = new Set();
  journalBulkError = "";
  render();
  try {
    if (designPreviewMode) {
      const row = (journalReconciliationRows || []).find((item) => item.archive_entry_id === "preview-archive-green-lantern" && !item.review_decision);
      const proposals = row ? [{ archive_entry_id: row.archive_entry_id, entry_label: row.entry_label, archive_title: row.title, archive_year: row.release_year, tmdb_id: 946310, movie_title: row.title, movie_year: row.release_year, viewer_keys: ["dean"], source: "TMDB_EXACT" }] : [];
      journalBulkPreview = { eligibleCount: proposals.length, exactCount: proposals.length, strongCount: 0, reusedCount: 0, token: "preview", proposals };
    } else {
      const { data, error } = await supabase.rpc("preview_archive_history_bulk_review", { p_group_id: activeGroup.id });
      if (error) throw error;
      journalBulkPreview = data;
    }
  } catch (error) {
    journalBulkError = error.message || "Bulk matches could not be previewed.";
  } finally {
    journalBulkBusy = false;
    render();
  }
}

async function applyJournalBulkApproval() {
  const preview = journalBulkPreview;
  const selectedIds = [...journalBulkSelectedIds];
  const count = selectedIds.length;
  if (!isCurrentAdmin() || !activeGroup?.id || journalBulkBusy || journalReconciliationBusy || journalReconciliationMatchBusy || !count) return;
  if (!window.confirm(`Approve ${count} clear Journal film and viewer matches? This saves review decisions only. Private viewing history is created separately when you choose Sync.`)) return;
  journalBulkBusy = true;
  journalBulkError = "";
  render();
  try {
    if (designPreviewMode) {
      journalReconciliationRows = (journalReconciliationRows || []).map((row) => {
        const proposal = preview.proposals.find((item) => item.archive_entry_id === row.archive_entry_id && selectedIds.includes(item.archive_entry_id));
        return proposal ? { ...row, movie_id: `preview-movie-${proposal.tmdb_id}`, canonical_title: proposal.movie_title, candidate_count: 1, match_status: "READY", review_decision: "APPROVED", reviewed_movie_id: `preview-movie-${proposal.tmdb_id}`, reviewed_viewer_keys: proposal.viewer_keys, match_reason: "Manually approved canonical film and private-history viewers." } : row;
      });
    } else {
      const { data, error } = await supabase.rpc("apply_archive_history_bulk_review", { p_group_id: activeGroup.id, p_expected_token: preview.token, p_archive_entry_ids: selectedIds });
      if (error) throw error;
      if (Number(data?.approvedCount) !== count) throw new Error("The saved count did not match the preview. Refresh before syncing.");
      await refreshJournalReconciliation();
    }
    journalBulkPreview = null;
    journalBulkSelectedIds = new Set();
    showToast(`${count} Journal match${count === 1 ? "" : "es"} approved. Use Sync to create private history.`);
  } catch (error) {
    journalBulkPreview = null;
    journalBulkSelectedIds = new Set();
    journalBulkError = error.message || "Bulk approval failed. Preview again before retrying.";
  } finally {
    journalBulkBusy = false;
    render();
  }
}

async function previewJournalTriage() {
  if (!isCurrentAdmin() || !activeGroup?.id || journalTriageBusy || journalReconciliationBusy || journalReconciliationMatchBusy || journalBulkBusy) return;
  journalTriageBusy = true;
  journalTriageError = "";
  journalTriagePreview = null;
  journalTriageApprovedIds = new Set();
  journalTriageSkippedIds = new Set();
  journalTriageManualIds = new Set();
  render();
  try {
    if (designPreviewMode) {
      const fixtureProposals = [
        { archive_entry_id: "preview-archive-green-lantern", entry_label: "#1346", archive_title: "Green Lantern: Beware My Power", archive_year: 2022, viewer_keys: ["dean"], tmdb_id: 946310, movie_title: "Green Lantern: Beware My Power", movie_year: 2022, match_score: 0.96, year_delta: 0, category: "SUGGESTED", can_approve: true, overview: "Green Lantern John Stewart faces an interplanetary threat." },
        { archive_entry_id: "preview-archive-showcase", entry_label: "#1344", archive_title: "Xbox Showcase", archive_year: 2025, viewer_keys: ["cambo"], category: "NO_CANDIDATE", can_approve: false, match_reason: "No canonical movie has the same title and release year." },
        { archive_entry_id: "preview-archive-firm", entry_label: "#1343", archive_title: "The Firm", archive_year: 2007, viewer_keys: ["cambo", "dean"], tmdb_id: 12345, movie_title: "The Firm", movie_year: 2009, poster_path: imageAssets.journalFallback, match_score: 0.91, year_delta: 2, category: "MANUAL", can_approve: false, match_reason: "More than one possible film was found." },
      ];
      const unresolvedIds = new Set((journalReconciliationRows || [])
        .filter((row) => !row.review_decision && ["NEEDS_REVIEW", "NO_CANONICAL_MOVIE", "AMBIGUOUS_MOVIE"].includes(row.match_status))
        .map((row) => row.archive_entry_id));
      const proposals = fixtureProposals.filter((row) => unresolvedIds.has(row.archive_entry_id));
      journalTriagePreview = {
        token: "preview",
        proposals,
        suggestedCount: proposals.filter((row) => row.category === "SUGGESTED").length,
        noCandidateCount: proposals.filter((row) => row.category === "NO_CANDIDATE").length,
        manualCount: proposals.filter((row) => row.category === "MANUAL").length,
      };
    } else {
      const { data, error } = await supabase.rpc("preview_archive_history_triage", { p_group_id: activeGroup.id });
      if (error) throw error;
      journalTriagePreview = data;
    }
  } catch (error) {
    journalTriageError = error.message || "The review queue could not be loaded.";
  } finally {
    journalTriageBusy = false;
    render();
  }
}

async function applyJournalTriage() {
  const approvedIds = [...journalTriageApprovedIds];
  const skippedIds = [...journalTriageSkippedIds];
  const count = approvedIds.length + skippedIds.length;
  if (!isCurrentAdmin() || !activeGroup?.id || !journalTriagePreview || journalTriageBusy || !count || count > 100) return;
  if (!window.confirm(`Save ${approvedIds.length} approved film match${approvedIds.length === 1 ? "" : "es"} and ${skippedIds.length} archive-only entr${skippedIds.length === 1 ? "y" : "ies"}? This does not create private viewing history. Review the selected rows before continuing.`)) return;
  journalTriageBusy = true;
  journalTriageError = "";
  render();
  try {
    if (designPreviewMode) {
      journalReconciliationRows = (journalReconciliationRows || []).map((row) => {
        if (approvedIds.includes(row.archive_entry_id)) return { ...row, match_status: "READY", review_decision: "APPROVED", reviewed_viewer_keys: ["dean"], canonical_title: "Green Lantern: Beware My Power" };
        if (skippedIds.includes(row.archive_entry_id)) return { ...row, match_status: "SKIPPED", review_decision: "SKIPPED" };
        return row;
      });
      journalTriagePreview = null;
      journalTriageApprovedIds = new Set();
      journalTriageSkippedIds = new Set();
      journalTriageManualIds = new Set();
    } else {
      const { data, error } = await supabase.rpc("apply_archive_history_triage", {
        p_group_id: activeGroup.id,
        p_expected_token: journalTriagePreview.token,
        p_approved_ids: approvedIds,
        p_skipped_ids: skippedIds,
      });
      if (error) throw error;
      if (Number(data?.approvedCount) !== approvedIds.length || Number(data?.skippedCount) !== skippedIds.length) throw new Error("The saved counts did not match the selection. Refresh the queue before continuing.");
      await refreshJournalReconciliation();
    }
    showToast(`${count} Journal review decision${count === 1 ? "" : "s"} saved. Sync remains separate.`);
  } catch (error) {
    journalTriageError = error.message || "The review decisions could not be saved. Refresh the queue before retrying.";
    journalTriagePreview = null;
    journalTriageApprovedIds = new Set();
    journalTriageSkippedIds = new Set();
    journalTriageManualIds = new Set();
  } finally {
    journalTriageBusy = false;
    render();
  }
}

async function applyJournalManualApprovals() {
  const approvedIds = [...journalTriageManualIds];
  if (!isCurrentAdmin() || !activeGroup?.id || !journalTriagePreview || journalTriageBusy || !approvedIds.length || approvedIds.length > 100) return;
  const selected = (journalTriagePreview.proposals || []).filter((row) => approvedIds.includes(row.archive_entry_id));
  if (selected.length !== approvedIds.length || selected.some((row) => row.category !== "MANUAL" || journalManualApprovalIssue(row))) {
    journalTriageError = "The selected matches need a fresh review. Refresh the queue before approving.";
    render();
    return;
  }
  const canonicalCount = selected.filter((row) => (journalReconciliationRows || []).some((source) => source.archive_entry_id === row.archive_entry_id && source.canonical_title)).length;
  const warning = canonicalCount ? ` ${canonicalCount} already have a canonical match that may differ from the selected TMDB film.` : "";
  if (!window.confirm(`Approve the displayed TMDB film and confirmed viewers for ${approvedIds.length} Journal entr${approvedIds.length === 1 ? "y" : "ies"}?${warning} This saves review decisions only; private history requires a separate Sync.`)) return;
  journalTriageBusy = true;
  journalTriageError = "";
  render();
  try {
    if (designPreviewMode) {
      journalReconciliationRows = (journalReconciliationRows || []).map((row) => {
        const proposal = selected.find((item) => item.archive_entry_id === row.archive_entry_id);
        return proposal ? { ...row, match_status: "READY", review_decision: "APPROVED", reviewed_viewer_keys: proposal.viewer_keys, canonical_title: proposal.movie_title } : row;
      });
      journalTriagePreview = null;
      journalTriageManualIds = new Set();
    } else {
      const { data, error } = await supabase.rpc("apply_archive_history_manual_approvals", {
        p_group_id: activeGroup.id,
        p_expected_token: journalTriagePreview.token,
        p_approved_ids: approvedIds,
      });
      if (error) throw error;
      if (Number(data?.approvedCount) !== approvedIds.length) throw new Error("The saved count did not match the selection. Refresh the queue before continuing.");
      await refreshJournalReconciliation();
    }
    showToast(`${approvedIds.length} verified Journal match${approvedIds.length === 1 ? "" : "es"} approved. Sync remains separate.`);
  } catch (error) {
    journalTriageError = error.message || "The matches could not be approved. Refresh the queue before retrying.";
    journalTriagePreview = null;
    journalTriageManualIds = new Set();
  } finally {
    journalTriageBusy = false;
    render();
  }
}

function openJournalTriageEntry(entryId) {
  const row = (journalReconciliationRows || []).find((item) => item.archive_entry_id === entryId);
  if (!row) return;
  journalReconciliationQuery = row.title || row.entry_label || "";
  journalReconciliationStatusFilter = "review";
  const targetIndex = journalReconciliationRowsForDisplay()
    .findIndex((item) => item.archive_entry_id === entryId);
  journalReconciliationVisibleLimit = Math.max(24, targetIndex + 1);
  render();
  const article = root.querySelector(`[data-reconciliation-entry-id="${CSS.escape(entryId)}"]`);
  if (!article) return;
  const details = article.querySelector(".journal-reconciliation-review");
  if (details) details.open = true;
  article.scrollIntoView({ block: "center", behavior: "smooth" });
  article.querySelector(".journal-reconciliation-review summary")?.focus({ preventScroll: true });
}

async function applyJournalReconciliation() {
  if (!isCurrentAdmin() || !activeGroup?.id || journalReconciliationBusy || journalBulkBusy) return;
  const readyIds = (journalReconciliationRows || [])
    .filter((row) => row.match_status === "READY")
    .map((row) => row.archive_entry_id);
  const readyCount = readyIds.length;
  if (!readyCount || !window.confirm(`Create private viewing history for ${readyCount} ready Journal match${readyCount === 1 ? "" : "es"}? Ambiguous entries and the shared list will be left unchanged.`)) return;
  journalReconciliationBusy = true;
  journalReconciliationError = "";
  render();
  try {
    if (designPreviewMode) {
      journalReconciliationRows = (journalReconciliationRows || []).map((row) => row.match_status === "READY"
        ? { ...row, match_status: "ALREADY_SYNCED", already_synced_viewers: [...(row.target_viewers || [])], match_reason: "Private history already exists for every resolved viewer." }
        : row);
      showToast(`${readyCount} private film history match${readyCount === 1 ? "" : "es"} synced in preview.`);
    } else {
      const { data, error } = await supabase.rpc("apply_archive_history_reconciliation", { p_group_id: activeGroup.id, p_archive_entry_ids: readyIds });
      if (error) throw error;
      await refreshJournalReconciliation();
      if (Number(data?.entries_applied) !== readyCount) {
        showToast(`Only ${Number(data?.entries_applied) || 0} of ${readyCount} ready Journal matches synced. Review the refreshed preview before trying again.`);
      } else {
        showToast(`${Number(data?.events_created) || 0} private history event${Number(data?.events_created) === 1 ? "" : "s"} created. The shared list was unchanged.`);
      }
    }
  } catch (error) {
    journalReconciliationError = error.message || "Private Journal history could not be synced.";
    showToast(`Journal history was not synced: ${journalReconciliationError}`);
  } finally {
    journalReconciliationBusy = false;
    render();
  }
}

function setJournalReconciliationReviewStatus(form, message, tone = "") {
  const status = form?.querySelector("[data-reconciliation-review-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

async function searchJournalReconciliationMovie(form) {
  const searchButton = form.querySelector("[data-reconciliation-search-movie]");
  const query = String(form.elements.movie_query?.value || "").trim();
  const yearValue = String(form.elements.movie_year?.value || "").trim();
  const year = yearValue ? Number(yearValue) : null;
  if (!query) {
    setJournalReconciliationReviewStatus(form, "Enter a film title to search.", "warning");
    return;
  }
  if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2200)) {
    setJournalReconciliationReviewStatus(form, "Enter a valid release year or leave it blank.", "warning");
    return;
  }
  searchButton.disabled = true;
  searchButton.querySelector(".material-symbols-outlined")?.replaceChildren(document.createTextNode("progress_activity"));
  setJournalReconciliationReviewStatus(form, "Searching the canonical film catalogue…");
  try {
    const { matches = [] } = await lookupMovie({ action: "search", query, year });
    form.querySelector("[data-reconciliation-candidates]").innerHTML = renderJournalReconciliationCandidates(matches);
    setJournalReconciliationReviewStatus(form, matches.length ? `${matches.length} matches found. Choose the correct film.` : "No matching films found. Try a broader title.", matches.length ? "success" : "warning");
  } catch (error) {
    setJournalReconciliationReviewStatus(form, error.message || "The canonical film search failed.", "warning");
  } finally {
    searchButton.disabled = false;
    searchButton.querySelector(".material-symbols-outlined")?.replaceChildren(document.createTextNode("search"));
  }
}

async function selectJournalReconciliationMovie(button) {
  const form = button.closest("[data-reconciliation-review-form]");
  if (!form || button.disabled) return;
  button.disabled = true;
  setJournalReconciliationReviewStatus(form, "Loading the selected canonical film…");
  try {
    const { movie } = await lookupMovie({ action: "details", tmdbId: Number(button.dataset.reconciliationSelectMovie) });
    if (!movie?.movieId) throw new Error("That film could not be added to the canonical catalogue.");
    form.dataset.movieId = movie.movieId;
    form.dataset.movieTitle = movie.title || "Canonical movie selected";
    form.querySelector("[data-reconciliation-selected-movie]").innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">movie</span><span>Selected: <strong>${escapeHTML(movie.title || "Canonical movie selected")}</strong>${movie.year ? ` <small>${movie.year}</small>` : ""}</span>`;
    form.querySelector("[data-reconciliation-candidates]").innerHTML = "";
    setJournalReconciliationReviewStatus(form, "Canonical film selected. Choose the private-history viewers, then approve.", "success");
  } catch (error) {
    setJournalReconciliationReviewStatus(form, error.message || "The canonical film could not be selected.", "warning");
  } finally {
    button.disabled = false;
  }
}

async function saveJournalReconciliationReview(form, decision = "APPROVED") {
  const archiveEntryId = form.dataset.archiveEntryId;
  if (!archiveEntryId || journalReconciliationReviewBusyId) return;
  const movieId = decision === "APPROVED" ? (form.dataset.movieId || null) : null;
  const viewerKeys = decision === "APPROVED"
    ? [...form.querySelectorAll("input[name='viewer_key']:checked")].map((input) => input.value)
    : [];
  if (decision === "APPROVED" && !movieId) {
    setJournalReconciliationReviewStatus(form, "Choose a canonical film before approving this entry.", "warning");
    return;
  }
  if (decision === "APPROVED" && !viewerKeys.length) {
    setJournalReconciliationReviewStatus(form, "Choose at least one current viewer before approving this entry.", "warning");
    return;
  }
  if (decision === "SKIPPED" && !window.confirm("Skip this archive entry? It will not create private viewing history until you review it again.")) return;
  journalReconciliationReviewBusyId = archiveEntryId;
  journalBulkPreview = null;
  journalTriagePreview = null;
  journalTriageApprovedIds = new Set();
  journalTriageSkippedIds = new Set();
  journalTriageManualIds = new Set();
  form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
  setJournalReconciliationReviewStatus(form, decision === "SKIPPED" ? "Skipping entry…" : "Saving review…");
  try {
    if (designPreviewMode) {
      const choices = reconciliationViewerChoices();
      journalReconciliationRows = (journalReconciliationRows || []).map((row) => row.archive_entry_id !== archiveEntryId ? row : {
        ...row,
        match_status: decision === "SKIPPED" ? "SKIPPED" : "READY",
        match_reason: decision === "SKIPPED" ? "Manually skipped by an administrator." : "Manually approved canonical film and private-history viewers.",
        review_decision: decision,
        reviewed_movie_id: movieId,
        reviewed_viewer_keys: viewerKeys,
        movie_id: movieId,
        canonical_title: decision === "SKIPPED" ? null : (form.dataset.movieTitle || row.canonical_title),
        target_viewers: decision === "SKIPPED" ? [] : viewerKeys.map((key) => choices.find((choice) => choice.key === key)?.label || key),
      });
      journalReconciliationReviewBusyId = null;
      render();
      showToast(decision === "SKIPPED" ? "Archive entry skipped." : "Archive match approved. It is ready to sync.");
      return;
    }
    const { error } = await supabase.rpc("save_archive_history_reconciliation_review", {
      p_group_id: activeGroup.id,
      p_archive_entry_id: archiveEntryId,
      p_movie_id: movieId,
      p_viewer_keys: viewerKeys,
      p_decision: decision,
    });
    if (error) throw error;
    await refreshJournalReconciliation();
    showToast(decision === "SKIPPED" ? "Archive entry skipped." : "Archive match approved. It is ready to sync.");
  } catch (error) {
    setJournalReconciliationReviewStatus(form, error.message || "The review could not be saved.", "warning");
  } finally {
    journalReconciliationReviewBusyId = null;
    if (document.body.contains(form)) form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
  }
}

function renderMembers() {
  if (!isCurrentAdmin()) return renderList();
  const accessUrl = `${window.location.origin}${window.location.pathname}`;
  const sortedMembers = [...members].sort((a, b) => a.role !== b.role ? (a.role === "admin" ? -1 : 1) : a.name.localeCompare(b.name));
  return `
    <section class="page-view" aria-labelledby="members-title">
      ${renderPageHeader({
        id: "members-title",
        eyebrow: `Admin only · ${members.length} approved ${members.length === 1 ? "member" : "members"}`,
        title: "Members",
        description: "Approve friends, keep list names consistent and control access to Cine-Cord.",
      })}
      <article class="invite-panel layout-container layout-container-neutral"><div><span class="eyebrow">Invite a friend</span><h2>Share the private entrance.</h2><p>They create an account, request access and remain locked out until an administrator approves them here.</p></div><div class="invite-link-row"><input value="${escapeHTML(accessUrl)}" readonly aria-label="Website invite link" /><button class="secondary-button" type="button" data-copy-invite>Copy link</button></div></article>
      <section class="management-section" aria-labelledby="requests-title"><div class="section-heading"><div><span class="eyebrow">Waiting room</span><h2 id="requests-title">Access requests</h2></div><span class="request-count">${joinRequests.length}</span></div><div class="request-list">${joinRequests.length ? joinRequests.map((request) => `<article class="request-row layout-container layout-container-neutral"><div class="request-identity"><span class="member-initial">${escapeHTML(request.requested_display_name.slice(0, 1).toUpperCase())}</span><div><h3>${escapeHTML(request.requested_display_name)}</h3><p>${escapeHTML(request.requester_email)} · ${formatRequestDate(request.created_at)}</p></div></div><div class="request-actions"><button class="secondary-button compact" type="button" data-approve-request="${request.id}">Approve</button><button class="quiet-button danger" type="button" data-decline-request="${request.id}">Decline</button></div></article>`).join("") : `<div class="empty-state compact-empty">No one is waiting for access.</div>`}</div></section>
      <section class="management-section" aria-labelledby="discord-hub-title"><div class="section-heading"><div><span class="eyebrow">Discord integration</span><h2 id="discord-hub-title">Cine-Cord hub</h2></div></div><article class="invite-panel layout-container layout-container-neutral"><div><h3>Keep the server entrance in one place.</h3><p>Publish or update one Discord message with buttons for Cine-Cord, Sessions, Journal and My Cinema. This never exposes private member data.</p></div><button class="primary-button compact" type="button" data-publish-cine-cord-hub><span class="material-symbols-outlined" aria-hidden="true">send</span>Publish or update hub</button></article></section>
      ${renderJournalReconciliationPanel()}
      <section class="management-section" aria-labelledby="approved-title"><div class="section-heading"><div><span class="eyebrow">Cine-Cord roster</span><h2 id="approved-title">Approved members</h2></div></div><div class="member-admin-list">${sortedMembers.map((member) => `<form class="member-admin-row" data-member-form data-user-id="${member.id}"><div class="member-admin-identity"><img src="${member.avatar}" alt="" /><div><strong>${escapeHTML(member.name)}</strong><span>${member.id === authUser.id ? "Your account" : "Website member"}</span></div></div><label><span>Display name</span><input name="display_name" maxlength="40" required value="${escapeHTML(member.name)}" /></label><label><span>Role</span><select name="role"><option value="member" ${member.role === "member" ? "selected" : ""}>Member</option><option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option></select></label><div class="member-admin-actions"><button class="secondary-button compact" type="submit">Save</button>${member.id !== authUser.id ? `<button class="quiet-button danger" type="button" data-remove-member="${member.id}">Remove access</button>${String(member.name).trim().toLowerCase() === "cameron_brown00" ? `<button class="quiet-button danger" type="button" data-reassign-remove-member="${member.id}">Move shared films here and remove</button>` : ""}` : ""}</div></form>`).join("")}</div></section>
    </section>`;
}

function memberProfileForId(profileId) {
  return memberProfiles.find((profile) => profile.ownerId === profileId) || null;
}

function memberForId(profileId) {
  return members.find((member) => member.id === profileId) || null;
}

function profileMovieForId(movieId) {
  return personalFilms.find((film) => film.movieId === movieId)
    || movieList.find((film) => film.movieId === movieId)
    || null;
}

function renderProfilePoster(film, { compact = false } = {}) {
  const poster = film.posterUrl || (film.posterPath ? tmdbPoster(film.posterPath) : null);
  return `<span class="member-profile-poster ${compact ? "is-compact" : ""} ${poster ? "" : "is-placeholder"}"><img src="${escapeHTML(poster || imageAssets.journalFallback)}" alt="${escapeHTML(film.title)} poster" loading="lazy" /><span class="member-profile-poster-slot">${film.slot || ""}</span></span>`;
}

function renderProfileRating(rating) {
  if (!Number.isFinite(Number(rating))) return "";
  const score = Number(rating);
  const label = reactionForValue(score)?.label || `${score} out of 5`;
  return `<span class="member-profile-rating" aria-label="${escapeHTML(label)}"><span class="material-symbols-outlined" aria-hidden="true">star</span>${score}/5</span>`;
}

function memberProfileBanner(profile) {
  return profile?.bannerBackdropUrl
    || profile?.bannerPosterUrl
    || profile?.films?.find((film) => film.movieId === profile.bannerMovieId)?.posterUrl
    || profile?.films?.[0]?.posterUrl
    || imageAssets.journalFallback;
}

function buildPreviewMemberProfilePublication({ introduction, movieIds, bannerMovieId, includeRecentWatches, includeGenreBreakdown }) {
  const member = memberForId(authUser.id);
  const current = memberProfileForId(authUser.id);
  const visibleEvents = personalViewingEvents
    .filter((event) => event.ownerId === authUser.id && !event.isHidden)
    .sort((left, right) => String(right.watchedOn || right.createdAt || "").localeCompare(String(left.watchedOn || left.createdAt || "")));
  const watchedMovieIds = new Set([
    ...personalFilms.filter((film) => film.ownerId === authUser.id && film.state === "WATCHED").map((film) => film.movieId),
    ...visibleEvents.filter((event) => event.outcome === "FINISHED").map((event) => event.movieId),
  ]);
  const ratings = personalFilms.map((film) => Number(film.rating)).filter(Number.isFinite);
  const finishedCount = visibleEvents.filter((event) => event.outcome === "FINISHED").length;
  const films = movieIds.map((movieId, index) => {
    const film = profileMovieForId(movieId);
    const personal = personalFilms.find((candidate) => candidate.movieId === movieId);
    return { slot: index + 1, movie_id: movieId, title: film?.title || "Untitled film", release_year: film?.year || null, tmdb_id: film?.tmdbId || null, poster_url: film?.posterUrl || null, rating: personal?.rating ?? null };
  });
  const banner = profileMovieForId(bannerMovieId) || profileMovieForId(movieIds[0]);
  const genreCounts = new Map();
  for (const event of visibleEvents.filter((candidate) => candidate.outcome === "FINISHED")) {
    const film = profileMovieForId(event.movieId);
    for (const genre of film?.genres || []) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  }
  const recentWatches = includeRecentWatches ? visibleEvents.slice(0, 5).map((event, index) => {
    const film = profileMovieForId(event.movieId);
    const personal = personalFilms.find((candidate) => candidate.movieId === event.movieId);
    const sourceSession = sessionHistory.find((session) => session.journalEntry?.id === event.sourceJournalEntryId);
    return { position: index + 1, movie_id: event.movieId, title: film?.title || "Untitled film", release_year: film?.year || null, tmdb_id: film?.tmdbId || null, poster_url: film?.posterUrl || null, watched_on: event.watchedOn, outcome: event.outcome, rating: personal?.rating ?? null, session_label: sourceSession ? sessionModeLabel(sourceSession) : null };
  }) : [];
  const genreBreakdown = includeGenreBreakdown
    ? [...genreCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 3).map(([genre, watchCount], index) => ({ position: index + 1, genre, watch_count: watchCount }))
    : [];
  return normaliseMemberProfile({
    owner_id: authUser.id,
    display_name: member?.name || currentProfile?.displayName,
    avatar_url: member?.avatar || currentProfile?.discordServerAvatar,
    introduction,
    member_since: current?.memberSince || new Date().toISOString(),
    published_at: new Date().toISOString(),
    banner_movie_id: banner?.movieId || null,
    banner_title: banner?.title || null,
    banner_backdrop_path: banner?.backdropPath || banner?.backdropUrl || null,
    banner_poster_path: banner?.posterPath || banner?.posterUrl || null,
    films_watched_count: watchedMovieIds.size,
    sessions_attended_count: sessionHistory.filter((session) => session.status === "WATCHED" && session.participantIds?.includes(authUser.id)).length,
    average_rating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
    completion_rate: visibleEvents.length ? 100 * finishedCount / visibleEvents.length : null,
    recent_watches: recentWatches,
    genre_breakdown: genreBreakdown,
    films,
  });
}

function renderMemberProfileCard(member) {
  const profile = memberProfileForId(member.id);
  const canEdit = member.id === authUser?.id;
  const films = profile?.films || [];
  return `
    <article class="member-profile-card layout-container ${profile ? "is-published" : "is-unpublished"}">
      <header class="member-profile-card-header"><img src="${escapeHTML(member.avatar || avatarForName(member.name))}" alt="" /><div><span class="eyebrow">${profile ? "Published profile" : "Not published"}</span><h2>${escapeHTML(member.name)}</h2></div></header>
      ${profile ? `<p class="member-profile-card-intro">${escapeHTML(profile.introduction || "No introduction yet.")}</p><div class="member-profile-poster-strip">${films.slice(0, 5).map((film) => renderProfilePoster(film, { compact: true })).join("")}</div><p class="member-profile-card-films">${films.map((film) => escapeHTML(film.title)).join(" · ")}</p>` : `<div class="member-profile-unpublished"><span class="material-symbols-outlined" aria-hidden="true">person_outline</span><p>${canEdit ? "Choose your introduction and Top Five to publish your profile." : "This member has not published a profile yet."}</p></div>`}
      <footer class="member-profile-card-actions">${profile ? `<button class="secondary-button compact" type="button" data-view="profile" data-profile-id="${escapeHTML(member.id)}"><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>View profile</button>` : ""}${canEdit ? `<button class="${profile ? "quiet-button" : "primary-button"} compact" type="button" data-edit-member-profile><span class="material-symbols-outlined" aria-hidden="true">edit</span>${profile ? "Edit yours" : "Create yours"}</button>` : ""}</footer>
    </article>`;
}

function renderMemberProfiles() {
  const sortedMembers = [...members].sort((left, right) => left.name.localeCompare(right.name));
  return `
    <section class="page-view member-profiles-view" aria-labelledby="member-profiles-title">
      ${renderPageHeader({
        id: "member-profiles-title",
        eyebrow: `Cine-Cord · ${memberProfiles.length} published`,
        title: "Member Profiles",
        description: "A curated window into the people you watch with. Only approved Cine-Cord members can see a published profile.",
        actions: `<button class="primary-button" type="button" data-edit-member-profile><span class="material-symbols-outlined" aria-hidden="true">edit</span>${memberProfileForId(authUser?.id) ? "Edit my profile" : "Create my profile"}</button>`,
      })}
      ${memberProfilesLoadError ? `<div class="feature-error-state" role="alert"><span class="material-symbols-outlined" aria-hidden="true">cloud_off</span><div><strong>Member Profiles couldn’t load.</strong><p>The shared Cine-Cord pages are still available.</p></div><button class="secondary-button" type="button" data-retry-member-profiles>Try again</button></div>` : `<div class="member-profile-grid">${sortedMembers.length ? sortedMembers.map(renderMemberProfileCard).join("") : `<div class="empty-state"><span class="material-symbols-outlined" aria-hidden="true">groups</span><h2>No approved members yet.</h2><p>Profiles will appear here once your Cine-Cord group has members.</p></div>`}</div>`}
    </section>`;
}

function renderMemberProfileEditor(profile) {
  if (personalFilmsLoadError) return `${renderPageHeader({ id: "member-profile-editor-title", eyebrow: "Private draft", title: "Edit Profile", description: "Your private My Cinema could not be loaded, so the Top Five editor is unavailable." })}${renderPersonalFilmsUnavailable()}`;
  const selectedIds = memberProfileDraft.movieIds || [];
  const films = [...personalFilms].sort((left, right) => left.title.localeCompare(right.title));
  const published = Boolean(profile);
  const selectedBanner = profileMovieForId(memberProfileDraft.bannerMovieId) || profileMovieForId(selectedIds[0]);
  return `
    <section class="member-profile-editor layout-container layout-container-private" aria-labelledby="member-profile-editor-title">
      <header class="member-profile-editor-header"><div><span class="eyebrow">Private draft</span><h2 id="member-profile-editor-title">Shape your cinema profile</h2><p>Your Discord name and avatar stay verified. Everything below changes for the group only when you publish.</p></div><span class="profile-draft-state">${memberProfileDraftSaved ? "Draft saved" : "Draft in progress"}</span></header>
      <form class="member-profile-form" data-member-profile-form>
        <label><span>Introduction <small>160 characters · optional</small></span><textarea name="introduction" maxlength="160" rows="3" placeholder="What kind of films pull you in?">${escapeHTML(memberProfileDraft.introduction)}</textarea></label>
        <fieldset><legend>Top Five <small>Order matters</small></legend><div class="member-profile-slot-list">${Array.from({ length: 5 }, (_, index) => {
          const selected = selectedIds[index] || "";
          return `<label class="member-profile-slot"><span>${index + 1}</span><select name="movie_${index + 1}" aria-label="Top Five slot ${index + 1}"><option value="">No film selected</option>${films.map((film) => `<option value="${escapeHTML(film.movieId)}" ${film.movieId === selected ? "selected" : ""}>${escapeHTML(film.title)}${film.year ? ` (${film.year})` : ""}</option>`).join("")}</select></label>`;
        }).join("")}</div></fieldset>
        <fieldset class="member-profile-banner-fieldset"><legend>Hero banner <small>Choose one of your Top Five</small></legend><div class="member-profile-banner-editor"><div class="member-profile-banner-preview">${selectedBanner ? `<img src="${escapeHTML(selectedBanner.backdropUrl || selectedBanner.posterUrl || imageAssets.journalFallback)}" alt="" data-profile-banner-preview-image /><span data-profile-banner-preview-title>${escapeHTML(selectedBanner.title)}</span>` : `<span class="material-symbols-outlined" aria-hidden="true">panorama</span><span data-profile-banner-preview-title>Select a Top Five film</span>`}</div><label><span>Banner film</span><select name="banner_movie_id" data-profile-banner-select><option value="">Use the first Top Five film</option>${films.map((film) => `<option value="${escapeHTML(film.movieId)}" ${film.movieId === memberProfileDraft.bannerMovieId ? "selected" : ""}>${escapeHTML(film.title)}${film.year ? ` (${film.year})` : ""}</option>`).join("")}</select></label></div></fieldset>
        <fieldset class="member-profile-publication-fieldset"><legend>Published profile sections <small>You control these snapshots</small></legend><label class="member-profile-publication-option"><input type="checkbox" name="include_recent_watches" ${memberProfileDraft.includeRecentWatches ? "checked" : ""} /><span><strong>Recent watches</strong><small>Publish up to five visible viewing-history events. Hidden events are never copied.</small></span></label><label class="member-profile-publication-option"><input type="checkbox" name="include_genre_breakdown" ${memberProfileDraft.includeGenreBreakdown ? "checked" : ""} /><span><strong>Genre breakdown</strong><small>Publish the top three genre counts calculated from visible finished events.</small></span></label></fieldset>
        <div class="member-profile-form-actions"><button class="secondary-button" type="submit" name="profile_action" value="draft" ${memberProfileBusy ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">save</span>${memberProfileBusy ? "Saving…" : "Save private draft"}</button><button class="primary-button" type="submit" name="profile_action" value="publish" ${memberProfileBusy ? "disabled" : ""}><span class="material-symbols-outlined" aria-hidden="true">public</span>${published ? "Update published profile" : "Publish profile"}</button>${published ? `<button class="quiet-button danger" type="button" data-unpublish-member-profile ${memberProfileBusy ? "disabled" : ""}>Unpublish</button>` : ""}<button class="quiet-button" type="button" data-view="${published ? "profile" : "profiles"}" ${published ? `data-profile-id="${escapeHTML(authUser.id)}"` : ""}>Cancel</button></div>
        <small class="member-profile-form-note">Publishing replaces the previous group-visible snapshot. Your full My Cinema and private viewing history remain private.</small>
      </form>
    </section>`;
}

function renderMemberProfileEditPage() {
  const profile = memberProfileForId(authUser?.id);
  return `<section class="page-view member-profile-edit-page" aria-labelledby="profile-edit-page-title">
    ${renderPageHeader({ id: "profile-edit-page-title", eyebrow: "Member Profiles · Private editor", title: "Edit Profile", description: "Curate what the Discordians can see. Saving a draft publishes nothing.", actions: `<button class="secondary-button" type="button" data-view="${profile ? "profile" : "profiles"}" ${profile ? `data-profile-id="${escapeHTML(authUser.id)}"` : ""}><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>${profile ? "Back to profile" : "All profiles"}</button>` })}
    ${renderMemberProfileEditor(profile)}
  </section>`;
}

function renderMemberProfileRecentWatch(watch) {
  const outcome = watch.outcome === "DID_NOT_FINISH" ? "Did not finish" : "Finished";
  return `<article class="member-profile-recent-watch"><img src="${escapeHTML(watch.posterUrl || imageAssets.journalFallback)}" alt="${escapeHTML(watch.title)} poster" loading="lazy" /><div><span class="member-profile-watch-date">${escapeHTML(formatSavedDate(watch.watchedOn))}</span><h3>${escapeHTML(watch.title)}${watch.year ? ` <small>${escapeHTML(watch.year)}</small>` : ""}</h3><p>${escapeHTML(watch.sessionLabel || "Private watch")} &middot; ${escapeHTML(outcome)}</p>${renderProfileRating(watch.rating)}</div></article>`;
}

function renderMemberProfileDetail() {
  const profile = memberProfileForId(selectedProfileId);
  const member = memberForId(selectedProfileId);
  const isOwner = selectedProfileId === authUser?.id;
  if (!profile && !isOwner) return renderMemberProfiles();
  if (!profile) {
    return `<section class="page-view member-profile-detail" aria-labelledby="member-profile-title">${renderPageHeader({ id: "member-profile-title", eyebrow: "Member Profiles", title: "Your profile is private", description: "Choose a Top Five and publish a profile when you are ready.", actions: `<button class="secondary-button" type="button" data-view="profiles"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>All profiles</button><button class="primary-button" type="button" data-edit-member-profile><span class="material-symbols-outlined" aria-hidden="true">edit</span>Create profile</button>` })}</section>`;
  }
  const displayName = profile.displayName || member?.name || currentProfile?.displayName || "Discordian";
  const avatar = profile.avatarUrl || member?.avatar || avatarForName(displayName);
  const reviews = publishedReviews.filter((review) => review.ownerId === selectedProfileId).sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));
  const maxGenreCount = Math.max(1, ...profile.genreBreakdown.map((genre) => genre.watchCount));
  return `
    <section class="page-view member-profile-detail" aria-labelledby="member-profile-title">
      <section class="member-profile-hero">
        <img class="member-profile-hero-backdrop" src="${escapeHTML(memberProfileBanner(profile))}" alt="" />
        <div class="member-profile-hero-shade" aria-hidden="true"></div>
        <div class="member-profile-hero-toolbar"><button class="secondary-button compact" type="button" data-view="profiles"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>All profiles</button>${isOwner ? `<button class="primary-button compact" type="button" data-edit-member-profile><span class="material-symbols-outlined" aria-hidden="true">edit</span>Edit profile</button>` : ""}</div>
        <div class="member-profile-hero-identity"><img class="member-profile-avatar" src="${escapeHTML(avatar)}" alt="" /><div><span class="eyebrow">Verified Discordian</span><h1 id="member-profile-title">${escapeHTML(displayName)}</h1><p>${escapeHTML(profile.introduction || "No introduction published yet.")}</p><div class="member-profile-meta"><span>Member since ${escapeHTML(formatAddedDate(profile.memberSince))}</span><span>Updated ${escapeHTML(formatAddedDate(profile.publishedAt))}</span></div></div></div>
      </section>
      <section class="member-profile-stats" aria-label="Published member statistics">
        <div><strong>${profile.filmsWatchedCount.toLocaleString("en-GB")}</strong><span>Films watched</span></div>
        <div><strong>${profile.sessionsAttendedCount.toLocaleString("en-GB")}</strong><span>Sessions attended</span></div>
        <div><strong>${Number.isFinite(profile.averageRating) ? profile.averageRating.toFixed(1) : "—"}</strong><span>Average rating</span></div>
        <div><strong>${Number.isFinite(profile.completionRate) ? `${Math.round(profile.completionRate)}%` : "—"}</strong><span>Completion rate</span></div>
      </section>
      <div class="member-profile-content-grid">
        <main class="member-profile-main-column">
          <section class="member-profile-section" aria-labelledby="top-five-title"><header class="section-heading"><div><span class="eyebrow">Curated selection</span><h2 id="top-five-title">Top Five</h2></div><small>${profile.films.length}/5</small></header><div class="member-profile-top-five">${profile.films.map((film) => `<article class="member-profile-featured-film">${renderProfilePoster(film)}<div><strong>${escapeHTML(film.title)}</strong><span>${film.year || "Year unknown"}</span>${renderProfileRating(film.rating)}</div></article>`).join("")}</div></section>
          <section class="member-profile-section" aria-labelledby="recent-watches-title"><header class="section-heading"><div><span class="eyebrow">Published snapshot</span><h2 id="recent-watches-title">Recent watches</h2></div><small>${profile.recentWatches.length}</small></header>${profile.recentWatches.length ? `<div class="member-profile-recent-list">${profile.recentWatches.map(renderMemberProfileRecentWatch).join("")}</div>` : `<div class="member-profile-empty"><span class="material-symbols-outlined" aria-hidden="true">history</span><div><strong>No recent watches published.</strong><p>This member has kept their viewing timeline private.</p></div></div>`}</section>
        </main>
        <aside class="member-profile-side-column">
          <section class="member-profile-section" aria-labelledby="profile-genres-title"><header class="section-heading"><div><span class="eyebrow">Finished films</span><h2 id="profile-genres-title">Genre breakdown</h2></div></header>${profile.genreBreakdown.length ? `<div class="member-profile-genres">${profile.genreBreakdown.map((genre) => `<div class="member-profile-genre"><div><strong>${escapeHTML(genre.genre)}</strong><span>${genre.watchCount}</span></div><span class="member-profile-genre-track"><span style="width:${Math.max(8, Math.round(100 * genre.watchCount / maxGenreCount))}%"></span></span></div>`).join("")}</div>` : `<div class="member-profile-empty"><span class="material-symbols-outlined" aria-hidden="true">bar_chart</span><div><strong>No genre counts published.</strong><p>This profile keeps its taste breakdown private.</p></div></div>`}</section>
          <section class="member-profile-section" aria-labelledby="profile-reviews-title"><header class="section-heading"><div><span class="eyebrow">Explicitly published</span><h2 id="profile-reviews-title">Reviews</h2></div><small>${reviews.length}</small></header>${reviews.length ? `<div class="published-review-list member-profile-review-list">${reviews.map(renderPublishedReview).join("")}</div>` : `<div class="member-profile-empty"><span class="material-symbols-outlined" aria-hidden="true">reviews</span><div><strong>No published reviews yet.</strong><p>Private reviews appear only after their author publishes them.</p></div></div>`}</section>
        </aside>
      </div>
    </section>`;
}

function navigationAreaForView(view) {
  if (view === "members") return "admin";
  if (view === "my-films") return "my-cinema";
  return "cine-cord";
}

function revealActiveMobileDestination() {
  if (!window.matchMedia("(max-width: 860px)").matches) return;
  const activeDestination = document.querySelector(".nav-area.is-open .nav-item.is-active");
  window.requestAnimationFrame(() => activeDestination?.scrollIntoView({ block: "nearest", inline: "nearest" }));
}

function updateShellState() {
  const hasWorkspace = Boolean(authUser && activeGroup);
  const hasDiscordServerProfile = Boolean(currentProfile?.discordServerDisplayName);
  const isAdmin = hasWorkspace && isCurrentAdmin();
  const activeArea = navigationAreaForView(currentView);
  document.body.classList.toggle("is-locked", !hasWorkspace);
  document.body.classList.toggle("is-admin", isAdmin);
  document.body.classList.toggle("has-film-detail", hasWorkspace && ["list", "my-films"].includes(currentView) && Boolean(selectedFilmId));
  document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = !isAdmin; });
  document.querySelectorAll("[data-nav-area]").forEach((area) => {
    const unavailable = area.classList.contains("is-unavailable");
    const isOpen = !unavailable && area.dataset.navArea === activeArea;
    const toggle = area.querySelector("[data-nav-area-toggle]");
    area.classList.toggle("is-open", isOpen);
    if (!toggle) return;
    toggle.disabled = !hasWorkspace || (area.dataset.navArea === "admin" && !isAdmin);
    toggle.classList.toggle("is-active", hasWorkspace && isOpen);
    toggle.setAttribute("aria-expanded", String(hasWorkspace && isOpen));
    if (toggle.disabled) toggle.setAttribute("aria-disabled", "true");
    else toggle.removeAttribute("aria-disabled");
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.disabled = !hasWorkspace || (button.dataset.view === "members" && !isAdmin);
    const isActive = hasWorkspace && button.dataset.view === currentView;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (sessionPanel) sessionPanel.hidden = !authUser;
  if (sessionName) sessionName.textContent = currentProfile?.discordServerDisplayName || currentProfile?.displayName || authUser?.email || "Signed in";
  if (sessionIdentitySource) sessionIdentitySource.textContent = hasDiscordServerProfile ? "The Discordians profile" : "Discord profile needs refresh";
  if (sessionAvatar) {
    const avatarUrl = currentProfile?.discordServerAvatar || "";
    sessionAvatar.hidden = !avatarUrl;
    if (avatarUrl) sessionAvatar.src = avatarUrl;
    else sessionAvatar.removeAttribute("src");
  }
  if (discordProfileRefresh) discordProfileRefresh.hidden = !hasWorkspace || !discordAuthEnabled;
  revealActiveMobileDestination();
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

function bindMyFilmsSearch() {
  const search = document.querySelector("#my-films-search");
  search?.addEventListener("input", (event) => {
    myFilmsQuery = event.target.value;
    root.innerHTML = renderMyFilms();
    updateShellState();
    bindMyFilmsSearch();
    const refreshed = document.querySelector("#my-films-search");
    refreshed?.focus();
    refreshed?.setSelectionRange(refreshed.value.length, refreshed.value.length);
  });
  const sort = document.querySelector("#my-films-sort");
  sort?.addEventListener("change", (event) => {
    myFilmsSort = event.target.value;
    render();
  });
}

function bindJournalSearch() {
  const search = document.querySelector("#journal-search");
  search?.addEventListener("input", (event) => {
    journalQuery = event.target.value;
    journalVisibleLimit = 60;
    root.innerHTML = renderJournal();
    updateShellState();
    bindJournalSearch();
    const refreshed = document.querySelector("#journal-search");
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
  const renderers = { list: renderList, "my-films": renderMyFilms, pick: renderPick, sessions: renderSessions, journal: renderJournal, stats: renderStats, members: renderMembers, profiles: renderMemberProfiles, profile: renderMemberProfileDetail, "profile-edit": renderMemberProfileEditPage };
  if (!renderers[currentView] || (currentView === "members" && !isCurrentAdmin())) currentView = "list";
  root.innerHTML = renderers[currentView]();
  updateShellState();
  if (currentView === "list") bindListSearch();
  if (currentView === "my-films") bindMyFilmsSearch();
  if (currentView === "journal") bindJournalSearch();
}

function navigate(view, profileId = null) {
  if (!authUser || !activeGroup) return;
  if (view === "members" && !isCurrentAdmin()) return;
  currentView = legacyViewMap[view] || view;
  selectedProfileId = currentView === "profile" ? profileId : null;
  selectedFilmId = null;
  reactionEditorExpanded = false;
  reactionLiveMessage = "";
  viewingEventEditorId = null;
  viewingEventPendingId = null;
  viewingEventLiveMessage = "";
  if (currentView !== "journal") journalFocusedEntryId = null;
  window.location.hash = currentView === "profile" && selectedProfileId
    ? `profile/${encodeURIComponent(selectedProfileId)}`
    : currentView;
  render();
  if (currentView === "my-films") refreshPersonalCinema({ rerender: true }).catch(() => {});
  root.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPartyModal(mode = "Queue Roulette", film = null) {
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
  const directFilm = film && movieList.find((item) => item.id === film.id);
  if (!directFilm && !movieList.some((item) => !item.watched)) {
    showToast("Add at least one ready film before starting a session.");
    return;
  }
  pendingPartyFilmId = directFilm?.id || null;
  partyModal.querySelector("#party-title").textContent = directFilm ? `Watch ${directFilm.title}` : "Start a watch party";
  partyModal.querySelector(".modal-intro").textContent = directFilm
    ? "Choose who is here. This film will be confirmed without Queue Roulette."
    : "Choose who is here and how tonight's film will be decided.";
  partyForm.querySelector("fieldset:nth-of-type(2)").hidden = Boolean(directFilm);
  partyForm.querySelector("button[type='submit']").textContent = directFilm ? "Start this film" : "Create Watch Party";
  partyMembers.innerHTML = members.map((member) => `<label class="member-choice"><input type="checkbox" name="members" value="${escapeHTML(member.id)}" checked /><img src="${member.avatar}" alt="" /><span>${escapeHTML(member.name)}</span></label>`).join("");
  const radio = partyForm.querySelector(`input[name="mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  partyModal.hidden = false;
  document.body.style.overflow = "hidden";
  partyModal.querySelector("input:checked")?.focus();
}

function closePartyModal() {
  partyModal.hidden = true;
  document.body.style.overflow = "";
  pendingPartyFilmId = null;
  partyModal.querySelector("#party-title").textContent = "Start a watch party";
  partyModal.querySelector(".modal-intro").textContent = "Choose who is here and how tonight's film will be decided.";
  partyForm.querySelector("fieldset:nth-of-type(2)").hidden = false;
  partyForm.querySelector("button[type='submit']").textContent = "Create Watch Party";
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

async function updateActiveMovieSession(patch, session = activeSession) {
  if (!session || !activeGroup) throw new Error("There is no session to update.");
  if (!canManageSession(session)) throw new Error("Only the session host or a website administrator can change this session.");
  if (designPreviewMode) return;

  const { data, error } = await supabase
    .from("movie_sessions")
    .update(patch)
    .eq("id", session.id)
    .eq("group_id", activeGroup.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No session row was updated. Refresh before trying again.");
  applySessionRow(session, data);
  return data;
}

// Keeps the in-memory session honest about what the database actually stored,
// rather than assuming the patch we sent is what landed.
function applySessionRow(session, row) {
  if (!session || !row) return session;
  session.status = row.status;
  session.gameState = row.game_state || {};
  session.confirmedAt = row.confirmed_at;
  session.endedAt = row.ended_at;
  session.hostId = row.host_id || session.hostId;
  session.hostName = members.find((member) => member.id === session.hostId)?.name || session.hostName;
  session.sessionDate = row.watch_date || session.sessionDate;
  session.watchedAt = row.watched_at || null;
  session.journalDraft = row.journal_draft && Object.keys(row.journal_draft).length ? row.journal_draft : null;
  return session;
}

async function persistRouletteState() {
  if (!activeSession) return;
  const gameState = serialiseRouletteState();
  await updateActiveMovieSession({ game_state: gameState });
  activeSession.gameState = gameState;
  persistDesignPreviewWorkspace();
}

async function createMovieSession(participantIds, mode) {
  const selectedMembers = participantIds.map((id) => members.find((member) => member.id === id)).filter(Boolean);
  const memberNames = selectedMembers.map((member) => member.name);
  const candidateCount = movieList.filter((item) => !item.watched).length;
  const directFilm = pendingPartyFilmId ? movieList.find((item) => item.id === pendingPartyFilmId) : null;
  const initialRoulette = mode === "Queue Roulette"
    ? createRouletteState(selectedMembers, { selectionMode: directFilm ? "direct" : "roulette" })
    : null;
  const gameState = initialRoulette ? serialiseRouletteStateValue(initialRoulette) : {};

  if (designPreviewMode) {
    activeSession = {
      id: `preview-session-${Date.now()}`,
      groupId: activeGroup.id,
      createdById: authUser.id,
      hostId: authUser.id,
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
      sessionDate: isoDateOnly(new Date()),
      watchedAt: null,
      journalDraft: null,
    };
    rouletteState = initialRoulette;
    journalSessionId = null;
    if (directFilm) await confirmMovieSession(directFilm);
    persistDesignPreviewWorkspace();
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
  if (directFilm) await confirmMovieSession(directFilm);
}

async function confirmMovieSession(winner) {
  if (!activeSession || !rouletteState) return;
  const previousPhase = rouletteState.phase;
  rouletteState.phase = "confirmed";
  const gameState = serialiseRouletteState();
  try {
    await updateActiveMovieSession({
      status: "CONFIRMED",
      watch_date: activeSession.sessionDate || isoDateOnly(new Date()),
      selected_queue_item_id: winner.id,
      selected_title: winner.title,
      selected_release_year: winner.year || null,
      selected_movie_id: winner.movieId || null,
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
  activeSession.sessionDate = activeSession.sessionDate || isoDateOnly(new Date());
  sessionDetailsEditing = null;
  discordDraft = null;
  persistDesignPreviewWorkspace();
}

async function saveSessionDetails(session, { sessionDate, hostId, participantIds }) {
  if (!session) throw new Error("There is no session to update.");
  if (!canEditSessionDetails(session)) {
    throw new Error("Only the Journal entry creator or a website administrator can change a watched session linked to that entry.");
  }
  const chosen = members.filter((member) => participantIds.includes(member.id));
  if (!chosen.length) throw new Error("Choose at least one participant.");
  const host = members.find((member) => member.id === hostId);
  if (!host) throw new Error("Choose an approved host.");
  if (!isCurrentAdmin() && hostId !== session.hostId) throw new Error("Only a website administrator can transfer the session host.");
  if (!designPreviewMode) {
    // One transaction, so the date and the participant list cannot diverge.
    const { data, error } = await supabase.rpc("save_movie_session_details", {
      p_session_id: session.id,
      p_watch_date: sessionDate,
      p_host_id: hostId,
      p_participant_ids: chosen.map(({ id }) => id),
    });
    if (error) throw error;
    if (!data) throw new Error("The session was not saved. Refresh before trying again.");
    applySessionRow(session, Array.isArray(data) ? data[0] : data);
  }
  session.sessionDate = sessionDate;
  session.hostId = hostId;
  session.hostName = host.name;
  session.participantIds = chosen.map(({ id }) => id);
  session.participants = chosen.map(({ id, name }) => ({ id, name }));
  session.members = chosen.map(({ name }) => name);
  if (session.status === "WATCHED") {
    session.watchedAt = `${sessionDate}T00:00:00.000Z`;
    if (session.journalEntry) session.journalEntry.watchedAt = sessionDate;
    const listedFilm = movieList.find((item) => item.id === session.selectedFilmId);
    if (listedFilm) {
      listedFilm.lastWatchedOn = sessionHistory
        .filter((candidate) => candidate.status === "WATCHED" && candidate.selectedFilmId === session.selectedFilmId)
        .map((candidate) => candidate.sessionDate)
        .filter(Boolean)
        .sort()
        .at(-1) || sessionDate;
    }
  }
  if (session.id === activeSession?.id && rouletteState) {
    rouletteState.participants = session.participants.map(({ id, name }) => ({ id, name }));
    rouletteState.usedVetoes = rouletteState.usedVetoes.filter((id) => session.participantIds.includes(id));
  }
  if (session.journalDraft) {
    session.journalDraft = {
      ...session.journalDraft,
      viewerIds: [...session.participantIds],
      viewers: session.members.join(", "),
    };
  }
  if (discordDraft?.sessionId === session.id) {
    discordDraft = {
      ...discordDraft,
      viewerIds: [...session.participantIds],
      viewers: session.members.join(", "),
    };
  }
  persistDesignPreviewWorkspace();
}

async function deleteMovieSession(session) {
  if (!session || !canManageSession(session)) throw new Error("Only the session host or an administrator can delete this session.");
  if (session.journalEntry) throw new Error("Delete the linked Journal entry before deleting this session.");
  if (designPreviewMode) {
    sessionHistory = sessionHistory.filter((candidate) => candidate.id !== session.id);
    if (activeSession?.id === session.id) activeSession = null;
    sessionDetailsEditing = null;
    persistDesignPreviewWorkspace();
    return;
  }
  const { error } = await supabase.rpc("delete_movie_session", { p_session_id: session.id });
  if (error) throw error;
  await loadWorkspace();
  sessionDetailsEditing = null;
  journalSessionId = null;
}

async function markSessionWatched(session, { sessionDate, hostId, participantIds }) {
  if (!session || session.id !== activeSession?.id) throw new Error("There is no current session to mark watched.");
  const film = selectedFilmForSession(session);
  const chosen = members.filter((member) => participantIds.includes(member.id));
  if (!chosen.length) throw new Error("Choose at least one participant.");
  const host = members.find((member) => member.id === hostId);
  if (!host) throw new Error("Choose an approved host.");
  if (!isCurrentAdmin() && hostId !== session.hostId) throw new Error("Only a website administrator can transfer the session host.");
  // The date the group confirms in the final review, not the moment the button was pressed.
  const watchedOn = sessionDate;
  let watchedAt = `${watchedOn}T00:00:00.000Z`;
  if (!designPreviewMode) {
    // One transaction covers the status, the participants and the queue item, so
    // a host who did not suggest the film cannot leave the two out of step.
    const { data, error } = await supabase.rpc("mark_movie_session_watched", {
      p_session_id: session.id,
      p_watched_on: watchedOn,
      p_host_id: hostId,
      p_participant_ids: chosen.map(({ id }) => id),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The session was not marked watched. Refresh before trying again.");
    applySessionRow(session, row);
    watchedAt = row.watched_at || watchedAt;
  }
  session.sessionDate = watchedOn;
  session.hostId = host.id;
  session.hostName = host.name;
  session.participantIds = chosen.map(({ id }) => id);
  session.participants = chosen.map(({ id, name }) => ({ id, name }));
  session.members = chosen.map(({ name }) => name);
  const watchedSession = { ...session, status: "WATCHED", watchedAt };
  if (film) {
    const listed = movieList.find((item) => item.id === film.id);
    if (listed) {
      listed.watched = true;
      listed.watchCount = (Number.isInteger(listed.watchCount) ? listed.watchCount : 0) + 1;
      listed.lastWatchedOn = watchedOn;
    }
  }
  sessionHistory = [watchedSession, ...sessionHistory];
  activeSession = null;
  rouletteState = null;
  discordDraft = createDiscordDraft(watchedSession, film);
  sessionDetailsEditing = null;
  journalSessionId = watchedSession.id;
  persistDesignPreviewWorkspace();
  return watchedSession;
}

async function endMovieSession() {
  if (!activeSession) return;
  stopRouletteSpin();
  if (!designPreviewMode) {
    await updateActiveMovieSession({ status: "ENDED", game_state: serialiseRouletteState() });
    await loadWorkspace();
  } else {
    activeSession = null;
    rouletteState = null;
    discordDraft = null;
    journalSessionId = null;
    sessionDetailsEditing = null;
    persistDesignPreviewWorkspace();
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

function openFilmModal(item = null, purpose = "shared") {
  filmModalPurpose = purpose;
  filmEditingId = item?.id || null;
  pendingFilmDraft = null;
  filmForm.reset();
  clearFilmMatches();
  if (filmFormEyebrow) filmFormEyebrow.textContent = purpose === "personal" ? "My Cinema · Private" : "Cine-Cord · Shared list";
  filmFormTitle.textContent = item ? "Match movie details" : purpose === "personal" ? "Add to My Cinema" : "Add a film";
  filmFormIntro.textContent = item
    ? "Search for the correct TMDB result to add or refresh its poster, runtime, genres and synopsis."
    : purpose === "personal"
      ? "Search for a film to add privately. It will start in Want to Watch and will not be added to Cine-Cord."
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
  filmModalPurpose = "shared";
  pendingFilmDraft = null;
  filmForm.reset();
  clearFilmMatches();
}

async function fetchPersonalFilms() {
  return settleOptionalQuery(
    supabase
      .from("personal_films")
      .select(PERSONAL_FILM_SELECT)
      .eq("owner_id", authUser.id)
      .order("updated_at", { ascending: false }),
    (rows) => rows.map(normalisePersonalFilm),
  );
}

async function fetchPersonalViewingEvents() {
  return settleOptionalQuery(
    supabase
      .from("personal_viewing_events")
      .select(PERSONAL_VIEWING_EVENT_SELECT)
      .eq("owner_id", authUser.id)
      .order("watched_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    (rows) => rows.map(normalisePersonalViewingEvent),
  );
}

async function fetchPersonalReviews() {
  return settleOptionalQuery(
    supabase
      .from("personal_reviews")
      .select(PERSONAL_REVIEW_SELECT)
      .eq("owner_id", authUser.id)
      .order("updated_at", { ascending: false }),
    (rows) => rows.map(normalisePersonalReview),
  );
}

async function fetchPublishedReviews() {
  return settleOptionalQuery(
    supabase
      .from("published_reviews")
      .select(PUBLISHED_REVIEW_SELECT)
      .order("published_at", { ascending: false }),
    (rows) => rows.map(normalisePublishedReview),
  );
}

async function fetchMemberProfiles(groupId) {
  return settleOptionalQuery(
    supabase.rpc("get_member_profiles", { p_group_id: groupId }),
    (rows) => aggregateMemberProfileRows(rows),
  );
}

async function fetchMemberProfileDraft(groupId) {
  try {
    const result = await supabase
      .from("member_profile_drafts")
      .select("group_id,owner_id,introduction,banner_movie_id,include_recent_watches,include_genre_breakdown,member_profile_draft_films(slot,movie_id)")
      .eq("group_id", groupId)
      .eq("owner_id", authUser.id)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    return { data: result.data ? normaliseMemberProfileDraft(result.data) : null, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function applyPersonalFilmsResult(result) {
  personalFilms = result.data;
  personalFilmsLoadError = Boolean(result.error);
  if (result.error) console.warn("My Cinema data could not be loaded.", result.error);
}

function applyPersonalViewingEventsResult(result) {
  personalViewingEvents = result.data;
  personalViewingEventsLoadError = Boolean(result.error);
  if (result.error) console.warn("Private viewing history could not be loaded.", result.error);
}

function applyPersonalReviewsResult(result) {
  personalReviews = result.data;
  personalReviewsLoadError = Boolean(result.error);
  if (result.error) console.warn("Private reviews could not be loaded.", result.error);
}

function applyPublishedReviewsResult(result) {
  publishedReviews = result.data;
  publishedReviewsLoadError = Boolean(result.error);
  if (result.error) console.warn("Published reviews could not be loaded.", result.error);
}

function applyMemberProfilesResult(result) {
  memberProfiles = result.data || [];
  memberProfilesLoadError = Boolean(result.error);
  if (result.error) console.warn("Member Profiles could not be loaded.", result.error);
}

function applyMemberProfileDraftResult(result) {
  memberProfileDraft = result.data || emptyMemberProfileDraft();
  memberProfileDraftSaved = Boolean(result.data);
  if (result.error) console.warn("Member Profile draft could not be loaded.", result.error);
}

async function retryPersonalFilms() {
  if (designPreviewMode) {
    personalFilmsLoadError = designPreviewPersonalFilmsError;
    return !personalFilmsLoadError;
  }
  const result = await fetchPersonalFilms();
  applyPersonalFilmsResult(result);
  return !result.error;
}

async function retryPersonalViewingEvents() {
  if (viewingEventsRetrying) return false;
  viewingEventsRetrying = true;
  render();
  try {
    if (designPreviewMode) {
      personalViewingEventsLoadError = designPreviewViewingHistoryError;
      return !personalViewingEventsLoadError;
    }
    const result = await fetchPersonalViewingEvents();
    applyPersonalViewingEventsResult(result);
    return !result.error;
  } finally {
    viewingEventsRetrying = false;
  }
}

async function retryReviews() {
  if (designPreviewMode) {
    personalReviewsLoadError = false;
    publishedReviewsLoadError = false;
    return true;
  }
  const [privateResult, publishedResult] = await Promise.all([fetchPersonalReviews(), fetchPublishedReviews()]);
  applyPersonalReviewsResult(privateResult);
  applyPublishedReviewsResult(publishedResult);
  return !privateResult.error && !publishedResult.error;
}

async function loadWorkspace(providerToken = null) {
  const { data: groups, error: groupError } = await supabase.from("groups").select("id,name,slug").eq("slug", "the-discordians").limit(1);
  if (groupError) throw groupError;
  availableGroup = groups?.[0] || null;
  activeGroup = null;
  currentProfile = null;
  members = [];
  accessRequest = null;
  joinRequests = [];
  movieList = [];
  personalFilms = [];
  personalFilmsLoadError = false;
  personalViewingEvents = [];
  personalViewingEventsLoadError = false;
  personalReviews = [];
  publishedReviews = [];
  personalReviewsLoadError = false;
  publishedReviewsLoadError = false;
  memberProfiles = [];
  memberProfilesLoadError = false;
  memberProfileDraft = emptyMemberProfileDraft();
  memberProfileDraftSaved = false;
  memberProfileBusy = false;
  selectedProfileId = null;
  reviewEditorOpen = false;
  reviewPendingAction = "";
  reviewLiveMessage = "";
  viewingEventsRetrying = false;
  viewingEventEditorId = null;
  viewingEventPendingId = null;
  viewingEventLiveMessage = "";
  activeSession = null;
  sessionHistory = [];
  journalCatalog = [];
  rouletteState = null;
  discordDraft = null;
  journalSessionId = null;
  sessionDetailsEditing = null;
  journalPublishPendingId = null;
  journalEditingId = null;
  journalSyncPendingId = null;
  journalFocusedEntryId = null;
  journalReconciliationRows = null;
  journalReconciliationBusy = false;
  journalReconciliationMatchBusy = false;
  journalReconciliationError = "";
  journalReconciliationCandidates = new Map();
  journalReconciliationQuery = "";
  journalReconciliationStatusFilter = "all";
  journalReconciliationVisibleLimit = 24;
  journalReconciliationReviewBusyId = null;
  journalBulkPreview = null;
  journalBulkBusy = false;
  journalBulkSelectedIds = new Set();
  journalBulkError = "";
  journalTriagePreview = null;
  journalTriageBusy = false;
  journalTriageError = "";
  journalTriageCategory = "SUGGESTED";
  journalTriageVisibleLimit = 24;
  journalTriageApprovedIds = new Set();
  journalTriageSkippedIds = new Set();
  journalTriageManualIds = new Set();
  if (!availableGroup) return;

  const [selfProfileResult, selfMembershipResult, selfRequestResult, selfDiscordIdentityResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name").eq("id", authUser.id).maybeSingle(),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle(),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle(),
    supabase.from("discord_identities").select("profile_id,display_name,avatar_url,synced_at").eq("profile_id", authUser.id).maybeSingle(),
  ]);
  const accessError = [selfProfileResult.error, selfMembershipResult.error, selfRequestResult.error, selfDiscordIdentityResult.error].find(Boolean);
  if (accessError) throw accessError;
  currentProfile = { id: authUser.id, displayName: selfProfileResult.data?.display_name || preferredAuthDisplayName(authUser), role: selfMembershipResult.data?.role || null };
  accessRequest = selfRequestResult.data || null;
  if (!selfMembershipResult.data) return;

  activeGroup = availableGroup;
  if (providerToken && (discordProfileSyncRequested || !selfDiscordIdentityResult.data)) {
    try {
      const identity = await syncDiscordServerProfile(providerToken);
      discordProfileSyncNotice = `The Discordians profile refreshed as ${identity.displayName}.`;
    } catch (error) {
      discordProfileSyncError = error.message;
    }
  }
  const personalFilmsPromise = fetchPersonalFilms();
  const personalViewingEventsPromise = fetchPersonalViewingEvents();
  const personalReviewsPromise = fetchPersonalReviews();
  const publishedReviewsPromise = fetchPublishedReviews();
  const memberProfilesPromise = fetchMemberProfiles(activeGroup.id);
  const memberProfileDraftPromise = fetchMemberProfileDraft(activeGroup.id);
  const [profilesResult, membershipsResult, identitiesResult, queueResult, votesResult, requestsResult, currentSessionResult, watchedSessionsResult, participantsResult, watchedResult, journalResult, entryViewersResult, publicationsResult, catalogRows] = await Promise.all([
    supabase.from("profiles").select("id,display_name"),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", activeGroup.id),
    supabase.from("discord_identities").select("profile_id,display_name,avatar_url,synced_at"),
    supabase.from("queue_items").select("*").eq("group_id", activeGroup.id).order("created_at", { ascending: true }),
    supabase.from("queue_votes").select("queue_item_id,user_id,created_at"),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", activeGroup.id).order("created_at", { ascending: true }),
    supabase.from("movie_sessions").select("*").eq("group_id", activeGroup.id).in("status", ["ACTIVE", "CONFIRMED"]).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("movie_sessions").select("*").eq("group_id", activeGroup.id).eq("status", "WATCHED").order("watch_date", { ascending: false }).order("started_at", { ascending: false }).limit(20),
    supabase.from("movie_session_participants").select("session_id,profile_id,display_name_snapshot,added_at").order("added_at", { ascending: true }),
    supabase.rpc("group_watch_counts", { p_group_id: activeGroup.id }),
    supabase.from("journal_entries").select("*").eq("group_id", activeGroup.id).order("watched_at", { ascending: false }),
    supabase.from("entry_viewers").select("entry_id,profile_id"),
    supabase.from("discord_publications").select("*"),
    fetchAllJournalCatalog(activeGroup.id),
  ]);
  const firstError = [profilesResult.error, membershipsResult.error, identitiesResult.error, queueResult.error, votesResult.error, requestsResult.error, currentSessionResult.error, watchedSessionsResult.error, participantsResult.error, watchedResult.error, journalResult.error, entryViewersResult.error, publicationsResult.error].find(Boolean);
  if (firstError) throw firstError;
  applyPersonalFilmsResult(await personalFilmsPromise);
  applyPersonalViewingEventsResult(await personalViewingEventsPromise);
  applyPersonalReviewsResult(await personalReviewsPromise);
  applyPublishedReviewsResult(await publishedReviewsPromise);
  applyMemberProfilesResult(await memberProfilesPromise);
  applyMemberProfileDraftResult(await memberProfileDraftPromise);

  const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  const discordIdentityMap = new Map((identitiesResult.data || []).map((identity) => [identity.profile_id, identity]));
  const selfDiscordIdentity = discordIdentityMap.get(authUser.id);
  currentProfile = {
    id: authUser.id,
    displayName: profileMap.get(authUser.id)?.display_name || currentProfile.displayName,
    discordServerDisplayName: selfDiscordIdentity?.display_name || null,
    discordServerAvatar: selfDiscordIdentity?.avatar_url || null,
    discordServerProfileSyncedAt: selfDiscordIdentity?.synced_at || null,
    role: selfMembershipResult.data.role,
  };
  members = (membershipsResult.data || []).map((membership) => {
    const name = profileMap.get(membership.user_id)?.display_name || "Discordian";
    const identity = discordIdentityMap.get(membership.user_id);
    return { id: membership.user_id, name, discordServerName: identity?.display_name || null, role: membership.role, avatar: identity?.avatar_url || avatarForName(name) };
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
    const suggestedBy = profileMap.get(item.suggested_by)?.display_name || "Former member";
    const suggestedByIdentity = discordIdentityMap.get(item.suggested_by);
    return {
      id: item.id,
      title: item.title,
      year: item.release_year,
      suggestedById: item.suggested_by,
      suggestedBy,
      suggestedByAvatar: suggestedByIdentity?.avatar_url || avatarForName(suggestedBy),
      watched: item.watched,
      createdAt: item.created_at,
      votes: voters.length,
      votedByMe: voters.includes(authUser.id),
      posterUrl,
      posterPath: item.poster_path || null,
      movieId: item.movie_id || null,
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
  const viewerIdsByEntry = new Map();
  for (const viewer of entryViewersResult.data || []) {
    const current = viewerIdsByEntry.get(viewer.entry_id) || [];
    current.push(viewer.profile_id);
    viewerIdsByEntry.set(viewer.entry_id, current);
  }
  const publicationByEntry = new Map((publicationsResult.data || []).map((publication) => [publication.journal_entry_id, publication]));
  journalCatalog = (catalogRows || []).map((row) => normaliseJournalCatalogRow(row, viewerIdsByEntry, publicationByEntry));
  for (const catalogEntry of journalCatalog) {
    if (catalogEntry.publication) catalogEntry.publication.discord_out_of_date = catalogEntry.discordOutOfDate;
  }
  const journalBySession = new Map((journalResult.data || [])
    .filter((entry) => entry.movie_session_id)
    .map((entry) => [entry.movie_session_id, {
      id: entry.id,
      entryNumber: entry.entry_number,
      title: entry.title,
      year: entry.release_year,
      watchedAt: entry.watched_at,
      status: entry.status,
      comment: entry.comment || "",
      createdById: entry.created_by,
      viewerIds: viewerIdsByEntry.get(entry.id) || [],
      viewerNames: (viewerIdsByEntry.get(entry.id) || []).map((id) => profileMap.get(id)?.display_name || "Former member"),
      updatedAt: entry.updated_at,
      publication: publicationByEntry.get(entry.id) || null,
    }]));
  const sessionRows = [
    ...(currentSessionResult.data ? [currentSessionResult.data] : []),
    ...(watchedSessionsResult.data || []),
  ];
  const sessions = sessionRows.map((session) => {
    const participants = participantsBySession.get(session.id) || [];
    const selectedFromList = movieList.find((item) => item.id === session.selected_queue_item_id);
    const selectedFilm = selectedFromList || (session.selected_title ? {
      id: session.selected_queue_item_id || `session-${session.id}`,
      title: session.selected_title,
      year: session.selected_release_year,
      movieId: session.selected_movie_id || null,
      tmdbId: session.selected_tmdb_id,
      posterPath: session.selected_poster_path,
      posterUrl: session.selected_poster_path ? tmdbPoster(session.selected_poster_path) : null,
      runtime: Number(session.selected_runtime_minutes) || null,
      genres: normaliseGenres(session.selected_genres),
      overview: session.selected_overview || "",
      watched: false,
      createdAt: session.started_at,
    } : null);
    const journalEntry = journalBySession.get(session.id) || null;
    return {
      id: session.id,
      groupId: session.group_id,
      createdById: session.created_by,
      hostId: session.host_id,
      hostName: profileMap.get(session.host_id)?.display_name || "Former member",
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
      sessionDate: session.watch_date || isoDateOnly(session.started_at),
      watchedAt: session.watched_at || null,
      journalDraft: session.journal_draft && Object.keys(session.journal_draft).length ? session.journal_draft : null,
      journalEntry,
      journalPublication: journalEntry?.publication || null,
    };
  });
  // A film's viewing count is the number of watched sessions that chose it, so
  // sessions stay the single source of truth rather than a counter that drifts.
  // Rows are matched by queue item first, then by the snapshot the session kept,
  // so a film deleted from the list does not lose the viewings it already has.
  const watchRows = watchedResult.data || [];
  for (const item of movieList) {
    const matchedRows = watchRows.filter((row) => {
      const sameItem = row.queue_item_id && row.queue_item_id === item.id;
      const sameTmdb = !row.queue_item_id && row.tmdb_id && item.tmdbId && Number(row.tmdb_id) === Number(item.tmdbId);
      const sameTitle = !row.queue_item_id && !row.tmdb_id
        && String(row.title || "").trim().toLowerCase() === String(item.title || "").trim().toLowerCase()
        && Number(row.release_year || 0) === Number(item.year || 0);
      return sameItem || sameTmdb || sameTitle;
    });
    item.watchCount = matchedRows.reduce((total, row) => total + (Number(row.watch_count) || 0), 0);
    item.lastWatchedOn = matchedRows
      .map((row) => row.last_watched_on)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  }
  activeSession = currentSessionResult.data
    ? sessions.find((session) => session.id === currentSessionResult.data.id) || null
    : null;
  sessionHistory = sessions.filter((session) => session.status === "WATCHED");
  if (activeSession?.mode === "Queue Roulette") rouletteState = restoreRouletteState(activeSession);
  const selectedCollection = currentView === "my-films" ? personalFilms : movieList;
  if (selectedFilmId && !selectedCollection.some((item) => item.id === selectedFilmId)) selectedFilmId = null;
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
  personalFilms = [];
  personalFilmsLoadError = false;
  personalViewingEvents = [];
  personalViewingEventsLoadError = false;
  personalReviews = [];
  publishedReviews = [];
  personalReviewsLoadError = false;
  publishedReviewsLoadError = false;
  reviewEditorOpen = false;
  reviewPendingAction = "";
  reviewLiveMessage = "";
  viewingEventsRetrying = false;
  viewingEventEditorId = null;
  viewingEventPendingId = null;
  viewingEventLiveMessage = "";
  activeSession = null;
  sessionHistory = [];
  journalCatalog = [];
  rouletteState = null;
  discordDraft = null;
  journalSessionId = null;
  sessionDetailsEditing = null;
  journalPublishPendingId = null;
  journalEditingId = null;
  journalSyncPendingId = null;
  journalFocusedEntryId = null;
  discordProfileSyncError = "";
  discordProfileSyncNotice = "";
  selectedFilmId = null;
  selectedProfileId = null;
  clearJournalDraftSaveTimer();
  render();
  if (authUser) {
    try { await loadWorkspace(session?.provider_token || null); }
    catch (error) { showToast(`Could not load The List: ${error.message}`); }
  }
  isLoading = false;
  render();
  if (discordProfileSyncError) showToast(`Discord server profile was not refreshed: ${discordProfileSyncError}`);
  else if (discordProfileSyncNotice) showToast(discordProfileSyncNotice);
}

window.addEventListener("beforeunload", () => {
  if (!discordDraft) return;
  flushJournalDraftSave().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && discordDraft) flushJournalDraftSave().catch(() => {});
  if (document.visibilityState === "visible") refreshPersonalCinema({ rerender: currentView === "my-films" }).catch(() => {});
});

document.addEventListener("focusout", (event) => {
  if (!event.target.closest("#discord-template-form") || !event.target.matches("input, textarea, select")) return;
  if (event.relatedTarget?.closest?.("[data-save-journal-draft], button[type='submit']")) return;
  flushJournalDraftSave().catch(() => {});
});

document.addEventListener("pointerover", (event) => {
  if (event.pointerType === "touch") return;
  const choice = event.target.closest?.("[data-reaction-choice]");
  if (!choice || choice.contains(event.relatedTarget)) return;
  previewReactionChoice(choice);
});

document.addEventListener("pointerout", (event) => {
  if (event.pointerType === "touch") return;
  const choice = event.target.closest?.("[data-reaction-choice]");
  if (!choice || choice.contains(event.relatedTarget)) return;
  const control = choice.closest(".reaction-control");
  const nextChoice = event.relatedTarget?.closest?.("[data-reaction-choice]");
  if (nextChoice?.closest(".reaction-control") === control) {
    previewReactionChoice(nextChoice);
    return;
  }
  const focusedChoice = control?.querySelector("[data-reaction-choice]:focus");
  if (focusedChoice) previewReactionChoice(focusedChoice);
  else restoreReactionLabel(control);
});

document.addEventListener("focusin", (event) => {
  const choice = event.target.closest?.("[data-reaction-choice]");
  if (choice) previewReactionChoice(choice);
});

document.addEventListener("focusout", (event) => {
  const choice = event.target.closest?.("[data-reaction-choice]");
  if (!choice) return;
  const control = choice.closest(".reaction-control");
  const nextChoice = event.relatedTarget?.closest?.("[data-reaction-choice]");
  if (nextChoice?.closest(".reaction-control") === control) {
    previewReactionChoice(nextChoice);
    return;
  }
  const hoveredChoice = activeReactionPreview(control);
  if (hoveredChoice) previewReactionChoice(hoveredChoice);
  else restoreReactionLabel(control);
});

document.addEventListener("change", (event) => {
  const bannerSelect = event.target.closest?.("[data-profile-banner-select]");
  if (!bannerSelect) return;
  const form = bannerSelect.closest("[data-member-profile-form]");
  const fallbackMovieId = String(new FormData(form).get("movie_1") || "");
  const selected = profileMovieForId(String(bannerSelect.value || fallbackMovieId));
  const preview = form.querySelector(".member-profile-banner-preview");
  if (!preview) return;
  preview.innerHTML = selected
    ? `<img src="${escapeHTML(selected.backdropUrl || selected.posterUrl || imageAssets.journalFallback)}" alt="" data-profile-banner-preview-image /><span data-profile-banner-preview-title>${escapeHTML(selected.title)}</span>`
    : `<span class="material-symbols-outlined" aria-hidden="true">panorama</span><span data-profile-banner-preview-title>Select a Top Five film</span>`;
});

document.addEventListener("submit", async (event) => {
  const memberProfileEditor = event.target.closest("[data-member-profile-form]");
  if (memberProfileEditor) {
    event.preventDefault();
    if (!memberProfileEditor.reportValidity() || memberProfileBusy) return;
    const form = new FormData(memberProfileEditor);
    const movieIds = Array.from({ length: 5 }, (_, index) => String(form.get(`movie_${index + 1}`) || "")).filter(Boolean);
    if (new Set(movieIds).size !== movieIds.length) {
      showToast("Choose each Top Five film only once.");
      return;
    }
    const action = event.submitter?.value === "publish" ? "publish" : "draft";
    if (action === "publish" && movieIds.length === 0) {
      showToast("Choose at least one Top Five film before publishing.");
      return;
    }
    const requestedBannerMovieId = String(form.get("banner_movie_id") || "");
    const bannerMovieId = requestedBannerMovieId || movieIds[0] || null;
    if (bannerMovieId && !movieIds.includes(bannerMovieId)) {
      showToast("Choose a banner film that is also in your Top Five.");
      return;
    }
    const includeRecentWatches = form.has("include_recent_watches");
    const includeGenreBreakdown = form.has("include_genre_breakdown");
    memberProfileBusy = true;
    render();
    try {
      const introduction = String(form.get("introduction") || "").trim();
      const nextDraft = { introduction, movieIds, bannerMovieId, includeRecentWatches, includeGenreBreakdown };
      if (designPreviewMode) {
        memberProfileDraft = nextDraft;
        memberProfileDraftSaved = true;
        if (action === "publish") {
          const nextProfile = buildPreviewMemberProfilePublication(nextDraft);
          memberProfiles = [...memberProfiles.filter((profile) => profile.ownerId !== authUser.id), nextProfile];
        }
        persistDesignPreviewWorkspace();
      } else {
        const { error: draftError } = await supabase.rpc("save_member_profile_draft", {
          p_group_id: activeGroup.id,
          p_introduction: introduction,
          p_movie_ids: movieIds,
          p_banner_movie_id: bannerMovieId,
          p_include_recent_watches: includeRecentWatches,
          p_include_genre_breakdown: includeGenreBreakdown,
        });
        if (draftError) throw draftError;
        memberProfileDraft = nextDraft;
        memberProfileDraftSaved = true;
        if (action === "publish") {
          const { error: publishError } = await supabase.rpc("publish_member_profile", { p_group_id: activeGroup.id });
          if (publishError) throw publishError;
          applyMemberProfilesResult(await fetchMemberProfiles(activeGroup.id));
        }
      }
      memberProfileBusy = false;
      if (action === "publish") {
        navigate("profile", authUser.id);
      } else {
        render();
      }
      showToast(action === "publish" ? "Your profile is now visible to approved Cine-Cord members." : "Your profile draft was saved privately.");
    } catch (error) {
      memberProfileBusy = false;
      render();
      showToast(`Your profile was not ${action === "publish" ? "published" : "saved"}: ${error.message}`);
    }
    return;
  }

  const reviewEditor = event.target.closest("[data-personal-review-form]");
  if (reviewEditor) {
    event.preventDefault();
    if (!reviewEditor.reportValidity()) return;
    const context = selectedFilmContext();
    if (!context?.movie?.movieId) return;
    const existing = personalReviewForMovie(context.movie.movieId);
    const form = new FormData(reviewEditor);
    const action = event.submitter?.value === "publish" ? "publish" : "save";
    reviewPendingAction = action;
    render();
    try {
      const saved = await savePersonalReview(context.movie, existing, {
        body: String(form.get("body") || ""),
        containsSpoilers: form.get("contains_spoilers") === "on",
      });
      if (action === "publish") await publishPersonalReview(saved, context.movie);
      reviewPendingAction = "";
      reviewEditorOpen = false;
      reviewLiveMessage = action === "publish" ? "Review published to approved Cine-Cord members." : "Private review saved.";
      render();
      window.requestAnimationFrame(() => document.querySelector("#personal-review-title")?.focus({ preventScroll: true }));
      showToast(action === "publish" ? "Review published to Cine-Cord. A rating was included only if you have one." : "Review saved privately. Any published version was left unchanged.");
    } catch (error) {
      reviewPendingAction = "";
      render();
      showToast(`The review was not ${action === "publish" ? "published" : "saved"}: ${error.message}`);
    }
    return;
  }

  const viewingEventEditor = event.target.closest("[data-viewing-event-form]");
  if (viewingEventEditor) {
    event.preventDefault();
    if (!viewingEventEditor.reportValidity()) return;
    const context = selectedFilmContext();
    if (!context?.movie?.movieId || !context.personal) return;
    const eventId = viewingEventEditor.dataset.viewingEventId;
    const existing = eventId ? personalViewingEvents.find((candidate) => candidate.id === eventId) : null;
    if (eventId && (!existing || existing.sourceJournalEntryId)) return;
    const form = new FormData(viewingEventEditor);
    const pendingId = existing?.id || "new";
    const submit = viewingEventEditor.querySelector("[type=submit]");
    viewingEventPendingId = pendingId;
    submit.disabled = true;
    try {
      const saved = await saveManualViewingEvent(context.movie, existing, {
        outcome: String(form.get("outcome") || ""),
        watchedOn: String(form.get("watched_on") || "") || null,
      });
      viewingEventPendingId = null;
      viewingEventEditorId = null;
      viewingEventLiveMessage = `${viewingOutcomeLabel(saved.outcome)} viewing saved${saved.watchedOn ? ` for ${formatSavedDate(saved.watchedOn)}` : " without a date"}.`;
      render();
      window.requestAnimationFrame(() => document.querySelector(`[data-viewing-event-row="${CSS.escape(saved.id)}"]`)?.focus({ preventScroll: true }));
      showToast(existing ? "Manual viewing updated. Your current film state and Cine-Cord were not changed." : "Manual viewing added privately. Your current film state and Cine-Cord were not changed.");
    } catch (error) {
      viewingEventPendingId = null;
      submit.disabled = false;
      showToast(`The viewing event was not saved: ${error.message}`);
    }
    return;
  }

  const journalEditor = event.target.closest("[data-journal-entry-form]");
  if (journalEditor) {
    event.preventDefault();
    if (!journalEditor.reportValidity()) return;
    const submit = journalEditor.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const entryNumber = new FormData(journalEditor).get("entry_number");
      await saveCatalogJournalEntry(journalEditor);
      journalEditingId = null;
      if (!designPreviewMode) await loadWorkspace();
      render();
      showToast(`Journal entry #${entryNumber} saved. Any existing Discord copy is now marked out of date.`);
    } catch (error) {
      submit.disabled = false;
      showToast(`The Journal entry was not saved: ${error.message}`);
    }
    return;
  }

  if (event.target.matches("#session-details-form")) {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const form = new FormData(event.target);
    const session = sessionForId(String(form.get("session_id") || ""));
    const intent = String(form.get("intent") || "save");
    const submit = event.target.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const details = {
        sessionDate: String(form.get("watch_date")),
        hostId: String(form.get("host_id")),
        participantIds: form.getAll("participant").map(String),
      };
      if (intent === "watch") {
        const watched = await markSessionWatched(session, details);
        currentView = "sessions";
        window.history.replaceState(null, "", "#sessions");
        sessionDetailsEditing = null;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
        showToast(`${watched.selectedFilm?.title || "The film"} is marked watched. The optional Journal is ready now or later.`);
        return;
      }
      await saveSessionDetails(session, details);
      sessionDetailsEditing = null;
      render();
      showToast("Session details saved.");
    } catch (error) {
      console.error("Session details update failed", error);
      submit.disabled = false;
      showToast(`Session details were not saved: ${error.message}`);
    }
    return;
  }
  if (event.target.matches("#discord-template-form")) {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const form = new FormData(event.target);
    const session = journalSession();
    discordDraft = {
      sessionId: session?.id || discordDraft?.sessionId || null,
      entryNumber: String(form.get("entry_number") || "").trim(),
      title: String(form.get("title")).trim(),
      year: String(form.get("year")).trim(),
      viewerIds: [...(session?.journalEntry?.viewerIds || session?.participantIds || [])],
      viewers: session?.journalEntry?.viewerNames?.join(", ") || session?.members.join(", ") || "",
      runtime: Number(selectedFilmForSession(session)?.runtime) || null,
      genres: normaliseGenres(selectedFilmForSession(session)?.genres),
      status: String(form.get("status")) === "DNF" ? "DNF" : "Finished",
      comment: String(form.get("comment")).trim(),
    };
    const submit = event.target.querySelector("button[type=submit]");
    if (submit) submit.disabled = true;
    try {
      clearJournalDraftSaveTimer();
      const preview = event.target.querySelector("#discord-template-preview");
      const savedDraft = await saveJournalEntry(session, discordDraft);
      const entryField = event.target.querySelector("[name=entry_number]");
      if (entryField) entryField.value = savedDraft.entryNumber;
      if (preview) preview.value = buildDiscordTemplate(savedDraft);
      const copied = await copyJournalToClipboard(savedDraft, preview);
      showToast(copied
        ? `Journal entry #${savedDraft.entryNumber} saved and copied. Nothing was posted automatically.`
        : `Journal entry #${savedDraft.entryNumber} was saved. Automatic copy was blocked; use Copy for Discord from the saved entry.`);
      await moveSavedSessionToJournal(session);
    } catch (error) {
      showToast(`The Journal entry was not saved: ${error.message}`);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }

  if (event.target.matches("[data-journal-reconciliation-filter-form]")) {
    event.preventDefault();
    const form = new FormData(event.target);
    journalReconciliationQuery = String(form.get("query") || "").trim();
    journalReconciliationStatusFilter = String(form.get("status") || "all");
    journalReconciliationVisibleLimit = 24;
    render();
    return;
  }

  if (event.target.matches("[data-reconciliation-review-form]")) {
    event.preventDefault();
    await saveJournalReconciliationReview(event.target, "APPROVED");
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
        setFilmSearchStatus(filmModalPurpose === "personal" ? "No matching films were found. Try a broader title." : "No matching films were found. Try a broader title or add it without artwork.", "warning");
        filmManualAdd.hidden = Boolean(filmEditingId) || filmModalPurpose === "personal";
      }
    } catch (error) {
      setFilmSearchStatus(filmModalPurpose === "personal" ? error.message : `${error.message} You can still keep the website list usable without artwork.`, "warning");
      filmManualAdd.hidden = Boolean(filmEditingId) || filmModalPurpose === "personal";
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
  const areaButton = event.target.closest("[data-nav-area-toggle]");
  if (areaButton && !areaButton.disabled) { navigate(areaButton.dataset.defaultView); return; }
  const editMemberProfile = event.target.closest("[data-edit-member-profile]");
  if (editMemberProfile) {
    navigate("profile-edit");
    return;
  }
  const unpublishMemberProfile = event.target.closest("[data-unpublish-member-profile]");
  if (unpublishMemberProfile) {
    if (!window.confirm("Unpublish your profile? Your private draft will be kept.")) return;
    memberProfileBusy = true;
    render();
    try {
      if (designPreviewMode) {
        memberProfiles = memberProfiles.filter((profile) => profile.ownerId !== authUser.id);
      } else {
        const { error } = await supabase.rpc("unpublish_member_profile", { p_group_id: activeGroup.id });
        if (error) throw error;
        applyMemberProfilesResult(await fetchMemberProfiles(activeGroup.id));
      }
      memberProfileBusy = false;
      if (designPreviewMode) persistDesignPreviewWorkspace();
      render();
      showToast("Your profile is private again. The draft is still saved.");
    } catch (error) {
      memberProfileBusy = false;
      render();
      showToast(`The profile was not unpublished: ${error.message}`);
    }
    return;
  }
  const retryMemberProfiles = event.target.closest("[data-retry-member-profiles]");
  if (retryMemberProfiles) {
    if (designPreviewMode) return;
    applyMemberProfilesResult(await fetchMemberProfiles(activeGroup.id));
    render();
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { navigate(viewButton.dataset.view, viewButton.dataset.profileId || null); return; }
  if (event.target.closest("[data-toggle-auth-mode]")) { authMode = authMode === "signin" ? "signup" : "signin"; render(); return; }
  const discordButton = event.target.closest("[data-auth-discord]");
  if (discordButton) {
    if (!discordAuthEnabled) return;
    discordButton.disabled = true;
    discordButton.querySelector("strong").textContent = "Opening Discord…";
    requestDiscordProfileSync();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: discordOAuthOptions(window.location),
    });
    if (error) {
      clearDiscordProfileSyncRequest();
      discordButton.disabled = false;
      discordButton.querySelector("strong").textContent = "Continue with Discord";
      showToast(`Discord sign-in could not start: ${error.message}`);
    }
    return;
  }
  const refreshDiscordProfileButton = event.target.closest("[data-refresh-discord-profile]");
  if (refreshDiscordProfileButton) {
    if (designPreviewMode) {
      showToast("This preview uses test Discord server-profile data; no Discord account was contacted.");
      return;
    }
    if (!discordAuthEnabled) {
      showToast("Discord sign-in is not currently enabled.");
      return;
    }
    refreshDiscordProfileButton.disabled = true;
    requestDiscordProfileSync();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: discordOAuthOptions(window.location, { forceConsent: true }),
    });
    if (error) {
      clearDiscordProfileSyncRequest();
      refreshDiscordProfileButton.disabled = false;
      showToast(`Discord profile refresh could not start: ${error.message}`);
    }
    return;
  }
  if (event.target.closest("[data-nav='list']")) { event.preventDefault(); navigate("list"); return; }
  if (event.target.closest("[data-sign-out]")) { await supabase.auth.signOut(); await syncSession(null); showToast("Signed out of Cine-Cord."); return; }

  const editJournalButton = event.target.closest("[data-edit-journal-entry]");
  if (editJournalButton) {
    const entry = journalCatalog.find((candidate) => candidate.journalEntryId === editJournalButton.dataset.editJournalEntry);
    if (!entry?.canEdit || entry.sourceType !== "CINE_CORD" || !entry.journalEntryId) return;
    journalEditingId = entry.journalEntryId;
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-journal-entry-form] [name=title]")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-cancel-journal-edit]")) {
    journalEditingId = null;
    render();
    return;
  }
  const deleteJournalButton = event.target.closest("[data-delete-journal-entry]");
  if (deleteJournalButton) {
    const entry = journalCatalog.find((candidate) => candidate.journalEntryId === deleteJournalButton.dataset.deleteJournalEntry);
    openJournalDeleteModal(entry, deleteJournalButton);
    return;
  }
  if (event.target.closest("[data-close-journal-delete]") || event.target === journalDeleteModal) {
    closeJournalDeleteModal();
    return;
  }
  if (event.target.closest("[data-confirm-journal-delete]")) {
    const entry = journalCatalog.find((candidate) => candidate.journalEntryId === journalDeleteModal.dataset.entryId);
    if (!entry?.canEdit || journalDeletePendingId) return;
    const entryLabel = entry.entryLabel;
    const hadDiscordMessage = journalEntryHasDiscordMessage(entry);
    journalDeletePendingId = entry.journalEntryId;
    journalDeleteConfirm.disabled = true;
    journalDeleteConfirm.querySelector("span:last-child").textContent = hadDiscordMessage ? "Deleting entry and Discord post…" : "Deleting entry…";
    journalDeleteError.hidden = true;
    try {
      await deleteCatalogJournalEntry(entry);
      journalDeletePendingId = null;
      closeJournalDeleteModal({ restoreFocus: false });
      journalEditingId = null;
      if (!designPreviewMode) {
        try {
          await loadWorkspace();
        } catch (refreshError) {
          removeDeletedJournalEntryFromLocalState(entry);
          render();
          showToast(`Journal entry #${entryLabel} was deleted, but the workspace could not refresh: ${refreshError.message}`);
          return;
        }
      }
      render();
      showToast(hadDiscordMessage
        ? `Journal entry #${entryLabel} and its Discord post were deleted.`
        : `Journal entry #${entryLabel} was deleted.`);
    } catch (error) {
      journalDeletePendingId = null;
      journalDeleteConfirm.disabled = false;
      journalDeleteConfirm.querySelector("span:last-child").textContent = hadDiscordMessage ? "Delete entry and Discord post" : "Delete entry";
      journalDeleteError.textContent = error.message;
      journalDeleteError.hidden = false;
      showToast(`Journal entry was not deleted: ${error.message}`);
    }
    return;
  }
  const copyCatalogButton = event.target.closest("[data-copy-journal-entry]");
  if (copyCatalogButton) {
    const entry = journalCatalog.find((candidate) => candidate.catalogId === copyCatalogButton.dataset.copyJournalEntry);
    if (!entry || entry.sourceType !== "CINE_CORD") return;
    const copied = await copyJournalToClipboard(journalDraftForCatalogEntry(entry));
    showToast(copied ? "Journal post copied. Nothing was posted automatically." : "Automatic copy was blocked by the browser.");
    return;
  }
  const catalogDiscordButton = event.target.closest("[data-post-catalog-journal], [data-update-catalog-journal]");
  if (catalogDiscordButton) {
    const entryId = catalogDiscordButton.dataset.postCatalogJournal || catalogDiscordButton.dataset.updateCatalogJournal;
    const entry = journalCatalog.find((candidate) => candidate.journalEntryId === entryId);
    const action = catalogDiscordButton.hasAttribute("data-update-catalog-journal") ? "update" : "publish";
    if (!entry?.canEdit) return;
    const question = action === "update"
      ? `Update the existing Discord message for Journal entry #${entry.entryLabel}? No duplicate will be created.`
      : `Post Journal entry #${entry.entryLabel} to the configured Discord Journal channel?`;
    if (!window.confirm(question)) return;
    journalSyncPendingId = entry.journalEntryId;
    render();
    try {
      await syncCatalogJournalToDiscord(entry, action);
      showToast(action === "update"
        ? `Discord post for Journal entry #${entry.entryLabel} updated without creating a duplicate.`
        : `Journal entry #${entry.entryLabel} posted to Discord.`);
    } catch (error) {
      if (action === "update") {
        entry.discordOutOfDate = true;
        entry.publication = { ...(entry.publication || {}), status: "UPDATE_FAILED", last_error: error.message };
      }
      showToast(`Discord was not ${action === "update" ? "updated" : "posted to"}: ${error.message}`);
    } finally {
      journalSyncPendingId = null;
      render();
    }
    return;
  }
  if (event.target.closest("[data-clear-journal-filters]")) {
    journalQuery = "";
    journalSourceFilter = "all";
    journalStatusFilter = "all";
    journalYearFilter = "all";
    journalViewerFilter = "all";
    journalVisibleLimit = 60;
    render();
    return;
  }
  if (event.target.closest("[data-show-more-journal]")) {
    journalVisibleLimit += 60;
    render();
    return;
  }

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
  if (event.target.closest("[data-refresh-journal-reconciliation]")) {
    await refreshJournalReconciliation();
    return;
  }
  if (event.target.closest("[data-discover-journal-reconciliation]")) {
    await discoverJournalReconciliationMatches();
    return;
  }
  if (event.target.closest("[data-preview-journal-triage]")) {
    await previewJournalTriage();
    return;
  }
  if (event.target.closest("[data-apply-journal-triage]")) {
    await applyJournalTriage();
    return;
  }
  if (event.target.closest("[data-apply-journal-manual]")) {
    await applyJournalManualApprovals();
    return;
  }
  const triageCategoryButton = event.target.closest("[data-triage-category]");
  if (triageCategoryButton) {
    journalTriageCategory = triageCategoryButton.dataset.triageCategory;
    journalTriageVisibleLimit = 24;
    render();
    return;
  }
  if (event.target.closest("[data-triage-select-visible]")) {
    const visible = (journalTriagePreview?.proposals || []).filter((row) => row.category === "SUGGESTED").slice(0, journalTriageVisibleLimit);
    visible.forEach((row) => journalTriageApprovedIds.add(row.archive_entry_id));
    render();
    return;
  }
  if (event.target.closest("[data-triage-select-manual]")) {
    const visible = (journalTriagePreview?.proposals || []).filter((row) => row.category === "MANUAL").slice(0, journalTriageVisibleLimit);
    visible.filter((row) => !journalManualApprovalIssue(row) && !journalTriageManualIds.has(row.archive_entry_id))
      .slice(0, Math.max(0, 100 - journalTriageManualIds.size)).forEach((row) => {
        journalTriageManualIds.add(row.archive_entry_id);
        journalTriageSkippedIds.delete(row.archive_entry_id);
      });
    render();
    return;
  }
  if (event.target.closest("[data-triage-select-next]")) {
    const manualRows = (journalTriagePreview?.proposals || []).filter((row) => row.category === "MANUAL");
    const available = manualRows.filter((row) => !journalManualApprovalIssue(row) && !journalTriageManualIds.has(row.archive_entry_id));
    available.slice(0, Math.max(0, 100 - journalTriageManualIds.size)).forEach((row) => {
      journalTriageManualIds.add(row.archive_entry_id);
      journalTriageSkippedIds.delete(row.archive_entry_id);
    });
    const lastSelectedPosition = manualRows.reduce((last, row, index) => journalTriageManualIds.has(row.archive_entry_id) ? index + 1 : last, 0);
    journalTriageVisibleLimit = Math.max(journalTriageVisibleLimit, lastSelectedPosition);
    render();
    return;
  }
  if (event.target.closest("[data-triage-clear]")) {
    journalTriageApprovedIds = new Set();
    journalTriageSkippedIds = new Set();
    journalTriageManualIds = new Set();
    render();
    return;
  }
  if (event.target.closest("[data-triage-more]")) {
    journalTriageVisibleLimit += 24;
    render();
    return;
  }
  const triageOpenButton = event.target.closest("[data-triage-open]");
  if (triageOpenButton) {
    openJournalTriageEntry(triageOpenButton.dataset.triageOpen);
    return;
  }
  if (event.target.closest("[data-preview-journal-bulk]")) {
    await previewJournalBulkApproval();
    return;
  }
  if (event.target.closest("[data-apply-journal-bulk]")) {
    await applyJournalBulkApproval();
    return;
  }
  if (event.target.closest("[data-select-all-journal-bulk]")) {
    journalBulkSelectedIds = new Set((journalBulkPreview?.proposals || []).map((proposal) => proposal.archive_entry_id));
    render();
    return;
  }
  if (event.target.closest("[data-clear-journal-bulk]")) {
    journalBulkSelectedIds = new Set();
    render();
    return;
  }
  if (event.target.closest("[data-apply-journal-reconciliation]")) {
    await applyJournalReconciliation();
    return;
  }
  if (event.target.closest("[data-show-more-journal-reconciliation]")) {
    journalReconciliationVisibleLimit += 24;
    render();
    return;
  }
  const reconciliationSearchButton = event.target.closest("[data-reconciliation-search-movie]");
  if (reconciliationSearchButton) {
    await searchJournalReconciliationMovie(reconciliationSearchButton.closest("[data-reconciliation-review-form]"));
    return;
  }
  const reconciliationMovieButton = event.target.closest("[data-reconciliation-select-movie]");
  if (reconciliationMovieButton) {
    await selectJournalReconciliationMovie(reconciliationMovieButton);
    return;
  }
  const reconciliationSkipButton = event.target.closest("[data-reconciliation-skip]");
  if (reconciliationSkipButton) {
    await saveJournalReconciliationReview(reconciliationSkipButton.closest("[data-reconciliation-review-form]"), "SKIPPED");
    return;
  }
  const publishHubButton = event.target.closest("[data-publish-cine-cord-hub]");
  if (publishHubButton) {
    if (!isCurrentAdmin() || !activeGroup?.id) return;
    publishHubButton.disabled = true;
    try {
      const { data, error } = await supabase.functions.invoke("publish-cine-cord-hub", { body: { groupId: activeGroup.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      showToast(data?.updated ? "The Cine-Cord Discord hub was updated." : "The Cine-Cord Discord hub was published.");
      if (data?.messageUrl) window.open(data.messageUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast(`The Cine-Cord Discord hub was not published: ${error.message}`);
    } finally {
      publishHubButton.disabled = false;
    }
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
  const reassignRemoveButton = event.target.closest("[data-reassign-remove-member]");
  if (reassignRemoveButton) {
    const member = members.find((candidate) => candidate.id === reassignRemoveButton.dataset.reassignRemoveMember);
    if (!member || member.id === authUser?.id) return;
    if (!window.confirm(`Move every shared Cine-Cord film currently attributed to ${member.name} to your account, then remove their Cine-Cord access? Their private data will not be deleted.`)) return;
    reassignRemoveButton.disabled = true;
    const { data, error } = await supabase.rpc("reassign_shared_films_and_remove_member", { p_group_id: activeGroup.id, p_old_user_id: member.id });
    if (error) { reassignRemoveButton.disabled = false; showToast(`The legacy account was not repaired: ${error.message}`); return; }
    await loadWorkspace();
    render();
    showToast(`${Number(data) || 0} shared film${Number(data) === 1 ? "" : "s"} moved. ${member.name}'s Cine-Cord access was removed.`);
    return;
  }

  const retryPersonalFilmsButton = event.target.closest("[data-retry-personal-films]");
  if (retryPersonalFilmsButton) {
    retryPersonalFilmsButton.disabled = true;
    const loaded = await retryPersonalFilms();
    render();
    showToast(loaded ? "My Cinema is available again." : "My Cinema still couldn’t load. The shared Cine-Cord pages remain available.");
    return;
  }
  if (event.target.closest("[data-open-film]")) { openFilmModal(); return; }
  if (event.target.closest("[data-open-personal-film]")) { openFilmModal(null, "personal"); return; }
  if (event.target.closest("[data-close-film]") || event.target === filmModal) { closeFilmModal(); return; }
  if (event.target.closest("[data-open-party]")) { openPartyModal(); return; }
  if (event.target.closest("[data-close-modal]") || event.target === partyModal) { closePartyModal(); return; }

  const watchNowButton = event.target.closest("[data-watch-now]");
  if (watchNowButton) {
    const item = movieList.find((candidate) => candidate.id === watchNowButton.dataset.watchNow);
    if (item) openPartyModal("Queue Roulette", item);
    return;
  }

  const filterButton = event.target.closest("[data-list-filter]");
  if (filterButton) { listFilter = filterButton.dataset.listFilter; render(); return; }
  const myFilmsFilterButton = event.target.closest("[data-my-films-filter]");
  if (myFilmsFilterButton) { myFilmsFilter = myFilmsFilterButton.dataset.myFilmsFilter; render(); return; }
  if (event.target.closest("[data-toggle-list-filters]")) {
    listFiltersOpen = !listFiltersOpen;
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-toggle-list-filters]")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-toggle-my-films-filters]")) {
    myFilmsFiltersOpen = !myFilmsFiltersOpen;
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-toggle-my-films-filters]")?.focus({ preventScroll: true }));
    return;
  }

  const retryReviewsButton = event.target.closest("[data-retry-reviews]");
  if (retryReviewsButton) {
    retryReviewsButton.disabled = true;
    const loaded = await retryReviews();
    render();
    showToast(loaded ? "Reviews loaded." : "Reviews are still unavailable. The rest of the film page is unchanged.");
    return;
  }

  const selectFilmButton = event.target.closest("[data-select-film]");
  if (selectFilmButton) {
    filmDetailReturnScrollY = window.scrollY;
    selectedFilmId = selectFilmButton.dataset.selectFilm;
    reactionEditorExpanded = false;
    reactionLiveMessage = "";
    viewingEventEditorId = null;
    viewingEventPendingId = null;
    viewingEventLiveMessage = "";
    reviewEditorOpen = false;
    reviewPendingAction = "";
    reviewLiveMessage = "";
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => document.querySelector(".film-detail-view")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-close-film-details]")) {
    const previousFilmId = selectedFilmId;
    selectedFilmId = null;
    reactionEditorExpanded = false;
    reactionLiveMessage = "";
    viewingEventEditorId = null;
    viewingEventPendingId = null;
    viewingEventLiveMessage = "";
    reviewEditorOpen = false;
    reviewPendingAction = "";
    reviewLiveMessage = "";
    render();
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: filmDetailReturnScrollY, behavior: "auto" });
      document.querySelector(`[data-select-film="${CSS.escape(previousFilmId || "")}"]`)?.focus({ preventScroll: true });
    });
    return;
  }

  const detailAreaButton = event.target.closest("[data-open-detail-area]");
  if (detailAreaButton) {
    const context = selectedFilmContext();
    const destination = detailAreaButton.dataset.openDetailArea;
    const destinationFilm = destination === "my-films" ? context?.personal : context?.shared;
    if (!destinationFilm) return;
    currentView = destination;
    selectedFilmId = destinationFilm.id;
    reactionEditorExpanded = false;
    viewingEventEditorId = null;
    viewingEventPendingId = null;
    viewingEventLiveMessage = "";
    reviewEditorOpen = false;
    reviewPendingAction = "";
    reviewLiveMessage = "";
    window.history.replaceState(null, "", `#${destination}`);
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => document.querySelector(".film-detail-view")?.focus({ preventScroll: true }));
    return;
  }

  const retryViewingHistoryButton = event.target.closest("[data-retry-viewing-history]");
  if (retryViewingHistoryButton) {
    retryViewingHistoryButton.disabled = true;
    const loaded = await retryPersonalViewingEvents();
    render();
    window.requestAnimationFrame(() => document.querySelector("#viewing-history-title")?.focus({ preventScroll: true }));
    showToast(loaded ? "Viewing history loaded." : "Viewing history is still unavailable. Your other private film details are unchanged.");
    return;
  }

  if (event.target.closest("[data-write-personal-review], [data-edit-personal-review]")) {
    reviewEditorOpen = true;
    reviewLiveMessage = "";
    render();
    window.requestAnimationFrame(() => document.querySelector("#personal-review-body")?.focus({ preventScroll: true }));
    return;
  }

  if (event.target.closest("[data-cancel-review-editor]")) {
    reviewEditorOpen = false;
    reviewPendingAction = "";
    render();
    window.requestAnimationFrame(() => document.querySelector("#personal-review-title")?.focus({ preventScroll: true }));
    return;
  }

  if (event.target.closest("[data-publish-personal-review]")) {
    const context = selectedFilmContext();
    const review = personalReviewForMovie(context?.movie?.movieId);
    if (!context?.movie || !review) return;
    reviewPendingAction = "publish";
    render();
    try {
      await publishPersonalReview(review, context.movie);
      reviewPendingAction = "";
      reviewLiveMessage = "Review published to approved Cine-Cord members.";
      render();
      showToast("Review published to Cine-Cord. A rating was included only if you have one.");
    } catch (error) {
      reviewPendingAction = "";
      render();
      showToast(`The review was not published: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-unpublish-personal-review]")) {
    const context = selectedFilmContext();
    const review = personalReviewForMovie(context?.movie?.movieId);
    if (!review) return;
    reviewPendingAction = "unpublish";
    render();
    try {
      await unpublishPersonalReview(review);
      reviewPendingAction = "";
      reviewLiveMessage = "Review unpublished. The private draft was kept.";
      render();
      showToast("Review unpublished. Your private draft was kept.");
    } catch (error) {
      reviewPendingAction = "";
      render();
      showToast(`The review was not unpublished: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-delete-personal-review]")) {
    const context = selectedFilmContext();
    const review = personalReviewForMovie(context?.movie?.movieId);
    if (!review || !window.confirm("Delete this review? Its private draft and any published copy will be removed.")) return;
    reviewPendingAction = "delete";
    render();
    try {
      await deletePersonalReview(review);
      reviewPendingAction = "";
      reviewEditorOpen = false;
      reviewLiveMessage = "Review deleted.";
      render();
      showToast("Review deleted. Any published copy was removed too.");
    } catch (error) {
      reviewPendingAction = "";
      render();
      showToast(`The review was not deleted: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-add-viewing-event]")) {
    viewingEventEditorId = "new";
    viewingEventLiveMessage = "";
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-viewing-event-form] select")?.focus({ preventScroll: true }));
    return;
  }

  if (event.target.closest("[data-cancel-viewing-event]")) {
    const previousEditorId = viewingEventEditorId;
    viewingEventEditorId = null;
    render();
    window.requestAnimationFrame(() => {
      const target = previousEditorId === "new"
        ? document.querySelector("[data-add-viewing-event]")
        : document.querySelector(`[data-viewing-event-row="${CSS.escape(previousEditorId || "")}"]`);
      target?.focus({ preventScroll: true });
    });
    return;
  }

  const editViewingEventButton = event.target.closest("[data-edit-viewing-event]");
  if (editViewingEventButton) {
    const viewingEvent = personalViewingEvents.find((candidate) => candidate.id === editViewingEventButton.dataset.editViewingEvent);
    if (!viewingEvent || viewingEvent.sourceJournalEntryId) return;
    viewingEventEditorId = viewingEvent.id;
    viewingEventLiveMessage = "";
    render();
    window.requestAnimationFrame(() => document.querySelector("[data-viewing-event-form] select")?.focus({ preventScroll: true }));
    return;
  }

  const deleteViewingEventButton = event.target.closest("[data-delete-viewing-event]");
  if (deleteViewingEventButton) {
    const viewingEvent = personalViewingEvents.find((candidate) => candidate.id === deleteViewingEventButton.dataset.deleteViewingEvent);
    if (!viewingEvent || viewingEvent.sourceJournalEntryId) return;
    const dateLabel = viewingEvent.watchedOn ? formatSavedDate(viewingEvent.watchedOn) : "an unknown date";
    if (!window.confirm(`Delete the manual ${viewingOutcomeLabel(viewingEvent.outcome)} viewing from ${dateLabel}? This cannot be undone. Cine-Cord and the Journal will not be changed.`)) return;
    viewingEventPendingId = viewingEvent.id;
    render();
    try {
      await deleteManualViewingEvent(viewingEvent);
      viewingEventPendingId = null;
      viewingEventEditorId = null;
      viewingEventLiveMessage = "Manual viewing deleted. Cine-Cord and the Journal were not changed.";
      render();
      window.requestAnimationFrame(() => document.querySelector("#viewing-history-title")?.focus({ preventScroll: true }));
      showToast("Manual viewing deleted. Cine-Cord and the Journal were not changed.");
    } catch (error) {
      viewingEventPendingId = null;
      render();
      showToast(`The manual viewing was not deleted: ${error.message}`);
    }
    return;
  }

  const toggleViewingEventButton = event.target.closest("[data-toggle-viewing-event-hidden]");
  if (toggleViewingEventButton) {
    const viewingEvent = personalViewingEvents.find((candidate) => candidate.id === toggleViewingEventButton.dataset.toggleViewingEventHidden);
    if (!viewingEvent?.sourceJournalEntryId) return;
    viewingEventPendingId = viewingEvent.id;
    render();
    try {
      const saved = await setSourceViewingEventHidden(viewingEvent, !viewingEvent.isHidden);
      viewingEventPendingId = null;
      viewingEventLiveMessage = saved.isHidden
        ? "Source-linked viewing hidden from normal My Cinema history. The Journal was not changed."
        : "Source-linked viewing revealed in My Cinema. The Journal was not changed.";
      render();
      window.requestAnimationFrame(() => {
        const target = saved.isHidden ? document.querySelector("#viewing-history-title") : document.querySelector(`[data-viewing-event-row="${CSS.escape(saved.id)}"]`);
        target?.focus({ preventScroll: true });
      });
      showToast(saved.isHidden ? "Hidden from normal My Cinema history. The shared Journal entry was not changed." : "Revealed in My Cinema. The shared Journal entry was not changed.");
    } catch (error) {
      viewingEventPendingId = null;
      render();
      showToast(`The source-linked viewing was not changed: ${error.message}`);
    }
    return;
  }

  const sourceJournalButton = event.target.closest("[data-open-source-journal]");
  if (sourceJournalButton) {
    const viewingEvent = personalViewingEvents.find((candidate) => candidate.id === sourceJournalButton.dataset.openSourceJournal);
    const sourceEntry = journalEntryForViewingEvent(viewingEvent);
    if (!sourceEntry?.journalEntryId) {
      showToast("The current Journal source is not available in this workspace. Refresh before trying again.");
      return;
    }
    journalQuery = sourceEntry.entryLabel;
    journalSourceFilter = "CINE_CORD";
    journalStatusFilter = "all";
    journalYearFilter = "all";
    journalViewerFilter = "all";
    journalVisibleLimit = 60;
    journalFocusedEntryId = sourceEntry.journalEntryId;
    journalEditingId = sourceEntry.canEdit ? sourceEntry.journalEntryId : null;
    navigate("journal");
    window.requestAnimationFrame(() => {
      const target = document.querySelector(`[data-journal-entry-id="${CSS.escape(sourceEntry.journalEntryId)}"]`);
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      target?.focus({ preventScroll: true });
    });
    if (!sourceEntry.canEdit) showToast("This is the shared source. Its recorder or an administrator can correct it.");
    return;
  }

  if (event.target.closest("[data-open-reaction]")) {
    reactionEditorExpanded = true;
    render();
    window.requestAnimationFrame(() => document.querySelector("#reaction-question")?.focus({ preventScroll: true }));
    return;
  }
  const personalStateButton = event.target.closest("[data-personal-state]");
  if (personalStateButton) {
    const context = selectedFilmContext();
    if (!context?.movie?.movieId) return;
    const previousRating = context.personal?.rating;
    personalStateButton.disabled = true;
    try {
      await savePersonalFilm(context.movie, { state: personalStateButton.dataset.personalState });
      reactionLiveMessage = "";
      render();
      window.requestAnimationFrame(() => document.querySelector(`[data-personal-state="${personalStateButton.dataset.personalState}"]`)?.focus({ preventScroll: true }));
      const cleared = Boolean(previousRating) && personalStateButton.dataset.personalState === "WANT_TO_WATCH";
      showToast(`${context.movie.title} is ${personalStateLabel(personalStateButton.dataset.personalState)} in My Cinema.${cleared ? " Its reaction was cleared." : ""}`);
    } catch (error) {
      personalStateButton.disabled = false;
      showToast(`Private state was not saved: ${error.message}`);
    }
    return;
  }

  const reactionButton = event.target.closest("[data-reaction-choice]");
  if (reactionButton) {
    const context = selectedFilmContext();
    if (!context?.movie?.movieId) return;
    reactionButton.disabled = true;
    const reaction = reactionForValue(reactionButton.dataset.reactionValue);
    try {
      await savePersonalFilm(context.movie, { rating: reaction.value });
      reactionEditorExpanded = true;
      const markedWatched = context.personal?.state !== "WATCHED" && context.personal?.state !== "DID_NOT_FINISH";
      reactionLiveMessage = `Saved, ${reaction.label}.${markedWatched ? " Marked as Watched in My Cinema." : ""}`;
      render();
      if (markedWatched) showToast("Rating saved. Marked as Watched in My Cinema.");
      window.requestAnimationFrame(() => document.querySelector(`[data-reaction-choice][data-reaction-value="${reaction.value}"]`)?.focus({ preventScroll: true }));
    } catch (error) {
      reactionButton.disabled = false;
      showToast(`Reaction was not saved: ${error.message}`);
    }
    return;
  }

  const favouriteButton = event.target.closest("[data-toggle-favourite]");
  if (favouriteButton) {
    const context = selectedFilmContext();
    if (!context?.personal) return;
    favouriteButton.disabled = true;
    try {
      const saved = await savePersonalFilm(context.movie, { isFavourite: !context.personal.isFavourite });
      render();
      window.requestAnimationFrame(() => document.querySelector("[data-toggle-favourite]")?.focus({ preventScroll: true }));
      showToast(`${context.movie.title} ${saved.isFavourite ? "marked as a Favourite" : "removed from Favourites"}.`);
    } catch (error) {
      favouriteButton.disabled = false;
      showToast(`Favourite was not changed: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-clear-reaction]")) {
    const context = selectedFilmContext();
    if (!context?.personal?.rating) return;
    try {
      await savePersonalFilm(context.movie, { rating: null });
      reactionEditorExpanded = false;
      reactionLiveMessage = "Reaction cleared. Film state and Favourite unchanged.";
      render();
      window.requestAnimationFrame(() => document.querySelector("#reaction-question")?.focus({ preventScroll: true }));
      showToast(`Reaction cleared for ${context.movie.title}. Its state and Favourite were not changed.`);
    } catch (error) {
      showToast(`Reaction was not cleared: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-remove-personal-film]")) {
    const context = selectedFilmContext();
    if (!context?.personal || !window.confirm(`Remove ${context.movie.title} from My Cinema? Your viewing history is kept. This does not change Cine-Cord or the Journal.`)) return;
    try {
      await removePersonalFilm(context.movie);
      if (currentView === "my-films") selectedFilmId = null;
      reactionEditorExpanded = false;
      render();
      showToast(`${context.movie.title} removed from My Cinema. Viewing history was kept; Cine-Cord and the Journal were not changed.`);
    } catch (error) {
      showToast(`The film was not removed from My Cinema: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-suggest-personal-film]")) {
    const context = selectedFilmContext();
    if (!context?.movie) return;
    try {
      await suggestPersonalFilm(context.movie);
      render();
      showToast(`${context.movie.title} suggested for Cine-Cord. Your private state and reaction remain private.`);
    } catch (error) {
      showToast(`The film was not suggested: ${error.message}`);
    }
    return;
  }

  if (event.target.closest("[data-open-current-session]")) { navigate(activeSession?.mode === "Queue Roulette" && !isDirectWatchSession() ? "pick" : "sessions"); return; }

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
      if (filmModalPurpose === "personal") {
        const existingPersonalFilm = findFilmByIdentity(personalFilms, movie);
        const saved = existingPersonalFilm || await savePersonalFilm(movie, { state: "WANT_TO_WATCH" });
        closeFilmModal();
        currentView = "my-films";
        selectedFilmId = saved.id;
        reactionEditorExpanded = false;
        window.history.replaceState(null, "", "#my-films");
        render();
        showToast(existingPersonalFilm ? `${saved.title} is already in My Cinema.` : `${saved.title} added privately to Want to Watch.`);
        return;
      }
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
    if (!pendingFilmDraft || filmEditingId || filmModalPurpose === "personal") return;
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

  const voteButton = event.target.closest("[data-vote]");
  if (voteButton) {
    const item = movieList.find((candidate) => candidate.id === voteButton.dataset.vote);
    if (!item || item.watched) return;
    voteButton.disabled = true;
    if (designPreviewMode) {
      item.votes = Math.max(0, item.votes + (item.votedByMe ? -1 : 1));
      item.votedByMe = !item.votedByMe;
      persistDesignPreviewWorkspace();
      render();
      showToast(item.votedByMe ? `Vote added for ${item.title}.` : `Vote removed from ${item.title}.`);
      return;
    }
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
  const sessionDiscordButton = event.target.closest("[data-post-journal], [data-update-journal]");
  if (sessionDiscordButton) {
    const button = sessionDiscordButton;
    const form = document.querySelector("#discord-template-form");
    const session = journalSession();
    const action = button.hasAttribute("data-update-journal") ? "update" : "publish";
    if (!form || !session || !canManageJournalEntry(session.journalEntry, session) || !form.reportValidity()) return;
    updateDiscordDraftPreview(form);
    const title = selectedFilmForSession(session)?.title || discordDraft?.title || "this film";
    const question = action === "update"
      ? `Update the existing Discord Journal message for ${title}? This will not create a new post.`
      : `Post the saved Journal entry for ${title} to the configured Discord Journal channel?`;
    if (!window.confirm(question)) return;
    button.disabled = true;
    if (action === "update") journalSyncPendingId = session.journalEntry.id;
    else journalPublishPendingId = session.id;
    let journalSaved = false;
    try {
      clearJournalDraftSaveTimer();
      const savedDraft = await saveJournalEntry(session, discordDraft);
      journalSaved = true;
      discordDraft = savedDraft;
      await publishJournalToDiscord(session, action);
      showToast(action === "update"
        ? `Discord post for Journal entry #${savedDraft.entryNumber} updated without creating a duplicate.`
        : `Journal entry #${savedDraft.entryNumber} posted to Discord.`);
    } catch (error) {
      if (session.journalEntry && (action === "update" || session.journalPublication?.status !== "POSTED")) {
        const uncertain = /delivery (?:is |could not be )?uncertain|could not be confirmed|retry is blocked/i.test(error.message);
        session.journalPublication = {
          ...(session.journalPublication || {}),
          journal_entry_id: session.journalEntry.id,
          status: action === "update" ? "UPDATE_FAILED" : uncertain ? "UNKNOWN" : "FAILED",
          discord_out_of_date: action === "update" || Boolean(session.journalPublication?.discord_out_of_date),
          last_error: error.message,
        };
      }
      showToast(journalSaved
        ? `The Journal was saved, but Discord was not ${action === "update" ? "updated" : "posted to"}: ${error.message}`
        : `The Journal entry was not saved or posted: ${error.message}`);
    } finally {
      journalPublishPendingId = null;
      journalSyncPendingId = null;
      if (journalSaved) await moveSavedSessionToJournal(session);
      else {
        persistDesignPreviewWorkspace();
        render();
      }
    }
    return;
  }
  if (event.target.closest("[data-save-journal-draft]")) {
    const button = event.target.closest("[data-save-journal-draft]");
    const form = document.querySelector("#discord-template-form");
    if (form) updateDiscordDraftPreview(form);
    button.disabled = true;
    try {
      clearJournalDraftSaveTimer();
      await saveJournalDraft();
      showToast("Journal draft saved. Nothing was posted to Discord.");
    } catch (error) {
      showToast(`The Journal draft was not saved: ${error.message}`);
    }
    button.disabled = false;
    return;
  }
  const journalButton = event.target.closest("[data-open-journal]");
  if (journalButton) {
    journalSessionId = journalButton.dataset.openJournal;
    const session = journalSession();
    if (!session || (!canManageJournalEntry(session.journalEntry, session) && !canManageSession(session) && !session.journalEntry)) return;
    discordDraft = session?.journalDraft ? { ...session.journalDraft, sessionId: session.id } : null;
    render();
    window.requestAnimationFrame(() => document.querySelector("#discord-copy-title")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return;
  }
  if (event.target.closest("[data-copy-saved-journal]")) {
    const session = journalSession();
    if (!session?.journalEntry) return;
    const draft = ensureDiscordDraft(session, selectedFilmForSession(session));
    const preview = document.querySelector("#discord-template-preview");
    const copied = await copyJournalToClipboard(draft, preview);
    showToast(copied ? "Journal post copied. Nothing was posted automatically." : "Automatic copy was blocked. The Journal post is selected for manual copying.");
    return;
  }
  const editSessionButton = event.target.closest("[data-edit-session-details]");
  if (editSessionButton) {
    const session = sessionForId(editSessionButton.dataset.editSessionDetails);
    if (!canEditSessionDetails(session)) return;
    journalSessionId = null;
    sessionDetailsEditing = { sessionId: session.id, mode: "edit" };
    render();
    window.requestAnimationFrame(() => document.querySelector("#session-details-form [name=watch_date]")?.focus({ preventScroll: true }));
    return;
  }
  if (event.target.closest("[data-cancel-session-edit]")) {
    sessionDetailsEditing = null;
    render();
    return;
  }
  const deleteSessionButton = event.target.closest("[data-delete-session]");
  if (deleteSessionButton) {
    const session = sessionForId(deleteSessionButton.dataset.deleteSession);
    if (!session || session.journalEntry || !canManageSession(session)) return;
    const filmTitle = session.selectedFilm?.title || "this movie session";
    if (!window.confirm(`Delete the ${filmTitle} session? This removes the session and its derived private viewing events. This cannot be undone.`)) return;
    deleteSessionButton.disabled = true;
    try {
      await deleteMovieSession(session);
      render();
      showToast("Movie session deleted.");
    } catch (error) {
      deleteSessionButton.disabled = false;
      showToast(`The movie session was not deleted: ${error.message}`);
    }
    return;
  }
  const reviewWatchedButton = event.target.closest("[data-review-session-watched]");
  if (reviewWatchedButton) {
    const session = sessionForId(reviewWatchedButton.dataset.reviewSessionWatched);
    if (!canManageSession(session) || session?.status !== "CONFIRMED") return;
    journalSessionId = null;
    sessionDetailsEditing = { sessionId: session.id, mode: "watch" };
    render();
    window.requestAnimationFrame(() => document.querySelector("#session-details-form [name=watch_date]")?.focus({ preventScroll: true }));
    return;
  }
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
  if (event.target.closest("[data-continue-roulette]")) { navigate(activeSession?.mode === "Queue Roulette" ? "pick" : "sessions"); return; }
  if (event.target.closest("[data-close-roulette]")) {
    navigate("sessions");
    return;
  }
  if (event.target.closest("[data-end-session]")) {
    if (!canManageSession() || !window.confirm("Cancel this movie-night session? It will disappear from the normal session list.")) return;
    try { await endMovieSession(); render(); showToast("Session cancelled. Discord was not changed."); }
    catch (error) { showToast(`The session was not cancelled: ${error.message}`); }
  }
});

document.addEventListener("input", (event) => {
  const form = event.target.closest("#discord-template-form");
  if (form) updateDiscordDraftPreview(form);
  if (event.target.matches("#personal-review-body")) {
    const counter = event.target.closest("[data-personal-review-form]")?.querySelector("[data-review-character-count]");
    if (counter) counter.textContent = String(event.target.value.length);
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-triage-approve], [data-triage-skip], [data-triage-manual]")) {
    const id = event.target.value;
    const attribute = event.target.matches("[data-triage-approve]") ? "data-triage-approve" : event.target.matches("[data-triage-manual]") ? "data-triage-manual" : "data-triage-skip";
    const targetSet = attribute === "data-triage-approve" ? journalTriageApprovedIds : attribute === "data-triage-manual" ? journalTriageManualIds : journalTriageSkippedIds;
    if (event.target.checked) {
      targetSet.add(id);
      if (attribute === "data-triage-manual") journalTriageSkippedIds.delete(id);
      if (attribute === "data-triage-skip") journalTriageManualIds.delete(id);
    } else targetSet.delete(id);
    render();
    root.querySelector(`[value="${CSS.escape(id)}"][${attribute}]`)?.focus();
    return;
  }
  if (event.target.matches("[data-select-journal-bulk]")) {
    if (event.target.checked) journalBulkSelectedIds.add(event.target.value);
    else journalBulkSelectedIds.delete(event.target.value);
    render();
    root.querySelector(`[data-select-journal-bulk][value="${CSS.escape(event.target.value)}"]`)?.focus();
    return;
  }
  const discordForm = event.target.closest("#discord-template-form");
  if (discordForm) { updateDiscordDraftPreview(discordForm); return; }
  if (event.target.matches("#journal-source-filter, #journal-year-filter, #journal-status-filter, #journal-viewer-filter")) {
    if (event.target.matches("#journal-source-filter")) journalSourceFilter = event.target.value;
    if (event.target.matches("#journal-year-filter")) journalYearFilter = event.target.value;
    if (event.target.matches("#journal-status-filter")) journalStatusFilter = event.target.value;
    if (event.target.matches("#journal-viewer-filter")) journalViewerFilter = event.target.value;
    journalVisibleLimit = 60;
    render();
    return;
  }
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
  const directFilm = pendingPartyFilmId ? movieList.find((item) => item.id === pendingPartyFilmId) : null;
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
    navigate(directFilm ? "sessions" : mode === "Queue Roulette" ? "pick" : "sessions");
    showToast(directFilm ? `${directFilm.title} session created for ${selectedMemberIds.length} people.` : `${mode} session created and saved for ${selectedMemberIds.length} people.`);
  } catch (error) {
    showToast(`The session was not created: ${error.message}`);
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  const reactionChoice = event.target.closest?.("[data-reaction-choice]");
  if (reactionChoice && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    const choices = [...reactionChoice.closest("[role='group']").querySelectorAll("[data-reaction-choice]")];
    const currentIndex = choices.indexOf(reactionChoice);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.length - 1
        : Math.min(choices.length - 1, Math.max(0, currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1)));
    event.preventDefault();
    choices[nextIndex]?.focus();
    return;
  }
  const navDestination = event.target.closest?.(".nav-destinations .nav-item");
  if (navDestination && window.matchMedia("(max-width: 860px)").matches && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    const destinations = [...navDestination.closest(".nav-destinations").querySelectorAll(".nav-item:not(:disabled)")];
    const currentIndex = destinations.indexOf(navDestination);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? destinations.length - 1
        : Math.min(destinations.length - 1, Math.max(0, currentIndex + (event.key === "ArrowRight" ? 1 : -1)));
    event.preventDefault();
    destinations[nextIndex]?.focus();
    destinations[nextIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  if (event.key !== "Escape") return;
  if (!journalDeleteModal.hidden) { closeJournalDeleteModal(); return; }
  if (selectedFilmId) {
    selectedFilmId = null;
    reactionEditorExpanded = false;
    reactionLiveMessage = "";
    viewingEventEditorId = null;
    viewingEventPendingId = null;
    viewingEventLiveMessage = "";
    render();
    window.requestAnimationFrame(() => window.scrollTo({ top: filmDetailReturnScrollY, behavior: "auto" }));
    return;
  }
  if (!partyModal.hidden) closePartyModal();
  if (!filmModal.hidden) closeFilmModal();
});

window.addEventListener("hashchange", () => {
  const route = routeFromHash();
  const nextView = route.view;
  if (nextView && nextView !== currentView && authUser && activeGroup) {
    currentView = nextView;
    selectedProfileId = route.profileId;
    selectedFilmId = null;
    reactionEditorExpanded = false;
    viewingEventEditorId = null;
    viewingEventPendingId = null;
    viewingEventLiveMessage = "";
    if (currentView !== "journal") journalFocusedEntryId = null;
    render();
  } else if (nextView === "profile" && authUser && activeGroup) {
    selectedProfileId = route.profileId;
    render();
  }
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
