# ListR Project State

Last updated: 2026-10-01

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

## Current planned work
1. Confirm the Supabase Authentication URL Configuration for production.
2. Manually verify the production auth flow with a newly generated confirmation email.
3. Once auth/rebrand is fully verified, move to Text to List.
4. Preserve all existing tracker, guest, auth, cloud-sync, AniList, and RLS behavior while adding new features.

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
