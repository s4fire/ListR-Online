# ListR — Anime Tracker

A personal anime tracker built with **HTML5, CSS3, and vanilla JavaScript**. Guest lists stay in this browser; signed-in libraries use Supabase Auth and owner-protected Postgres rows. The app searches AniList’s public GraphQL API and remains deployable as static files.

## Features

- **Watching, Completed, and Interested** lists keyed by AniList media ID.
- AniList search results with cover, year, format, status, episode count, and description.
- Episode increment/decrement and direct editing, with values clamped to zero and a known total.
- Completed anime are set to their known episode total when first added; the count remains editable.
- Unknown episode totals show `watched / ? episodes` and have no fabricated percentage.
- Interested anime do not contribute to watched-episode or time statistics.
- Move anime between categories, avoid duplicates, filter and sort your collection, and remove entries.
- Watch-time estimates use AniList duration only; entries without a known duration are excluded from time totals.
- Metadata refresh, responsive layout, and useful API/network/rate-limit errors.
- Email/password registration and login with Supabase Auth; persistent browser sessions and logout.
- Registration requires a globally unique, case-insensitive username; legacy accounts without a username are prompted when opening social features.
- Separate per-user cloud libraries with a user-namespaced recovery cache and retry queue.
- Friends search/requests and accepted-friend-only aggregate stats; profiles never expose email or private anime titles.
- Recipient-only anime recommendations, with explicit dismiss or acceptance; accepting adds/moves to ListR Interested only and never writes to AniList.
- A Home dashboard with live tracker summaries, direct navigation shortcuts, and account-aware guest guidance.
- Five selectable themes (Sub-Zero, Onyx, Cosmic, Emerald, Soft Light) and three separate page layouts (Current, Reworked Old, New); guest preferences are local and signed-in preferences use owner-only RLS.
- A Watching-only **Watch on Miruro** action that resolves the exact AniList media ID and opens the next episode; it never changes ListR progress or AniList lists.
- Stats, Friends, and Recommendations live in a profile dropdown; the recommendation composer keeps results scrollable above a fixed selected-anime preview and Send action.
- A cohesive midnight-blue interface with responsive anime/poster cards, polished forms/dialogs, tactile control states, short transitions, and accessible reduced-motion behavior.
- Optional synthesized UI sounds with a persistent, accessible mute switch; sound never carries essential feedback and is suppressed while browser media is playing or the page is hidden.
- Explicit, non-destructive import of guest anime; duplicates in the cloud are not overwritten.
- Optional AniList OAuth link and one-click progress sync, with 15-minute open/focus refresh cooldown, matching only existing owner rows and preserving categories/metadata.
- AniList OAuth client secrets/access tokens remain server-side; sync writes use the authenticated user's RLS-protected database function.

## Project files

```text
index.html       App shell and accessible page structure
style.css        Responsive midnight-blue UI, dashboard and collection styles
account.css      Matching account, AniList, social, and dialog styles
appearance-v2.css Five-theme and three-layout design tokens and responsive arrangements
script.js        View rendering, tracker controls, auth state, and sync events
appearance-v2.js User-scoped appearance loading, validation, and persistence
miruro-v2.js     Exact-match resolver client and allowlisted episode URL builder
ui-effects-v2.js Optional Web Audio feedback and persisted sound preference
favicon_v2.svg   Blue ListR browser icon
api.js           AniList GraphQL search and metadata-refresh client
core.js          Tracker rules, statistics, and localStorage helpers
cloud-store.js   Supabase row mapping, RLS-scoped data access, cache, and retry outbox
auth-validation.js  Dependency-free login/register field validation
anilist-integration-v2.js AniList connection, OAuth callback, sync feedback, and cooldown helpers
social-v2.js   RLS-scoped username, friendship, friend-stat, and recommendation RPC client
supabase-config.js  Public Supabase project URL and publishable key only
tests/*.test.mjs  Dependency-free tracker, API, auth, cloud, social, and UI-effects tests
```

See the repository [setup and security guide](../README.md) for the required database migrations, email redirect allow-list, RLS tests, and GitHub Pages instructions. AniList v2 owner setup is documented in [`../ANILIST_INTEGRATION_v2.md`](../ANILIST_INTEGRATION_v2.md); Friends and Recommendations v2 migration, privacy, ListR-only acceptance, and deployment steps are in [`../FRIENDS_RECOMMENDATIONS_v2.md`](../FRIENDS_RECOMMENDATIONS_v2.md). Appearance/Miruro setup and the route evidence are in [`../APPEARANCE_MIRURO_v2.md`](../APPEARANCE_MIRURO_v2.md) and [`../MIRURO_ROUTING_RESEARCH_v2.md`](../MIRURO_ROUTING_RESEARCH_v2.md).

## Run locally

Because the app uses JavaScript modules, open it from a local static HTTP server rather than `file://`:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>. Python is only used here as a convenient local static-file server; the website itself has **no Python or server-side dependency**. Alternatively, use any static-file server. The browser must be online for AniList search, metadata refresh, authentication, and cloud sync. Configure the local URL in Supabase Authentication → URL Configuration if testing email verification.

Run the included logic tests with Node.js 18 or later:

```bash
node --test tests/*.test.mjs
```

## Publish with GitHub Pages

The project owner uploads the returned source to the existing `s4fire/ListR-Online` repository and publishes it using the existing Actions workflow. Configure GitHub Pages and the exact Supabase Authentication redirect URL there. This task does not push, commit, branch, or deploy to GitHub.

All app asset/module references are relative, so the site works at a repository subpath. No bundler or server-side runtime is introduced.

## Data and limitations

- Guest tracker data remains in this browser and does not sync. Signed-in tracker records are stored in the configured Supabase project and separated by Auth user ID.
- Existing guest anime are never silently uploaded or deleted. Use the account import banner to copy only AniList IDs missing from the current cloud library; the local guest list remains unchanged.
- Supabase Auth stores the persisted session. ListR never stores passwords. The frontend key is publishable; database access depends on the checked-in migration and RLS policies.
- Temporary cloud failures retain queued changes in the matching user's browser recovery cache/outbox for retry. Cloud sync requires storage and connectivity; guest data remains separate.
- Email verification may be required by the Supabase Auth project. Follow the confirmation email and allow-list the exact Pages/local redirect URL.
- The AniList API is an external service and may be unavailable or rate-limited. API errors do not erase the saved collection.
- Covers and live metadata are provided by AniList. Missing data remains missing rather than being guessed.
- AniList episode counts represent the **series total**; your watched count is stored separately.
