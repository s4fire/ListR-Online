# ListR Project State v2

## Scope and preservation

This update is a visual/interaction redesign only. The project remains a plain static GitHub Pages app using HTML, CSS and vanilla JavaScript; no framework, bundler or external UI/audio dependency was added. Existing tracker, local/cloud data handling, AniList API/OAuth/progress sync, authentication, Supabase, Friends, Recommendations, and recommendation acceptance behavior were retained. In particular, accepting a received recommendation still adds or moves the anime to ListR Interested only and never writes to AniList Planning.

Application code changes are limited to presenting the existing Home watch-time value and bootstrapping an isolated optional UI-effects module; no existing API call, data model, account rule, tracker action, or backend flow was rewritten.

## Design v2

- Replaced the prior visual layer with a distinct midnight/navy blue system, electric-blue and cyan accents, subtle atmospheric grid/light, clearer spacing and typography, and consistent component tokens.
- Reworked the fixed desktop navigation into a tablet topbar and compact phone navigation. At 390px, all four primary labels fit without clipping; account status remains below the navigation.
- Extended Home with an existing-calculation watch-time metric. Updated collection cards, forms/search, statistics, empty/loading/status states, AniList/account surfaces, Friends, Recommendations, dropdowns, and dialogs with matching focus/hover/pressed/disabled/loading states.
- Added short, synthesized Web Audio feedback for button clicks, navigation, dialog openings, and success/error toasts. The preference persists independently under `listr-ui-sounds-v2`; the control exposes its state accessibly, sounds require browser interaction, and playback is suppressed while the page is hidden or audio/video is playing. Sounds are never needed for feedback.
- Added `favicon_v2.svg`; all application paths remain relative for repository-subpath hosting.
- Reduced-motion preferences substantially disable nonessential animations and retain nonanimated route scrolling.

## Verification

- Frontend suite: `node --test anime-tracker/tests/*.test.mjs` — **57 passing, 0 failing**.
- JavaScript syntax checks for browser modules and tests plus `git diff --check` passed.
- Isolated Chromium/Playwright QA at **1440×1080, 768×1024 and 390×844**: no page-wide horizontal overflow, no sidebar/content or mobile navigation/account overlap, Home and collection routes load with fixture data, and no page JavaScript errors. At 390px, primary-nav scroll width equals its client width and the decorative hero captions are hidden.
- Exercised profile-menu navigation and dismissal, the persistent sound toggle, muted behavior, generated success/error tones using a silent fake AudioContext, and the registration-mode dialog without submitting a form.
- A visual-only 18-result fixture confirmed the recommendation results list scrolls independently while the selected preview and Send footer stay visible inside the phone dialog (dialog bottom 782px; results scrolled 240px; footer bottom 770px at 390×844). No recommendation was sent.
- The checked-in Supabase/AniList behavior was not changed or live-submitted as part of this UI-only task. No commit, push, or GitHub Pages deployment was performed.

## Files

- Main frontend: `anime-tracker/index.html`, `anime-tracker/style.css`, `anime-tracker/account.css`, `anime-tracker/script.js`.
- New optional effects module and icon: `anime-tracker/ui-effects-v2.js`, `anime-tracker/favicon_v2.svg`.
- Design notes: `DESIGN_RESEARCH_v2.md`.
