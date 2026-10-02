# Afterglow — Anime Tracker

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
- Separate per-user cloud libraries with a user-namespaced recovery cache and retry queue.
- Explicit, non-destructive import of guest anime; duplicates in the cloud are not overwritten.
- Optional AniList OAuth link and one-click progress sync, with 15-minute open/focus refresh cooldown, matching only existing owner rows and preserving categories/metadata.
- AniList OAuth client secrets/access tokens remain server-side; sync writes use the authenticated user's RLS-protected database function.

## Project files

```text
index.html       App shell and accessible page structure
style.css        Responsive dark anime-inspired interface
account.css      Responsive account, sync, import, and auth-dialog styles
script.js        View rendering, tracker controls, auth state, and sync events
api.js           AniList GraphQL search and metadata-refresh client
core.js          Tracker rules, statistics, and localStorage helpers
cloud-store.js   Supabase row mapping, RLS-scoped data access, cache, and retry outbox
auth-validation.js  Dependency-free login/register field validation
anilist-integration-v2.js AniList connection, OAuth callback, sync feedback, and cooldown helpers
supabase-config.js  Public Supabase project URL and publishable key only
tests/*.test.mjs  Dependency-free tracker, API, auth, and cloud-adapter tests
```

See the repository [setup and security guide](../README.md) for the required database migration, email redirect allow-list, RLS tests, and GitHub Pages instructions. AniList v2 owner setup (developer app, Edge Function secrets/deploy, and migration) is documented in [`../ANILIST_INTEGRATION_v2.md`](../ANILIST_INTEGRATION_v2.md).

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

1. Push changes to the existing `s4fire/ListR-Online` repository; its Actions workflow packages this folder for Pages.
2. In GitHub, open **Settings → Pages** and confirm the GitHub Actions deployment is enabled.
3. Wait for the workflow to publish at <https://s4fire.github.io/ListR-Online/> (unless a custom domain is configured).
4. In Supabase Authentication → URL Configuration, set the site URL to the deployed URL and add it to the Redirect URLs allow-list.

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
