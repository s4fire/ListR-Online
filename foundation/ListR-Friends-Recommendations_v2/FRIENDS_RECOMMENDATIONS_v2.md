# Friends and Recommendations v2

**Project:** ListR (`s4fire/ListR-Online`)  
**State:** Source, the additive Supabase migration, browser helper, server handler, and tests are prepared in this working copy. The migration and updated Edge Function have **not** been applied/deployed to the live Supabase project or production GitHub Pages site from this session.

## Usernames, friendships, and privacy

New registrations require a username. ListR canonicalizes usernames to lowercase and accepts 3–20 ASCII letters, digits, or underscores, with a letter/digit first. The Auth insert trigger validates the signup metadata before the account insert can complete; a unique database index prevents case-variant duplicates. The browser also validates fields and reports database uniqueness errors. Existing accounts without a valid username receive a blocking username modal the first time they enter Friends or Recommendations.

The profile table stores only the Auth user ID, a username, and timestamps. Direct profile access is limited to the current user; a narrowly scoped search RPC returns username and relationship state only, never email. Friend requests are stored as a canonical UUID pair with a unique constraint; RPCs prevent self-friending and duplicate requests. Only participants can list, respond to, cancel, or remove a relationship. Profile previews show usernames only. Aggregate stats are returned only to accepted friends, and include Interested in list/category counts while excluding Interested from watched episodes and watched time, matching ListR's existing rule.

Recommendations are canonicalized by AniList media ID. The authenticated server handler re-fetches the selected media from AniList, rejects nonexistent, mismatched, non-anime, or adult results, and creates a recommendation only for an accepted friend. The database recipient inbox returns pending recommendations addressed to the current Auth user, with the sender's username and display metadata only. Recipients can dismiss their own received pending recommendations; browser roles cannot directly insert, update, or delete social rows.

## AniList write-back boundary

Normal tracker changes and normal AniList-to-ListR progress sync remain read/import/update-from-AniList only. No ordinary add, move, watched-count edit, delete, or sync action writes to AniList.

The **only** AniList mutation is the recipient's explicit **Add to Interested** action on a received recommendation. The updated authenticated Edge Function:

1. Verifies the recipient owns a pending recommendation and has a valid linked AniList authorization.
2. Uses the recipient's RLS-scoped database client to place the anime in ListR **Interested**. A missing entry is inserted under `(user_id, anilist_media_id)`; an existing entry is moved to Interested while retaining its watched count and cached metadata. Repeated attempts do not create duplicate anime rows.
3. Checks the authenticated AniList account's list; if that media ID is already `PLANNING`, no duplicate mutation is sent. Otherwise it explicitly calls AniList `SaveMediaListEntry` with `status: PLANNING` and requires a successful response confirming the same ID/status.
4. Uses a server-only, service-role-protected RPC to mark the received recommendation accepted **only after both services confirm their update**.

If the ListR save fails, AniList is not changed. If AniList fails after the ListR save, ListR reports that partial state, preserves progress/metadata, and leaves the recommendation pending for an idempotent retry. If finalization fails after AniList succeeds, the response explicitly says both anime records were saved but the recommendation status needs a retry. If AniList is not connected, the UI explains the requirement and offers the existing connection flow; it does not claim success.

## Files and tests

The main addition is `supabase/migrations/202610020003_friends_recommendations_v2.sql`. It creates the username/profile, friendship and recommendation schema; database constraints/indexes; participant/recipient RLS; signup/profile/search/friend/stats/recommendation RPCs; and a finalize-acceptance RPC executable only by `service_role`.

The static client additions are `anime-tracker/social-v2.js`, `anime-tracker/tests/friends-recommendations-v2.test.mjs`, new required username and social views/dialogs in `index.html`, matching CSS, and Friends/recommendation orchestration in `script.js`. The existing `anilist-account-v2` Edge Function is narrowly extended, and `_shared/anilist-v2.mjs` adds the isolated, testable acceptance coordinator and canonical media/Planning helpers.

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

The Friends suite is `supabase/tests/friends_recommendations_v2.test.sql`; it covers signup username enforcement, case-insensitive uniqueness, self/duplicate friend requests, profile/email boundaries, accepted-friend stats, authorized recommendation creation, sender/recipient isolation, dismissal, server-only finalization, and ended-friendship access. JavaScript tests additionally cover AniList media verification, Planning de-duplication, success ordering, one-way-sync boundaries, and cross-service failure paths.

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

The current sandbox does not have the Supabase CLI, Docker, or local PostgreSQL, and no production migration or deployment was requested/performed. Therefore the pgTAP database suite and live two-account/friend/AniList acceptance flow still need an owner-run Supabase test/deploy after applying the migration. The pre-existing AniList connection migration/function also remains a prerequisite for recommendation acceptance.