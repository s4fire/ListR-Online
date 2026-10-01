# ListR Project State

Last updated: 2026-10-01

## Repository
- GitHub repository: s4fire/ListR-Online
- Default branch: main
- GitHub Pages deployment uses .github/workflows/static.yml and copies anime-tracker/ to the Pages artifact.
- Production site: https://s4fire.github.io/ListR-Online/
- Repository name must NOT be changed.

## Application
- App branding is being changed from the old Afterglow / Anime Tracker branding to ListR.
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

## Authentication redirect issue
- Production auth redirects must return to:
  https://s4fire.github.io/ListR-Online/
- The current registration code in anime-tracker/script.js still constructs emailRedirectTo from window.location.origin, which can become http://localhost:3000 when registration is performed from a development preview.
- This needs to be changed so production does not send confirmation links to localhost.
- Supabase Authentication URL Configuration must allow the production URL and use it as the Site URL. Local development may use an explicitly configured local URL.
- Existing confirmation emails containing localhost will remain invalid; a new confirmation email must be generated after the fix.

## Current planned work
1. Finish ListR rebranding without renaming the GitHub repository.
2. Fix production authentication redirects alongside the rebrand.
3. Verify tests and GitHub Pages deployment.
4. Later implement Text to List.

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
- PROJECT_STATE.md is the handoff/source-of-context file for future coding chats.
- At clean checkpoints, update this file and commit it with the code.
- When a coding checkpoint is complete, tell the user to switch to a new chat inside the same ListR Project.
- In the next chat, inspect the current repo/state before editing and continue from the recorded state.
