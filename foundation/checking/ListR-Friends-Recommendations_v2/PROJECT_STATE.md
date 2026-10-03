# ListR Project State

## Current delivery

This working copy contains the Friends & Recommendations v2 implementation plus a polished interface overhaul. It remains a static GitHub Pages app using HTML, CSS, and vanilla JavaScript; no frontend framework, bundler, commit, push, or deployment was introduced.

## Rollback Version 1

The stable pre-overhaul app snapshot is preserved separately as `ListR-ROLLBACK-VERSION-1_v2.zip`. It contains the complete `anime-tracker/` application as it existed before the Home/UI changes and has not been overwritten by the current source. SHA-256: `43eeb1c928f7b80a5023d6ec21303b3aff13a695e597447720316d56df183d76`.

## Home and visual overhaul

- Added a data-driven Home dashboard and made `#home` the default destination. The ListR wordmark returns to Home; the dashboard offers direct access to library, discovery, stats, Friends, and Recommendations and distinguishes guest from signed-in copy.
- Applied a cohesive dark, restrained anime-inspired visual system to existing navigation, cards, controls, status feedback, dialogs, and social/account surfaces while retaining the existing app structure and tracker data format.
- Grouped Stats, Friends, and Recommendations in an accessible profile dropdown. The menu closes on outside click, Escape, and section selection. Core library destinations remain in the primary navigation.
- Added restrained interaction/loading feedback, clear success/error/destructive-action messages, keyboard skip navigation, active-section semantics, visible focus styling, and reduced-motion handling (route scrolling uses `auto` when reduced motion is requested). Login/register mode controls are accessible toggle buttons, not incomplete ARIA tabs. No sound system was added; it was optional and unnecessary to the stable UI.
- Reflowed the header at tablet/mobile breakpoints. Mobile places the main controls and scrollable nav on separate rows so the account bar cannot overlap navigation. Decorative hero counters/caption are hidden on narrow screens to keep actions readable.

## Recommendation behavior decision

The latest direct user instruction governs over the earlier reminder-only wording in the attached visual-overhaul brief: **Accept immediately adds or moves the anime to ListR Interested only. It never reads AniList connection state or writes to AniList Planning.** Acceptance re-applies and verifies the owner/media row's Interested category after the insert attempt, closing the concurrent-insert race before finalization. Deny/dismiss remains a recipient-scoped dismissal. AniList progress synchronization remains the separate, one-way progress import behavior; ordinary tracker actions do not write to AniList.

## Testing and verification

- Frontend logic/contract tests: `node --test anime-tracker/tests/*.test.mjs` — 55 passing, 0 failing after the review fixes.
- `node --check` passes for the edited browser modules and shared `.mjs` helper; `git diff --check` passes. Deno and Supabase CLI were unavailable, so the Edge Function TypeScript compiler and database-backed SQL test suite could not be run locally.
- Local Chromium responsive checks used 1440×1000, 768×1024, and 390×844 viewports. There was no page-wide horizontal overflow and no navigation/account-bar overlap after the breakpoint fix.
- A visual-only fixture with 18 long anime results verified that recommendation results have their own scrollable region and the selected-preview/Send footer stays inside the dialog at desktop (1440×1000), mobile (390×844), and short-height mobile (390×480). No recommendation was submitted during this layout check.
- Browser smoke tests verified Home loads, the logo returns to Home, profile dropdown sections appear, Stats and Friends navigation works, and the menu closes after selecting a section. Guest-mode Friends correctly requests sign-in. Chromium confirmed reduced-motion route scrolling is `auto`, normal-motion scrolling remains smooth, and the auth toggle updates `aria-pressed` without tab roles. The browser console showed no output.
- A live authenticated Supabase/AniList account flow and database-backed SQL suite were not exercised in this visual-only pass; no GitHub or production changes were made.

## Handoff

Upload the current source bundle to the existing repository through the user's normal workflow. Apply the documented Supabase migrations and deploy/configure the Edge Function only as described in the v2 setup guides; do not commit or publish secret credentials. GitHub was not modified, committed, pushed, or deployed by this task.
