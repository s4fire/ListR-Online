# AniList integration v2 — implementation and setup

**Project:** ListR (`s4fire/ListR-Online`)  
**State:** v2 source, migration, and tests are prepared in this working copy. The live Supabase migration/function and AniList OAuth app have **not** been deployed or exercised because the Supabase CLI/project-owner configuration and AniList developer credentials are not available in this session. The existing ListR sign-in, cloud library, guest mode, AniList metadata/search, and guest localStorage key remain separate and unchanged.

## What was added

- An authenticated **Connect AniList** panel with Not Connected, Connecting, Connected, and Error states; it shows the linked AniList username, offers disconnect, and reports sync progress, update counts, no-change results, failures, and last successful sync.
- A server-side Supabase Edge Function named `anilist-account-v2`. It uses AniList's Authorization Code Grant; the AniList client secret and access token remain in server-only Supabase storage and are never returned to browser code. OAuth transactions use one-time, expiring SHA-256 state records and the callback fails closed on a missing, expired, or mismatched state.
- A private, one-connection-per-ListR-user table and a private OAuth-state table. Browser roles have no table grants or RLS policies for these tables.
- An authenticated `SECURITY INVOKER` database function, `sync_anilist_progress_v2`, which uses `auth.uid()` and existing RLS to update **only watched episode counts on existing rows owned by the caller**. It never inserts an anime, changes a category, changes cached metadata, or accepts an owner ID from the caller. It clamps to a known episode total and ignores unmatched media IDs.
- A sync action that fetches the linked user's full anime `MediaListCollection` by the AniList user ID verified during OAuth, includes status and custom-list groups, normalizes by AniList media ID, and returns only IDs/counts to the same authenticated user. A second call applies updates through the user-scoped RLS client.
- Automatic sync after connecting, on signed-in library load if the last successful sync is at least 15 minutes old, and when a visible tab resumes after that interval. There is no timer or polling loop. Sync requests have a 30-second client cooldown plus an atomic, server-enforced per-user reservation, so direct calls cannot bypass the cooldown. Each actual refresh uses one AniList GraphQL list query; AniList's `Retry-After` is surfaced on rate limiting.
- `supabase/tests/anilist_integration_v2.test.sql` plus dependency-free JavaScript tests cover OAuth/query behavior, state/cancellation/failures, list normalization, duplicate prevention, progress clamping, idempotent repeat sync, RLS owner isolation, guest/auth boundaries, and rate-limit/error handling.

## AniList behavior verified against current official docs

AniList's [authentication overview](https://docs.anilist.co/guide/auth/) documents Authorization Code and Implicit Grant flows, says OAuth scopes are not supported, says access tokens last one year, and says refresh tokens are not supported. Because this project has a backend, v2 uses the Authorization Code Grant: the [official guide](https://docs.anilist.co/guide/auth/authorization-code) documents `https://anilist.co/api/v2/oauth/authorize`, `response_type=code`, the exact registered redirect URI, and the `https://anilist.co/api/v2/oauth/token` exchange requiring the client ID, client secret, redirect URI, grant type, and code. The client secret is kept in Edge Function secrets.

AniList's docs do not mention OAuth `state` or PKCE parameters. The implementation uses OAuth 2.0's standard recommended `state` parameter for CSRF protection (see [RFC 6749 §4.1.1–4.1.2](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.1)); it will not accept a callback if the exact one-time state is absent or mismatched. Verify this round trip after registering the AniList application. **Do not disable state verification** if the provider does not return it; stop and reassess rather than accepting an unbound callback.

Authenticated AniList requests use `Authorization: Bearer …` at `https://graphql.anilist.co`, as documented [here](https://docs.anilist.co/guide/auth/authenticated-requests). The official [media-list guide](https://docs.anilist.co/guide/graphql/queries/media-list) requires a `userId` or `userName` even for authenticated calls, and warns that custom lists can contain entries hidden from default status lists. v2 uses the verified AniList `userId` and requests all `lists { entries { mediaId progress updatedAt } }`; the [MediaList reference](https://docs.anilist.co/reference/object/medialist) defines `mediaId` and `progress`.

The official [rate-limit page](https://docs.anilist.co/guide/rate-limiting) currently reports a **degraded limit of 30 requests/minute** (normal limit 90), plus burst limiting. The sync is user-driven/cooldown-based rather than polled and returns the provider's `Retry-After` when rate limited. AniList currently describes `MediaListCollection` as limited to the 11,000 most recently updated unique entries.

## Manual setup required

These actions require access to the matching Supabase project and an AniList developer account; never send client secrets, private keys, or access tokens in chat or commit them.

1. **Apply the database migrations** in order if they have not already been applied:
   - `supabase/migrations/202610010001_anime_records.sql`
   - `supabase/migrations/202610020001_anilist_integration_v2.sql`

   The v2 SQL creates the private connection/state tables and the RLS-invoker progress RPC. It assumes the existing `anime_records` table and owner-only RLS migration are active. The database tests are in `supabase/tests/anilist_integration_v2.test.sql`.

2. **Register an AniList application** at [AniList Developer Settings](https://anilist.co/settings/developer). Give it an app name such as `ListR`. Set the redirect URL to the exact site root, normally:
   `https://s4fire.github.io/ListR-Online/`

   Use that same exact value for both the AniList application and `ANILIST_REDIRECT_URI`; AniList requires exact URI matching. If the site uses a custom domain, substitute its exact site root consistently. AniList does not support OAuth scopes; ListR warns users of this before they connect.

3. **Set production Edge Function secrets** in the Supabase Dashboard under **Edge Function Secrets** (or use a locally-created, ignored `.env` file with `supabase secrets set --env-file .env`). Required variable names are:
   - `ANILIST_CLIENT_ID`
   - `ANILIST_CLIENT_SECRET`
   - `ANILIST_REDIRECT_URI`

   The optional `LISTR_ALLOWED_ORIGINS` is a comma-separated list of browser origins if a custom Pages domain or a different local dev origin is used. Defaults allow `https://s4fire.github.io` and local port 8000. Do not set or expose any `SUPABASE_SERVICE_ROLE_KEY` in the frontend; Supabase provides server-only credentials to the Edge Function runtime.

4. **Deploy the function** to the same Supabase project after CLI login/link:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase functions deploy anilist-account-v2
   ```
   `supabase/config.toml` explicitly keeps JWT verification enabled. The function also validates the ListR user and uses a user-scoped database client for the progress RPC. Creating production secrets requires a Supabase project Owner or Administrator; see [Supabase function security](https://supabase.com/docs/guides/functions/auth), [secrets](https://supabase.com/docs/guides/functions/secrets), and [deployment](https://supabase.com/docs/guides/functions/deploy).

5. **Publish the website source** through the existing GitHub Pages workflow and ensure the current Supabase project allows the deployed site URL. The workflow tests the frontend and publishes `anime-tracker/`; it does not deploy the Edge Function or apply SQL migrations.

6. **Verify with two ListR test accounts.** Connect each account to an AniList account; add an anime to each ListR library; change a progress count in AniList/Miruro; use **Sync with AniList** (or wait for the next eligible focus/open refresh). Confirm only existing matching AniList IDs update, counts clamp to known totals, metadata/categories do not change, no duplicate rows appear, and the other ListR account is unchanged. Test cancel, disconnect, reauthorization after expiry/revocation, and a 429 response.

## Test commands

Frontend and integration unit tests, plus JavaScript syntax checks:

```bash
cd anime-tracker
node --test tests/*.test.mjs
node --check script.js
node --check anilist-integration-v2.js
node --check ../supabase/functions/_shared/anilist-v2.mjs
```

For the database policy/RPC tests, with the Supabase CLI and local database available:

```bash
supabase start
supabase db reset
supabase test db
```

The current sandbox has Node.js but no Supabase CLI, Deno, or local Postgres/Docker stack, so the pgTAP/RLS suite and live OAuth exchange still require the manual project setup above.

## Security and behavior boundaries

- AniList link identity and its token belong to the current Supabase Auth `user_id`; status, disconnect, state transactions, and sync queries are filtered to that verified owner. The Edge Function requires a valid user session; guests cannot connect or sync.
- AniList credentials/tokens are not in HTML, browser modules, localStorage, guest storage, URLs, function responses, or logs. The callback code is removed from browser history after processing; the page sets `no-referrer`.
- AniList authorization does not replace ListR authentication. The integration only reads the authorized AniList user's anime list; ListR does not mutate the AniList list.
- Existing guest localStorage key remains `afterglow-anime-tracker-v1`; guest records are neither sent to the Edge Function nor automatically imported.
- Current AniList docs say there are no OAuth scopes, tokens expire after one year, and no refresh-token flow exists. A user must reconnect after expiry or revocation.
- The separate Miruro Watch button is intentionally **not** included in this update.
