# Codex brief — Cine-Cord visual refinement pass (Direction A · Marquee)

Drop this in the repo as `docs/design-refinement-pass.md` and hand Codex **one task per branch**. Every task below is self-contained: file, change, and the check that proves it.

---

## Standing constraints — paste at the top of every Codex task

> Repo: Discordians / Cine-Cord. Read `AGENTS.md` and `docs/PROJECT_CONTEXT.md` first.
> Active files only: `index.html`, `app.js`, `styles.css`, `assets/`. Do **not** edit `Movie Picker.dc.html` or `support.js`.
> Work on a focused `feature/` branch off up-to-date `main`. Never commit to `main`, never merge, rebase, delete or force-update a branch.
> Preserve: purple/charcoal/white identity; Barlow Condensed display + Space Grotesk UI; 2:3 posters on phones and in selected-film views; mobile as a first-class layout; accessible contrast, visible focus, practical touch targets; honest Coming Soon states; the editable manual Copy for Discord output; membership gating and all existing behaviour.
> Do not add features, backend calls, dependencies, gradients, glassmorphism or neon. Do not replace the palette. Do not hide information to make screens look cleaner.
> Validate with `npm run test:unit`, `npm run build`, `npm run test:e2e`, then check `390×844`, `768×1024` and `1440×900` at `http://localhost:5173/moviepicker/?design-preview`, including loading, empty, disabled, error and signed-out states. Report files changed, checks run and unresolved risks.

---

## Sequencing

Land in this order — 1 and 2 change the values every later task depends on.

| # | Task | Files | Size |
| --- | --- | --- | --- |
| 1 | Token and surface pass | styles.css | quick |
| 2 | Type floors | styles.css | quick |
| 3 | Poster grid density | styles.css | quick |
| 4 | Selected-film poster ratio | styles.css (+ small markup) | quick–moderate |
| 5 | Phone hero and sticky toolbar | styles.css | quick |
| 6 | Card footer and vote target | styles.css | quick |
| 7 | Purple discipline | styles.css | quick |
| 8 | Stylesheet hygiene | styles.css | quick |
| 9 | Roulette stage rebalance | styles.css, app.js | moderate |
| 10 | List Stats made poster-led | app.js, styles.css | moderate |
| 11 | Pick Tonight mode hierarchy | app.js, styles.css | moderate |
| 12 | Loading, empty and locked states | app.js, styles.css | moderate |

Tasks 1–8 are one branch each or two batched branches (1+2+3, then 4–8). Tasks 9–12 must be separate branches — they touch `app.js` render output.

---

## 1 · Token and surface pass

**Change** in `:root`: `--border: #3f4453`, `--border-soft: #323642`. Add `--surface-raised-grad: linear-gradient(180deg,#1a1d25,#15171e)` and `--shadow-raised: 0 14px 34px rgba(4,5,9,0.32)`.
Apply the gradient + border + shadow to: `.modal`, `.access-card`, `.active-session`, `.discord-copy-card`, `.list-stat-grid article`, `.stat-feature-list article`, `.roulette-pool`, `.roulette-veto-panel`, `.film-detail-drawer`. Add a 1px top highlight via `box-shadow: inset 0 1px rgba(255,255,255,0.05), var(--shadow-raised)`.
Two elevation levels only — page and raised. Do not introduce a third.

**Check** `--border` reaches ≈2.2:1 against `#111217`; every panel edge is visible at 1440 without zooming; no element gains a purple tint in this task.

## 2 · Type floors

**Change** minimum sizes across `styles.css`: mono/eyebrow labels `11px` with `letter-spacing: 0.12em` (replaces the 8/9/10px variants), secondary body text `13px`, poster card title `16px`, `.detail-overview` `14px/1.7`, `.detail-facts > span` `12px` at `min-height: 30px`, `.detail-ledger dt` `11px` / `dd` `13px`.
Barlow Condensed stays for page titles and numerals only.

**Check** no rule below 11px remains except `.sr-only`; at 390px the card metadata and “Added by” lines are legible without zooming.

## 3 · Poster grid density

**Change** delete the four fixed column breakpoints (`repeat(4)` base, `1280→6`, `1440→7`, `1600→8`) and the `max-width:1250px` override. Use `grid-template-columns: repeat(auto-fill, minmax(206px, 1fr))` with `gap: 30px 20px`, `.list-view { max-width: 1360px; margin: 0 auto; }`. With the detail drawer open, `minmax(186px, 1fr)`. Keep 2 columns ≤640px and 3 columns ≤860px.
Poster card title: `font-size:16px; line-height:1.25;` with a 2-line clamp (`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical`) instead of `white-space:nowrap` + ellipsis. Metadata line stays one line.

**Check** at 1440 there are 5 columns and no film title in the preview data is truncated (`Interstellar`, `Spirited Away`, `The Martian` are the tests); no horizontal overflow at any tested width.

## 4 · Selected-film poster ratio — highest value

**Change** `.detail-poster { aspect-ratio: 2/3; }` — remove `16/10` and the `max-height:280px` mobile cap.
Desktop drawer: make the head a two-column grid, poster `width:150px` (2:3) beside title, year, status pill and `.detail-facts`; the ledger and overview stay full width below.
Phone sheet: poster `width:min(188px,46%)`, centred, 2:3, with title/facts beside it; sheet keeps `max-height:86dvh`.
Also give the confirmed Roulette result a real poster: `.roulette-winning-poster` at `width:min(300px,42vw)`, 2:3, top-aligned in the left column.

**Check** open Interstellar at 390 and 1440 — the full artwork is visible, nothing is cropped, title and status still sit in the first screen of the sheet.

## 5 · Phone hero and sticky toolbar

**Change** at ≤640px: `.list-hero .page-title { font-size: clamp(34px,9vw,40px); }` on one line; subtitle to a single 13px line; `.list-hero-actions` becomes one full-width 48px primary plus a 48×48 icon button (not two stacked full-width buttons). Make the search + status-tab row `position: sticky; top: 0;` with the page background at 96% opacity, 56px tall; keep `Filters & sort` as the disclosure, collapsed by default, as a 44px control beside search.

**Check** at 390×844 the first poster card's top is ≤ 370px (it is 515px today) and the sticky row does not cover cards while scrolling.

## 6 · Card footer and vote target

**Change** `.poster-vote` to `width:48px; height:44px` with the count in Barlow Condensed 18px; voted state is a 2px `--purple` edge. Remove the `border-top` from `.poster-card-footer`, use `gap:12px`, avatar 24px, “Added by” at 12px. Card hover: 1px `--purple` edge + `translateY(-2px)` + `--shadow-raised` on the poster frame only.

**Check** the vote hit box measures ≥44px in devtools at 390px; disabled (watched) state still reads as disabled.

## 7 · Purple discipline

**Change** `.primary-button` becomes flat `background: var(--purple)`, `box-shadow: none` (keep the 1px purple border and white label — 4.9:1). Remove the purple tint backgrounds from `.active-session` and `.discord-copy-card`; use the raised surface with a 2px `--purple` left edge instead. `.nav-item.is-active` loses the gradient wash — keep the 2px purple edge plus `rgba(255,255,255,0.045)`.
Rule: one filled purple element per view. On Sessions that is *Open Active Session*; *View result* and *Copy only* become secondary/outline.

**Check** no screen shows more than one filled purple control; focus rings stay `--purple-light` and visible on every interactive element.

## 8 · Stylesheet hygiene

**Change** delete the dead blocks (`.film-row*`, `.ledger-entry*`, `.journal-*`, `.wrapped-summary`, `.summary-stat`, `.award-*`, `.queue-row`, `.vote-control`, `.vote-button`, `.list-overview*`, `.mode-list` legacy variants) — verify with a grep against `app.js` before removing each. Collapse the duplicate `.list-hero`, `.list-toolbar`, `.filter-tabs`, `.filter-tab` declarations into one each, and the duplicate `prefers-reduced-motion` block into one. Standardise control heights on 42 / 48 / 56 and radii on 2px (controls) and 16px (phone sheet only). Extract one `.fact-chip` used by the detail drawer, the Roulette result and Sessions.

**Check** `npm run build` succeeds, no visual diff at the three viewports, and the stylesheet is materially shorter.

## 9 · Roulette stage rebalance

**Change** `.roulette-wheel-stage { width: min(500px, 46vw); }`; move `renderRouletteChanceRows` output into the control column above the veto panel on ≥980px (keep the horizontal strip on phones); make both columns end near the same baseline. In the confirmed state, pin the winner poster (task 4) top-left and order the right column title → facts → confirmation note → Discord card.

**Check** at 1440×900 there is no tall void beside the wheel, and the confirmed screen has no empty left column. Phone flow, veto and re-spin behaviour unchanged; `roulette-core` untouched.

## 10 · List Stats made poster-led

**Change** in `renderStats`, collapse the three counters into one rule-divided band (~120px, mono label above a Barlow numeral, no boxes) and make *Current favourite* and *Longest waiting* poster rows: 88×132 poster at 2:3, title in Barlow Condensed 34px, fact as a mono line, on the raised surface. Reuse the existing poster frame and fact-chip components — no new patterns.

**Check** no empty 210px boxes remain; the screen holds real artwork; empty-data fallbacks (“No votes yet”, “Nothing waiting”) still render.

## 11 · Pick Tonight mode hierarchy

**Change** promote Queue Roulette to a full-width raised card with the primary action; render Consensus Sprint and Reel Bracket as a quiet “Planned” list under a mono heading — no buttons, no 55% dimming, a mono `Planned` tag right-aligned, 1px dashed left rule. Mirror the same treatment in the watch-party dialog's mode picker.

**Check** the two unavailable modes remain clearly unavailable and cannot create a session; the copy stays honest and unchanged in meaning; disabled radio semantics preserved.

## 12 · Loading, empty and locked states

**Change** `renderLoading` returns the real hero plus eight static 2:3 skeleton frames in the live grid (`#1b1d24` fill, 1px border, no shimmer, no animation). Constrain `.empty-state` to `max-width:560px` and make its action the primary button. When locked (`body.is-locked`), render the sidebar brand-only — hide the inert nav — and place a 12%-opacity poster mosaic from existing `assets/` behind the access card. Access, approval and gating copy is unchanged.

**Check** signed-out, pending-approval, loading, empty-search and error/toast states at all three viewports; no layout shift when the list arrives; gating behaviour identical.

---

## Prompt template for each task

> Read `AGENTS.md`, `docs/PROJECT_CONTEXT.md` and `docs/design-refinement-pass.md`.
> Implement **task N** only, exactly as specified there. Do not start other tasks and do not refactor unrelated code.
> [paste the standing constraints block]
> Then report: files changed, the task's own check plus the three viewport checks, and anything you could not do without a decision from Cameron.

## After each task

Verify against the audit's own numbers rather than vibes: border contrast ≈2.2:1, no type below 11px, 5 columns at 1440, no truncated preview titles, first phone poster ≤370px, vote target ≥44px, one filled purple per view. If a task cannot hit its check without touching something outside its scope, stop and raise it instead of widening the change.
