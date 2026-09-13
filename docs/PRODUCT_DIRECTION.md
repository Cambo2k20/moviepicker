# Cine-Cord product direction

Status: Approved product direction

Approved: 24 August 2026

Scope: Cine-Cord, My Cinema, Discover and curated member profiles

Current position: Phase 0 is complete. Phase 1 is in progress: canonical movie
identity, owner-only personal-film records and the owner-private viewing-event
foundation are shipped, while the remaining private-data foundation is not.
Phase 2A is complete: its My Films experience and the compact film-detail
revision with numbered ratings were integrated into `main`, passed the
production release gates and were published on 13 September 2026. The numbered
detail controls supersede the detailed reaction artwork on that page; compact
reaction faces remain on My Films cards. Phase 2B is in progress: its secure
viewing-event storage is deployed, but history UI, current-Journal linking,
private notes and reviews remain unbuilt. Phases 2C–5 have not started.

## Purpose and authority

This is the authoritative product direction for Discordians / Cine-Cord. It
exists so future conversations, models and implementation branches can continue
from the same approved decisions rather than reconstructing them from chat
history.

This direction is a compass towards the agreed vision, not an immutable
contract. Cameron may change a preference, and implementation evidence may
show that an approved approach is wrong or unnecessarily complicated. In that
case, discuss the new evidence, make a deliberate decision and update the
direction. Preserving consistency means recording changes clearly, not
defending an outdated choice.

Status language:

- **Shipped** means implemented and validated in the current product boundary
  described by README.md and docs/PROJECT_CONTEXT.md.
- **Approved direction** means decided but not necessarily built.
- **Deferred** means intentionally excluded from the first relevant release.
- **Out of scope** means a new explicit product decision is required.
- **Superseded** means a later dated amendment intentionally replaced the
  earlier rule.

Approval of this direction is not blanket implementation permission. Every
phase still requires a focused branch, an implementation plan and Cameron's
explicit approval. Applying database changes, deploying Edge Functions,
publishing the frontend and merging branches are separate approval gates.

If another document conflicts with this one about future behaviour, this
document wins. For claims about what is shipped, verify the authoritative
checkout and correct the stale current-state document.

## Vision and principles

Discordians is the private group identity. Cine-Cord is its shared movie-list,
movie-night and Journal companion. My Cinema gives each approved member a
private personal library. Discover uses that private library and explicit
session choices to help the member find films they may enjoy.

The product should feel like a small group's beautifully maintained cinema,
not a public social network or a generic analytics dashboard.

- Membership approval and Row Level Security are product requirements.
- Shared and personal actions must always be distinguishable.
- Personal activity stays private unless the member publishes a specific item
  to their group-only profile.
- No personal action silently changes Cine-Cord's list or Journal.
- Recommendation explanations must be truthful and evidence-based.
- Poster artwork remains prominent, especially on phones.
- Purple, grey and white remain the Discordians identity.
- Mobile is a first-class experience.
- External credentials and privileged Supabase keys never enter browser code.
- Manual Copy for Discord remains available.

## Product map

The sidebar becomes an area switcher.

### Cine-Cord — shared

- The List
- Watch a Film, the approved future label for the currently shipped Pick
  Tonight area
- Sessions
- Journal
- Group Stats, the approved future label for List Stats; its calculations stay
  list-derived until Journal statistics receive a separate decision
- Member Profiles, when curated profiles launch

### My Cinema — private by default

- Overview
- My Films
- My Lists

### Discover — private recommendation bridge

- For You
- Because You Liked…
- Mood Compass

These are entry modes into one discovery journey, not three separate products.

### Admin — administrators only

- Members
- Access requests and roles

Admin membership controls remain distinct from the group-visible Member
Profiles directory.

## Ownership boundary

| Data or action | Default visibility | Shared effect |
| --- | --- | --- |
| Cine-Cord list, votes, sessions and Journal | Approved group | Already shared |
| My Cinema state, rating, review, private note and lists | Owner only | None |
| Viewing events and personal viewing history | Owner only | None |
| Discover answers, feedback and inferred taste | Owner only | None |
| Top Four | Approved group after the member saves it to their profile | Profile only |
| Featured list, rating or review | Approved group after explicit publication | Profile only |
| Suggest for Cine-Cord | Explicit shared action | Uses shared-list rules |

Application administrators may manage membership. They receive neither an
interface nor an application database policy granting access to another
member's private My Cinema, viewing, list, note or Discover data. Administrator
role never appears as an override in a private-table RLS predicate.

Profile publication exposes only deliberately published records, never the
underlying private library.

## Decision register

All decisions below were approved and last reviewed on 24 August 2026. A future
change adds an amendment directly under the affected decision using:

> Amended YYYY-MM-DD — what changed, what it replaced and why.

An amendment may be driven by Cameron changing direction, usability evidence,
security constraints or implementation learning. It is not a failure of the
plan. Dependent sections must change in the same documentation pass.

### Decision 001 — Product areas

Status: Approved direction

Cine-Cord remains the group space. My Cinema is personal. Discover bridges
private taste and new-film discovery. Admin remains permissioned management.

Personal films never enter the shared list automatically. Interfaces must use
explicit destinations such as Add to My Cinema, Add to Personal List and
Suggest for Cine-Cord. An Add to Both action is acceptable only when both
consequences are shown separately. Decision 007 adds Member Profiles to
Cine-Cord.

Watch a Film and Group Stats are approved navigation labels, but they are
introduced only in an authorised area-navigation change rather than renamed as
a side effect of unrelated work. When My Cinema ships, the existing shared
statistic Current favourite becomes Most voted so Favourite consistently means
the private personal marker.

### Decision 002 — Curated profiles and privacy

Status: Approved direction

Profiles are visible only to approved Cine-Cord members. There is no public
profile mode.

Deliberately curated profile content may include:

- Verified avatar and display name
- Optional short introduction
- Top Four
- Featured personal lists
- Individually shared Favourite films
- Individually shared ratings and short reviews

Owner-only content includes:

- Full My Cinema library and watchlist
- Private custom lists and complete viewing history
- Private notes
- Discover answers, feedback and inferred taste
- Ratings and reviews not explicitly published

An optional private note is a personal memory aid that can never be published.
It is distinct from the optional review, which may be deliberately shared.

Publishing profile content never adds a film to Cine-Cord.

### Decision 003 — Five-level enjoyment reaction

Status: Approved direction

Exact labels:

1. Didn’t like it
2. Not for me
3. It was okay
4. Really liked it
5. Loved it

Rules:

- No half-points.
- Favourite is a separate heart-style marker.
- A short review is optional.
- Each member has one current editable overall rating per film.
- A member may clear their rating. Clearing removes its Discover signal and any
  published copy without changing state, Favourite, lists or viewing events.
- Rating adds the film to My Cinema.
- Rating normally marks Watched except when Did Not Finish is explicit.
- Rating never adds the film to Cine-Cord.
- Rewatches are separate events and do not require new ratings.
- Ratings and reviews stay private unless deliberately published.
- Private ratings may train that member's Discover recommendations.
- Top Four is curated, never automatically selected from ratings.

### Decision 003A — Rating interaction and artwork

Status: Amended approved direction, 13 September 2026

> Amended 2026-09-13 — Cameron found the rating system too dominant on film
> details and approved compact numbered controls and a simpler detail layout.
> This supersedes the 30 August approval of face controls and the large patron
> stage on film details. The earlier artwork and QA remain historical evidence.

Film details use five numbered buttons, 1–5, on one row at every supported
viewport, with at least 44px targets. The saved number has a violet fill and
pressed state; each accessible name includes the number and exact enjoyment
label from Decision 003. A short text label sits beside or below the row.

Hover and keyboard focus preview the label without saving. Leaving restores
the saved label or "Choose a rating" when unrated. Arrow keys, Home and End move
focus; click, Enter, Space or touch saves. Controls remain visible after saving
at all sizes. Clear removes only the rating. No detailed patron, face image,
large question or permanent consequence paragraph appears in the detail editor.
Automatic changes to Watched receive a brief save notice; DNF stays explicit.

Compact faces on My Films cards are unchanged by this detail-page revision.
Yellow remains confined to those private reaction assets and is not a general
Cine-Cord accent. Existing artwork files remain versioned; the patron images
are no longer imported by the active application.

### Decision 004 — Film states

Status: Approved direction

Visible states:

- Want to Watch
- Watched
- Did Not Finish

An implicit unset state is allowed when a film enters My Cinema through a
Favourite, list or other action without a viewing state.

Want to Watch records intent. Watched means completed. Did Not Finish means
started but not completed. A DNF film may be rated without becoming Watched.
Finishing it later changes its current state to Watched while retaining the DNF
event. Rewatches are events, not states. Want to Rewatch is deferred as a core
state and may initially be a custom list. Not Interested is Discover feedback.
Personal states never alter Cine-Cord's shared watched status.

### Decision 005 — Personal lists

Status: Approved direction

Built-in smart collections:

- All Films
- Want to Watch
- Watched
- Did Not Finish
- Favourites

They cannot be renamed or deleted. Rated, Reviewed, Recently Added and Recently
Watched are filters or sorts rather than more permanent collections.

Custom lists require a title and may have a short description. They are private
by default and have one owner in the first release. A film may belong to several
lists but not appear twice in one list. Adding it adds it to My Cinema.
Removing it from a list does not remove ratings, history, Favourite status or
other memberships. Deleting a list never deletes ratings or history.

Manual order is preserved; temporary sorting does not overwrite it. Custom
cover creation and collaborative editing are deferred.

A member may feature individual lists on their profile. Featuring a list
creates a separate publication snapshot containing the exact title,
description, film order and film set exposed to approved members. Group
members read that publication only; they never read the private list or
list-item rows.

Later private edits do not reach the profile automatically. The owner sees
Unpublished changes and chooses Update Profile Version to replace the
snapshot. Removing the feature deletes the publication immediately. Published
lists never expose private ratings, reviews, notes or dates and never add films
to Cine-Cord. Top Four is not a custom list.

### Decision 006 — My Cinema structure

Status: Approved direction

My Cinema contains Overview, My Films and My Lists.

Overview is a personal cinema shelf with Top Four editing, short Want to Watch
and Recently Watched rows, Favourites, recent or featured lists and, after ten
rated films, a restrained Taste Snapshot. Below that threshold it asks for
more ratings rather than inventing confidence.

Top Four editing is private until the member chooses Save to Profile. Saving is
the explicit publication action: it updates the four group-visible slots
together. Unsaved drafts are invisible, and clearing a slot becomes visible
only after saving.

My Films is the complete poster-led library with search; state, Favourite,
rating, genre, decade and list filters; and recently added, recently watched,
title, year and rating sorts. Cards retain clear artwork and show only compact
personal indicators.

My Lists provides list cards, poster previews, film counts, last-updated
information and creation, editing, ordering and deletion flows. Each list says
Private, Published or Unpublished changes and shows its own last-published date
when a profile snapshot exists.

My Cinema has protected film search. Adding, rating, favouriting or listing a
result remains personal. Suggest for Cine-Cord is separate.

One unified film-detail view adapts to context. From My Cinema it prioritises
private state, reaction, Favourite, lists, history, private note and review.
From Cine-Cord it prioritises shared status, votes, suggester, sessions and
Journal information. When both apply, visibly separate My Cinema — Private
from Cine-Cord — Shared with the group. Editing one never silently edits the
other.

> Amended 2026-09-13 — The Phase 2A detail page uses one uncropped poster, one
> title and one metadata line. Desktop places the poster beside the information
> and controls; phone and tablet lead with poster/title, then the originating
> area's controls, synopsis and the other area's context. Remove duplicate facts
> and the visible TMDB ID. Keep personal state, numbered rating and Favourite
> compact and clearly private. Films outside My Cinema offer an explicit add
> with a state choice. Removal belongs under More options. Notes, reviews,
> viewing events and lists stay in their later phases with no roadmap filler
> or empty editors on the current page.

Profile management is reached through View My Profile and Edit Profile rather
than becoming a fourth private-data tab.

### Decision 007 — Curated member profiles

Status: Approved direction

Profiles may contain verified identity, an optional introduction of at most
160 characters, an ordered Top Four, published list snapshots, and individually published
Favourite films, ratings and short reviews.

Top Four is manually selected and ordered. It is independent from ratings and
Favourite status. Selecting films does not publish a draft; Save to Profile is
the explicit publication act. Published reactions use language and artwork,
such as Really liked it, rather than only 4/5.

Reviews may be marked Contains spoilers and remain collapsed until revealed.
Sharing a review also shares its rating; sharing a rating does not expose a
private review.

Published ratings, reviews and Favourite markers are explicit snapshots. Later
private edits show Unpublished changes until the member republishes. Clearing a
rating, deleting a review or removing a Favourite immediately revokes the
corresponding publication so deleted personal content cannot remain visible.

Edit Profile provides an exact preview and every item clearly says Private or
Shown on profile.

Cine-Cord gains a Member Profiles page with avatar, display name, Top Four
preview and View Profile. Member names and avatars elsewhere may link to it.
Admin — Members remains separate.

Profiles exclude followers, friend requests, likes, comments, direct messages,
automatic activity feeds, automatic taste labels and competitive rankings.

### Decision 008 — Discover

Status: Approved direction

Discover has three entry modes:

1. For You
2. Because You Liked…
3. Mood Compass

All produce one five-film Discovery Deck.

For You uses private history with different signal strengths. Loved it,
Favourites and Top Four are strongest positives. Really liked it is positive.
It was okay is weak or neutral. Not for me and Didn’t like it are negative.
Did Not Finish without a rating is a weak negative engagement signal. An
explicit rating always outranks DNF for taste: a positive rating remains
positive, and its explanation cites the rating rather than implying that
abandonment meant dislike. Want to Watch signals interest, not enjoyment. A
completed watch alone does not imply enjoyment. Private review text is not
analysed in the first release.

Discover begins basic history personalisation after five rated films. Below
that threshold it says results are based mostly on today's choices rather than
claiming strong personalisation. The ten-rating Taste Snapshot threshold in
Decision 006 is deliberately higher because a written taste summary makes a
stronger claim than ranking candidates.

Because You Liked… starts from one selected film and may combine a second. The
first release uses structured metadata and explicit filters, not unrestricted
natural-language interpretation.

Mood Compass asks no more than three primary questions:

1. Desired experience: comforting, funny, exciting, tense, emotional, strange
   or thought-provoking.
2. Available energy: easy watch, balanced or demanding.
3. Adventure level: familiar territory, a mixture or surprise me.

Optional filters cover runtime, genres, release period, language, watched-film
inclusion and content avoidance. Session answers do not permanently rewrite
the taste profile. Mood answers and temporary constraints live only in the
active discovery session and are not persisted. Persistent feedback such as
Not Interested is stored separately.

A normal deck contains three close recommendations, one adjacent choice and
one deliberate wildcard. Every card includes a truthful Why this fits
explanation assembled from actual signals. There are no invented match
percentages.

Not Now and Show Me Another replace a card with another candidate of the same
slot type, preserving the three-one-one composition for the session. When hard
constraints leave fewer than five eligible films, Discover shows the valid
results it has, names the limiting constraint and offers to relax it. It never
pads the deck with a film that violates a hard constraint.

Actions:

- Add to Want to Watch
- Already Seen — Rate It
- Not Now
- Not Interested
- Show Me Another
- Suggest for Cine-Cord
- Open film details

Not Now affects only the current session. Not Interested is persistent private
feedback. Another result does not imply dislike. Suggest for Cine-Cord is the
only shared action.

The first recommender is a transparent hybrid: retrieve protected candidates,
apply hard constraints, score against positive and negative personal signals,
re-rank for variety and novelty, then explain the contributing signals.

Candidate retrieval and external-metadata constraints run through the
movie-lookup Edge Function. Personal scoring, re-ranking and explanation may
run in the browser over rows the member can already read or in an authenticated
database or server function executing under that member's RLS context. They
never use a service-role shortcut or gain cross-member access to private taste
data.

A heavyweight collaborative model is deferred because the small group will
initially have too little data. Embeddings may be considered later. The
movie-lookup Edge Function gains protected server-side capabilities; its
external credential never enters app.js.

Deferred from the first Discover release:

- Group-blended recommendations and collaborative sessions
- Conversational AI chatbot
- Public recommendation profiles and social reactions
- Automatic streaming availability
- Infinite scrolling
- Review-text analysis

### Decision 009 — Personal data lifecycle

Status: Approved direction

| Category | Examples | Visibility |
| --- | --- | --- |
| Private personal | States, ratings, reviews, notes, lists, viewing events, history, Favourites and Discover feedback | Owner |
| Curated profile | Top Four, featured lists, published reactions and reviews | Approved group |
| Shared group | Cine-Cord list, votes, sessions, Journal and viewers | Group |

When a completed Cine-Cord session or Journal entry links a viewer through a
real profile ID and resolves the film through a verified external or canonical
movie identity, it appears automatically as a source-linked My Cinema viewing
event. A linked session's verified movie identity may supply that resolution.
A title-and-year-only match is a suggestion that the member confirms, never an
automatic link.

A shared FINISHED result creates a Watched event and current state. A shared
DNF result creates a Did Not Finish event and current state. The link creates
no rating, Favourite, private note, review or custom-list membership. The event
is owner-only even though the underlying Journal viewer list is shared. Its
date and completion outcome follow the Journal, and the member may hide it from
My Cinema without changing the shared entry.

The imported archive stores names rather than verified profile IDs, so those
names are never silently assigned to accounts. A later Find My History flow
suggests possible matches for private review. The member must claim or reject
each result. A claim does not rewrite the archive and may be withdrawn.

Members edit their own state, rating, Favourite, private note, private review,
lists, manual viewings, Discover feedback and publication choices.
Source-linked group facts are corrected through the authorised Journal flow.

The UI distinguishes:

- Remove personal details
- Delete manual viewing event
- Hide from My Cinema
- Correct shared history

Private deletion never deletes a shared film, session, Journal entry or another
member's data.

Membership removal immediately revokes access and hides the curated profile but
does not automatically destroy private data or shared history. Reapproval
restores retained private data.

An authenticated removed member receives a restricted account-management
surface rather than ordinary Cine-Cord, My Cinema or Discover access. It allows
only personal export, private-data deletion, account closure and a request to
correct shared historical attribution. These operations are owner-only and do
not expose any group or other-member data.

Account closure is separate. It revokes active sessions and sign-in access,
deletes private My Cinema, Discover and publication data, and removes the
navigable profile. Shared group history remains. Any shared relationship that
must preserve attribution is re-associated with a non-login historical
identity displayed as Former member rather than retaining a link to the closed
profile. It does not delete group films, sessions or Journal entries. Phase 1
must design foreign keys and historical identity so this outcome is possible;
the current profile relationship is not assumed sufficient.

Personal export includes films, states, ratings, reviews, private notes,
Favourites, lists, viewing history, Discover feedback and publication choices,
but no other member's private data.

Normal private-table access requires owner predicates plus approved membership
through RLS. Narrow account-management operations for a removed member are the
only non-membership-gated exception; they authenticate the owner and expose
only export or deletion operations rather than general table access.

Group profile reads target explicit publication snapshots rather than private
source tables. Application administrators receive no private-table override.
Privileged and external secrets remain server-side.

### Decision 010 — Release plan

Status: Approved direction

This initiative is not one giant release.

Each phase is a milestone, not a single branch. A milestone may use several
focused branches and review checkpoints. Unfinished navigation stays hidden or
clearly unavailable until the complete user-facing milestone passes its gates.

#### Phase 0 — Documentation

Status: Complete and maintained on main

- Establish this document.
- Correct stale current-state documents.
- Require future agents to read the direction.
- Make no product, database or deployment change.

#### Phase 1 — Private data foundation

Status: In progress

Shipped foundation:

- Canonical movie identity and safe metadata
- Owner-only personal-film records with states, reactions and Favourites
- Owner-only viewing-event records for repeatable Finished and Did Not Finish
  history
- Additive migrations, explicit grants and owner-only RLS
- Production migration-parity verification before frontend deployment

Still required in this phase:

- Add private notes, reviews, lists, Discover feedback and explicit
  profile-publication entities.
- Define the restricted removed-member, export, deletion and historical-
  identity foundations required by Decision 009.
- Test several authenticated identities.
- Leave current group behaviour unchanged.

Exact SQL requires a separate review. This document does not pre-approve table
or function definitions.

#### Phase 2 — My Cinema Core

Status: In progress; Phase 2A complete and Phase 2B in progress

This is the first user-facing release, delivered through smaller batches:

##### Phase 2A — Personal film and reaction core

Status: Complete and deployed on 13 September 2026

- Area-switching shell and My Films
- Protected personal film search
- States and five-level reactions
- Favourite marker
- Unified private and shared film details

The paired artwork accepted on 30 August passed its original responsive QA.
The 13 September amendment to Decisions 003A and 006 superseded the detail-page
presentation with numbered ratings and compact film information while retaining
the compact face artwork on My Films cards. The revision passed responsive,
interaction, database-parity and production deployment gates and is live from
merge commit `4af2b0a`.

##### Phase 2B — History and personal detail

Status: In progress; viewing-event foundation deployed on 13 September 2026

- Viewing-event history UI and manual event controls
- Current stable-identity Cine-Cord history linking
- Private note and optional review
- Per-film personal-data removal and source-linked hiding

The owner-private viewing-event migration passed authenticated database tests,
production migration parity, unit tests, build and Playwright before deployment
from merge commit `521ea03`. It stores repeatable Finished or Did Not Finish
events without changing the current personal-film row. It deliberately adds no
history UI or automatic Journal linking; those remain separately reviewed
Phase 2B patches.

##### Phase 2C — Overview and lists

Status: Not started

- Overview, My Films and My Lists as the complete three-view area
- Built-in smart collections
- Private custom lists and ordering
- Published-list snapshot status
- Empty, loading and error states for the complete personal library

Profiles and Discover remain unreleased during this phase.

#### Phase 3 — Discover

Status: Not started

- Three entry modes and five-film deck
- Truthful explanations
- Feedback, rating and Want to Watch handoffs
- Explicit Suggest for Cine-Cord
- Protected server-side retrieval

New Edge Function actions stay backward compatible and are deployed before the
frontend requests them.

#### Phase 4 — Curated profiles

Status: Not started

- Editor and exact preview
- Top Four, featured lists and published reactions or reviews
- Spoiler handling
- Group-only Member Profiles directory
- Dedicated multi-member publication security tests
- A removed publisher's profile, Top Four, lists and reviews disappear
  immediately for another approved member and reappear only after reapproval
  and a valid publication state

#### Phase 5 — History and account controls

Status: Not started

- Find My History and claim withdrawal
- Personal export
- Restricted removed-member account management
- Self-service private-data deletion and account closure
- Shared-history anonymisation
- Former-member attribution

The Phase 1 schema must support this later lifecycle.

## Conceptual data model

Final table names may differ, but preserve these concepts:

- **Movie:** canonical external identity and safe metadata independent of
  shared or personal membership.
- **Personal film:** owner, current state, current rating, Favourite and private
  review plus a non-publishable private note.
- **Viewing event:** owner, completion outcome of Finished or Did Not Finish,
  optional date and optional shared source. It never carries a rating; the
  single current rating belongs to the personal film.
- **Personal list:** owner, title, description and deliberate order plus
  whether a separate publication currently exists.
- **List item:** film membership and deliberate position.
- **Profile publication:** an explicit snapshot of the exact Top Four, list,
  reaction or review deliberately exposed.
- **Discovery feedback:** private persistent signals such as Not Interested.
- **Discovery session:** active-session-only mood and constraints that are not
  persisted.
- **Historical identity:** a non-login attribution used when shared group
  history must survive account closure without retaining a navigable profile.

Implementation plans must define deletion, uniqueness, foreign keys, grants and
RLS before migrations. Never authorise from user-editable metadata.

## Validation gates

Every user-facing phase requires:

- npm run test:unit
- Relevant local database tests through npm run test:db
- npm run build
- npm run test:e2e
- Browser checks around 390 × 844, 768 × 1024 and 1440 × 900
- Loading, empty, error, signed-out and removed-member states
- Multi-member tests proving cross-member reads and writes fail
- Verification that private keys and external credentials stay server-side

Repository documentation uses portable npm commands. Windows PowerShell agents
may invoke npm.cmd instead when command resolution requires it.

Build success does not prove database writes, RLS, interactions or deployment.
Each is verified separately.

No hosted migration, Edge Function deployment, frontend publication or branch
merge occurs without explicit permission.

## Deferred and out of scope

Deferred:

- Collaborative personal lists and custom list covers
- Want to Rewatch as a core state
- Group-blended Discover
- Automatic streaming availability
- Embedding-based recommendation
- Automatic profile taste labels
- Final challenge and achievement rules

Out of scope without a new decision:

- Public profiles
- Followers, friend requests, likes, comments or direct messages
- Automatic activity feeds
- Automatic transfer from My Cinema to Cine-Cord
- Private-review analysis for recommendations
- Browser-held TMDB, service-role, webhook or other private credentials
- Treating authentication alone as approved group access

## Handoff and change control

Before work covered by this direction:

1. Read this file and the [current project context](PROJECT_CONTEXT.md).
2. Verify the branch, worktree and current shipped state.
3. State the decision and release phase being implemented.
4. Identify conflicts before editing.
5. Obtain explicit permission for the focused implementation.
6. Preserve unrelated behaviour and privacy boundaries.
7. Report validation, risk and anything not deployed.

Treat the decisions as the best current route towards the vision, not dogma.
Do not silently rewrite one, but do challenge it when Cameron changes their
mind or evidence shows a better approach. Record the dated amendment, mark
replaced language Superseded and update every dependent section in the same
documentation change.
