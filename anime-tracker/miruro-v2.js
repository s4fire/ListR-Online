export const MIRURO_RESOLVER_FUNCTION_V2 = 'miruro-resolve-v2';
export const MIRURO_CACHE_PREFIX_V2 = 'listr-miruro-watch-v2:';
export const MIRURO_CACHE_TTL_MS_V2 = 6 * 60 * 60 * 1000;

function safeMediaId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return null;
  return id;
}

export function nextEpisodeNumberV2(entry) {
  if (!entry || entry.category !== 'watching') return null;
  const total = Number(entry.meta?.episodes);
  let watched = Number(entry.watched);
  if (!Number.isFinite(watched)) watched = 0;
  watched = Math.max(0, Math.floor(watched));
  if (Number.isFinite(total) && total > 0) watched = Math.min(watched, Math.floor(total));
  return watched + 1;
}

export function buildMiruroPayloadV2(entry) {
  const mediaId = safeMediaId(entry?.id);
  if (!mediaId) throw new Error('This anime has no valid AniList ID, so it cannot be matched safely in Miruro.');
  const title = entry?.meta?.title || {};
  const titles = [...new Set([
    title.userPreferred,
    title.english,
    title.romaji,
    title.native,
    ...(Array.isArray(entry?.meta?.synonyms) ? entry.meta.synonyms : []),
  ].map((value) => String(value || '').trim()).filter((value) => value && value.length <= 140))].slice(0, 6);
  if (!titles.length) throw new Error('This anime has no title metadata to resolve in Miruro. Refresh its AniList details and try again.');
  return {
    mediaId,
    titles,
    seasonYear: Number.isInteger(Number(entry?.meta?.seasonYear)) ? Number(entry.meta.seasonYear) : null,
    format: String(entry?.meta?.format || '').slice(0, 32),
    episodes: Number.isInteger(Number(entry?.meta?.episodes)) ? Number(entry.meta.episodes) : null,
  };
}

export function buildMiruroEpisodeUrlV2(watchUrl, episode) {
  const episodeNumber = Number(episode);
  if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1) return null;
  let url;
  try { url = new URL(String(watchUrl)); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'www.miruro.tv' || url.port
    || !/^\/watch\/[A-Za-z0-9_-]+\/[A-Za-z0-9._~-]+\/?$/u.test(url.pathname)) return null;
  url.search = '';
  url.hash = '';
  url.searchParams.set('ep', String(episodeNumber));
  return url.toString();
}

function cacheKey(mediaId) { return `${MIRURO_CACHE_PREFIX_V2}${mediaId}`; }

function readCachedWatchUrl(storage, mediaId, now) {
  try {
    const raw = storage?.getItem(cacheKey(mediaId));
    const cached = raw ? JSON.parse(raw) : null;
    if (!cached || Number(cached.mediaId) !== mediaId || !Number.isFinite(cached.expiresAt) || cached.expiresAt <= now) return null;
    return buildMiruroEpisodeUrlV2(cached.watchUrl, 1) ? String(cached.watchUrl) : null;
  } catch {
    return null;
  }
}

function writeCachedWatchUrl(storage, mediaId, watchUrl, now) {
  try {
    storage?.setItem(cacheKey(mediaId), JSON.stringify({
      mediaId,
      watchUrl,
      expiresAt: now + MIRURO_CACHE_TTL_MS_V2,
    }));
  } catch { /* the resolver still works if browser storage is full or disabled */ }
}

export async function resolveMiruroEpisodeUrlV2(client, entry, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const episode = nextEpisodeNumberV2(entry);
  if (!episode) throw new Error('Miruro Watch is available only for anime in your Watching list.');
  const media = buildMiruroPayloadV2(entry);
  let watchUrl = readCachedWatchUrl(storage, media.mediaId, now);

  if (!watchUrl) {
    if (!client?.functions?.invoke) throw new Error('The Miruro resolver is unavailable. Check the ListR Supabase configuration and try again.');
    const { data, error } = await client.functions.invoke(MIRURO_RESOLVER_FUNCTION_V2, { body: { media } });
    if (error) throw new Error('Could not resolve this AniList anime in Miruro. Check your connection and try again.');
    if (!data?.matched || Number(data.anilistMediaId) !== media.mediaId) {
      throw new Error('No exact AniList match was found on Miruro. Nothing was opened; try refreshing this anime’s metadata later.');
    }
    watchUrl = String(data.watchUrl || '');
    if (!buildMiruroEpisodeUrlV2(watchUrl, episode)) throw new Error('Miruro returned an invalid Watch page. Nothing was opened.');
    writeCachedWatchUrl(storage, media.mediaId, watchUrl, now);
  }

  const url = buildMiruroEpisodeUrlV2(watchUrl, episode);
  if (!url) throw new Error('The saved Miruro Watch page is no longer valid. Try again to resolve it.');
  return { url, watchUrl, episode, mediaId: media.mediaId };
}
