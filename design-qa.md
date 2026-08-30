# Design QA — Mobile list and Queue Roulette polish

## Random landing and poster-led reveal — 23 August 2026

### Scope and result

- Replaced poster-filled wheel slices with the selected clean numbered-wheel treatment: film number, title, year and weighted chance are readable without using artwork as a spinning texture.
- The winner now lands at a randomly selected safe point within its slice. The landing bands stay 15–35% or 65–85% through the slice, avoiding both its edges and the centred label.
- The wheel completes one continuous spin, holds the stopped state for 2.6 seconds, counter-rotates its labels and hub upright, glows the winning slice and highlights the corresponding film card before revealing the result.
- The reveal now gives the winner a full, uncropped poster using `object-fit: contain`, a compact result wheel and landed-on callout, title/year/runtime/genres, weighting reason, overview, veto tokens, **Confirm for tonight** and **Spin again**.
- No Supabase, Discord API, bot, webhook, OAuth or database behaviour was changed in this pass.

### Reference and implementation evidence

- Selected stopped-state reference: `C:\Users\Cambo\.codex\generated_images\01a02b89-7ce8-7730-bae5-94856e33282b\exec-f8ccd9c9-011f-4f6e-bd22-62a2f3e1cec4.png` (`1675 × 939`).
- Selected reveal reference: `C:\Users\Cambo\.codex\generated_images\01a02b89-7ce8-7730-bae5-94856e33282b\exec-f1266a81-6b84-4e7b-af6c-ca9336d54e20.png` (`1675 × 939`).
- Browser stopped state: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-final-held-1680x945.png`.
- Browser reveal at reference size: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-v8-final-reveal-1680x945.png`.
- Browser reveal at required desktop size: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-v8-final-reveal-1440x900.png`.
- Browser reveal at tablet size: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-v8-reveal-768x1024.png`.
- Browser reveal at phone size: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-v8-reveal-390x844.png`.
- Side-by-side stopped comparison: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-compare-held.png`.
- Side-by-side reveal comparison: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-roulette-compare-reveal-v8.png`.
- Browser: Codex in-app Browser using the local design-preview dataset.

Both selected references and their matching implementation screenshots were normalized to `1680 × 945` and placed side by side before the final visual judgment.

### Browser checks

- Desktop `1680 × 945`: stopped winner slice, fixed pointer, upright labels/hub, off-centre landing, landed-on callout, highlighted film card and transition into the reveal.
- Desktop `1440 × 900`: large `400 × 600` winning poster, compact mini wheel, result metadata, three veto tokens and both decision buttons fit without horizontal overflow or document scrolling.
- Tablet `768 × 1024`: `400 × 600` full poster and mini wheel remain intact; result details continue below in normal document flow with no horizontal overflow.
- Phone `390 × 844`: the secondary mini wheel is hidden, the full `230 × 345` poster leads the result, and title/metadata remain legible with no horizontal overflow.
- The browser log contained Vite connection/debug entries only; no application warning or error was recorded.
- Real movie posters were used throughout. No placeholder, CSS-drawn or generated substitute artwork was introduced.

### Comparison findings and fixes

1. P2 — the first implementation left the stopped hub rotated with the wheel. Fixed by counter-rotating the hub with the recalibrated wedge labels.
2. P2 — the first reveal comparison undersold the winning artwork. Fixed by enlarging the desktop poster from `330px` to `400px` and raising the desktop result group so the complete poster and decisions fit in the viewport.
3. P2 — the old poster-filled wheel made films hard to identify while moving. Fixed by using restrained solid slices plus readable text, with real art moved into the film strip and winner reveal.
4. Final comparison — no actionable P0, P1 or P2 visual, responsive, interaction or copy issues remain.

### Automated validation

```text
npm run test:unit  -> 11 passed
npm run build      -> passed; 9 local references and 7 emitted images verified
npm run test:e2e   -> 18 passed, 6 intentionally skipped across phone, tablet, narrow desktop and desktop projects
git diff --check   -> passed; line-ending conversion warnings only
```

The responsive Queue Roulette test now verifies the stopped callout, exactly one winning slice, exactly one highlighted film card, absence of poster images inside the wheel, a loaded full-size winning poster with `object-fit: contain`, confirmation and the copy-only Discord handoff.

### Permanent controls and session-header follow-up

- **Adjust pool** remains permanently open with maximum runtime, genre, rewatches and age weighting. The duplicate **Current chances** list was removed from the control rail; the poster-card strip below the wheel remains the single detailed chance view and still provides per-film removal controls.
- The session strip now has one watch-party roster: the avatar tokens show both who is present and whether each veto is available. The separate unbadged participant avatars were removed. The desktop reading order is **Players and veto counts → Spin the list → film/chance totals**.
- At the exact annotated desktop viewport (`1115 × 807`), the session strip ends at `y = 246.59px`; the wheel and permanent control rail both begin at `y = 264.59px`. The wheel overlaps neither the header nor the control rail, and horizontal overflow is `0px`.
- During the stopped-winner hold, the landed-on callout overlaps neither the header nor the control rail. The poster-led reveal also has no header/column overlap, retains a loaded winner poster and has `0px` horizontal overflow.
- Before/after comparison: `C:\Users\Cambo\AppData\Local\Temp\moviepicker-session-header-before-after-v13.png`.
- The four responsive Playwright projects now assert that the settings cannot collapse, the controls are visible, the single three-token roster and spin action are inside the session header in the requested order, the duplicate participant and chances panels are absent, and the wheel does not overlap the header or control rail.

### Winning-film result-stage fitting follow-up

- **Source visual truth:** the annotated live result captured before the fit correction at `C:\Users\Cambo\AppData\Local\Temp\moviepicker-result-layout-before-1075x605.png`.
- **Implementation evidence:** the revised Alien result at `C:\Users\Cambo\AppData\Local\Temp\moviepicker-result-layout-after-1075x605.png`; combined comparison at `C:\Users\Cambo\AppData\Local\Temp\moviepicker-result-layout-before-after-v14.png`.
- **Viewport and normalization:** annotated CSS target `1075 × 605`; final browser measurement `1076 × 605` because of one-pixel host rounding. Source and implementation captures were `1071 × 602` and `1071 × 603` pixels and were compared after cropping the implementation's final row. Both show the Alien reveal state at the same responsive breakpoint.
- **Earlier P1:** below `1180px`, the result switched to a single column with a `400 × 600px` poster. The result stage grew to `631.99px` high, ended at `y = 896.03px` and pushed the film details to `y = 939.06px`, so the core reveal did not fit the annotated main body.
- **Fix:** the general desktop poster cap is now `340px`. From `1000–1180px`, the reveal uses a compact two-column result layout, a `215px` poster cap, a smaller supporting wheel and tighter copy rhythm. The wheel remains visible and the winning poster keeps its full `2:3` artwork.
- **Post-fix evidence:** the result stage measures `461.76 × 322.49px`, ends at `y = 586.51px` inside the `605px` viewport, and the poster measures `215.00 × 322.49px`. The result layout, stage and copy all remain inside the main content width with `0px` horizontal overflow.
- **Required fidelity surfaces:** the Barlow Condensed/monospace typography, purple-grey-white tokens, poster source and crop, icon set, and result copy are unchanged. Only responsive scale, grid tracks and vertical rhythm changed. A separate focused crop was unnecessary because the full matched viewport keeps the selected result stage and its text legible in the same comparison.
- **Responsive/interaction gate:** phone, tablet, narrow-desktop and desktop result flows still reach reveal, confirmation and the editable Discord handoff. The new narrow-desktop assertions require a two-column result, poster width no greater than `216px`, stage height no greater than `324px`, and containment inside the main body.

final result: passed

## Stabilization revalidation — 22 August 2026

The absolute `/workspace/scratch/...` paths below are historical evidence from the earlier polish pass and are not repository assets. Current verification uses the checked-in Playwright tests plus direct source and production-preview browser checks.

- Automated Chromium checks pass at `390 × 844`, `768 × 1024`, `1142 × 912` and `1440 × 900`.
- The list, decision-mode screen, watch-party dialog and confirmed Queue Roulette result have no horizontal page overflow at those sizes.
- The watch-party dialog defaults to Queue Roulette; Consensus Sprint and Reel Bracket are disabled and labelled **Coming soon**.
- The full create → spin → reveal → confirm flow reaches the editable **Copy for Discord** form.
- Six bundled local images resolve in the generated `dist/` artifact, and no source asset path remains in the bundle.
- Source and production-preview browser consoles contain no application warnings or errors.
- Newly found desktop result overflows were fixed by allowing the Discord form grid to shrink and switching the confirmed-result layout to one column below `1180px`; the full-result browser test now guards both widths.

Commands used:

```bash
npm run test:unit
npm run build
npm run test:e2e
```

Current result: passed. The staged Supabase privilege migration was not applied during design QA.

- Source visual truth — list: `/workspace/scratch/1eeb17f1f72e/upload/507F1D9A-DFB6-4738-93DE-57971956EB31.png`
- Source visual truth — wheel: `/workspace/scratch/1eeb17f1f72e/upload/139A82C2-2469-475B-8954-0BC153CD5691.jpeg`
- Source visual truth — selected film: `/workspace/scratch/1eeb17f1f72e/upload/AA16DE6F-B610-4882-9EB3-E884CD5E29C1.png`
- Source visual truth — decisions: `/workspace/scratch/1eeb17f1f72e/upload/071E5890-C378-4AE8-BB6E-C7B3401C52A1.png`
- Browser-rendered mobile list: `/workspace/scratch/1eeb17f1f72e/qa-mobile-roulette/01-mobile-list.jpg`
- Browser-rendered mobile wheel: `/workspace/scratch/1eeb17f1f72e/qa-mobile-roulette/02-mobile-wheel.jpg`
- Browser-rendered mobile result: `/workspace/scratch/1eeb17f1f72e/qa-mobile-roulette/03-mobile-result.jpg`
- Browser-rendered mobile decisions: `/workspace/scratch/1eeb17f1f72e/qa-mobile-roulette/04-mobile-decisions.jpg`
- Browser-rendered desktop wheel: `/workspace/scratch/1eeb17f1f72e/qa-mobile-roulette/05-desktop-wheel.jpg`
- Combined comparisons: `/workspace/scratch/1eeb17f1f72e/qa-mobile-roulette/compare-list.jpg`, `compare-wheel.jpg`, `compare-result.jpg`, `compare-decisions.jpg`
- Browser: cloud Chrome
- Mobile app viewport: 390 × 844 capture; page client area 375 × 844 because the wrapper reserves a 15 px browser scrollbar
- Mobile implementation pixels: 390 × 844 at density 1
- Source pixels: list/result/decisions 1179 × 2556; wheel 709 × 1536
- Density normalization: every source was proportionally normalized to 390 × 844 before being placed beside the 390 × 844 implementation. Source-only iPhone and Safari chrome was treated as external framing, not app UI.
- Desktop implementation viewport: 1348 × 926 at density 1

## States checked

- Mobile list at 390 × 844 with filters collapsed and poster cards visible
- Mobile filter drawer expanded and collapsed
- Queue Roulette with default 2-film pool and expanded 8-film pool
- Weighted wheel with 23 chances across eight contiguous film slices
- Adjust Pool expanded and collapsed
- Spin animation and poster-led result
- Full participant veto controls
- Veto removal followed by an automatic re-spin
- House re-spin confirmation and cancellation
- Confirmed result and the copy-only Discord template
- Desktop ready wheel
- Reduced-motion CSS fallback

## Primary interactions tested

- Open Pick Tonight from the mobile list
- Create a three-person Queue Roulette session
- Change Maximum runtime from Under 120 min to Any runtime
- Collapse Adjust Pool and spin the list
- Veto Alien as Cameron and verify Home Alone replaces it
- Verify Cameron's veto becomes disabled and the vetoed winner is excluded from the remaining pool
- Open and cancel the House re-spin safeguard
- Confirm a winner and verify the saved-session screen still exposes the editable, copy-only Discord template
- Confirm the page has no horizontal overflow at the mobile breakpoint

## Full-view comparison evidence

The source and implementation were placed in the same four comparison images before judgment. The list comparison shows the intentional mobile-density improvement: filters move behind one labelled control, so real poster cards appear in the first viewport. The wheel comparison shows one contiguous slice per film, high-contrast radial dividers, numeric slice labels, weight labels, a total-chance hub and a matching odds strip. The result comparison confirms that a correctly scaled 2:3 poster, title, status and core facts fit in the first viewport. The decision comparison confirms that participant names are no longer truncated inside tiny veto tiles and that the two host actions remain full-width and unambiguous.

## Required fidelity surfaces

- Fonts and typography: existing Barlow Condensed display headings, Space Grotesk UI text and mono eyebrow labels remain consistent with the Cine-Cord system. Film and chance counts now use singular/plural copy correctly. No clipped headings or participant names remain at the tested width.
- Spacing and layout rhythm: the list hero is shorter on phone, poster cards begin sooner, the wheel remains centred, the spin action stays above the fixed navigation, and the selected poster plus title fits above the fold. Expanded pool controls return the spin button to document flow so it does not cover settings.
- Colors and visual tokens: the established charcoal, grey, white and restrained-purple tokens are reused. Dark radial dividers with a purple edge make adjacent wheel portions legible without introducing another palette.
- Image quality and asset fidelity: list cards, wheel wedges, orbit cards and result art all use the real TMDB poster assets already present in the project. Result posters preserve 2:3 scaling and `object-fit: cover`; no CSS-drawn or placeholder film art was introduced.
- Copy and content: each film has one named/numbered slice, wait time and odds are explained, veto ownership is explicit, and the House re-spin asks for confirmation. The confirmed state continues to say that neither the list nor Discord was changed automatically.
- Icons and controls: existing Material Symbols are retained. Mobile primary actions and veto rows meet practical touch-target sizes, disabled vetoes have semantic disabled state, and the wheel has a descriptive accessible label.
- Accessibility and resilience: the reveal region uses `role="status"` with `aria-live="polite"`; filters, pool state and confirmation state are labelled; `prefers-reduced-motion` reduces the spin animation; mobile `scrollWidth` equals `clientWidth`.

## Findings

- No actionable P0, P1 or P2 findings remain.
- P3: the horizontal odds strip intentionally shows the first two entries at once; users swipe for the rest. A future pass could add a short first-use swipe hint when the real list becomes much larger.

## Comparison history

1. Initial source state — blocked by P1: visually similar poster portions were repeated around the wheel for extra weight, so film boundaries and the relationship between films and chances were unclear. Fix: render one contiguous wedge per film, scale each wedge by weight, and add radial dividers plus numeric/weight labels. Post-fix evidence: `compare-wheel.jpg`.
2. Initial mobile list — blocked by P2: permanent genre, suggester and sort controls consumed much of the first viewport. Fix: group secondary controls behind a `Filters & sort` disclosure while leaving search and All/Ready/Watched immediately available. Post-fix evidence: `compare-list.jpg`.
3. Initial result — blocked by P2: the large selected poster pushed useful title and status information below the first mobile viewport. Fix: constrain the winner poster to `min(190px, 55%)`, preserve its 2:3 ratio and compress the orbit stage. Post-fix evidence: `compare-result.jpg`.
4. Initial decisions — blocked by P1: compact veto cards truncated names and a host re-spin could happen without a safeguard. Fix: use full-width named veto rows, expose remaining/used state, exclude vetoed winners from future spins and require inline confirmation for a House re-spin. Post-fix evidence: `compare-decisions.jpg` and the browser-verified Alien → Home Alone veto test.
5. Final pass — no actionable P0/P1/P2 visual, responsive, interaction or copy issues remain at the tested mobile and desktop viewports.

## Console and data boundary

- No application-origin browser console errors or warnings were recorded on mobile or desktop.
- Repeated browser-extension metadata errors came only from a `chrome-extension://` URL and are unrelated to the app.
- Browser confirmation still states: `The movie list and Discord have not been changed.`
- This branch changes frontend rendering and client-side Roulette state only. It adds no Discord API, bot, webhook, OAuth or Journal write path and performs no Discord operation.
- No Supabase schema, policy or production data changes were made for this polish pass. The new vetoed-film list is stored inside the session's existing `game_state` JSON.

## Implementation checklist

- [x] Separate every film into one visibly bounded weighted wedge
- [x] Explain current odds outside the wheel
- [x] Compact mobile list filters without hiding core status tabs
- [x] Keep poster-led list and result states on phone
- [x] Scale the selected poster correctly on phone
- [x] Show full veto ownership and used state
- [x] Remove vetoed winners from subsequent spins
- [x] Add a House re-spin confirmation
- [x] Preserve persistent session confirmation and copy-only Discord handoff
- [x] Verify mobile/desktop layout, primary interactions and app-origin console logs

final result: passed

# Navigation design QA

## Comparison target

- Source visual truth:
  - `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\claude-navigation-audit\03-proposal-mobile-list.png`
  - `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\claude-navigation-audit\05-proposal-desktop.png`
- Rendered implementation: `http://127.0.0.1:4178/moviepicker/?design-preview#list`
- State: design-preview member/admin data, The List active, Cine-Cord open, My Cinema and Discover disabled as Private / Coming soon, Member Profiles disabled, Admin available to the preview administrator.

## Viewports and evidence

| Surface | CSS viewport | Source pixels | Implementation pixels | Density normalization | Implementation screenshot |
| --- | ---: | ---: | ---: | --- | --- |
| Phone | 390 × 843 (390 × 844 target) | 476 × 1029 | 476 × 1028 | In-app Browser reported DPR 0.82. Its integer viewport override produced a one-CSS-pixel height difference, so the implementation was scaled vertically by one output pixel only for the comparison board. | `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\implementation-phone-final-390x843-css.png` |
| Tablet | 768 × 1024 | No tablet source supplied | 937 × 1249 | DPR 0.82; no source normalization. This is the approved responsive extrapolation of the phone two-tier navigation. | `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\implementation-tablet-final-768x1024-css.png` |
| Desktop | 1440 × 900 | 1756 × 1097 | 1756 × 1098 | In-app Browser reported DPR 0.82. The source was scaled vertically by one output pixel only for the comparison board. | `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\implementation-desktop-final-1440x900-css.png` |

Full-view comparison evidence, with source on the left and implementation on the right:

- `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-phone-final.png`
- `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-desktop-final.png`

Focused comparison evidence was required because the full desktop board makes labels and small navigation states difficult to judge:

- Phone title/header: `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-phone-header-final.png`
- Phone two-tier navigation: `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-phone-nav-final.png`
- Desktop nested rail: `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-desktop-sidebar-final.png`
- Desktop title and controls: `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-desktop-header-final.png`

## Comparison history

### Iteration 1 — blocked

- P1 — The old raster logo and profile-heavy phone header remained instead of the selected text title treatment. Evidence: `C:\Users\Cambo\.codex\visualizations\2026\08\24\01a034ab-d10c-7421-bbb0-1e1474cdaae0\navigation-implementation-qa\comparison-phone-initial.png` and `comparison-desktop-initial.png` in the same directory. This changed the selected hierarchy and did not address the title problem the design was commissioned to solve.
- P2 — The phone displayed permanent All / Ready / Watched tabs plus a second Filters & sort row. That pushed the real posters materially farther below the fold than the source. Evidence: the same initial phone comparison.
- P2 — The desktop title block had the old oversized heading and no shared header/filter frame, so its vertical rhythm and region proportions did not match the selected desktop source. Evidence: the initial desktop comparison.

Fixes made:

- Replaced the raster brand treatment with Barlow Condensed `The Discordians` and the monospace `Companion app` label at the source sizes.
- Matched the phone and desktop title scale, desktop sidebar width, rail spacing, title/filter frame, and violet accent rule.
- Combined phone search and filter access into one row while keeping every status, genre, member, and sort control available when the accessible filter button expands.
- Kept the existing profile refresh and sign-out actions available as compact icon controls on phone rather than deleting working account functions omitted by the mock.

### Iteration 2 — passed

Post-fix full-view and focused evidence is listed above. The earlier P1/P2 differences are resolved.

## Required fidelity surfaces

- Fonts and typography: Barlow Condensed, Space Grotesk and the existing monospace label stack match the source family and hierarchy. Brand, page title, small labels, counts, line height and wrapping were checked at phone, tablet and desktop sizes.
- Spacing and layout rhythm: the 268 px desktop rail, 1440 × 900 title/filter frame, phone content gutters, two-tier footer heights, active destination visibility and poster grid spacing match the source intent without horizontal overflow.
- Colors and visual tokens: the existing Discordians purple, grey and white tokens map directly to the source. Active, disabled, shared/private and focus states remain distinguishable.
- Image quality and asset fidelity: real TMDB poster artwork is retained at full 2:3 proportions. The source's striped rectangles were presentation placeholders, not assets to reproduce. All preview posters and member avatars loaded successfully in browser and end-to-end checks.
- Copy and content: `Cine-Cord`, `The List`, `Watch a Film`, `Group Stats`, `My Cinema`, `Discover`, `Member Profiles`, Shared, Private and Coming soon match the approved product direction. Dynamic preview counts intentionally differ from the mock data.
- Icons: existing Material Symbols are used for functional controls; no emoji, CSS drawings, inline SVG approximations or placeholder artwork were introduced.
- Accessibility and behaviour: active routes use `aria-current="page"`; unavailable areas use real disabled controls and `aria-disabled`; the phone filter toggle has changing accessible names; keyboard destination movement and auto-reveal are covered by Playwright at phone and tablet sizes.

## Interactions and runtime checks

- In-app Browser: expanded and collapsed phone filters, navigated to Group Stats, opened Admin / Members, returned to Cine-Cord / The List, and confirmed My Cinema and Discover remained disabled.
- Automated browser suite: verified phone/tablet keyboard End + Enter navigation, active-item reveal, unavailable areas, text brand, account controls, poster prominence, dialogs, Journal and existing session flows.
- Console: 0 errors and 0 warnings after the final phone, tablet and desktop navigation checks.
- Responsive overflow: no horizontal document overflow at 390 × 843, 768 × 1024 or 1440 × 900.

## Intentional differences from the visual source

- Watch a Film is violet-primary on phone and desktop because that cross-viewport priority was explicitly approved.
- Desktop uses six larger real posters at 1440 px rather than seven narrow striped placeholders; this was explicitly approved to preserve artwork prominence.
- The web app does not reproduce the mock's simulated phone operating-system status bar.
- Refresh profile and sign-out remain accessible even though the visual mock omits those working account actions.

## Findings

No actionable P0, P1 or P2 differences remain. No P3 follow-up is required for the navigation release.

## Implementation checklist

- [x] Source and implementation opened and compared together.
- [x] Phone, tablet and desktop layouts checked.
- [x] Typography, spacing, colors, image quality, copy, icons and interaction states checked.
- [x] Initial P1/P2 findings fixed and recaptured.
- [x] Console and overflow checked.
- [x] Unit tests, build and complete Playwright suite passed.

final result: passed

# My Cinema film detail and five-level reaction design QA

## Comparison target

- Release scope: Decision 010, Phase 2A, implementing Decisions 003, 003A, 004 and 006.
- Source visual truth: the six Claude V2 boards supplied on 25 August 2026:
  - `C:\Users\Cambo\Downloads\Film Detail and Reaction v2-selection.png`
  - `C:\Users\Cambo\Downloads\Film Detail and Reaction v2-selection (1).png`
  - `C:\Users\Cambo\Downloads\Film Detail and Reaction v2-selection (2).png`
  - `C:\Users\Cambo\Downloads\Film Detail and Reaction v2-selection (3).png`
  - `C:\Users\Cambo\Downloads\Film Detail and Reaction v2-selection (4).png`
  - `C:\Users\Cambo\Downloads\Film Detail and Reaction v2-selection (5).png`
- Rendered implementation: `http://127.0.0.1:4181/moviepicker/?design-preview#my-films` in the Codex in-app Browser.
- State: approved preview member, Pulp Fiction present in both My Cinema and Cine-Cord, saved level 4 reaction, Favourite on, with My Cinema or Cine-Cord leading according to entry context.

## Viewports, normalization and evidence

The source boards are presentation canvases containing multiple frames and notes. Their app frames were cropped first, then normalized to the browser screenshot pixels before being placed beside the implementation. Browser captures use the requested CSS viewport; the raster buffer excludes the browser scrollbar and a small amount of host chrome.

| Surface and state | CSS viewport | Normalized source pixels | Implementation pixels | Density normalization | Implementation screenshot |
| --- | ---: | ---: | ---: | --- | --- |
| Desktop, My Cinema origin, saved level 4 | 1363 × 852 (1440 × 900 design target) | 1364 × 853 | 1364 × 853 | The `2880 × 1800` @2x source frame was reduced to `1440 × 900`, then matched to the browser raster. | `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\desktop-my-cinema-origin-final.png` |
| Tablet, saved level 4 | 768 × 1025 (768 × 1024 target) | 757 × 1010 | 757 × 1010 | The `1536 × 2048` @2x source frame was reduced to `768 × 1024`, then matched to the browser raster. | `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\tablet-film-detail-final.png` |
| Phone, Want to Watch and no reaction | 390 × 844 | 379 × 819 | 379 × 819 | The `780 × 1688` @2x source frame was reduced to `390 × 844`, then matched to the browser raster. | `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\phone-before-rating-final.png` |
| Phone, saved level 4 with editor expanded | 390 × 844 | 379 × 819 | 379 × 819 | The `780 × 1688` @2x source frame was reduced to `390 × 844`, then matched to the browser raster. | `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\phone-saved-expanded-final.png` |

Full-view comparison evidence, with Claude V2 on the left and the local Phase 2A implementation on the right:

- `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\comparisons\desktop-comparison.png`
- `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\comparisons\tablet-comparison.png`
- `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\comparisons\phone-before-comparison.png`
- `C:\Users\Cambo\AppData\Local\Temp\cine-cord-phase2a-qa-20260825\comparisons\phone-saved-expanded-comparison.png`

The saved/expanded phone comparison is also the focused control comparison: at `379 × 819` the summary, Change/Clear actions, current state, Favourite, editor heading, focusable close control and first reaction row remain readable. A separate crop would not reveal additional detail.

## Required fidelity surfaces

- Fonts and typography: the implementation retains Barlow Condensed for film/display headings, Space Grotesk for interface copy and the established monospace label stack. Heading scale, uppercase hierarchy, compact metadata, label spacing and mobile wrapping follow the reference without clipping.
- Spacing and layout rhythm: desktop keeps the poster/facts rail beside context-ordered panels; tablet uses the film-specific sticky header and poster/title split; phone switches from a large poster-led no-reaction state to the compact saved-reaction layout. Panel borders, violet rules, control spacing and practical touch targets match the source intent.
- Colors and visual tokens: the existing Discordians charcoal, graphite, grey, white and electric-violet tokens are reused. Saved, focus, active, disabled, private and shared states remain distinct without adding a competing palette.
- Image quality and asset fidelity: the implementation uses the real Pulp Fiction TMDB poster and all five supplied aligned V2 transparent reaction PNGs. Images keep their intended aspect ratios and use `object-fit`; no placeholder, CSS-drawn, inline-SVG or emoji replacement was introduced.
- Copy and content: the five approved labels are exact. Privacy consequences are explicit. The implementation deliberately says `TMDB ID 680` instead of presenting the mock's unsupported `TMDB 8.5`, omits a duplicate Suggest action when the film is already shared, and uses real session/Journal facts rather than simulated values.
- Icons: the existing Material Symbols family supplies back, vote, Favourite, close, search and state marks with consistent weight and alignment.
- Accessibility and behavior: reactions form one labelled radiogroup with roving tab stops, arrow/Home/End selection, `aria-checked`, a polite save announcement and visible focus. Favourite is a switch, state buttons expose pressed state, and the compact phone state chip expands all three legal states so a member can still choose Did Not Finish while retaining a reaction. Reduced motion removes reaction transitions.

## Primary interactions and runtime checks

- Opened Pulp Fiction from My Films and from The List; the private or shared panel leads according to origin.
- Switched between Cine-Cord and My Cinema contexts; the full detail destination returned to the top rather than retaining an invalid panel scroll offset.
- Verified no-reaction, saved, Change reaction, Clear, Favourite, Watched, Want to Watch and Did Not Finish states.
- Verified Did Not Finish retains a saved level 4 reaction, then restored Watched.
- Opened the compact phone state editor: all three states became reachable; selecting a state collapsed it again.
- Searched My Films for `Pulp`, opened details, returned, and confirmed the search remained `Pulp` before clearing it.
- Checked desktop, tablet and phone document widths; no horizontal page overflow was present.
- Browser console contained Vite debug/connect messages only, with no application warning or error.

## Comparison history

1. Iteration 1 — blocked by P1: the saved phone layout placed personal state controls before the reaction summary and removed the summary when Change reaction opened. Fix: keep the saved summary and actions first, then place the state controls and a separately bordered expanded editor beneath them. Post-fix evidence: `phone-saved-expanded-comparison.png`.
2. Iteration 2 — blocked by P2: the first phone no-reaction layout used the compact poster/title treatment intended only for an existing reaction. Fix: add the source's centred large poster and title-below composition for films without a personal reaction, while retaining the compact saved layout. Post-fix evidence: `phone-before-comparison.png` and `phone-saved-expanded-comparison.png`.
3. Iteration 3 — blocked by P2: the existing member brand header consumed approximately 86 px above the film detail at tablet and phone widths. Fix: use the source's sticky film-detail return header on detail pages while preserving the already-shipped bottom navigation. Post-fix evidence: `tablet-comparison.png` and both phone comparisons.
4. Iteration 4 — blocked by P2: showing all three state buttons in the default saved phone summary pushed the expanded reaction editor materially lower than the source. Fix: show the current state and Favourite in one row; selecting the current state opens all three states, preserving the DNF-with-reaction path. Post-fix evidence: `phone-saved-expanded-comparison.png` and the browser-tested state editor.
5. Final pass — no actionable P0, P1 or P2 typography, layout, color, imagery, copy, icon, interaction, accessibility or responsive findings remain.

## Intentional product differences

- The existing approved two-tier phone/tablet navigation remains. Claude's isolated detail frames draw only the primary row, so the implementation reserves more bottom space while keeping every destination reachable and all detail content scrollable.
- Suggest for Cine-Cord is absent when the film is already on the shared list. Repeating that action would be false and could create a duplicate.
- Director, certification and TMDB vote average are not invented because the current canonical movie row does not store those fields.
- The screen uses live or preview workspace facts for votes, sessions and Journal history rather than Claude's presentation-only values.

## Findings

- No actionable P0, P1 or P2 findings remain.
- P3: Claude notes that the popcorn cup is unusually bright at very small sizes. Removing it cleanly requires a new render from the 3D source; raster erasure would damage the chair and edge light, so the aligned supplied V2 artwork is retained for this release.
- Complete automated validation passed: 45 unit tests, the production build and emitted-asset check, 55 local database/RLS integration tests, and the isolated Playwright suite on port 4183 with 39 passed and 29 intentionally skipped across phone, tablet, narrow-desktop and desktop projects.

## Implementation checklist

- [x] Replace the selected-film drawer with one contextual full-detail destination.
- [x] Add My Films search, filters, sort, add-film and private film cards.
- [x] Keep shared and private controls separate and ordered by entry context.
- [x] Implement the five-level reaction, Favourite and three personal states.
- [x] Implement no-reaction, saved, expanded, cleared and DNF-with-reaction behavior.
- [x] Match desktop, tablet and phone source states with real poster and reaction assets.
- [x] Preserve mobile navigation, scrollability, practical targets and keyboard/screen-reader semantics.
- [x] Compare source and implementation in the same composite inputs and recheck after fixes.
- [x] Check app-origin console output and responsive overflow.
- [x] Run the complete isolated Playwright suite across all four responsive projects.

final result: passed

---

# Phase 2A reaction scale design QA

## Comparison target

- Source visual truth: `C:\Users\Cambo\Documents\0.0 DiscordianWebApp\Images\Rating System\Rating Scale-selection.png`
- Supporting source board: `C:\Users\Cambo\Documents\0.0 DiscordianWebApp\Images\Rating System\Rating Scale-selectionall.png`
- Browser-rendered implementation: `http://127.0.0.1:4183/moviepicker/?design-preview&phase2a-qa=acceptance#my-films`
- Implementation screenshot: `C:\Users\Cambo\.codex\visualizations\2026\08\25\01a037cd-a47d-7351-9ff9-3697922bc1c5\reaction-scale-desktop-final-1440x900.png`
- Desktop viewport: 1440 x 900 CSS px at device pixel ratio 1.
- Source pixels: 1160 x 1034.
- Implementation pixels: 1425 x 1188, including the complete vertically scrollable page and excluding the 15 px browser scrollbar.
- State: Pulp Fiction, private My Cinema detail, saved Level 4, `Really liked it`.
- Product acceptance: Cameron accepted the final paired production artwork on 30 August 2026. Merge and publication remain separate approval gates.

## Normalization and evidence

- Full-view comparison: `C:\Users\Cambo\.codex\visualizations\2026\08\25\01a037cd-a47d-7351-9ff9-3697922bc1c5\reaction-scale-design-comparison-final.png`
  - Both captures were scaled proportionally to 900 px high, centered on 1440 x 900 dark canvases, then placed side by side in one 2880 x 900 image.
- Focused reaction-panel comparison: `C:\Users\Cambo\.codex\visualizations\2026\08\25\01a037cd-a47d-7351-9ff9-3697922bc1c5\reaction-scale-design-comparison-focused-final.png`
  - The source panel was cropped to 1160 x 840.
  - The implementation's actual 823 x 805 private-panel slot was cropped from the desktop capture, scaled proportionally to 840 px high, and centered on a 1160 x 840 dark canvas.
  - This focused comparison was required because the controls and small labels were too small for a reliable full-page judgment.
- Tablet evidence: `C:\Users\Cambo\.codex\visualizations\2026\08\25\01a037cd-a47d-7351-9ff9-3697922bc1c5\reaction-scale-tablet-viewport-final.png` at 768 x 1024 CSS px.
- Phone evidence: `C:\Users\Cambo\.codex\visualizations\2026\08\25\01a037cd-a47d-7351-9ff9-3697922bc1c5\reaction-scale-phone-final-390x844.png` at 390 x 844 CSS px.

## Findings

No actionable P0, P1 or P2 findings remain.

- Fonts and typography: Barlow Condensed preserves the source's tall display labels, while the existing Space Grotesk and monospaced metadata styles keep the implementation consistent with Cine-Cord. The level labels and captions remain readable at desktop, tablet and phone sizes.
- Spacing and layout rhythm: one detailed patron owns the stage, five compact faces form one row at desktop and tablet, and the controls become five 60 px touch rows on phone. The implementation is intentionally narrower than the standalone source board because it occupies the real film-detail content column beside the poster.
- Colors and visual tokens: charcoal, grey, white and electric violet match both the supplied board and the existing product. Yellow appears only in the private face assets. Borders remain square and use the current layout-system tokens.
- Image quality and asset fidelity: all five 768 x 768 patron WebPs and five 192 x 192 face WebPs use transparent alpha, preserve the supplied subjects, and show no visible halo, stretch or crop. No CSS, SVG, glyph or placeholder substitute is used for the reaction artwork.
- Copy and content: all five reaction labels are present in text. The Level 4 title and caption match the source. The existing Favourite control, saved-status text and consequence copy are intentional product context retained around the source pattern.
- Interaction and accessibility: hover and focus preview without saving; leaving restores the saved or neutral stage; Enter, Space, click and touch save; the choice group uses native buttons with `aria-pressed`; arrow keys move the preview focus without falsely claiming a saved radio change; reduced-motion rules remove transitions.
- Responsive behavior: no horizontal overflow was measured at 1440 x 900, 768 x 1024 or 390 x 844. The phone flow keeps the newly saved detailed stage visible and still offers an explicit close action to return to the compact summary.

## Comparison history

### Pass 1 - blocked

- [P2] The square patron image resolved to 360 px high inside a 300 px visual slot and overlapped the reaction title. Evidence: `C:\Users\Cambo\.codex\visualizations\2026\08\25\01a037cd-a47d-7351-9ff9-3697922bc1c5\reaction-scale-desktop-1440x900.png`.
  - Fix: absolutely contained the image within the relative stage-visual box and retained an 8 px stage row gap.
- [P2] A phone save immediately collapsed the editor, hiding the matching detailed stage promised by the touch contract.
  - Fix: phone saves now keep the editor expanded and refocus the visible selected choice; the explicit close control performs the collapse.
- [P2] Opening an unrated reaction picker focused Level 1 and replaced the intended neutral Level 3 resting stage.
  - Fix: the opening flow focuses the labelled question instead, preserving `Pick a face` at Level 3 and 45% artwork opacity.
- [P2] Preview-only arrow navigation used radio semantics even though focus movement intentionally did not save.
  - Fix: the five choices are now a labelled native-button group with `aria-pressed` reserved for the saved value.

### Pass 2 - passed

- Post-fix visual evidence: the full and focused side-by-side comparisons listed above.
- The patron, title and caption no longer overlap at any tested breakpoint.
- The final focused comparison preserves the source hierarchy: one detailed stage, one text label and caption, then five compact faces with the saved Level 4 state visibly marked.
- Browser console check returned zero warnings or errors.
- Primary interaction checks covered desktop hover, leave, keyboard preview and save; tablet one-row preview; phone compact summary, expansion, touch save, retained stage and explicit collapse; and the no-reaction neutral Level 3 state.
- Automated evidence: 57 unit tests passed; production build and emitted-asset verification passed; Playwright completed with 45 passed, 35 intentional skips and 0 failures.

## Open questions

None.

## Implementation checklist

- [x] Match the supplied Level 4 state in one combined comparison input.
- [x] Contain all five patron poses inside the stage slot.
- [x] Preserve the saved-versus-preview interaction contract.
- [x] Verify neutral, saved, hover, focus, touch and collapsed states.
- [x] Verify 1440 x 900, 768 x 1024 and 390 x 844.
- [x] Check the browser console and automated suites.

## Follow-up polish

No P3 polish is required for Phase 2A acceptance.

## Final result

passed
