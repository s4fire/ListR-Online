export const ANILIST_AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize';
export const ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

export class AniListIntegrationError extends Error {
  constructor(code, message, { status = 502, retryAfter = null } = {}) {
    super(message);
    this.name = 'AniListIntegrationError';
    this.code = code;
    this.status = status;
    const seconds = retryAfter == null || retryAfter === '' ? Number.NaN : Number(retryAfter);
    const timestamp = retryAfter == null || retryAfter === '' ? Number.NaN : Date.parse(String(retryAfter));
    this.retryAfter = Number.isFinite(seconds) && seconds >= 0
      ? seconds
      : (Number.isFinite(timestamp) ? Math.max(0, (timestamp - Date.now()) / 1000) : null);
  }
}

export function createOAuthState(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.getRandomValues) throw new Error('A secure random source is required.');
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export async function hashOAuthState(state, cryptoImpl = globalThis.crypto) {
  if (typeof state !== 'string' || state.length < 32 || state.length > 256) throw new Error('Invalid OAuth state.');
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function buildAniListAuthorizationUrl({ clientId, redirectUri, state }) {
  if (!clientId || !redirectUri || !state) throw new Error('AniList OAuth configuration is incomplete.');
  const url = new URL(ANILIST_AUTHORIZE_URL);
  url.searchParams.set('client_id', String(clientId));
  url.searchParams.set('redirect_uri', String(redirectUri));
  url.searchParams.set('response_type', 'code');
  // OAuth 2.0 state is included for CSRF protection; callback state is required and checked.
  url.searchParams.set('state', state);
  return url.toString();
}

async function readJson(response, code) {
  try { return await response.json(); }
  catch { throw new AniListIntegrationError(code, 'AniList returned an unreadable response.'); }
}

async function safeFetch(fetchImpl, url, options, code) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new AniListIntegrationError(code, 'AniList could not be reached. Check the connection and try again.', { status: 502 });
  }
}

export async function exchangeAniListCode({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const response = await safeFetch(fetchImpl, ANILIST_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code
    })
  }, 'anilist_token_exchange_failed');
  const payload = await readJson(response, 'anilist_token_exchange_failed');
  if (!response.ok || typeof payload?.access_token !== 'string' || !payload.access_token) {
    throw new AniListIntegrationError('anilist_token_exchange_failed', 'AniList authorization could not be completed. Start Connect AniList again.', { status: 502 });
  }
  return payload.access_token;
}

async function authenticatedGraphql(accessToken, query, variables, fetchImpl) {
  const response = await safeFetch(fetchImpl, ANILIST_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query, variables })
  }, 'anilist_unavailable');
  if (response.status === 429) {
    throw new AniListIntegrationError('anilist_rate_limited', 'AniList is rate-limiting requests. Wait before syncing again.', {
      status: 429,
      retryAfter: response.headers?.get?.('Retry-After')
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new AniListIntegrationError('anilist_reauthorization_required', 'Your AniList authorization expired or was revoked. Reconnect AniList to continue.', { status: 409 });
  }
  const payload = await readJson(response, 'anilist_unavailable');
  if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length)) {
    const providerMessage = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => typeof item?.message === 'string' ? item.message.trim() : '').filter(Boolean).join(' | ').slice(0, 240)
      : '';
    const message = providerMessage || 'AniList could not complete the authenticated request. Try again later.';
    const isWriteFailure = query.includes('SaveMediaListEntry');
    throw new AniListIntegrationError(
      isWriteFailure ? 'recommendation_anilist_write_failed' : 'anilist_query_failed',
      isWriteFailure ? `AniList rejected the list change: ${message}` : message,
      { status: isWriteFailure ? 409 : 502 },
    );
  }
  if (!payload?.data) throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an incomplete account response. No ListR data was changed.', { status: 502 });
  return payload.data;
}


async function publicGraphql(query, variables, fetchImpl) {
  const response = await safeFetch(fetchImpl, ANILIST_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  }, 'anilist_unavailable');
  if (response.status === 429) {
    throw new AniListIntegrationError('anilist_rate_limited', 'AniList is rate-limiting requests. Wait before trying again.', {
      status: 429,
      retryAfter: response.headers?.get?.('Retry-After')
    });
  }
  const payload = await readJson(response, 'anilist_unavailable');
  if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length)) {
    throw new AniListIntegrationError('anilist_query_failed', 'AniList could not return the anime data. Try again later.', { status: 502 });
  }
  if (!payload?.data) throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned incomplete anime data.', { status: 502 });
  return payload.data;
}

const RECOMMENDATION_MEDIA_QUERY = `query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    id
    type
    isAdult
    isLocked
    title { romaji english native userPreferred }
    coverImage { extraLarge large medium }
    episodes
    duration
    status
    season
    seasonYear
    format
    description(asHtml: false)
    siteUrl
  }
}`;

export async function fetchAniListAnimeById(mediaId, fetchImpl = fetch) {
  const id = Number(mediaId);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    throw new AniListIntegrationError('anilist_invalid_media', 'The AniList anime ID is invalid.', { status: 400 });
  }
  const data = await publicGraphql(RECOMMENDATION_MEDIA_QUERY, { id }, fetchImpl);
  const media = data?.Media;
  if (!media || Number(media.id) !== id || media.type !== 'ANIME' || media.isAdult === true) {
    throw new AniListIntegrationError('anilist_invalid_media', 'That AniList entry is not a valid non-adult anime.', { status: 400 });
  }
  const title = media.title;
  if (!title || !['romaji', 'english', 'native', 'userPreferred'].some((key) => typeof title[key] === 'string' && title[key].trim())) {
    throw new AniListIntegrationError('anilist_invalid_media', 'AniList did not return usable anime metadata.', { status: 502 });
  }
  return media;
}

const SAVE_MEDIA_LIST_ENTRY_MUTATION = `mutation ($mediaId: Int!, $status: MediaListStatus!) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status) {
    id
    mediaId
    status
  }
}`;

export async function addAniListAnimeToPlanning(accessToken, mediaId, fetchImpl = fetch) {
  const id = Number(mediaId);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    throw new AniListIntegrationError('anilist_invalid_media', 'The AniList anime ID is invalid.', { status: 400 });
  }
  const data = await authenticatedGraphql(accessToken, SAVE_MEDIA_LIST_ENTRY_MUTATION, {
    mediaId: id,
    status: 'PLANNING'
  }, fetchImpl);
  const entry = data?.SaveMediaListEntry;
  if (!entry || Number(entry.mediaId) !== id || entry.status !== 'PLANNING') {
    throw new AniListIntegrationError('recommendation_anilist_write_failed', 'AniList did not confirm the anime was added to Planning.', { status: 502 });
  }
  return entry;
}

export async function getAniListViewer(accessToken, fetchImpl = fetch) {
  const data = await authenticatedGraphql(accessToken, 'query { Viewer { id name } }', {}, fetchImpl);
  const viewer = data?.Viewer;
  const id = Number(viewer?.id);
  const name = typeof viewer?.name === 'string' ? viewer.name.trim() : '';
  if (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an invalid account profile. No account was connected.', { status: 502 });
  }
  return { id, name };
}

export function normalizeAniListProgress(collection) {
  if (!collection || !Array.isArray(collection.lists)) {
    throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an incomplete anime list. No ListR data was changed.', { status: 502 });
  }
  const byMediaId = new Map();
  for (const list of collection.lists) {
    if (!list || !Array.isArray(list.entries)) {
      throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an incomplete anime list. No ListR data was changed.', { status: 502 });
    }
    for (const entry of list.entries) {
      const mediaId = Number(entry?.mediaId);
      if (!Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2147483647) {
        throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an invalid media ID. No ListR data was changed.', { status: 502 });
      }
      // A null progress value is not a count; do not turn it into zero or reset local progress.
      if (entry.progress == null) continue;
      const progress = Number(entry.progress);
      if (!Number.isSafeInteger(progress) || progress < 0 || progress > 2147483647) {
        throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an invalid episode count. No ListR data was changed.', { status: 502 });
      }
      const media = entry?.media;
      const mediaIdFromMedia = Number(media?.id);
      if (!media || mediaIdFromMedia !== mediaId) {
        throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned incomplete anime metadata. No ListR data was changed.', { status: 502 });
      }
      const episodes = media.episodes == null ? null : Number(media.episodes);
      if (episodes != null && (!Number.isSafeInteger(episodes) || episodes < 0 || episodes > 2147483647)) {
        throw new AniListIntegrationError('anilist_malformed_response', 'AniList returned an invalid episode total. No ListR data was changed.', { status: 502 });
      }
      const status = typeof media.status === 'string' ? media.status : null;
      const updatedAt = Number.isSafeInteger(Number(entry.updatedAt)) ? Number(entry.updatedAt) : 0;
      const previous = byMediaId.get(mediaId);
      if (!previous || updatedAt > previous.updatedAt || (updatedAt === previous.updatedAt && progress > previous.progress)) {
        byMediaId.set(mediaId, { mediaId, progress, updatedAt, media });
      }
    }
  }
  if (byMediaId.size > 12000) {
    throw new AniListIntegrationError('anilist_list_too_large', 'The AniList list exceeds the supported sync size. No ListR data was changed.', { status: 502 });
  }
  return [...byMediaId.values()]
    .sort((left, right) => left.mediaId - right.mediaId)
    .map(({ mediaId, progress, media }) => ({ mediaId, progress, media }));
}

const MEDIA_LIST_PROGRESS_QUERY = `query ($userId: Int!, $type: MediaType!) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      isCustomList
      entries {
      mediaId
      progress
      updatedAt
      media {
        id
        title { romaji english native userPreferred }
        coverImage { extraLarge large medium }
        episodes
        duration
        status
        season
        seasonYear
        format
        description(asHtml: false)
        siteUrl
      }
    }
    }
  }
}`;

export async function fetchAniListMediaProgress(accessToken, aniListUserId, fetchImpl = fetch) {
  const userId = Number(aniListUserId);
  if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) {
    throw new AniListIntegrationError('anilist_invalid_user', 'The stored AniList account ID is invalid. Reconnect AniList.', { status: 409 });
  }
  const data = await authenticatedGraphql(accessToken, MEDIA_LIST_PROGRESS_QUERY, { userId, type: 'ANIME' }, fetchImpl);
  return normalizeAniListProgress(data?.MediaListCollection);
}

export function addOneYear(from = new Date()) {
  const expires = new Date(from);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
}
