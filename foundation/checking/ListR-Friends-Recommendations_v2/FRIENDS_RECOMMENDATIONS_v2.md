# Friends and Recommendations v2

**Project:** ListR (`s4fire/ListR-Online`)  
**State:** Source, the additive Supabase migration, browser helper, server handler, and tests are prepared in this working copy. The migration and updated Edge Function have **not** been applied/deployed to the live Supabase project or production GitHub Pages site from this session.

## Usernames, friendships, and privacy

New registrations require a username. ListR canonicalizes usernames to lowercase and accepts 3–20 ASCII letters, digits, or underscores, with a letter/digit first. The Auth insert trigger validates the signup metadata before the account insert can complete; a unique database index prevents case-variant duplicates. The browser also validates fields and reports database uniqueness errors. Existing accounts without a valid username receive a blocking username modal the first time they enter Friends or Recommendations.

The profile table stores only the Auth user ID, a username, and timestamps. Direct profile access is limited to the current user; a narrowly scoped search RPC returns username and relationship state only, never email. Friend requests are stored as a canonical UUID pair with a unique constraint; RPCs prevent self-friending and duplicate requests. Only participants can list, respond to, cancel, or remove a relationship. Profile previews show usernames only. Aggregate stats are returned only to accepted friends, and include Interested in list/category counts while excluding Interested from watched episodes and watched time, matching ListR's existing rule.

Recommendations are canonicalized by AniList media ID. The authenticated server handler re-fetches the selected media from AniList, rejects nonexistent, mismatched, non-anime, or adult results, and creates a recommendation only for an accepted friend. The database recipient inbox returns pending recommendations addressed to the current Auth user, with the sender's username and display metadata only. Recipients can **Add to Interested** or dismiss their own received pending recommendations; browser roles cannot directly insert, update, or delete social rows.

## Recommendation acceptance: ListR only

Accept adds the recommended anime immediately to the recipient's ListR **Interested** category. This action does **not** require an AniList connection and never writes to AniList Planning; AniList is left unchanged. No ListR tracker action writes to an AniList list. AniList progress sync remains one-way: it reads AniList progress and updates watched counts on existing ListR records only.

The authenticated Edge Function:

1. Verifies the recipient owns a pending recommendation and that its stored media metadata matches the canonical media ID and anime type.
2. Uses the recipient's RLS-scoped database client to place the anime in ListR **Interested**. A missing entry is inserted under `(user_id, anilist_media_id)`; an existing entry is moved to Interested while retaining its watched count and cached metadata. Repeated attempts do not create duplicate anime rows.
3. Uses a server-only, service-role-protected RPC to mark the received recommendation accepted after the ListR entry has been saved.

If the ListR save fails, the recommendation remains pending. If inbox finalization fails after the ListR save, the response says the anime is saved but the recommendation status needs a retry; the existing ListR record is preserved, and retrying is duplicate-safe. No AniList connection check or AniList mutation is part of this flow.

## Files and tests

The main addition is `supabase/migrations/202610020003_friends_recommendations_v2.sql`. It creates the username/profile, friendship and recommendation schema; database constraints/indexes; participant/recipient RLS; signup/profile/search/friend/stats/recommendation RPCs; and a finalize-acceptance RPC executable only by `service_role`.

The static client additions are `anime-tracker/social-v2.js`, `anime-tracker/tests/friends-recommendations-v2.test.mjs`, new required username and social views/dialogs in `index.html`, matching CSS, and Friends/recommendation orchestration in `script.js`. The existing `anilist-account-v2` Edge Function is narrowly extended, and `_shared/anilist-v2.mjs` provides the testable ListR-only acceptance coordinator and canonical media validation.

The app header keeps Watching, Completed, Interested, and Add anime prominent; Stats, Friends, and Recommendations are grouped in a circular profile dropdown. It closes on outside click, Escape, or section selection. The recommendation composer separates the AniList result scroller from a pinned selected-anime preview and Send footer, so a long result list does not push the action off-screen. Selecting a result is not a send and does not write to AniList.

Run frontend and helper tests with:

```bash
cd anime-tracker
node --test tests/*.test.mjs
```

Run the database RLS/pgTAP suite after applying migrations with the Supabase CLI and local database available:

```bash
cd ..
supabase start
supabase db reset
supabase test db
```

The Friends suite is `supabase/tests/friends_recommendations_v2.test.sql`; it covers signup username enforcement, case-insensitive uniqueness, self/duplicate friend requests, profile/email boundaries, accepted-friend stats, authorized recommendation creation, sender/recipient isolation, dismissal, server-only finalization, and ended-friendship access. JavaScript tests additionally cover AniList media verification, ListR-only acceptance ordering, duplicate-safe updates, one-way-sync boundaries, and failure recovery without any AniList Planning write path.

## Manual deployment still required

Apply the SQL migrations in order in the **same Supabase project**:

1. `supabase/migrations/202610010001_anime_records.sql`
2. `supabase/migrations/202610020001_anilist_integration_v2.sql`
3. `supabase/migrations/202610020003_friends_recommendations_v2.sql`

Then deploy the updated function, retaining its existing JWT verification and already documented AniList server-side secrets:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy anilist-account-v2
```

Publish the updated `anime-tracker/` source using the existing GitHub Pages Actions workflow. No new AniList secret or browser secret is introduced. Do not put a Supabase service-role key, AniList secret, or AniList access token into browser configuration or Git.

The current sandbox does not have the Supabase CLI, Docker, or local PostgreSQL, and no production migration or deployment was requested/performed. Therefore the pgTAP database suite and live two-account/friend acceptance flow still need an owner-run Supabase test/deploy after applying the migration. Recommendation acceptance does not require an AniList account or connection; the existing AniList integration remains independent for search, metadata, and one-way progress sync.
