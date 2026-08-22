import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tbmxxdodprmynyiiaofj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D-ZMbt0ttcYPHEDtghl7AQ_wstwsoti";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const knownAvatars = {
  cameron: "./assets/avatar-cameron.png",
  dean: "./assets/avatar-dean.png",
  kieran: "./assets/avatar-kieran.png",
  andrew: "./assets/avatar-andrew.png",
  ross: "./assets/avatar-ross.png"
};

const queue = [
  { id: 1, title: "The Nice Guys", year: 2016, suggestedBy: "Dean", votes: 5, age: "341 days waiting", voted: false },
  { id: 2, title: "Coherence", year: 2013, suggestedBy: "Cameron", votes: 4, age: "228 days waiting", voted: false },
  { id: 3, title: "Arrival", year: 2016, suggestedBy: "Kieran", votes: 3, age: "166 days waiting", voted: false },
  { id: 4, title: "Paddington 2", year: 2017, suggestedBy: "Andrew", votes: 2, age: "92 days waiting", voted: false },
  { id: 5, title: "The Raid", year: 2011, suggestedBy: "Ross", votes: 2, age: "51 days waiting", voted: false }
];

const awards = [
  { rank: "01", title: "MVP Watcher", description: "Appeared in 83.05% of every recorded watch.", value: "Dean · 578 events" },
  { rank: "02", title: "Ride-or-Die Duo", description: "The pairing that returned to the Journal most often.", value: "Dean + Kieran · 278" },
  { rank: "03", title: "Completion God", description: "382 finished entries and only four DNFs.", value: "Andrew · 98.96%" },
  { rank: "04", title: "Third Wheel King", description: "Watched with thirteen different people.", value: "Dean · 13 people" },
  { rank: "05", title: "Ghost Award", description: "The wooden spoon for one elusive appearance.", value: "William · 1 event" }
];

const decisionModes = [
  {
    code: "01",
    title: "Consensus Sprint",
    copy: "Everyone privately likes or passes. The strongest overlap becomes tonight's pick.",
    action: "Quick Vote"
  },
  {
    code: "02",
    title: "Queue Roulette",
    copy: "Neglected queue entries get more weight. Everyone receives one merciful veto.",
    action: "Mini-Games"
  },
  {
    code: "03",
    title: "Journal Recall",
    copy: "Trivia generated from your own history earns a golden vote for the final decision.",
    action: "Mini-Games"
  },
  {
    code: "04",
    title: "Already Decided",
    copy: "Skip the democracy. Record who is here and move straight to the watch.",
    action: "Already Decided"
  }
];

const root = document.querySelector("#view-root");
const partyModal = document.querySelector("#party-modal");
const journalModal = document.querySelector("#journal-modal");
const partyMembers = document.querySelector("#party-members");
const partyForm = document.querySelector("#party-form");
const journalForm = document.querySelector("#journal-form");
const entryPreview = document.querySelector("#entry-preview");
const toast = document.querySelector("#toast");
const sessionPanel = document.querySelector("#session-panel");
const sessionName = document.querySelector("#session-name");

let currentView = window.location.hash.replace("#", "") || "home";
let authUser = null;
let currentProfile = null;
let availableGroup = null;
let activeGroup = null;
let members = [];
let accessRequest = null;
let joinRequests = [];
let journalEntries = [];
let activeSession = null;
let journalQuery = "";
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

function formatJournalDate(value) {
  if (!value) return "Date unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}

function localISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function isCurrentAdmin() {
  return currentProfile?.role === "admin";
}

function formatRequestDate(value) {
  if (!value) return "Date unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function nextEntryNumber() {
  return journalEntries.length ? Math.max(...journalEntries.map((entry) => entry.number)) + 1 : 1317;
}

function memberMarkup(member) {
  return `
    <div class="member">
      <img class="member-avatar" src="${member.avatar}" alt="${escapeHTML(member.name)}'s illustrated avatar" />
      <span class="member-name">${escapeHTML(member.name)}</span>
    </div>
  `;
}

function renderLoading() {
  return `
    <section class="access-view" aria-live="polite">
      <span class="eyebrow">Private archive</span>
      <h1>Opening Cine-Cord…</h1>
      <p>Checking your invite and loading the Journal.</p>
    </section>
  `;
}

function renderLogin() {
  const isSignup = authMode === "signup";
  return `
    <section class="access-view" aria-labelledby="login-title">
      <div class="access-card">
        <span class="eyebrow">The Discordians · ${isSignup ? "Request access" : "Private access"}</span>
        <h1 id="login-title">${isSignup ? "Join the waiting list." : "Enter Cine-Cord."}</h1>
        <p>${isSignup
          ? "Create an account, confirm your email if asked, then request approval from a Discordians website administrator."
          : "Sign in with your approved website account. This does not connect to Discord or request any server permissions."}</p>
        <form id="auth-form" class="access-form" data-auth-mode="${isSignup ? "signup" : "signin"}">
          ${isSignup ? `<label><span>Journal display name</span><input name="display_name" required maxlength="40" autocomplete="nickname" placeholder="How your name appears in entries" /></label>` : ""}
          <label><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com" /></label>
          <label><span>Password</span><input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="${isSignup ? "8" : "6"}" /></label>
          <button class="primary-button full-width" type="submit">${isSignup ? "Create account" : "Sign in"} <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
        </form>
        <button class="auth-mode-toggle" type="button" data-toggle-auth-mode>
          ${isSignup ? "Already have an account? Sign in" : "New Discordian? Create an account"}
        </button>
        <span class="access-note">Approval controls private Journal access. Creating an account alone reveals no group data.</span>
      </div>
    </section>
  `;
}

function renderPendingAccess() {
  const requestedName = accessRequest?.requested_display_name || currentProfile?.displayName || "";
  return `
    <section class="access-view" aria-labelledby="pending-title">
      <div class="access-card">
        <span class="eyebrow">Account recognised · Private data locked</span>
        <h1 id="pending-title">${accessRequest ? "Waiting for approval." : "Request access."}</h1>
        <p>${accessRequest
          ? `Your request was sent on ${formatRequestDate(accessRequest.created_at)}. You can update the Journal name an administrator will see.`
          : "Choose the familiar name your friends use in the Journal, then send a request to the website administrator."}</p>
        <form id="request-access-form" class="access-form">
          <label><span>Journal display name</span><input name="display_name" required maxlength="40" value="${escapeHTML(requestedName)}" /></label>
          <button class="primary-button full-width" type="submit">${accessRequest ? "Update request" : "Request website access"} <span class="material-symbols-outlined" aria-hidden="true">send</span></button>
        </form>
        <div class="access-actions">
          ${accessRequest ? `<button class="text-button" type="button" data-cancel-access-request>Cancel request</button>` : ""}
          <button class="text-button" type="button" data-sign-out>Sign out</button>
        </div>
      </div>
    </section>
  `;
}

function renderHome() {
  const latest = journalEntries[0];
  const journalSpotlight = latest ? `
    <article class="journal-spotlight">
      <div class="journal-main">
        <span class="eyebrow">Persistent Journal&nbsp; · &nbsp;${journalEntries.length} loaded entries</span>
        <span class="entry-kicker">Entry #${latest.number}</span>
        <h2>${escapeHTML(latest.title)}</h2>
        <div class="entry-meta">
          <span>${latest.year || "Year unknown"}</span><span>·</span>
          <span>Viewers: ${latest.viewers.map(escapeHTML).join(", ")}</span><span>·</span>
          <span>Status: <strong class="finished">${escapeHTML(latest.status)}</strong></span>
        </div>
      </div>
      <div class="journal-comment">
        <span class="eyebrow">Comment</span>
        <blockquote>${escapeHTML(latest.comment || "No comment recorded.")}</blockquote>
        <span class="comment-credit">— <strong>${escapeHTML(latest.author)}</strong>&nbsp;&nbsp; ${escapeHTML(latest.date)}</span>
      </div>
    </article>
  ` : `
    <article class="journal-spotlight journal-empty">
      <div class="journal-main">
        <span class="eyebrow">Persistent Journal connected</span>
        <span class="entry-kicker">Ready for Entry #1317</span>
        <h2>The archive is waiting.</h2>
        <p class="page-subtitle">Record the first website entry now, or import the historical Journal in the next phase.</p>
      </div>
      <div class="journal-comment">
        <span class="eyebrow">Database status</span>
        <blockquote>Private, authenticated and completely disconnected from Discord.</blockquote>
      </div>
    </article>
  `;

  return `
    <section class="home-view" aria-labelledby="home-title">
      <div class="home-hero">
        <div class="hero-copy">
          <h1 id="home-title" class="hero-title">Tonight,<br />we decide.</h1>
          <p class="hero-subtitle">Start a room, gather the Discordians, then choose the film.</p>
          <div class="party-members" aria-label="Discordians members">
            ${members.slice(0, 5).map(memberMarkup).join("")}
          </div>
          <div class="hero-actions">
            <button class="primary-button" type="button" data-open-party>
              Start Watch Party
              <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
            <span class="decision-modes">Quick Vote&nbsp; · &nbsp;Mini-Games&nbsp; · &nbsp;Already Decided</span>
          </div>
        </div>
        <img class="hero-art" src="./assets/hero-journal-web.png" alt="Abstract violet cinematic web of light" />
      </div>
      ${journalSpotlight}
      <span class="home-date">${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())}</span>
    </section>
  `;
}

function renderJournal() {
  const query = journalQuery.trim().toLowerCase();
  const filtered = journalEntries.filter((entry) => {
    const haystack = [entry.number, entry.title, entry.year, entry.status, entry.comment, ...entry.viewers].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  return `
    <section class="page-view" aria-labelledby="journal-title">
      <header class="page-header">
        <div>
          <span class="eyebrow">The living archive · ${journalEntries.length} persistent entries</span>
          <h1 id="journal-title" class="page-title">The Journal</h1>
          <p class="page-subtitle">Every film, season, live event, DNF and comment that deserved to survive the group chat.</p>
        </div>
        <button class="secondary-button" type="button" data-open-journal>Record an entry</button>
      </header>
      <div class="toolbar">
        <label class="search-field">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="journal-search" type="search" value="${escapeHTML(journalQuery)}" placeholder="Search entries, viewers or comments" aria-label="Search the Journal" />
        </label>
      </div>
      <div class="journal-ledger" aria-live="polite">
        ${filtered.length ? filtered.map((entry) => `
          <article class="ledger-entry">
            <div class="ledger-number">#${entry.number}</div>
            <div>
              <h3>${escapeHTML(entry.title)} <span class="eyebrow">${entry.year || "—"}</span></h3>
              <div class="entry-meta"><span>Viewers: ${entry.viewers.map(escapeHTML).join(", ")}</span></div>
              <p>${escapeHTML(entry.comment || "No comment recorded.")}</p>
            </div>
            <div class="ledger-side">
              <span class="status ${entry.status === "DNF" ? "dnf" : ""}">${escapeHTML(entry.status)}</span>
              <span class="ledger-date">${escapeHTML(entry.date)}</span>
            </div>
          </article>
        `).join("") : `<div class="empty-state">${journalQuery ? "No Journal entries match that search." : "The persistent Journal is empty. Record an entry or import the archive next."}</div>`}
      </div>
    </section>
  `;
}

function renderTonight() {
  return `
    <section class="page-view" aria-labelledby="tonight-title">
      <header class="page-header">
        <div>
          <span class="eyebrow">Choose the chaos</span>
          <h1 id="tonight-title" class="page-title">Tonight</h1>
          <p class="page-subtitle">Start with a sensible quick vote, surrender to the wheel, or prove who remembers the Journal best.</p>
        </div>
        <button class="primary-button" type="button" data-open-party>Start Watch Party <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
      </header>
      ${activeSession ? `
        <article class="active-session">
          <div class="active-session-head">
            <div>
              <span class="eyebrow">Active session · ${escapeHTML(activeSession.mode)}</span>
              <h3>The room is ready.</h3>
              <p class="session-members">${activeSession.members.map(escapeHTML).join(", ")}</p>
            </div>
            <button class="secondary-button" type="button" data-record-entry>Finish &amp; Journal</button>
          </div>
        </article>
      ` : ""}
      <div class="mode-list">
        ${decisionModes.map((mode) => `
          <article class="mode-row">
            <span class="mode-icon">${mode.code}</span>
            <div><h3>${mode.title}</h3><p>${mode.copy}</p></div>
            <button class="secondary-button" type="button" data-select-mode="${mode.action}">Choose</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderWrapped() {
  return `
    <section class="page-view" aria-labelledby="wrapped-title">
      <header class="page-header">
        <div>
          <span class="eyebrow">The Journal Strikes Back</span>
          <h1 id="wrapped-title" class="page-title">Wrapped</h1>
          <p class="page-subtitle">The awards, pairings and questionable arithmetic that define Cine-Cord.</p>
        </div>
        <button class="secondary-button" type="button" data-range>Lifetime</button>
      </header>
      <div class="wrapped-summary" aria-label="Cine-Cord totals">
        <div class="summary-stat"><strong>696</strong><span>Total entries</span></div>
        <div class="summary-stat"><strong>683</strong><span>Finished</span></div>
        <div class="summary-stat"><strong>98.132%</strong><span>Completion rate</span></div>
      </div>
      <div class="award-list">
        ${awards.map((award) => `
          <article class="award-row">
            <span class="award-rank">${award.rank}</span>
            <div><h3>${award.title}</h3><p>${award.description}</p></div>
            <strong class="award-value">${award.value}</strong>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderQueue() {
  return `
    <section class="page-view" aria-labelledby="queue-title">
      <header class="page-header">
        <div>
          <span class="eyebrow">Future mistakes · prototype data</span>
          <h1 id="queue-title" class="page-title">The Queue</h1>
          <p class="page-subtitle">Shared suggestions waiting for democracy, mini-games or the Wheel of Regret.</p>
        </div>
        <button class="secondary-button" type="button" data-add-suggestion>Add a suggestion</button>
      </header>
      <div class="queue-list">
        ${queue.map((item) => `
          <article class="queue-row">
            <div>
              <h3>${item.title} <span class="eyebrow">${item.year}</span></h3>
              <p>Suggested by ${item.suggestedBy}</p>
            </div>
            <span class="queue-age">${item.age}</span>
            <div class="vote-control">
              <span>${item.votes}</span>
              <button class="vote-button ${item.voted ? "is-voted" : ""}" type="button" data-vote="${item.id}" aria-label="Vote for ${item.title}">
                <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>
              </button>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderMembers() {
  if (!isCurrentAdmin()) return renderHome();
  const accessUrl = `${window.location.origin}${window.location.pathname}`;
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return `
    <section class="page-view" aria-labelledby="members-title">
      <header class="page-header">
        <div>
          <span class="eyebrow">Website access · Admin only</span>
          <h1 id="members-title" class="page-title">Members</h1>
          <p class="page-subtitle">Approve friends, keep Journal names consistent and control access to the private archive.</p>
        </div>
        <span class="member-count">${members.length} approved</span>
      </header>

      <article class="invite-panel">
        <div>
          <span class="eyebrow">Invite a friend</span>
          <h2>Share the private entrance.</h2>
          <p>They create an account, request access and remain locked out until you approve them here.</p>
        </div>
        <div class="invite-link-row">
          <input value="${escapeHTML(accessUrl)}" readonly aria-label="Website invite link" />
          <button class="secondary-button" type="button" data-copy-invite>Copy link</button>
        </div>
      </article>

      <section class="management-section" aria-labelledby="requests-title">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Waiting room</span>
            <h2 id="requests-title">Access requests</h2>
          </div>
          <span class="request-count">${joinRequests.length}</span>
        </div>
        <div class="request-list">
          ${joinRequests.length ? joinRequests.map((request) => `
            <article class="request-row">
              <div class="request-identity">
                <span class="member-initial">${escapeHTML(request.requested_display_name.slice(0, 1).toUpperCase())}</span>
                <div>
                  <h3>${escapeHTML(request.requested_display_name)}</h3>
                  <p>${escapeHTML(request.requester_email)}</p>
                  <small>Requested ${formatRequestDate(request.created_at)}</small>
                </div>
              </div>
              <div class="request-actions">
                <button class="primary-button compact-button" type="button" data-approve-request="${request.id}">Approve</button>
                <button class="secondary-button" type="button" data-decline-request="${request.id}">Decline</button>
              </div>
            </article>
          `).join("") : `<div class="empty-state compact-empty">No one is waiting for approval.</div>`}
        </div>
      </section>

      <section class="management-section" aria-labelledby="approved-title">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Private archive</span>
            <h2 id="approved-title">Approved members</h2>
          </div>
        </div>
        <div class="approved-list">
          ${sortedMembers.map((member) => {
            const isSelf = member.id === authUser.id;
            return `
              <form class="approved-row" data-member-form data-user-id="${member.id}">
                <img src="${member.avatar}" alt="" />
                <label>
                  <span>Journal name</span>
                  <input name="display_name" required maxlength="40" value="${escapeHTML(member.name)}" />
                </label>
                <label>
                  <span>Role</span>
                  <select name="role" ${isSelf ? "disabled" : ""}>
                    <option value="member" ${member.role === "member" ? "selected" : ""}>Member</option>
                    <option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option>
                  </select>
                  ${isSelf ? `<input type="hidden" name="role" value="admin" />` : ""}
                </label>
                <div class="member-admin-actions">
                  <button class="secondary-button" type="submit">Save</button>
                  <button class="text-button danger-button" type="button" data-remove-member="${member.id}" ${isSelf ? "disabled" : ""}>Remove access</button>
                </div>
                ${isSelf ? `<span class="self-badge">You</span>` : ""}
              </form>
            `;
          }).join("")}
        </div>
      </section>
    </section>
  `;
}

function updateShellState() {
  const hasWorkspace = Boolean(authUser && activeGroup);
  const isAdmin = hasWorkspace && isCurrentAdmin();
  document.body.classList.toggle("is-locked", !hasWorkspace);
  document.body.classList.toggle("is-admin", isAdmin);
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !isAdmin;
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.disabled = !hasWorkspace || (button.dataset.view === "members" && !isAdmin);
    button.classList.toggle("is-active", hasWorkspace && button.dataset.view === currentView);
  });
  if (sessionPanel) sessionPanel.hidden = !authUser;
  if (sessionName) sessionName.textContent = currentProfile?.displayName || authUser?.email || "Signed in";
}

function bindJournalSearch() {
  const search = document.querySelector("#journal-search");
  search?.addEventListener("input", (event) => {
    journalQuery = event.target.value;
    root.innerHTML = renderJournal();
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

  const renderers = {
    home: renderHome,
    journal: renderJournal,
    tonight: renderTonight,
    wrapped: renderWrapped,
    queue: renderQueue,
    members: renderMembers
  };
  if (!renderers[currentView] || (currentView === "members" && !isCurrentAdmin())) currentView = "home";
  root.innerHTML = renderers[currentView]();
  updateShellState();
  if (currentView === "journal") bindJournalSearch();
}

function navigate(view) {
  if (!authUser || !activeGroup) return;
  if (view === "members" && !isCurrentAdmin()) return;
  currentView = view;
  window.location.hash = view;
  render();
  root.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPartyModal(mode = "Quick Vote") {
  partyMembers.innerHTML = members.map((member, index) => `
    <label class="member-choice">
      <input type="checkbox" name="members" value="${escapeHTML(member.name)}" ${index < 3 ? "checked" : ""} />
      <img src="${member.avatar}" alt="" />
      <span>${escapeHTML(member.name)}</span>
    </label>
  `).join("");
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

function updateEntryPreview() {
  const data = new FormData(journalForm);
  entryPreview.textContent = [
    `• Entry #${nextEntryNumber()}`,
    `• ${data.get("title") || "Title"}`,
    `• ${data.get("year") || "Year"}`,
    `• Viewers: ${data.get("viewers") || "Viewers"}`,
    `• Status: ${data.get("status") || "Finished"}`,
    `• ${data.get("comment") || "Journal comment"}`
  ].join("\n");
}

function openJournalModal() {
  const viewerNames = activeSession?.members?.join(", ") || currentProfile?.displayName || "";
  journalForm.elements.viewers.value = viewerNames;
  journalForm.elements.year.value = String(new Date().getFullYear());
  journalForm.elements.status.value = "Finished";
  updateEntryPreview();
  journalModal.hidden = false;
  document.body.style.overflow = "hidden";
  journalForm.elements.title.focus();
}

function closeJournalModal() {
  journalModal.hidden = true;
  document.body.style.overflow = "";
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3600);
}

async function loadWorkspace() {
  const { data: groups, error: groupError } = await supabase
    .from("groups")
    .select("id,name,slug")
    .eq("slug", "the-discordians")
    .limit(1);
  if (groupError) throw groupError;

  availableGroup = groups?.[0] || null;
  activeGroup = null;
  currentProfile = null;
  members = [];
  accessRequest = null;
  joinRequests = [];
  journalEntries = [];
  if (!availableGroup) return;

  const [selfProfileResult, selfMembershipResult, selfRequestResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name").eq("id", authUser.id).maybeSingle(),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle(),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", availableGroup.id).eq("user_id", authUser.id).maybeSingle()
  ]);

  const accessError = [selfProfileResult.error, selfMembershipResult.error, selfRequestResult.error].find(Boolean);
  if (accessError) throw accessError;

  currentProfile = {
    id: authUser.id,
    displayName: selfProfileResult.data?.display_name || authUser.email?.split("@")[0] || "Discordian",
    role: selfMembershipResult.data?.role || null
  };
  accessRequest = selfRequestResult.data || null;

  if (!selfMembershipResult.data) return;

  activeGroup = availableGroup;

  const [profilesResult, membershipsResult, entriesResult, viewersResult, requestsResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name"),
    supabase.from("group_memberships").select("user_id,role").eq("group_id", activeGroup.id),
    supabase.from("journal_entries").select("id,entry_number,title,release_year,watched_at,status,comment,created_by,created_at").eq("group_id", activeGroup.id).order("entry_number", { ascending: false }),
    supabase.from("entry_viewers").select("entry_id,profile_id"),
    supabase.from("group_join_requests").select("id,group_id,user_id,requester_email,requested_display_name,created_at,updated_at").eq("group_id", activeGroup.id).order("created_at", { ascending: true })
  ]);

  const firstError = [profilesResult.error, membershipsResult.error, entriesResult.error, viewersResult.error, requestsResult.error].find(Boolean);
  if (firstError) throw firstError;

  const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  currentProfile = {
    id: authUser.id,
    displayName: profileMap.get(authUser.id)?.display_name || currentProfile.displayName,
    role: selfMembershipResult.data.role
  };

  members = (membershipsResult.data || []).map((membership) => {
    const profile = profileMap.get(membership.user_id);
    const name = profile?.display_name || "Discordian";
    return { id: membership.user_id, name, role: membership.role, avatar: avatarForName(name) };
  });
  joinRequests = isCurrentAdmin() ? (requestsResult.data || []) : [];

  const viewerIdsByEntry = new Map();
  for (const viewer of viewersResult.data || []) {
    const ids = viewerIdsByEntry.get(viewer.entry_id) || [];
    ids.push(viewer.profile_id);
    viewerIdsByEntry.set(viewer.entry_id, ids);
  }

  journalEntries = (entriesResult.data || []).map((entry) => ({
    id: entry.id,
    number: Number(entry.entry_number),
    title: entry.title,
    year: entry.release_year,
    viewers: (viewerIdsByEntry.get(entry.id) || []).map((id) => profileMap.get(id)?.display_name || "Former member"),
    status: entry.status === "FINISHED" ? "Finished" : entry.status,
    comment: entry.comment || "",
    author: profileMap.get(entry.created_by)?.display_name || "Legacy import",
    date: formatJournalDate(entry.watched_at)
  }));
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
  journalEntries = [];
  render();

  if (authUser) {
    try {
      await loadWorkspace();
    } catch (error) {
      showToast(`Could not load the private Journal: ${error.message}`);
    }
  }
  isLoading = false;
  render();
}

document.addEventListener("submit", async (event) => {
  if (!event.target.matches("#auth-form")) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const submit = event.target.querySelector("button[type='submit']");
  const mode = event.target.dataset.authMode;
  submit.disabled = true;
  submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…";

  const credentials = {
    email: String(form.get("email")).trim(),
    password: String(form.get("password"))
  };
  const { data, error } = mode === "signup"
    ? await supabase.auth.signUp({
        ...credentials,
        options: {
          data: { display_name: String(form.get("display_name")).trim() },
          emailRedirectTo: `${window.location.origin}${window.location.pathname}`
        }
      })
    : await supabase.auth.signInWithPassword(credentials);

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
});

document.addEventListener("submit", async (event) => {
  if (!event.target.matches("#request-access-form")) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const submit = event.target.querySelector("button[type='submit']");
  submit.disabled = true;
  const { error } = await supabase.rpc("request_group_access", {
    p_group_slug: "the-discordians",
    p_display_name: String(form.get("display_name")).trim()
  });
  submit.disabled = false;
  if (error) {
    showToast(`Request was not sent: ${error.message}`);
    return;
  }
  await loadWorkspace();
  render();
  showToast("Access request sent to The Discordians administrators.");
});

document.addEventListener("submit", async (event) => {
  if (!event.target.matches("[data-member-form]")) return;
  event.preventDefault();
  if (!activeGroup || !isCurrentAdmin()) return;
  const form = new FormData(event.target);
  const submit = event.target.querySelector("button[type='submit']");
  submit.disabled = true;
  const { error } = await supabase.rpc("update_group_member", {
    p_group_id: activeGroup.id,
    p_user_id: event.target.dataset.userId,
    p_display_name: String(form.get("display_name")).trim(),
    p_role: String(form.get("role"))
  });
  submit.disabled = false;
  if (error) {
    showToast(`Member was not updated: ${error.message}`);
    return;
  }
  await loadWorkspace();
  render();
  showToast("Member details saved.");
});

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    navigate(viewButton.dataset.view);
    return;
  }
  if (event.target.closest("[data-toggle-auth-mode]")) {
    authMode = authMode === "signin" ? "signup" : "signin";
    render();
    return;
  }
  if (event.target.closest("[data-nav='home']")) {
    event.preventDefault();
    navigate("home");
    return;
  }
  if (event.target.closest("[data-sign-out]")) {
    await supabase.auth.signOut();
    await syncSession(null);
    showToast("Signed out of the private archive.");
    return;
  }
  if (event.target.closest("[data-cancel-access-request]")) {
    if (!accessRequest || !window.confirm("Cancel your website access request?")) return;
    const { error } = await supabase.from("group_join_requests").delete().eq("id", accessRequest.id);
    if (error) {
      showToast(`Request was not cancelled: ${error.message}`);
      return;
    }
    await loadWorkspace();
    render();
    showToast("Access request cancelled.");
    return;
  }
  if (event.target.closest("[data-copy-invite]")) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}`);
      showToast("Website access link copied.");
    } catch {
      showToast("Copy was blocked. Press and hold the link to copy it manually.");
    }
    return;
  }
  const approveButton = event.target.closest("[data-approve-request]");
  if (approveButton) {
    approveButton.disabled = true;
    const { error } = await supabase.rpc("approve_group_join_request", {
      p_request_id: approveButton.dataset.approveRequest
    });
    if (error) {
      approveButton.disabled = false;
      showToast(`Access was not approved: ${error.message}`);
      return;
    }
    await loadWorkspace();
    render();
    showToast("Member approved. Their private archive access is now active.");
    return;
  }
  const declineButton = event.target.closest("[data-decline-request]");
  if (declineButton) {
    if (!window.confirm("Decline this website access request?")) return;
    declineButton.disabled = true;
    const { error } = await supabase.rpc("decline_group_join_request", {
      p_request_id: declineButton.dataset.declineRequest
    });
    if (error) {
      declineButton.disabled = false;
      showToast(`Request was not declined: ${error.message}`);
      return;
    }
    await loadWorkspace();
    render();
    showToast("Access request declined.");
    return;
  }
  const removeButton = event.target.closest("[data-remove-member]");
  if (removeButton) {
    const member = members.find((candidate) => candidate.id === removeButton.dataset.removeMember);
    if (!member || !window.confirm(`Remove ${member.name}'s website access? Their account will remain, but private data will be locked.`)) return;
    removeButton.disabled = true;
    const { error } = await supabase.rpc("remove_group_member", {
      p_group_id: activeGroup.id,
      p_user_id: member.id
    });
    if (error) {
      removeButton.disabled = false;
      showToast(`Member was not removed: ${error.message}`);
      return;
    }
    await loadWorkspace();
    render();
    showToast(`${member.name}'s website access was removed.`);
    return;
  }
  if (event.target.closest("[data-open-party]")) {
    openPartyModal();
    return;
  }
  if (event.target.closest("[data-close-modal]") || event.target === partyModal) {
    closePartyModal();
    return;
  }
  if (event.target.closest("[data-open-journal]") || event.target.closest("[data-record-entry]")) {
    openJournalModal();
    return;
  }
  if (event.target.closest("[data-close-journal]") || event.target === journalModal) {
    closeJournalModal();
    return;
  }
  const modeButton = event.target.closest("[data-select-mode]");
  if (modeButton) {
    openPartyModal(modeButton.dataset.selectMode);
    return;
  }
  const voteButton = event.target.closest("[data-vote]");
  if (voteButton) {
    const item = queue.find((candidate) => candidate.id === Number(voteButton.dataset.vote));
    if (item) {
      item.voted = !item.voted;
      item.votes += item.voted ? 1 : -1;
      render();
      showToast(item.voted ? `Prototype vote added for ${item.title}` : `Prototype vote removed from ${item.title}`);
    }
    return;
  }
  if (event.target.closest("[data-range]")) {
    showToast("Wrapped will be recalculated after the historical Journal import.");
    return;
  }
  if (event.target.closest("[data-add-suggestion]")) {
    showToast("Persistent queue suggestions are planned for the next phase.");
  }
});

partyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(partyForm);
  const selectedMembers = form.getAll("members");
  if (!selectedMembers.length) {
    showToast("Choose at least one Discordian.");
    return;
  }
  activeSession = { members: selectedMembers, mode: form.get("mode") };
  closePartyModal();
  navigate("tonight");
  showToast(`${activeSession.mode} room created for ${selectedMembers.length} people.`);
});

journalForm.addEventListener("input", updateEntryPreview);
journalForm.addEventListener("change", updateEntryPreview);

journalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authUser || !activeGroup) {
    showToast("Your private Journal session has expired. Sign in again.");
    return;
  }

  const data = new FormData(journalForm);
  const viewerNames = String(data.get("viewers")).split(",").map((name) => name.trim()).filter(Boolean);
  const memberByName = new Map(members.map((member) => [member.name.toLowerCase(), member]));
  const unknownNames = viewerNames.filter((name) => !memberByName.has(name.toLowerCase()));
  if (unknownNames.length) {
    showToast(`These viewers are not approved website members yet: ${unknownNames.join(", ")}`);
    return;
  }

  const submit = journalForm.querySelector("button[type='submit']");
  submit.disabled = true;
  const { data: entryNumber, error } = await supabase.rpc("create_journal_entry", {
    p_group_id: activeGroup.id,
    p_title: String(data.get("title")).trim(),
    p_release_year: Number(data.get("year")),
    p_watched_at: localISODate(),
    p_status: String(data.get("status")),
    p_comment: String(data.get("comment")).trim(),
    p_viewer_ids: [...new Set(viewerNames.map((name) => memberByName.get(name.toLowerCase()).id))]
  });
  submit.disabled = false;

  if (error) {
    showToast(`Entry was not recorded: ${error.message}`);
    return;
  }

  await loadWorkspace();
  activeSession = null;
  journalForm.reset();
  closeJournalModal();
  navigate("journal");
  showToast(`Entry #${entryNumber} saved to the private Journal.`);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!partyModal.hidden) closePartyModal();
  if (!journalModal.hidden) closeJournalModal();
});

window.addEventListener("hashchange", () => {
  const nextView = window.location.hash.replace("#", "");
  if (nextView && nextView !== currentView && authUser && activeGroup) {
    currentView = nextView;
    render();
  }
});

supabase.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => {
    if (session?.user?.id !== authUser?.id) syncSession(session);
  }, 0);
});

const { data: sessionData } = await supabase.auth.getSession();
await syncSession(sessionData.session);
