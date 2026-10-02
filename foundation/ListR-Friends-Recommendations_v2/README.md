# ListR / Afterglow

A static anime tracker in `anime-tracker/`, deployed to GitHub Pages and backed by AniList for search/metadata. Guest lists remain in the current browser. Signed-in lists sync through Supabase Auth and Postgres, with a database-enforced owner boundary.

## Supabase setup (required for accounts and cloud sync)

The frontend is configured for the Supabase project in `anime-tracker/supabase-config.js`. That file contains only the project URL and a publishable browser key; those are public client configuration, not secrets. Never put a Supabase secret/service-role key, database password, or other private credential in this repository.

1. In the matching Supabase project, open **SQL Editor** and run [`supabase/migrations/202610010001_anime_records.sql`](supabase/migrations/202610010001_anime_records.sql). It creates the user-owned `anime_records` table, compound `(user_id, anilist_media_id)` uniqueness, validation, timestamps, and separate select/insert/update/delete RLS policies.
2. In **Authentication → URL Configuration**, set the Site URL to the actual public site, normally `https://s4fire.github.io/ListR-Online/`. Add that exact URL to the Redirect URLs allow-list. For local development also allow the local static-server URL, such as `http://localhost:8000/**`. If the repository uses a custom Pages domain, allow that origin instead.
3. Keep email/password sign-up enabled. This project currently requires email confirmation (`mailer_autoconfirm` is off), so configure a working email provider/SMTP if needed. A new user must verify the Supabase email link before signing in; the link returns to ListR.
4. If using another Supabase project, change only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `anime-tracker/supabase-config.js` to that project's public values. Apply the migration there too. Do not commit private keys.

The UI shows a setup error rather than mixing guest data if the cloud table is missing or access is denied. Guest mode remains available while the backend is being configured.

## AniList account and progress sync v2

The optional AniList connection supplements ListR sign-in; it does not replace it. OAuth code exchange and AniList access tokens stay server-side in Supabase. Applying AniList progress uses an authenticated `SECURITY INVOKER` RPC and existing owner-only RLS; it changes watched counts only on matching rows, without creating duplicates or overwriting metadata/categories. Guests cannot connect or sync. The existing guest localStorage key is unchanged.

Read [`ANILIST_INTEGRATION_v2.md`](ANILIST_INTEGRATION_v2.md) for verified AniList OAuth/API behavior, the v2 migration and Edge Function deployment steps, required AniList/Supabase secrets, verification checklist, and known unconfigured/live-test items. Required manual actions: apply `supabase/migrations/202610020001_anilist_integration_v2.sql`, register the exact Pages redirect URL in AniList Developer Settings, set the three `ANILIST_*` Edge Function secrets, deploy `anilist-account-v2`, and publish the Pages source. No private credential belongs in Git or chat.

## Friends and Recommendations v2

Registration now requires a globally unique, case-insensitive username. Friends, username search, aggregate friend stats, and the recipient-only recommendation inbox are backed by the database-enforced profile/friendship/recommendation schema. Friend profiles reveal only usernames; stats are available only to accepted friends and never return anime titles, email, or AniList credentials. Read [`FRIENDS_RECOMMENDATIONS_v2.md`](FRIENDS_RECOMMENDATIONS_v2.md) for migration/deployment steps and the carefully limited recommendation acceptance flow.

## Features

- Watching, Completed, and Interested categories; tracker state and statistics are restored from the authenticated user's cloud rows.
- User-owned rows keyed by Auth user ID plus AniList media ID; RLS is the actual security boundary, not just JavaScript checks.
- Persistent Supabase Auth sessions; email/password account forms with validation, clear errors, and verification guidance.
- Unique ListR usernames and RLS/RPC-enforced friend requests, accepted-friend aggregate stats, and recipient-only anime recommendations.
- Non-destructive guest-library import: imports missing AniList IDs only, keeps cloud duplicates unchanged, and leaves the local guest list intact.
- Per-user recovery cache and retryable sync outbox for transient network/backend failures; caches and queues are namespaced by the authenticated user ID.
- Logout clears the visible cloud state and returns to the separate local guest list.
- Existing AniList search/metadata, add/remove/move, episode controls, progress, filters/sorting, responsive UI, and statistics are retained.

## Run locally

```bash
cd anime-tracker
python3 -m http.server 8000
```

Visit <http://localhost:8000>. Supabase email-confirmation redirects must include the local URL in the project's Redirect URLs list. AniList search/refresh and cloud sync require network access; queued signed-in changes are retained for retry.

Run the frontend logic tests with Node.js 18 or later:

```bash
cd anime-tracker
node --test tests/*.test.mjs
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

- Guest mode uses the existing `localStorage` key and does not upload it. Signing in does not silently merge or delete it; the import banner provides an explicit, duplicate-safe choice.
- Signed-in anime records live in Supabase. The browser keeps only the Supabase Auth session, a user-namespaced recovery cache, and a user-namespaced retry queue. Passwords are handled by Supabase Auth, never written by ListR to localStorage or the anime table.
- Every table operation is constrained by RLS `auth.uid() = user_id`; the frontend also filters by user ID only as defense in depth. Never expose a secret/service-role key.
- AniList IDs are unique only within one user's library, so different users may track the same anime.
