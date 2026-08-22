# Design QA — Queue Roulette

- Wheel source visual truth: `/workspace/scratch/1eeb17f1f72e/generated_images/exec-b7998b52-9557-4e29-961e-7b796474d87b.png`
- Poster-reveal source visual truth: `/workspace/scratch/1eeb17f1f72e/generated_images/exec-334928bd-673c-42c6-880e-e3f0eed2ff26.png`
- Browser-rendered mobile wheel: `/workspace/scratch/1eeb17f1f72e/qa-evidence/roulette-mobile-wheel.jpg`
- Browser-rendered mobile reveal: `/workspace/scratch/1eeb17f1f72e/qa-evidence/roulette-mobile-reveal.jpg`
- Browser-rendered desktop wheel: `/workspace/scratch/1eeb17f1f72e/qa-evidence/roulette-desktop-wheel.jpg`
- Combined wheel comparison: `/workspace/scratch/1eeb17f1f72e/qa-evidence/roulette-wheel-comparison.jpg`
- Combined reveal comparison: `/workspace/scratch/1eeb17f1f72e/qa-evidence/roulette-reveal-comparison.jpg`
- Browser: cloud Chrome
- Mobile CSS viewport: 390 × 844 at device scale factor 1
- Mobile source pixels: 853 × 1844, normalized to 390 × 844 before comparison
- Mobile implementation pixels: 390 × 844
- Desktop implementation viewport: 1348 × 926

## States checked

- Pick Tonight mode selection
- Five-member watch-party setup with Queue Roulette preselected
- Ready wheel with 2 and 8 eligible-film pools
- Runtime, genre, rewatch and age-weight controls
- Empty filtered-pool warning and disabled spin action
- Animated spin with reduced-motion fallback
- Poster-led winner reveal
- Individual participant veto and automatic re-spin
- Host re-spin without consuming a veto
- Final film confirmation
- New round and return-to-list actions
- Active-session continuation from Sessions
- Persistent session creation with approved participant IDs
- Confirmed film snapshot and resumable Roulette state
- Editable Discord template with required entry number
- Finished and DNF status formatting
- Optional comment omission
- Copy-to-clipboard result
- Mobile Discord form at 390 × 844

## Primary interactions tested

- Choose Queue Roulette from Pick Tonight
- Select all five participants and create the session
- Expand Adjust Pool and change the maximum runtime
- Spin the weighted wheel
- Spend Cameron's veto and verify that it becomes unavailable
- Confirm the replacement result
- Start another round
- Verify the confirmation explicitly leaves the list and Discord unchanged

## Full-view comparison evidence

The option 1 wheel source and the 390 × 844 ready-state implementation were placed in `roulette-wheel-comparison.jpg`. Both use the established dark Cine-Cord shell, a poster-filled circular wheel, violet pointer, central eligible count, participant avatars, three active-filter indicators, veto tokens and a dominant spin action. The implementation preserves the existing website header and makes the spin action persistent above the phone navigation so it remains reachable while pool controls scroll.

The option 3 poster source and the 390 × 844 result implementation were placed in `roulette-reveal-comparison.jpg`. Both make a correctly proportioned 2:3 poster the dominant result, keep secondary posters behind it, retain the participant and eligibility strip, and move the title/status directly below the image. The implementation uses the actual selected list metadata rather than decorative mock copy.

## Focused fidelity review

- Fonts and typography: existing Barlow Condensed display headings and Space Grotesk UI copy are retained. The final 42 px mobile Roulette heading remains on one line; small mono labels retain the source's wide tracking without becoming illegible.
- Spacing and layout rhythm: the wheel remains circular and centred at phone and desktop sizes. Mobile header, session strip and result stage were compressed after the first pass so the selected-film title appears above the fixed navigation.
- Colors and visual tokens: existing `--bg`, `--surface`, `--border`, `--purple-light`, `--success` and muted-text tokens map directly to the selected concepts. No new unrelated palette was introduced.
- Image quality and asset fidelity: all visible wheel segments, orbit cards and winner art use real queue poster images. Posters use cover cropping inside the wheel and correct 2:3 scaling for the selected result; no placeholder div art or handcrafted icon assets replace film artwork.
- Copy and content: rules, weights, filters, veto ownership and confirmation consequences are explicit. The confirmation message states that neither the website list nor Discord was changed.

## Comparison history

1. First mobile pass — blocked by P1: the primary spin action appeared below the initial 390 × 844 viewport. Fix: make the spin action persistent directly above the existing bottom navigation and reserve content padding for it. Post-fix evidence: `roulette-mobile-wheel.jpg` shows the full button at 12 px horizontal insets without covering the wheel.
2. Second mobile pass — blocked by P2: the two-line game title and taller result stage pushed the selected-film title below the initial viewport. Fix: keep the 42 px heading on one line, reduce the session strip, reduce the orbit stage from 450 px to 400 px and preserve a 220 px-wide 2:3 winner poster. Post-fix evidence: `roulette-mobile-reveal.jpg` shows the complete poster plus film title, year and status above navigation.
3. Final comparison — no actionable P0/P1/P2 differences remain. The source uses a taller concept canvas than the live 390 × 844 viewport; controls below the hero intentionally continue by vertical scroll while the primary spin action remains persistent.

## Console and data boundary

- No `terminal.local` application console errors or warnings were recorded during the tested flow.
- Browser-extension metadata errors were isolated to a Chrome extension URL and are unrelated to the app.
- Production build, JavaScript syntax and whitespace checks pass.
- Queue Roulette reads the already-loaded website list and now stores its active session, participants, filters, vetoes and confirmed film in two RLS-protected Supabase tables.
- Approved-member create/confirm/end behavior passed inside a rollback transaction; the test created no lasting session rows.
- A signed-in non-member read zero private session rows. Anonymous roles have no session-table or session-function privileges.
- The Supabase Security Advisor introduced no session-related warnings. The selected-film foreign key is covered by an index.
- The exact confirmed Discord format was generated with Entry #307, Men, 2022, Adam and Dean; blank comments are omitted and DNF renders exactly as `Status: DNF`.
- The copy button returned the exact visible template in the browser clipboard.
- No Discord API, bot, webhook, Journal message or Discord data was read or changed.

## Follow-up polish

- P3: a later motion pass could vary wheel deceleration and add a restrained poster-snap sound setting.
- P3: when the real list grows, a compact candidate-preview drawer could explain every film's current weight before spinning.

final result: passed
