# ListR UI/UX Redesign — Design Research v2

## Supplied live-site baseline

Source: <https://s4fire.github.io/ListR-Online/#watching>

The live app currently uses a dark charcoal/purple visual language, a horizontally arranged top navigation, a large orbit/planet hero treatment, an account/sync bar, collection filters, four-column anime cards on wide screens, separate social views, and a shared modal system. Guest mode currently opens the sign-in dialog when visiting Friends or Recommendations. These are observations of the current public page, not a request to change its underlying behavior.

## Uiverse visual references

- Animated button collection: <https://uiverse.io/ui/animated-buttons>
- Hover-effect collection: <https://uiverse.io/tags/hover%20effect>

Uiverse describes its buttons as using animated hover states and transitions and advises that effects remain fast, readable, and accessible. Its hover-effect library demonstrates a broad range of community-created interactions. Uiverse states that its UI elements are MIT-licensed.

## Application to ListR

Use the references as inspiration for concise hover/pressed/focus states, animated highlights, and controlled card lift—not as code to copy verbatim. The ListR implementation should use an original midnight-blue/electric-blue/cyan design language, retain standard HTML controls and visible keyboard focus, keep motion short, and provide an independent sound-off control. Existing data, API, authentication, tracker, social, navigation, and recommendation behavior remains the source of truth.


## Applied visual system v2

The implementation applies the original blue direction across all major surfaces rather than changing a few accents: a midnight canvas and fixed desktop rail, atmospheric blue lighting/grid, layered hero surfaces, compact count-bearing primary navigation, poster-integrated collection cards, quieter secondary controls, stronger primary CTAs, consistent account/social forms and a constrained modal system. The rail reflows to a tablet topbar and a compact phone header. On phones, nav labels remain visible while redundant icons and hero captions are removed to protect hierarchy.

Buttons use consistent hover elevation, pressed compression, border/light transitions, focus rings, disabled/loading states and success/error feedback. Search/empty/loading states, account status, AniList, Friends, Recommendations, stats, and dropdowns use the same palette and spacing system. Native dialogs keep keyboard/modality behavior; the recommendation composer retains a separate results scroller and a stationary selection/Send footer. The favicon is a simple original ListR mark at `anime-tracker/favicon_v2.svg`.

A tiny dependency-free module synthesizes short sine-wave UI cues with Web Audio instead of downloading audio. The toggle is keyboard/screen-reader exposed and persists its setting independently. Sounds are optional, suppressed when the page is hidden or media is playing, and are supplementary to visible feedback. CSS and route scrolling respond to `prefers-reduced-motion`.

## Applied-system verification

- `node --test anime-tracker/tests/*.test.mjs`: 57 pass, 0 fail; all browser modules pass `node --check`; `git diff --check` is clean.
- Playwright checked seeded desktop (1440×1080), tablet (768×1024), and phone (390×844) views. All had document width equal to viewport width; account and navigation layouts did not overlap. The 390px primary nav fit (`scrollWidth === clientWidth === 344px`) after removing mobile-only decorative icons.
- The Home watch-time display used the existing stats calculation; collection cards rendered with poster fallback, metadata and progress controls using synthetic local-only data.
- A synthetic 18-result recommendation list at 390×844 produced a results scroller of 438px with 1,387px content; after a 240px scroll the selected preview remained at y=658–724 and the Send footer at y=724–770, within the 62–782px dialog.
- A fake, silent AudioContext verified mute/persistence plus separate success/error cue scheduling without audible QA output. Registration dialog rendering and profile dropdown routing were tested without submitting account forms or mutating server data.
