# Miruro Routing Research v2

**Checked:** 2026-10-03. Public catalog and page metadata only. No Miruro account was accessed, no player route was requested by the resolver, and no media was played or extracted.

## Official sources inspected

- Miruro home: <https://www.miruro.tv/>
- Miruro public search UI for the verified title: <https://www.miruro.tv/search?query=The%20Apothecary%20Diaries%20Season%203>
- Miruro public anime catalog endpoint used by its UI: <https://www.miruro.tv/api/v1/anime?q=The+Apothecary+Diaries+Season+3&limit=5&sort=-popularity>
- Miruro Season 3 info page: <https://www.miruro.tv/info/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3>
- Miruro Season 1 info page: <https://www.miruro.tv/info/oWQwfijp7XeJzhYJnEP9livq8qVlfKZH/the-apothecary-diaries>
- Official Season 3 Watch route (route form only): <https://www.miruro.tv/watch/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3?ep=1>
- Official Miruro project repository: <https://github.com/Miruro-no-kuon/Miruro>
- Public site catalog-client bundle inspected for its metadata request/encoding: <https://www.miruro.tv/assets/classNames-Tz2tQR98.js>

## Verified facts

1. Series routes use a Miruro-specific opaque ID plus readable slug: `/info/{opaqueId}/{slug}` and `/watch/{opaqueId}/{slug}`. The opaque ID is not the AniList media ID and cannot be generated from an AniList ID.
2. Search results are **client-rendered**, not present as result links in the raw server-rendered search HTML. The public search UI requests `/api/v1/anime?q=<title>&limit=<n>&sort=-popularity` and the catalog response includes each entry's opaque ID and `external_ids.anilist` mapping.
3. The live catalog's current response is `application/octet-stream`; Miruro's public frontend decodes it by XORing with the public `miruro/catalog` key and then gzip-decompressing it. ListR bounds both request and response sizes and treats decoding/schema changes as a no-match rather than guessing.
4. The verified Season 3 catalog record has opaque ID `EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz`, title `The Apothecary Diaries Season 3`, and exact external AniList ID `195516`. Its official info-page JSON-LD contains `sameAs: https://anilist.co/anime/195516` and a `WatchAction.target` on the corresponding official Watch route.
5. The exact resolver therefore makes an ID-first catalog lookup, filters for an exact numeric AniList external ID, then fetches the candidate `/info/...` page and independently confirms the JSON-LD `sameAs` ID before accepting the official Watch URL. Title similarity alone is never sufficient.
6. The live Watch page initializes with `?ep=1`; the direct episode query key is `ep`. ListR constructs that query only in the user-facing browser link, using `lastWatched + 1` (or episode 1 for zero/unknown progress).
7. Search/info requests are server-side in the Supabase Edge Function to avoid browser CORS. The resolver allowlists the exact HTTPS `www.miruro.tv` origin and the expected `/info/` and `/watch/` route shapes. No playback or provider route is requested.

## Implementation contract

- Only cards in ListR **Watching** receive a Watch action.
- The requested episode is `lastWatched + 1`; zero/unknown progress starts at episode 1.
- Candidate lookup uses the exact AniList ID from Miruro's public catalog, then repeats that identity check on info-page JSON-LD. If the exact ID is not proven, ListR closes the placeholder tab and reports that nothing was opened.
- Route generation is based on the observed official form `/watch/{opaqueId}/{slug}?ep={episode}`.
- The app does not read, extract, proxy, or play third-party media streams.
- The catalog decoder, endpoints, response encoding, and third-party page markup are upstream dependencies; a changed contract must fail closed until reverified.
