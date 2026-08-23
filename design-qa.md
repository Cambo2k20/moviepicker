# Design QA — Mobile list and Queue Roulette polish

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
