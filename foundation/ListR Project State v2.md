# ListR Project State v2

**Snapshot:** 2026-10-03. The ListR overhaul and inherited feature scope are implemented in the plain-local website working copy. New feature modules, migrations, tests, research notes, and archive deliverables use `v2` names where applicable; existing HTML/CSS/JS entry-point names remain stable so the app and GitHub Pages links continue to work.

## Product and implementation

ListR remains a static GitHub Pages application built with HTML, CSS, and vanilla JavaScript modules. It uses Supabase Auth/Postgres/Edge Functions for optional account-backed features and AniList for catalogue metadata and optional read/sync actions. No frontend framework, build step, or hosted Manus-WebDev integration was added.

| Area | Current behavior |
|---|---|
| Account and library | Register/sign in with Supabase Auth; username uniqueness is enforced independently of email. Cloud records are owned by authenticated user ID and protected with row-level security. Guests keep a separate browser-local library. Passwords are handled by Supabase Auth. |
| Tracker | Watching, Completed, and Interested lists; AniList catalogue search and metadata; per-series episode progress, `+1`/`-1`, direct editing, category movement, duplicate prevention by AniList media ID, removal, and statistics. |
| Friends and recommendations | Username search, friend requests, friends, and recommendation inbox/composer. Accepting a recommendation adds or moves the anime to ListR Interested only; no AniList write is issued. |
| Home and design | Data-driven Home dashboard, library/statistics shortcuts, responsive midnight-blue design system, and accessible feedback states. The sound module is separate and has an accessible mute control. |
| Appearance | Five themes—Sub-Zero, Onyx, Cosmic, Emerald, Soft Light—and three independent layouts—Current, Reworked Old, New. Guest preferences are per-browser; account preferences are per-user in `list_r_appearance_preferences_v2`. |
| Miruro | Only Watching entries show “Watch on Miruro”. The server resolver finds a catalog item with the exact AniList ID, then requires the official info page’s JSON-LD `sameAs` to repeat that exact ID before returning a safe Miruro Watch route. The UI opens the next episode (`watched + 1`, or episode 1 for no progress). It does not fetch, proxy, or play media streams. |

## Relevant v2 implementation files

The presentation and preference controller are `anime-tracker/appearance-v2.css` and `anime-tracker/appearance-v2.js`; the Home and tracker wiring remain in `anime-tracker/index.html` and `anime-tracker/script.js`. Miruro’s client, Edge Function, and shared resolver are `anime-tracker/miruro-v2.js`, `supabase/functions/miruro-resolve-v2/index.ts`, and `supabase/functions/_shared/miruro-resolver-v2.mjs`.

The per-user appearance schema is defined in `supabase/migrations/202610030002_appearance_preferences_v2.sql`. Other account, AniList, social, and hardening migrations and the Edge Functions remain under `supabase/`. The route research and implementation-specific third-party dependency notes are in `MIRURO_ROUTING_RESEARCH_v2.md`.

## Final verification

The complete Node source-test command `node --test anime-tracker/tests/*.test.mjs supabase/tests/*.test.mjs` passed **77 tests, 0 failures**. Coverage includes account/RLS helpers, recommendation acceptance without AniList writes, appearance persistence, Watching-only Miruro action eligibility, next-episode construction, route allowlisting, compressed catalog decoding, exact AniList identity validation, and fail-closed behavior. SQL database test files are included in the Full archive but were not run against a live database in this final verification pass.

Isolated Chromium/Playwright smoke checks used synthetic guest-only localStorage data. Home statistics updated from the fixture; the profile menu and Appearance dialog opened with focus contained; all five themes and three layouts were present; changing the layout preserved the selected theme and saved the guest preference. Both distinct collection layouts were checked at 1440px, 768px, and 390px: New used 2/1/1 columns and Reworked Old used 4/2/2 columns, with no horizontal overflow or page errors. The Miruro action appeared on the Watching fixtures only and showed the expected next episode; Completed and Interested fixtures had no Watch action.

A live public-catalog lookup for AniList media ID `195516` returned the verified title “The Apothecary Diaries Season 3” and official route `https://www.miruro.tv/watch/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3`, with the expected 12-episode metadata. The resolver’s positive identity was confirmed from the exact catalog external ID and the info-page JSON-LD. Its upstream requests were limited to public catalog, info, or fallback search pages; no player route was requested.

## Delivery and deployment status

The Full archive is `ListR-Blue-UI_v2.zip`; the frontend-only archive is `ListR-Blue-UI-App_v2.zip`. They are refreshed from this working copy after the final code and document updates.

This remains a local GitHub Pages project. No commit, push, GitHub Pages publication, Supabase migration application, Edge Function deployment, registration, friend request, recommendation send, AniList write, or account mutation was performed during the final verification. Deploy the included Supabase migrations and Edge Functions separately before relying on cloud account, social, appearance-sync, or server-side Miruro resolution against a live project.
