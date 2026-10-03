# ListR — Anime Tracker

A static anime tracker in `anime-tracker/`, deployed to GitHub Pages and backed by AniList for search/metadata. Guest lists remain in the current browser. Signed-in lists sync through Supabase Auth and Postgres, with a database-enforced owner boundary.

The Pages workflow runs the frontend tests and publishes `anime-tracker/` directly. Older root-level ZIPs are not deployment inputs; use `ListR-Blue-UI_v2.zip` for the full source or `ListR-Blue-UI-App_v2.zip` for the app-only bundle from this update.

## Supabase setup (required for accounts and cloud sync)

The frontend is configured for the Supabase project in `anime-tracker/supabase-config.js`. That file contains only the project URL and a publishable browser key; those are public client configuration, not secrets. Never put a Supabase secret/service-role key, database password, or other private credential in this repository.

1. In the matching Supabase project, open **SQL Editor** and run [`supabase/migrations/202610010001_anime_records.sql`](supabase/migrations/202610010001_anime_records.sql). It creates the user-owned `anime_records` table, compound `(user_id, anilist_media_id)` uniqueness, validation, timestamps, and separate select/insert/update/delete RLS policies.
2. In **Authentication → URL Configuration**, set the Site URL to the actual public site, normally `https://s4fire.github.io/ListR-Online/`. Add that exact URL to the Redirect URLs allow-list. For local development also allow the local static-server URL, such as `http://localhost:8000/**`. If the repository uses a custom Pages domain, allow that origin instead.
3. Keep email/password sign-up enabled. This project currently requires email confirmation (`mailer_autoconfirm` is off), so configure a working email provider/SMTP if needed. A new user must verify the Supabase email link before signing in; the link returns to ListR.
4. If using another Supabase project, change only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `anime-tracker/supabase-config.js` to that project's public values. Apply the migration there too. Do not commit private keys.

The UI shows a setup error rather than mixing guest data if the cloud table is missing or access is denied. Guest mode remains available while the backend is being configured.

## Appearance and Miruro Watch v2

Appearance settings provide five colour themes (Sub-Zero, Onyx, Cosmic, Emerald, Soft Light) and three independent page layouts (Current, Reworked Old, New). Guest preferences stay in this browser; signed-in preferences are user-ID scoped and synced through RLS. Apply `supabase/migrations/202610030002_appearance_preferences_v2.sql` to enable cloud preference sync.

Watching cards can open their exact AniList-matched series on Miruro at the next episode (`watched + 1`; episode 1 when progress is zero). This uses the public, bounded `miruro-resolve-v2` Supabase Edge Function. The function searches official Miruro title pages, accepts only an info page whose JSON-LD `sameAs` has the exact AniList media ID, and returns only a validated Miruro Watch URL; it does not access or play streams. Deploy it with guest-compatible invocation enabled:

```bash
supabase functions deploy miruro-resolve-v2 --no-verify-jwt
```

If the function is not deployed or no exact ID match is available, ListR reports that the link could not be resolved and does not open a guessed result. Read [`APPEARANCE_MIRURO_v2.md`](APPEARANCE_MIRURO_v2.md) and [`MIRURO_ROUTING_RESEARCH_v2.md`](MIRURO_ROUTING_RESEARCH_v2.md) for behavior, limits, and route evidence.

## AniList account and progress sync v2

The optional AniList connection supplements ListR sign-in; it does not replace it. OAuth code exchange and AniList access tokens stay server-side in Supabase. Applying AniList progress uses an authenticated `SECURITY INVOKER` RPC and existing owner-only RLS; it changes watched counts only on matching rows, without creating duplicates or overwriting metadata/categories. Guests cannot connect or sync. The existing guest localStorage key is unchanged.

Read [`ANILIST_INTEGRATION_v2.md`](ANILIST_INTEGRATION_v2.md) for verified AniList OAuth/API behavior, the v2 migration and Edge Function deployment steps, required AniList/Supabase secrets, verification checklist, and known unconfigured/live-test items. Required manual actions: apply `supabase/migrations/202610020001_anilist_integration_v2.sql`, register the exact Pages redirect URL in AniList Developer Settings, set the three `ANILIST_*` Edge Function secrets, deploy `anilist-account-v2`, and publish the Pages source. No private credential belongs in Git or chat.

## Friends and Recommendations v2

Registration now requires a globally unique, case-insensitive username. Friends, username search, aggregate friend stats, and the recipient-only recommendation inbox are backed by the database-enforced profile/friendship/recommendation schema. Friend profiles reveal only usernames; stats are available only to accepted friends and never return anime titles, email, or AniList credentials. Accept adds a recommendation immediately to ListR Interested only and never writes to AniList Planning. Read [`FRIENDS_RECOMMENDATIONS_v2.md`](FRIENDS_RECOMMENDATIONS_v2.md) for migration/deployment steps and the acceptance flow.

Home is the default view, with live library counts and shortcuts into tracking, search, stats, and social features. The ListR wordmark returns Home. Stats, Friends, and Recommendations are grouped in the profile dropdown. Tablet and mobile navigation reflows so the account bar sits below, not over, the primary nav. The recommendation composer keeps search results in their own scroll area and pins the selected-anime preview and Send action below it. A recommendation shows its sender, received date, and AniList metadata; choosing a result only selects it—the separate Send action creates the recommendation and does not write to AniList. Accepting received recommendations adds only to ListR Interested.

## Features

- Watching, Completed, and Interested categories; tracker state and statistics are restored from the authenticated user's cloud rows.
- User-owned rows keyed by Auth user ID plus AniList media ID; RLS is the actual security boundary, not just JavaScript checks.
- Persistent Supabase Auth sessions; email/password account forms with validation, clear errors, and verification guidance.
- Unique ListR usernames and RLS/RPC-enforced friend requests, accepted-friend aggregate stats, and recipient-only anime recommendations.
- Profile dropdown for Stats, Friends, and Recommendations; the recommendation picker has an independent results scroller and fixed selection/send footer.
- Non-destructive guest-library import: imports missing AniList IDs only, keeps cloud duplicates unchanged, and leaves the local guest list intact.
- Per-user recovery cache and retryable sync outbox for transient network/backend failures; caches and queues are namespaced by the authenticated user ID.
- Logout clears the visible cloud state and returns to the separate local guest list.
- Home dashboard with live collection summaries, useful shortcuts, and guest/account-specific guidance.
- Existing AniList search/metadata, add/remove/move, episode controls, progress, filters/sorting, responsive UI, and statistics are retained.
- Cohesive midnight-blue visual redesign across navigation, anime cards/posters, search, stats, account, Friends, Recommendations, empty/loading states, and dialogs.
- Five independently selectable themes and three independently selectable Current/Reworked Old/New layouts; appearance follows a signed-in user or stays in guest-local storage.
- Watching-only Miruro links resolve the exact AniList ID and open the next episode without modifying ListR progress or any AniList list.
- Tactile hover/pressed/focus/loading states, responsive view/card transitions, and reduced-motion support while preserving accessible labels and visible keyboard focus.
- Optional, short synthesized Web Audio cues for clicks, navigation, dialogs, successes, and errors; users can persistently switch sounds off, and cues are suppressed while media plays or the page is hidden.
- Matching blue ListR vector favicon (`favicon_v2.svg`) and separate v2 design research/state notes.

## Run locally

```bash
cd anime-tracker
python3 -m http.server 8000
```

Visit <http://localhost:8000>. Supabase email-confirmation redirects must include the local URL in the project's Redirect URLs list. AniList search/refresh and cloud sync require network access; queued signed-in changes are retained for retry.

Run the frontend and resolver/migration source tests with Node.js 18 or later, from the repository root:

```bash
node --test anime-tracker/tests/*.test.mjs supabase/tests/*.test.mjs
```

The Postgres RLS tests are in [`supabase/tests/anime_records_rls.test.sql`](supabase/tests/anime_records_rls.test.sql), [`supabase/tests/anilist_integration_v2.test.sql`](supabase/tests/anilist_integration_v2.test.sql), and [`supabase/tests/friends_recommendations_v2.test.sql`](supabase/tests/friends_recommendations_v2.test.sql). From the repository root, install the Supabase CLI and Docker, then run the local stack and tests using the checked-in `supabase/config.toml`:

```bash
supabase start
supabase db reset
supabase test db
```

These database tests use separate Auth user IDs and exercise signed-out denial, anime-owner isolation, friend/username uniqueness and authorization, recipient-only recommendations, server-only acceptance finalization, and AniList progress-sync isolation/clamping/idempotency.

## GitHub Pages

The checked-in workflow at `.github/workflows/static.yml` copies `anime-tracker/` into the Pages artifact. Keep all frontend modules and styles together in that directory. Repository: [`s4fire/ListR-Online`](https://github.com/s4fire/ListR-Online). The expected project-site URL is <https://s4fire.github.io/ListR-Online/> unless a custom Pages domain is configured. Supabase remains the external auth/database service; the frontend has no server-side build requirement.

## Data and security notes

- Guest mode uses the existing tracker `localStorage` key and does not upload it. Appearance uses a separate guest/user preference key. Signing in does not silently merge or delete tracker data; the import banner provides an explicit, duplicate-safe choice.
- Signed-in anime records live in Supabase. The browser keeps only the Supabase Auth session, a user-namespaced recovery cache, and a user-namespaced retry queue. Passwords are handled by Supabase Auth, never written by ListR to localStorage or the anime table.
- Anime and appearance rows are constrained by RLS `auth.uid() = user_id`; the frontend also scopes requests by user ID as defense in depth. Never expose a secret/service-role key.
- AniList IDs are unique only within one user's library, so different users may track the same anime.
