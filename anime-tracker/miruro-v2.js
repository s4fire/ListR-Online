export const MIRURO_RESOLVER_FUNCTION_V2 = 'miruro-resolve-v2';
export const MIRURO_CACHE_PREFIX_V2 = 'listr-miruro-watch-v2:';
export const MIRURO_CACHE_TTL_MS_V2 = 6 * 60 * 60 * 1000;
const MIRURO_CATALOG_XOR_KEY_V2 = new TextEncoder().encode('miruro/catalog');

function normalizeTitleV2(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/gu, ' ');
}

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


async function readBrowserCatalogV2(response, maxBytes = 1_200_000) {
  if (!response?.ok || !response.body?.getReader) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    try { reader.releaseLock(); } catch { /* already released/cancelled */ }
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream') {
    try {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] ^= MIRURO_CATALOG_XOR_KEY_V2[index % MIRURO_CATALOG_XOR_KEY_V2.length];
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const reader2 = stream.getReader();
      const decoder = new TextDecoder();
      const parts = [];
      while (true) {
        const { value, done } = await reader2.read();
        if (done) break;
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      return JSON.parse(parts.join(''));
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function titleFromCatalogItemV2(item, fallbackTitle) {
  const title = item?.title;
  if (title && typeof title === 'object') {
    return String(title.english || title.romaji || title.native || '').trim();
  }
  return String(title || fallbackTitle || '').trim();
}

function scoreCatalogItemV2(item, requestedTitles) {
  const names = [titleFromCatalogItemV2(item, '')].filter(Boolean);
  let best = 0;
  for (const name of names) {
    const candidate = normalizeTitleV2(name);
    if (!candidate) continue;
    for (const requested of requestedTitles) {
      const wanted = normalizeTitleV2(requested);
      if (!wanted) continue;
      if (candidate === wanted) best = Math.max(best, 100);
      else if (candidate.startsWith(wanted) || wanted.startsWith(candidate)) {
        best = Math.max(best, 83 - Math.min(18, Math.abs(candidate.length - wanted.length) / 6));
      } else {
        const left = new Set(candidate.split(' '));
        const right = new Set(wanted.split(' '));
        const common = [...left].filter((word) => right.has(word)).length;
        best = Math.max(best, Math.round(common / Math.max(left.size, right.size, 1) * 72));
      }
    }
  }
  return best;
}

async function resolveMiruroInBrowserV2(entry) {
  const media = buildMiruroPayloadV2(entry);
  const queries = media.titles.slice(0, 4);

  for (const title of queries) {
    const url = new URL('https://www.miruro.tv/api/v1/anime');
    url.searchParams.set('q', title);
    url.searchParams.set('limit', '15');
    url.searchParams.set('sort', '-popularity');

    let response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { accept: '*/*' },
      });
    } catch {
      continue;
    }

    const payload = await readBrowserCatalogV2(response);
    if (!payload || !Array.isArray(payload.data)) continue;

    const exact = payload.data.find((item) => {
      const raw = item?.external_ids?.anilist;
      const ids = Array.isArray(raw) ? raw : [raw];
      return ids.some((id) => String(id) === String(media.mediaId));
    });

    const candidate = exact || [...payload.data]
      .map((item) => ({ item, score: scoreCatalogItemV2(item, media.titles) }))
      .filter(({ item }) => /^[A-Za-z0-9_-]{1,120}$/u.test(String(item?.id || '')) && !/^\d+$/u.test(String(item?.id || '')))
      .sort((a, b) => b.score - a.score)[0]?.item;

    if (!candidate) continue;

    const opaqueId = String(candidate.id || '');
    if (!/^[A-Za-z0-9_-]{1,120}$/u.test(opaqueId) || /^\d+$/u.test(opaqueId)) continue;

    const routeTitle = titleFromCatalogItemV2(candidate, media.titles[0]);
    if (!routeTitle) continue;

    const slug = routeTitle.normalize('NFKD').toLocaleLowerCase('en')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 180);

    if (!slug) continue;
    const watchUrl = 'https://www.miruro.tv/watch/' + opaqueId + '/' + slug;
    return {
      anilistMediaId: media.mediaId,
      watchUrl,
      title: routeTitle,
      episodes: null,
    };
  }

  throw new Error('Miruro could not be queried from the browser. The site may be blocking cross-site requests.');
}

async function readFunctionsErrorV2(error) {
  const status = Number(error?.context?.status ?? error?.statusCode ?? 0) || null;
  let body = null;
  try {
    if (error?.context?.json) body = await error.context.json();
  } catch { /* error body is optional */ }
  return {
    status,
    message: typeof body?.error === 'string' ? body.error : '',
    code: typeof body?.code === 'string' ? body.code : '',
  };
}

export async function resolveMiruroEpisodeUrlV2(client, entry, { storage: _storage } = {}) {
  const episode = nextEpisodeNumberV2(entry);
  if (!episode) throw new Error('Miruro Watch is available only for anime in your Watching list.');
  const media = buildMiruroPayloadV2(entry);

  if (!client?.functions?.invoke) {
    throw new Error('The Miruro resolver is unavailable. Check the ListR Supabase configuration and try again.');
  }

  let data = null;
  let error = null;

  // Miruro's server-facing API can be blocked by Cloudflare datacenter rules.
  // Prefer a request from the user's browser, then retain the Supabase resolver as a fallback.
  try {
    const browserMatch = await resolveMiruroInBrowserV2(entry);
    if (browserMatch?.watchUrl) {
      const url = buildMiruroEpisodeUrlV2(browserMatch.watchUrl, episode);
      if (!url) throw new Error('Miruro returned an invalid Watch page. Nothing was opened.');
      return { url, watchUrl: browserMatch.watchUrl, episode, mediaId: media.mediaId };
    }
  } catch {
    // Fall through to the server resolver for environments where direct browser CORS is unavailable.
  }

  ({ data, error } = await client.functions.invoke(MIRURO_RESOLVER_FUNCTION_V2, { body: { media } }));
  if (error) {
    const details = await readFunctionsErrorV2(error);
    if (details.status === 404) {
      throw new Error('The Miruro resolver endpoint could not be found. The ListR server configuration needs to be refreshed.');
    }
    if (details.status && details.message) throw new Error('Miruro resolver error (' + details.status + '): ' + details.message);
    if (details.message) throw new Error(details.message);
    throw new Error('Could not reach the Miruro resolver. Check your connection and try again.');
  }
  if (!data?.matched || Number(data.anilistMediaId) !== media.mediaId) {
    throw new Error('No exact AniList match was found in Miruro. Nothing was opened; try again later.');
  }

  const watchUrl = String(data.watchUrl || '');
  const url = buildMiruroEpisodeUrlV2(watchUrl, episode);
  if (!url) throw new Error('Miruro returned an invalid Watch page. Nothing was opened.');
  return { url, watchUrl, episode, mediaId: media.mediaId };
}

// Browser-side Miruro discovery prefers the user's network context before the server fallback.
