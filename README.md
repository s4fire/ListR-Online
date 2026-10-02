# ListR

ListR is a lightweight anime tracker built around AniList. It gives you one place to keep track of what you're watching, what you've completed, and what you want to watch next.

The project is designed to work as a simple static web app while still supporting optional accounts and cloud-synced libraries.

## Features

- **Watching, Completed & Interested** — organize your anime into three simple categories.
- **AniList integration** — search AniList for anime and use its metadata and episode information.
- **Episode tracking** — keep track of your current progress and see how much you've watched.
- **Statistics** — view total episodes and watch time across your tracked anime.
- **Cloud libraries** — signed-in users can keep their ListR library synced through Supabase.
- **Guest mode** — use ListR without an account, with the guest library kept locally in the browser.
- **Responsive interface** — designed to work across desktop and smaller screens.
- **Safe multi-user storage** — signed-in libraries are separated by the authenticated user's ID and protected with Supabase Row Level Security.

## Project structure

```
ListR-Online/
├── anime-tracker/       # The live ListR web app
├── foundation/          # Foundation ZIP archives used for project baselines
├── supabase/            # Database migrations and database tests
├── .github/workflows/   # GitHub Pages deployment
└── PROJECT_STATE.md     # Development handoff and project state
```

The live frontend lives in `anime-tracker/`. The `foundation/` directory contains archived project baselines and is not part of the deployed site.

## Running locally

ListR has no frontend build step. Serve the `anime-tracker/` directory with any local static web server and open the resulting address in a browser.

For development, the frontend logic tests can be run with Node.js 18+:

```bash
cd anime-tracker
node --test tests/*.test.mjs
```

The Supabase database tests live under `supabase/tests/`.

## Deployment

The project is deployed through GitHub Pages using the workflow in `.github/workflows/static.yml`. Changes pushed to `main` are tested and then deployed as the contents of `anime-tracker/`.

## Data & privacy

Guest libraries stay in the user's browser and are not uploaded automatically.

Signed-in anime records are stored in Supabase and are scoped to the authenticated ListR user. Supabase Row Level Security enforces that ownership boundary at the database level.

The frontend uses only public client configuration. Private Supabase credentials and service-role keys should never be committed to the repository.

## Status

ListR is an actively developed project. New features and integrations are added incrementally while keeping the existing tracker, authentication, cloud sync, and guest functionality intact.
