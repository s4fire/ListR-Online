// Small AniList GraphQL client. The fetch implementation is injectable for tests.
const API_URL = 'https://graphql.anilist.co';
const MEDIA_FIELDS = `id title { romaji english native userPreferred } coverImage { extraLarge large medium } episodes duration status season seasonYear format description(asHtml: false) siteUrl`;

export async function anilistRequest(query, variables = {}, { signal, fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('AniList could not be reached. Check your connection and try again.');
  }
  if (response.status === 429) {
    const retryAfter = response.headers?.get?.('Retry-After');
    throw new Error(`AniList is rate-limiting requests. Please wait${retryAfter ? ` about ${retryAfter} seconds` : ' a little'} and try again.`);
  }
  if (!response.ok) {
    if (response.status >= 500) throw new Error('AniList is temporarily unavailable. Your saved list is safe; please try again later.');
    throw new Error(`AniList request failed (${response.status}). Your saved list is safe.`);
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error('AniList returned an unreadable response. Please try again later.'); }
  if (payload.errors?.length) {
    const message = payload.errors[0]?.message || 'The AniList query could not be completed.';
    throw new Error(message.length > 180 ? `${message.slice(0, 177)}…` : message);
  }
  return payload.data;
}

export async function searchAnime(term, signal, fetchImpl) {
  const query = `query ($search: String) { Page(page: 1, perPage: 16) { media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${MEDIA_FIELDS} } } }`;
  const data = await anilistRequest(query, { search: term }, { signal, fetchImpl });
  return data?.Page?.media || [];
}

export async function refreshAnimeByIds(ids, signal, fetchImpl) {
  const query = `query ($ids: [Int]) { Page(page: 1, perPage: 20) { media(id_in: $ids, type: ANIME) { ${MEDIA_FIELDS} } } }`;
  const data = await anilistRequest(query, { ids }, { signal, fetchImpl });
  return data?.Page?.media || [];
}
