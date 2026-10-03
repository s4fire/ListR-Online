# ListR Project State

Last updated: 2026-10-03

## Rollback Version 1
- The current stable ListR repository and live GitHub Pages site are designated as **Rollback Version 1** before the UI/UX overhaul.
- Repository: s4fire/ListR-Online, branch main.
- Rollback commit: ff6f61b105d3485c95c82cb97ab75d04814421f0.
- Production site: https://s4fire.github.io/ListR-Online/
- GitHub Pages workflow run 37111821363 for this commit completed successfully.
- If the UI overhaul introduces a regression, restore the repository/site to this checkpoint before continuing.
- Manus workflow constraint: Manus must NOT modify GitHub. Manus only returns the updated project files. The user uploads/replaces those files in GitHub, and ChatGPT performs the GitHub commits and deployment.

## Repository
- GitHub repository: s4fire/ListR-Online
- Default branch: main
- GitHub Pages deployment uses .github/workflows/static.yml and copies anime-tracker/ to the Pages artifact.
- Production site: https://s4fire.github.io/ListR-Online/
- Repository name must NOT be changed.

## Application
- App branding has been changed from the old Afterglow / Anime Tracker branding to ListR.
- Current code is a static HTML/CSS/vanilla-JS anime tracker.
- Categories: Watching, Completed, Interested.
- AniList GraphQL is used for search and metadata.
- Guest mode uses browser localStorage.
- Authenticated mode uses Supabase Auth + Postgres and syncs per-user records.
- Existing tracker functionality should be preserved.

## Supabase
- Project: ListR
- Project ref: rgiddltqtkhjwkrhzcop
- Region: ap-northeast-2
- Project URL is configured in anime-tracker/supabase-config.js.
- Browser key in that file is the Supabase publishable key; never replace it with a secret/service-role key.
- Migration already applied to the Supabase project: supabase/migrations/202610010001_anime_records.sql
- Table: public.anime_records
- Rows are isolated by user_id with RLS.
- Unique per user: (user_id, anilist_media_id)
- Cloud sync is working; the app has shown “Cloud data synced successfully”.
- Email confirmation is required in the current Supabase setup.

## Authentication redirect checkpoint
- Production auth redirects must return to:
  https://s4fire.github.io/ListR-Online/
- anime-tracker/script.js now uses getAuthRedirectUrl(): GitHub Pages production uses the fixed production URL; local development uses the current local origin.
- The previous localhost redirect bug is fixed in the repository.
- Existing confirmation emails containing localhost remain invalid; a new confirmation email must be generated after the correct Supabase URL Configuration is in place.
- Supabase Authentication URL Configuration still needs to be confirmed/set externally: use the production Pages URL as Site URL and allow that exact URL as a Redirect URL. Local development may use an explicitly configured local URL.

## Rebrand checkpoint
- Visible app branding in index.html is now ListR, including the browser title, header brand, auth brand, footer, and accessibility labels/messages.
- Root and app README branding is now ListR.
- GitHub code search found no remaining “Afterglow” references after the rebrand.
- Existing guest localStorage key was intentionally preserved as afterglow-anime-tracker-v1 so existing guest libraries are not lost during the rebrand.
- The repository name remains s4fire/ListR-Online.
- GitHub Actions Pages workflow run 36916575138 for commit 38b2d6e420f43b6c91b30d22005adb3de34e77b4 completed successfully, including frontend tests and syntax checks.

## Auth startup deadlock checkpoint
- Investigated the persistent “Checking your saved library…” startup state.
- Root cause: anime-tracker/script.js was awaiting supabaseClient.auth.getSession() during startup even though Supabase Auth initializes automatically when the client is created. That created a second auth-initialization path and could leave startup waiting indefinitely on auth-js versions using the older initialization/locking path.
- Fixed initializeAccount() to subscribe to onAuthStateChange() and use the emitted INITIAL_SESSION as the authoritative startup result. Follow-up account activation is deferred with setTimeout so Supabase calls are not made synchronously inside the auth callback.
- No timeout/fallback was added to mask the problem.
- Fix commit: e24887c31dc77251dd4f7fec1416a92d2050f32d.
- Supabase's current documentation recommends relying on the automatic client initialization and onAuthStateChange rather than manually awaiting initialize() for normal browser startup. See the Supabase auth initialization/getSession documentation.
- This checkpoint should be verified on the production Pages site before further auth changes.

## Recommendation accept-and-remind checkpoint
- Recommendation cards now use `Accept` and `Deny` instead of automatically adding the anime.
- `Accept` creates a per-account local reminder in the bottom-right with an `Add anime` action. That action opens the normal AniList search flow prefilled for the recommended title and defaults the category to Interested.
- The reminder stays visible until the recommended AniList media ID appears in the user's ListR library. Once detected, the reminder is cleared and the recommendation is dismissed server-side.
- `Deny` keeps the existing dismiss behavior.
- Reminder state is persisted per signed-in user in browser localStorage when available, so an accepted recommendation remains actionable after refresh on the same browser.
- Implementation commits: e977d9ccc469a95084dce190b969476873e88c0b, ab4fa4d61ff4103f0fd31fdcc286cb7f47c39db3, c7aeb783177849418883d0df115324d4d637a8b3.

## Recommendation reminder viewport/overflow fix checkpoint
- Recommendation search result rows constrain their flex children and Select buttons so long titles cannot push the button outside the result border.
- Move dropdown fix: category move selects now start on a disabled `Move from <current category>` placeholder instead of automatically selecting the first destination. This prevents clicking the already-selected default from appearing nonfunctional while leaving actual move behavior unchanged.

## Current planned work
1. Confirm the Supabase Authentication URL Configuration for production.
2. Manually verify the production auth flow with a newly generated confirmation email.
3. UI/UX overhaul and Home page work is now the next planned development phase.
4. Preserve all existing tracker, guest, auth, cloud-sync, AniList, and RLS behavior while adding the UI overhaul.

## Text to List requirements (future feature)
- Input can contain standalone anime names, in which case the user chooses the category and normal defaults apply:
  - Watching: 0 watched
  - Completed: known total if available
  - Interested: no watched count
- Input can contain category headings such as Watching / Completed / Interested.
- When category headings are present, watched counts for Watching/Completed must be explicitly provided; do not default to 0 or total. Missing counts block import until manually filled.
- Interested under a category heading needs no watched count.
- Review screen should show title, AniList match, category, watched, total, duplicate status, and warnings.
- User can edit match/category/count before confirmation.
- Nothing is saved before confirmation.
- Duplicate detection is by AniList media ID.
- Parser should support numbered/bullet lists, extra whitespace, common formats, and simple episode annotations without being over-aggressive.

## Working method across chats
- GitHub repo is the code source of truth.
- PROJECT_STATE.md is the persistent technical handoff/source-of-context file for future coding chats.
- Workflow: inspect current state → plan → code → test/verify → update PROJECT_STATE.md → commit → declare a clean checkpoint.
- At each clean coding checkpoint, explicitly remind the user to switch to a new chat inside the same ListR Project.
- In the next chat, inspect the latest repo and PROJECT_STATE.md before editing; do not assume the previous chat's state.

## Text to List checkpoint
- Text to List parser added at anime-tracker/text-import.js.
- Text to List UI/import flow added at anime-tracker/text-list.js and loaded from index.html.
- Supports standalone title lists with a chosen default category and category-headed lists for Watching/Completed/Interested.
- Category-headed Watching/Completed entries require explicit watched counts before import; Interested does not.
- Review stage shows source title, AniList match choices, category, watched count, total, and warnings.
- Nothing is imported until the user confirms.
- Duplicate handling reuses the existing AniList-ID-based add flow, so existing tracker/cloud/guest persistence remains the source of truth.
- Next checkpoint: run the GitHub Pages workflow, manually test representative Text to List inputs, then fix any UX/parser issues found.

## Text to List UX fix checkpoint
- Added visible progress feedback while AniList matches are being searched, including per-item progress, and while confirmed rows are being imported.
- Reworked confirmed imports to use direct existing persistence helpers instead of repeatedly driving the normal search UI, reducing the previous clunky/slow import behavior.
- Review now shows duplicate status by AniList media ID.
- Standalone lists now apply normal defaults: Watching starts at 0 watched; Completed uses the known AniList total when available; Interested has no watched count.
- Existing category-headed count requirements remain enforced.

## Current UI copy preference
- User prefers ListR wording to sound casual, direct, and like something they would actually type, not polished marketing/product copy or “AI-generated” phrasing.
- Keep functional category names such as Watching, Completed, and Interested unchanged.
- Prefer simple labels such as Friends, Recs, Find anime, Stats, and plain helper text. Avoid overly poetic headings and corporate/product-language phrasing.

## Rollback Version 2
- Rollback Version 2 is the exact main-branch state immediately before the browser-side Miruro fix work began.
- Branch: `rollback-v2`.
- It was created after Miruro resolver PR #11 was merged and before the browser-side Miruro discovery PR #12.
- Miruro was later fully disabled from the UI in PR #13; the Miruro resolver files remain in the repository but are no longer imported by the frontend.

## Listr Continue Chat Handoff
- The user wants the phrase **“listr continue”** to act as a cross-chat handoff command for this project. When used, continue from the latest ListR project state and provide/use a summary of the prior chat work before proceeding.
- This chat focused on the Miruro Watch feature and then disabling it after repeated resolution failures.
- Miruro resolver history in this chat: server-side exact AniList/catalog matching was attempted; title/search fallbacks were added; the user still received the same no-match error. Research into other Miruro clients/projects found evidence that server/datacenter requests can be blocked while browser requests may work, so a browser-side catalog lookup was attempted. That browser fix initially had a missing normalization helper, which was corrected before merge, but the user chose to disable Miruro entirely because the feature had become too troublesome.
- PR #11 fixed minimal Miruro catalog payload handling and was merged as `eb2d62c3c5fe055e0966a19f53661c59a8c36bd0`.
- Browser-side Miruro discovery PR #12 was merged as `160f19c474a3258a42f5236646477477052e499a`. A follow-up harmless push `ed3c5449fc63eaf92127b5f9a2daa5d2ce76cb35` retriggered Pages deployment because the workflow run was not exposed by the connector.
- Miruro was then disabled in PR #13, merged as `07ca0ae6cf3d208b6592464b29c3a02913a50ac3`. The frontend no longer imports `miruro-v2.js`, no longer renders the Miruro Watch button, and no longer handles its click action. Other ListR functionality was left unchanged.
- Current work in this chat: simplify ListR copy so tabs/pages sound more like the user's natural wording. The copy branch is `tweak/listr-copy` and currently changes page titles/kickers/helper text toward simpler wording.
