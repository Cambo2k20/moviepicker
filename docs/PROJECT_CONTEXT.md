# Project context

## Product intent

Discordians / Cine-Cord is a private website for a small group of friends who maintain a shared movie list and watch films together. It should replace scattered manual tracking without losing the informal Discord-based routine the group already uses.

The product is broader than a random movie picker. Its main areas are:

- the shared movie list and votes;
- movie-night setup and decision games;
- persistent, resumable movie-night sessions;
- the long-running Journal of watched films;
- group and personal statistics, achievements and challenges;
- member administration.

## Audience and access

- The audience is a known private group, not the public.
- Creating or signing into an account must not by itself grant access to private group data.
- Membership approval and Supabase Row Level Security are part of the product model, not optional implementation details.
- Administrators manage access and roles from the website.

## Product language

- **Discordians** is the overall group/companion identity.
- **Cine-Cord** is the movie-list and movie-night area.
- **Journal** is the historical record of watched films.
- **Movie-night session** is the persistent room containing participants, decision-game state and the selected film.

## Current experience

### Shared movie list

Members can browse a poster-led movie collection, search and filter it, inspect full film details, vote and add films through a protected metadata lookup. The selected-film presentation must preserve the full poster aspect ratio on phones rather than cropping away recognisable artwork.

### Queue Roulette

Queue Roulette chooses from eligible list entries. Current controls include runtime, genre, watched status, age weighting and member vetoes. The wheel should communicate real film divisions clearly:

- visible boundaries between film portions;
- readable film labels;
- correct poster/background scaling;
- no misleading decorative segments;
- usable controls and result presentation on narrow phone screens.

### Persistent movie-night sessions

A session records the host, approved participants, decision mode, resumable game state and selected-film snapshot. A refresh should not silently destroy an active session. The website maintains session history separately from Journal entries.

A selected result can be copied manually into Discord. The editable output follows this general shape:

```text
- Entry #307
- Men
- 2022
- Viewers: Adam, Dean
- Status: Finished
- I wish I had a comment to make but I don't know what the fuck I just saw. Don't watch this movie
————————————————————————————————————————————————————————
```

Keep this manual copy path even if a later Discord integration is considered. Do not add automatic posting or request Discord permissions without an explicit decision.

### Journal

Journal entries and their viewers are persistent. Writes use database functions and security policies so users cannot gain access merely by manipulating browser requests.

### Statistics and challenges

Wrapped/statistics screens exist, but their final persistent calculation model is not complete. A desired future direction is a challenge system with both server-wide and personal progress, for example genre milestones such as watching 100 comedies. Treat challenge definitions, rewards and anti-gaming rules as product design work rather than inventing them silently inside an unrelated task.

## Visual direction

- Purple, grey and white Discordians identity.
- Dark, polished interface with strong poster imagery.
- Clear hierarchy rather than dense dashboard clutter.
- Mobile is a first-class layout, not a compressed desktop fallback.
- Poster art should stay visible on movie cards and selected-film screens.
- Dialogs, wheels and result panels must fit within the phone viewport without unusable clipping.
- Maintain accessible contrast, visible focus states and meaningful button labels.

## Technical boundaries

- Active frontend: `index.html`, `app.js` and `styles.css`.
- Build tool: Vite.
- Backend: Supabase Auth, Postgres, RLS, database functions and Edge Functions.
- Deployment: static GitHub Pages frontend plus Supabase backend.
- `support.js` is generated legacy runtime code and should not be hand-edited.
- `Movie Picker.dc.html` is a legacy design reference, not the active application.
- The browser may use the Supabase publishable key. Service-role keys and external movie-database credentials must remain server-side.

## Persistence boundary at handoff

Persistent:

- authentication and profiles;
- group membership and access requests;
- Journal entries and viewers;
- movie list, metadata and voting;
- movie-night sessions, participants, selected-film snapshots and resumable Queue Roulette state.

Not yet persistent or integrated:

- Discord posting or synchronisation;
- live multiplayer presence;
- final Wrapped calculations;
- server-wide and personal challenge progress.

## Candidate future work

These are backlog directions, not permission to implement all of them in one change:

1. Verify the persistent-session migration and recovery flow against real Supabase data.
2. Add additional decision games such as Consensus Sprint and Reel Bracket.
3. Design persistent server-wide and personal statistics/challenges.
4. Improve automated testing around pure selection logic and Supabase mapping.
5. Split the growing `app.js` and `styles.css` into maintainable modules without changing behaviour.
6. Consider Discord synchronisation only after defining credentials, permissions, conflict handling and the source of truth.

## Definition of done for a change

- The requested behaviour is implemented on a focused branch.
- Existing private-access and RLS assumptions remain intact.
- `npm run build` succeeds.
- Relevant phone, tablet and desktop states are manually checked.
- Database changes are documented and do not expose secrets.
- No branch is merged unless Cameron explicitly asks for it.
