# Movie-list reset — design QA

## Evidence

- Source visual truth: selected Option 3, “Tonight, We Decide” (`generated_images/exec-ab11dd90-70cb-4944-8f79-07377232c97e.png`)
- Implementation capture: cloud-browser render of `http://terminal.local:4173/?design-preview=1#list`
- Implementation state: signed-in list-first view, Ready filter, no modal
- Browser viewport: 1363 × 936 CSS pixels at 1× density
- Source pixels: 1487 × 1058
- Normalization: the full source and implementation were fit to the available viewport and compared at the same visual scale.

## Full-view comparison

- The selected cinematic-archive language is retained: charcoal canvas, restrained violet accents, white and muted-grey text, narrow left rail and condensed uppercase display type.
- The product hierarchy intentionally changes from Journal-first to list-first. “The List” is now the primary destination, with Pick Tonight, Sessions and List Stats following it.
- The hero artwork is intentionally replaced by functional list overview metrics and controls. This is an information-architecture change, not a fidelity defect.
- Spacing, border weight, surface contrast, active navigation treatment and primary-button styling remain consistent with the selected direction.
- At the tested desktop viewport, the list rows, filters, metrics and primary actions remain balanced without overlap or clipping.

## Focused checks

- Navigation/header region: active violet rail, wordmark, account footer and condensed section heading remain visually consistent.
- List toolbar: search, Ready/Watched/All filters and sort control are clear and correctly grouped.
- Film rows: title/year, suggester, waiting time, votes and watched state remain readable at a glance.
- Primary actions: Add Film and Pick Tonight have distinct hierarchy and visible focus/hover treatment.
- No visible broken assets, clipped labels or unintended horizontal scrollbars were found.

## Interaction verification

- Ready and Watched list filters were exercised.
- Add Film modal was opened and closed without submitting real data.
- Pick Tonight navigation was tested.
- Consensus Sprint was selected and a local preview session was created for Cameron, Dean and Kieran.
- The resulting Sessions view showed the selected mode, participants and available candidate count.
- No real Supabase list rows were inserted during QA.
- Runtime logs contained no application-origin warnings or errors; the only reported error came from the cloud browser extension environment.

## Data-boundary verification

- The frontend contains no Journal table query, Journal-entry mutation, Discord API call, webhook or bot integration.
- Existing `queue_items` and `queue_votes` remain the only movie-list persistence targets.
- Both list tables have Row Level Security enabled.
- No database migration or schema change was made for this reset.
- No Discord or Journal data was read or changed during implementation or QA.

## Findings and residual checks

- No actionable P0, P1 or P2 visual or interaction issue remains.
- P3 follow-up: verify the responsive layout on a physical iPhone after the branch is reviewed; mobile breakpoints were reviewed statically because the cloud-browser viewport could not be resized during this pass.
- Supabase Security Advisor still reports the pre-existing leaked-password-protection warning; it is unrelated to this list-first change.

final result: passed
