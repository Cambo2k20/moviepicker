# Design QA — The List poster experience

- Visual source: `/workspace/scratch/1eeb17f1f72e/generated_images/exec-03718190-ceed-41a6-a129-8401a537772c.png`
- Default-grid source: `/workspace/scratch/1eeb17f1f72e/generated_images/exec-aa54d86d-4746-4ff5-9846-7c61dddbd8a2.png`
- Implementation: `app.js`, `styles.css`
- Browser: cloud Chrome
- Desktop viewport checked: 1363 × 936
- Mobile viewport checked: 390 × 844 inside an isolated responsive QA frame

## States checked

- Default four-column poster gallery
- Three-column gallery with selected-film detail drawer
- Selected-card violet outline
- Honest artwork/metadata-pending fallback
- iPhone two-column gallery
- iPhone fixed bottom detail sheet with scrim and safe-area padding
- Ready and Watched card states
- Empty/filter-result behavior
- Add Film finder at desktop width
- Add Film finder inside a 390 × 844 iPhone viewport
- Existing-film metadata matching and refreshed detail state

## Interactions checked

- Open a film from its poster card
- Close details with the close button and Escape
- Restore the full-width grid after closing
- Filter by genre and added-by member
- Change list sorting
- Add/remove a film from the session-only Tonight shortlist
- Existing vote and watched controls remain wired to the website list only
- Search for a film and review multiple visual matches
- Select a match and refresh the card runtime, genres and synopsis
- Use the manual-add fallback when external movie lookup is unavailable

## Visual comparison

The selected-state source and the implementation were reviewed together in one comparison input. The implementation matches the source hierarchy: fixed Cine-Cord shell, restrained purple/grey/white palette, poster-first cards, dense toolbar, three-column reflow and a right-side information panel. The responsive implementation deliberately converts that panel to a bottom sheet on iPhone.

## Console and data boundary

- No application console errors or warnings in desktop or mobile checks.
- Temporary mock preview data was removed from the branch after QA.
- The production browser receives only the publishable Supabase key; TMDB credentials stay inside the authenticated Edge Function.
- Queue metadata fields are nullable, so the existing list row remained unchanged during the migration.
- No Discord, bot or Journal API exists in this implementation.
- No Discord or Journal data was read, written or changed during QA.

final result: passed
