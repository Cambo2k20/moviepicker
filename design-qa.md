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
