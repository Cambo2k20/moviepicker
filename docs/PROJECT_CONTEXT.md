# Project context

## Purpose

This document describes the implemented product and architecture in the
current checkout. It is current-state evidence, not the future roadmap.

Read the [product direction](PRODUCT_DIRECTION.md) for the approved direction
for My Cinema, Discover and curated member profiles. Approved direction is not
shipped behaviour or implementation permission.

## Product intent

Discordians / Cine-Cord is a private website for a small Discord group that
maintains a shared movie list, chooses films together and keeps a long-running
Journal.

It replaces scattered manual tracking without discarding the group's existing
Discord routine. The site remains membership-gated even when a person can
authenticate successfully.

## Current implemented boundary

This section describes the committed feature/session-journal-handoff checkout
at commit f2ddd4f. A build or commit does not prove that matching migrations,
Edge Functions or frontend assets have been deployed to production.

### Authentication and membership

- Email/password and optional Discord OAuth sign-in are supported.
- Authentication alone does not grant access.
- Administrators approve group membership through the website.
- Membership and Row Level Security protect private group records.
- Discord profile synchronisation stores the verified server display name and
  avatar needed by the site without exposing the Discord account ID to the
  browser.
- Discord sign-in never bypasses the website approval gate.

### Shared movie list

Approved members can:

- Browse a poster-led shared list
- Search and filter it
- Inspect film details
- Vote
- Add films through the protected movie-lookup Edge Function
- Track shared watched status

External movie-database credentials remain in the Edge Function environment.
The browser receives safe film results only.

### Queue Roulette

Queue Roulette is the only implemented movie-night decision game.

It supports:

- Runtime and genre constraints
- Watched-state eligibility
- Age weighting
- One veto per participant
- Visible film divisions and truthful odds
- Persistent, resumable game state
- A selected-film result that can continue into a saved session

Consensus Sprint and Reel Bracket are disabled Coming soon placeholders. They
must not be described as functional.

### Movie-night sessions

A session stores:

- Host and approved participants
- Decision mode
- Resumable game state
- Selected-film snapshot
- Planning and watch status
- Watch date
- Journal draft

Confirming a film does not mark it watched. The authorised watch-completion
flow records the final viewers and creates or updates the corresponding
Journal relationship.

Once a session's Journal entry is saved, the session moves into the Journal.
Watched sessions without a saved entry remain in Sessions until their entry is
written.

### Journal

The Journal is an implemented top-level frontend area in this checkout.

It combines:

- Current Cine-Cord Journal entries
- Read-only historical entries imported from the three preserved Discord
  Journal channels
- Search across the combined catalog
- Creator/admin editing for current entries
- Guarded deletion for current entries
- Viewer records
- Session-linked entry handling

Historical imported entries remain read-only.

Copy for Discord remains available. Posting is a separate explicit action.
Post to Discord and Update Discord post call an authenticated server-side Edge
Function that uses stored webhook credentials. Saving or copying never posts
automatically, and an existing publication is updated rather than silently
duplicated.

The current manual Copy for Discord output follows this shape:

```text
- Entry #307
- Film title
- 2022
- Viewers: Adam, Dean
- Status: Finished
- Optional comment
————————————————————————————————————————————————————————
```

Current-entry deletion removes a confirmed Discord webhook message first when
one exists. If Discord refuses that deletion, Supabase data is left untouched.

### Statistics and challenges

The current statistics are based on the shared list and must not be described
as Journal statistics.

Final persistent Wrapped calculations, personal statistics, achievements and
challenge progress are not implemented.

### Member administration

Administrators can review access requests and manage approved membership and
roles. Removing membership revokes group access through Row Level Security.
Application membership administration is distinct from any future curated
member-profile directory.

## Product language

- **Discordians** — overall private group identity
- **Cine-Cord** — shared movie-list, movie-night and Journal area
- **The List** — the shared movie queue
- **Journal** — current and imported historical watched-film record
- **Movie-night session** — persistent room containing participants, game
  state, selected film and watch handoff
- **My Cinema** — approved future private personal-library area; not shipped
- **Discover** — approved future private recommendation area; not shipped

## Current persistence

Implemented persistence includes:

- Auth users and site profiles
- Group memberships and access requests
- Verified Discord server display fields
- Shared queue films, metadata and votes
- Movie-night sessions, participants, game state and selected-film snapshots
- Watch completion and Journal drafts
- Current Journal entries and viewers
- Read-only imported Journal volumes and archive entries
- Explicit Discord publication records

Not implemented:

- Personal My Cinema records, states, ratings, Favourites and lists
- Personal viewing-event history
- Curated profile publications and group profile directory
- Discover feedback or recommendation profiles
- Archive-entry claims
- Personal export and self-service account deletion
- Live multiplayer presence
- Final Wrapped, achievement or challenge persistence

## Visual direction

- Purple, grey and white Discordians identity
- Dark polished interface with strong poster imagery
- Clear hierarchy rather than dense dashboard clutter
- Full poster aspect ratio on phones and selected-film screens
- Mobile-first behaviour at narrow viewports
- Accessible contrast, visible focus and meaningful labels

Dialogs, wheels and result panels must remain usable without horizontal
overflow or clipped primary actions.

## Technical boundaries

- Frontend: Vite with active index.html, app.js and styles.css
- Backend: Supabase Auth, Postgres, Row Level Security, database functions and
  Edge Functions
- Hosting: static GitHub Pages frontend plus Supabase services
- Protected film metadata: supabase/functions/movie-lookup
- Discord server profile sync: authenticated Edge Function
- Explicit Journal publishing: authenticated Edge Function and server-held
  webhook credential

Movie Picker.dc.html and support.js are legacy/generated references and are not
active implementation targets.

The browser may hold a Supabase publishable key. It must never contain a
service-role key, Supabase secret key, TMDB credential, Discord client secret or
webhook credential.

The readable canonical SQL files under supabase predate some later migrations.
Build databases from the ordered migration chain and consult
the [Supabase notes](../supabase/README.md) rather than assuming the original
schema files are complete.

## Validation boundary

Available checks:

- npm run test:unit
- npm run test:db with a local Supabase stack
- npm run build
- npm run test:e2e

On Windows PowerShell, use npm.cmd when command resolution requires it.

Playwright design-preview checks prove browser presentation and interaction
against preview data. They do not prove authenticated database writes, RLS,
Edge Function deployment or production state.

Database integration checks use several authenticated identities and must cover
ownership, membership and cross-member denial when a change affects private
data.

Representative UI checks include approximately 390 × 844, 768 × 1024 and
1440 × 900 plus loading, empty, error and signed-out states where relevant.

## Handoff rule

Before changing this product:

1. Verify the exact checkout, branch and worktree.
2. Compare the active branch with main and inspect uncommitted changes.
3. Read the [product direction](PRODUCT_DIRECTION.md) for approved future
   behaviour.
4. Distinguish inspection, proposal, implementation and deployment.
5. Obtain explicit permission for the focused change.
6. Never describe unvalidated or undeployed work as live.
