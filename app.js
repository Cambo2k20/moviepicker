import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tbmxxdodprmynyiiaofj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D-ZMbt0ttcYPHEDtghl7AQ_wstwsoti";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

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
let listFilter = "ready";
let listSort = "votes";
let authMode = "signin";
let isLoading = true;
let toastTimer;

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
    const matchesQuery = !query || [item.title, item.year, item.suggestedBy].join(" ").toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  }).sort((a, b) => {
    if (listSort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (listSort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
    if (b.votes !== a.votes) return b.votes - a.votes;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

function renderFilmRow(item, rank) {
  return `
    <article class="film-row ${item.watched ? "is-watched" : ""}">
      <span class="film-rank">${String(rank).padStart(2, "0")}</span>
      <div class="film-identity">
        <div class="film-title-line"><h3>${escapeHTML(item.title)}</h3>${item.year ? `<span class="film-year">${item.year}</span>` : ""}<span class="status-pill ${item.watched ? "watched" : "ready"}">${item.watched ? "Watched" : "Ready"}</span></div>
        <p>Suggested by <strong>${escapeHTML(item.suggestedBy)}</strong> <span>·</span> ${escapeHTML(formatWaitingTime(item.createdAt))}</p>
      </div>
      <div class="film-votes" aria-label="${item.votes} votes"><strong>${item.votes}</strong><span>${item.votes === 1 ? "vote" : "votes"}</span></div>
      <div class="film-actions">
        <button class="vote-button ${item.votedByMe ? "is-voted" : ""}" type="button" data-vote="${item.id}" ${item.watched ? "disabled" : ""} aria-label="${item.votedByMe ? "Remove vote from" : "Vote for"} ${escapeHTML(item.title)}"><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span></button>
        ${canManageFilm(item) ? `<button class="film-status-button" type="button" data-toggle-watched="${item.id}" aria-label="Mark ${escapeHTML(item.title)} as ${item.watched ? "ready" : "watched"}">${item.watched ? "Return to list" : "Mark watched"}</button>` : ""}
      </div>
    </article>`;
}

function renderList() {
  const visibleFilms = getVisibleFilms();
  const readyFilms = movieList.filter((item) => !item.watched);
  const watchedFilms = movieList.filter((item) => item.watched);
  const totalVotes = movieList.reduce((sum, item) => sum + item.votes, 0);
  const topPick = [...readyFilms].sort((a, b) => b.votes - a.votes)[0];
  return `
    <section class="list-view" aria-labelledby="list-title">
      <header class="list-hero">
        <div><span class="eyebrow">The Discordians · Shared backlog</span><h1 id="list-title" class="page-title">The List</h1><p class="page-subtitle">Everything the group might watch, ready whenever the bot is not.</p></div>
        <div class="list-hero-actions"><button class="secondary-button" type="button" data-open-film><span class="material-symbols-outlined" aria-hidden="true">add</span> Add Film</button><button class="primary-button" type="button" data-open-party>Pick Tonight <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button></div>
      </header>
      <div class="list-overview" aria-label="List overview">
        <article><strong>${readyFilms.length}</strong><span>Ready to watch</span></article>
        <article><strong>${totalVotes}</strong><span>Group votes</span></article>
        <article><strong>${watchedFilms.length}</strong><span>Marked watched</span></article>
        <article class="top-pick"><span>Current favourite</span><strong>${topPick ? escapeHTML(topPick.title) : "Waiting for votes"}</strong></article>
      </div>
      <div class="list-toolbar">
        <label class="search-field list-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="list-search" type="search" value="${escapeHTML(listQuery)}" placeholder="Search titles, years or suggesters" aria-label="Search The List" /></label>
        <div class="filter-tabs" aria-label="Filter The List">${["ready", "watched", "all"].map((filter) => `<button type="button" class="filter-tab ${listFilter === filter ? "is-active" : ""}" data-list-filter="${filter}">${filter[0].toUpperCase()}${filter.slice(1)}</button>`).join("")}</div>
        <label class="sort-field"><span>Sort</span><select id="list-sort" aria-label="Sort The List"><option value="votes" ${listSort === "votes" ? "selected" : ""}>Most voted</option><option value="oldest" ${listSort === "oldest" ? "selected" : ""}>Longest waiting</option><option value="newest" ${listSort === "newest" ? "selected" : ""}>Newest</option></select></label>
      </div>
      <div class="film-list" aria-live="polite">${visibleFilms.length ? visibleFilms.map((item, index) => renderFilmRow(item, index + 1)).join("") : `<div class="empty-state list-empty"><span class="material-symbols-outlined" aria-hidden="true">movie</span><h2>${movieList.length ? "No films match that view." : "The List is empty."}</h2><p>${movieList.length ? "Try another search or filter." : "Add the first suggestion and give the group something to argue about."}</p><button class="secondary-button" type="button" data-open-film>Add a film</button></div>`}</div>
    </section>`;
}

function renderPick() {
  const candidateCount = movieList.filter((item) => !item.watched).length;
  return `
    <section class="page-view" aria-labelledby="pick-title">
      <header class="page-header"><div><span class="eyebrow">${candidateCount} eligible ${candidateCount === 1 ? "film" : "films"}</span><h1 id="pick-title" class="page-title">Pick Tonight</h1><p class="page-subtitle">Choose the group, choose the rules, then let the website settle the argument.</p></div><button class="primary-button" type="button" data-open-party ${candidateCount ? "" : "disabled"}>Start a Session <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button></header>
      <div class="pick-callout"><span class="material-symbols-outlined" aria-hidden="true">cloud_done</span><div><strong>Independent of Discord</strong><p>These games use the shared website list and continue working while the bot is offline.</p></div></div>
      <div class="mode-list">${decisionModes.map((mode) => `<article class="mode-row"><span class="mode-icon">${mode.code}</span><div><span class="mode-tone">${mode.tone}</span><h3>${mode.title}</h3><p>${mode.copy}</p></div><button class="secondary-button" type="button" data-select-mode="${mode.title}" ${candidateCount ? "" : "disabled"}>Choose</button></article>`).join("")}</div>
    </section>`;
}

function renderSessions() {
  return `
    <section class="page-view" aria-labelledby="sessions-title">
      <header class="page-header"><div><span class="eyebrow">Decision rooms</span><h1 id="sessions-title" class="page-title">Sessions</h1><p class="page-subtitle">The place for live film-picking rooms—not the Discord Journal.</p></div><button class="primary-button" type="button" data-open-party>New Session <span class="material-symbols-outlined" aria-hidden="true">add</span></button></header>
      ${activeSession ? `<article class="active-session session-feature"><div class="active-session-head"><div><span class="eyebrow">Active setup · ${escapeHTML(activeSession.mode)}</span><h3>The room is ready for the next game build.</h3><p class="session-members">${activeSession.members.map(escapeHTML).join(", ")}</p><p>${activeSession.candidateCount} list ${activeSession.candidateCount === 1 ? "film" : "films"} available for this session.</p></div><button class="secondary-button" type="button" data-end-session>End Session</button></div></article>` : `<div class="empty-state session-empty"><span class="material-symbols-outlined" aria-hidden="true">groups</span><h2>No active session.</h2><p>Start with Consensus Sprint, Queue Roulette or a Reel Bracket.</p><button class="secondary-button" type="button" data-open-party>Choose a game</button></div>`}
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

function openFilmModal() {
  filmModal.hidden = false;
  document.body.style.overflow = "hidden";
  filmForm.elements.title.focus();
}

function closeFilmModal() {
  filmModal.hidden = true;
  document.body.style.overflow = "";
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
    supabase.from("queue_items").select("id,group_id,title,release_year,suggested_by,watched,created_at,updated_at").eq("group_id", activeGroup.id).order("created_at", { ascending: true }),
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
    return { id: item.id, title: item.title, year: item.release_year, suggestedById: item.suggested_by, suggestedBy: profileMap.get(item.suggested_by)?.display_name || "Former member", watched: item.watched, createdAt: item.created_at, votes: voters.length, votedByMe: voters.includes(authUser.id) };
  });
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
    const yearValue = String(form.get("year")).trim();
    const year = yearValue ? Number(yearValue) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2200)) { showToast("Enter a valid four-digit release year, or leave it blank."); return; }
    const submit = event.target.querySelector("button[type='submit']");
    submit.disabled = true;
    const { error } = await supabase.from("queue_items").insert({ group_id: activeGroup.id, title: String(form.get("title")).trim(), release_year: year, suggested_by: authUser.id });
    submit.disabled = false;
    if (error) { showToast(`Film was not added: ${error.message}`); return; }
    filmForm.reset();
    closeFilmModal();
    await loadWorkspace();
    render();
    showToast("Film added to The List.");
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

  const modeButton = event.target.closest("[data-select-mode]");
  if (modeButton) { openPartyModal(modeButton.dataset.selectMode); return; }
  if (event.target.closest("[data-end-session]")) { activeSession = null; render(); showToast("Session ended. The movie list was not changed."); }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#list-sort")) { listSort = event.target.value; render(); }
});

partyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(partyForm);
  const selectedMembers = form.getAll("members");
  if (!selectedMembers.length) { showToast("Choose at least one Discordian."); return; }
  activeSession = { members: selectedMembers, mode: String(form.get("mode")), candidateCount: movieList.filter((item) => !item.watched).length };
  closePartyModal();
  navigate("sessions");
  showToast(`${activeSession.mode} session created for ${selectedMembers.length} people.`);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!partyModal.hidden) closePartyModal();
  if (!filmModal.hidden) closeFilmModal();
});

window.addEventListener("hashchange", () => {
  const requestedView = window.location.hash.replace("#", "");
  const nextView = legacyViewMap[requestedView] || requestedView;
  if (nextView && nextView !== currentView && authUser && activeGroup) { currentView = nextView; render(); }
});

supabase.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => { if (session?.user?.id !== authUser?.id) syncSession(session); }, 0);
});

const { data: sessionData } = await supabase.auth.getSession();
await syncSession(sessionData.session);
