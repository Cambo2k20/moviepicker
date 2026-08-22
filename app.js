const members = [
  { name: "Cameron", avatar: "./assets/avatar-cameron.png" },
  { name: "Dean", avatar: "./assets/avatar-dean.png" },
  { name: "Kieran", avatar: "./assets/avatar-kieran.png" },
  { name: "Andrew", avatar: "./assets/avatar-andrew.png" },
  { name: "Ross", avatar: "./assets/avatar-ross.png" }
];

let journalEntries = [
  {
    number: 1316,
    title: "Spider-Man: Into the Spider-Verse",
    year: 2018,
    viewers: ["Dean", "Kieran"],
    status: "Finished",
    comment: "THAT'S WHY HE'S THE GOAT... THE GOOOAT!",
    author: "DeanShelTxn",
    date: "01/08/2026, 13:33"
  },
  {
    number: 1315,
    title: "Spider-Man: Brand New Day (Live)",
    year: 2026,
    viewers: ["Andrew", "Cory", "Dean", "Jake", "Kieran", "Luke", "Ross"],
    status: "Finished",
    comment: "Do you like Peter Parker? You should watch Spider-man. He's in it.",
    author: "DeanShelTxn",
    date: "01/08/2026, 13:33"
  },
  {
    number: 1314,
    title: "Ex-Machina",
    year: 2015,
    viewers: ["Cameron", "Dean"],
    status: "Finished",
    comment: "Did you design Ava's face based on my pornography profile? Is that why she looks like Ronnie Arthur?",
    author: "DeanShelTxn",
    date: "30/07/2026, 12:45"
  },
  {
    number: 1313,
    title: "It's A Trap",
    year: 2010,
    viewers: ["Dean", "Kieran"],
    status: "Finished",
    comment: "Ohhhhh, I'm afraid the shield generator will be quite operational when your friends arrive!",
    author: "DeanShelTxn",
    date: "26/07/2026, 14:16"
  },
  {
    number: 1312,
    title: "The Odyssey (Live)",
    year: 2026,
    viewers: ["Andrew", "Cameron", "Dean"],
    status: "Finished",
    comment: "I hate it when they try force Peter Parker's parents into the story.",
    author: "DeanShelTxn",
    date: "24/07/2026, 18:53"
  }
];

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

let currentView = window.location.hash.replace("#", "") || "home";
let activeSession = null;
let journalQuery = "";
let toastTimer;

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function memberMarkup(member) {
  return `
    <div class="member">
      <img class="member-avatar" src="${member.avatar}" alt="${member.name}'s illustrated avatar" />
      <span class="member-name">${member.name}</span>
    </div>
  `;
}

function renderHome() {
  const latest = journalEntries[0];
  return `
    <section class="home-view" aria-labelledby="home-title">
      <div class="home-hero">
        <div class="hero-copy">
          <h1 id="home-title" class="hero-title">Tonight,<br />we decide.</h1>
          <p class="hero-subtitle">Start a room, gather the Discordians, then choose the film.</p>

          <div class="party-members" aria-label="Discordians members">
            ${members.map(memberMarkup).join("")}
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

      <article class="journal-spotlight">
        <div class="journal-main">
          <span class="eyebrow">Return of the Journal&nbsp; · &nbsp;1,316 entries</span>
          <span class="entry-kicker">Entry #${latest.number}</span>
          <h2>${escapeHTML(latest.title)}</h2>
          <div class="entry-meta">
            <span>${latest.year}</span><span>·</span>
            <span>Viewers: ${latest.viewers.join(", ")}</span><span>·</span>
            <span>Status: <strong class="finished">${latest.status}</strong></span>
          </div>
        </div>
        <div class="journal-comment">
          <span class="eyebrow">Comment</span>
          <blockquote>${escapeHTML(latest.comment)}</blockquote>
          <span class="comment-credit">— <strong>${latest.author}</strong>&nbsp;&nbsp; ${latest.date}</span>
        </div>
      </article>

      <span class="home-date">22 August 2026</span>
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
          <span class="eyebrow">The living archive</span>
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
              <h3>${escapeHTML(entry.title)} <span class="eyebrow">${entry.year}</span></h3>
              <div class="entry-meta"><span>Viewers: ${entry.viewers.join(", ")}</span></div>
              <p>${escapeHTML(entry.comment)}</p>
            </div>
            <div class="ledger-side">
              <span class="status ${entry.status === "DNF" ? "dnf" : ""}">${entry.status}</span>
              <span class="ledger-date">${entry.date}</span>
            </div>
          </article>
        `).join("") : '<div class="empty-state">No Journal entries match that search.</div>'}
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
              <span class="eyebrow">Active session · ${activeSession.mode}</span>
              <h3>The room is ready.</h3>
              <p class="session-members">${activeSession.members.join(", ")}</p>
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
          <span class="eyebrow">Future mistakes</span>
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

function render() {
  const renderers = {
    home: renderHome,
    journal: renderJournal,
    tonight: renderTonight,
    wrapped: renderWrapped,
    queue: renderQueue
  };

  if (!renderers[currentView]) currentView = "home";
  root.innerHTML = renderers[currentView]();

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === currentView);
  });

  const journalSearch = document.querySelector("#journal-search");
  journalSearch?.addEventListener("input", (event) => {
    journalQuery = event.target.value;
    root.innerHTML = renderJournal();
    document.querySelector("#journal-search")?.focus();
    const refreshedSearch = document.querySelector("#journal-search");
    if (refreshedSearch) {
      refreshedSearch.setSelectionRange(refreshedSearch.value.length, refreshedSearch.value.length);
      refreshedSearch.addEventListener("input", (nextEvent) => {
        journalQuery = nextEvent.target.value;
        render();
      }, { once: true });
    }
  });
}

function navigate(view) {
  currentView = view;
  window.location.hash = view;
  render();
  root.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPartyModal(mode = "Quick Vote") {
  partyMembers.innerHTML = members.map((member, index) => `
    <label class="member-choice">
      <input type="checkbox" name="members" value="${member.name}" ${index < 3 ? "checked" : ""} />
      <img src="${member.avatar}" alt="" />
      <span>${member.name}</span>
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
  const nextNumber = Math.max(...journalEntries.map((entry) => entry.number)) + 1;
  entryPreview.textContent = [
    `• Entry #${nextNumber}`,
    `• ${data.get("title") || "Title"}`,
    `• ${data.get("year") || "Year"}`,
    `• Viewers: ${data.get("viewers") || "Viewers"}`,
    `• Status: ${data.get("status") || "Finished"}`,
    `• ${data.get("comment") || "Journal comment"}`
  ].join("\n");
}

function openJournalModal() {
  const viewerNames = activeSession?.members?.join(", ") || "Cameron, Dean";
  journalForm.elements.viewers.value = viewerNames;
  journalForm.elements.year.value = "2026";
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
  }, 2600);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    navigate(viewButton.dataset.view);
    return;
  }

  if (event.target.closest("[data-nav='home']")) {
    event.preventDefault();
    navigate("home");
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
      showToast(item.voted ? `Vote added for ${item.title}` : `Vote removed from ${item.title}`);
    }
    return;
  }

  if (event.target.closest("[data-range]")) {
    showToast("Custom Wrapped ranges will connect to the imported Journal.");
    return;
  }

  if (event.target.closest("[data-add-suggestion]")) {
    showToast("Queue suggestions will be enabled with Discord sign-in.");
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

  activeSession = {
    members: selectedMembers,
    mode: form.get("mode")
  };

  closePartyModal();
  navigate("tonight");
  showToast(`${activeSession.mode} room created for ${selectedMembers.length} people.`);
});

journalForm.addEventListener("input", updateEntryPreview);
journalForm.addEventListener("change", updateEntryPreview);

journalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(journalForm);
  const nextNumber = Math.max(...journalEntries.map((entry) => entry.number)) + 1;
  const viewers = String(data.get("viewers")).split(",").map((name) => name.trim()).filter(Boolean);

  journalEntries.unshift({
    number: nextNumber,
    title: String(data.get("title")).trim(),
    year: Number(data.get("year")),
    viewers,
    status: String(data.get("status")),
    comment: String(data.get("comment")).trim(),
    author: "Website recorder",
    date: "22/08/2026"
  });

  activeSession = null;
  journalForm.reset();
  closeJournalModal();
  navigate("journal");
  showToast(`Entry #${nextNumber} added to the website preview.`);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!partyModal.hidden) closePartyModal();
  if (!journalModal.hidden) closeJournalModal();
});

window.addEventListener("hashchange", () => {
  const nextView = window.location.hash.replace("#", "");
  if (nextView && nextView !== currentView) {
    currentView = nextView;
    render();
  }
});

render();
