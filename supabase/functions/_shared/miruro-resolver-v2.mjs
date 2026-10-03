export const MIRURO_ORIGIN_V2 = 'https://www.miruro.tv';
export const MIRURO_CATALOG_PATH_V2 = '/api/v1/anime';
export const MIRURO_RESOLVER_LIMITS_V2 = Object.freeze({
  searchQueries: 4,
  catalogLimit: 15,
  candidates: 10,
  timeoutMs: 7000,
  maxHtmlBytes: 1_200_000,
});

const CATALOG_XOR_KEY_V2 = new TextEncoder().encode('miruro/catalog');

function decodeHtmlV2(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&#(\d+);/gu, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/giu, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&amp;/giu, '&').replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<').replace(/&gt;/giu, '>').replace(/&nbsp;/giu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

function normalizeTitleV2(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/gu, ' ');
}

function slugifyTitleV2(value) {
  return String(value || '').normalize('NFKD').toLocaleLowerCase('en')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180);
}

function safeMiruroPageUrlV2(value, route) {
  try {
    const url = new URL(String(value), MIRURO_ORIGIN_V2);
    const routePattern = route === 'info'
      ? /^\/info\/[A-Za-z0-9_-]+\/[A-Za-z0-9._~-]+\/?$/u
      : /^\/watch\/[A-Za-z0-9_-]+\/[A-Za-z0-9._~-]+\/?$/u;
    if (url.protocol !== 'https:' || url.origin !== MIRURO_ORIGIN_V2 || url.port || !routePattern.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function safeWatchUrlV2(value) {
  return safeMiruroPageUrlV2(value, 'watch');
}

function safeInfoUrlV2(value) {
  return safeMiruroPageUrlV2(value, 'info');
}

function infoUrlFromWatchV2(value) {
  const watch = safeWatchUrlV2(value);
  if (!watch) return null;
  const info = new URL(watch);
  info.pathname = info.pathname.replace(/^\/watch\//u, '/info/');
  return info.toString();
}

function watchUrlFromInfoV2(value) {
  const info = safeInfoUrlV2(value);
  if (!info) return null;
  const watch = new URL(info);
  watch.pathname = watch.pathname.replace(/^\/info\//u, '/watch/');
  return watch.toString();
}

function readAttributeV2(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu'));
  return match ? match[2] : '';
}

function titleFromSlugV2(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1) || '';
    return decodeURIComponent(slug).replace(/[-_]+/gu, ' ');
  } catch {
    return '';
  }
}

function visitJsonLdV2(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) visitJsonLdV2(item, visitor);
    return;
  }
  for (const child of Object.values(value)) visitJsonLdV2(child, visitor);
}

function readJsonLdBlocksV2(html) {
  const values = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    if (!/\btype\s*=\s*(["'])application\/ld\+json\1/iu.test(match[1])) continue;
    try { values.push(JSON.parse(match[2].trim())); } catch { /* ignore malformed unrelated blocks */ }
  }
  return values;
}

function collectUrlsV2(value, urls = []) {
  if (typeof value === 'string') {
    if (/^https?:\/\//iu.test(value)) urls.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrlsV2(item, urls);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['url', 'urlTemplate', 'target', 'mainEntityOfPage'].includes(key)) collectUrlsV2(child, urls);
    }
  }
  return urls;
}

export function extractMiruroCandidatesV2(html) {
  const source = String(html || '');
  const candidates = new Map();
  const addCandidate = (rawUrl, names = []) => {
    const infoUrl = safeInfoUrlV2(rawUrl) || infoUrlFromWatchV2(rawUrl);
    const watchUrl = safeWatchUrlV2(rawUrl) || watchUrlFromInfoV2(rawUrl);
    if (!infoUrl || !watchUrl) return;
    const cleanedNames = names.map((name) => decodeHtmlV2(name)).filter((name) => name && name.length <= 240);
    const previous = candidates.get(infoUrl) || { infoUrl, watchUrl, names: [] };
    previous.names = [...new Set([...previous.names, ...cleanedNames])];
    if (!previous.names.length) previous.names.push(titleFromSlugV2(infoUrl));
    candidates.set(infoUrl, previous);
  };

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu;
  let match;
  while ((match = anchorPattern.exec(source))) {
    const href = readAttributeV2(match[1], 'href');
    const body = match[2];
    const anchorText = decodeHtmlV2(body).replace(/^play\s+/iu, '').replace(/\b(?:watch\s+)?now\b/giu, '').trim();
    const imageNames = [...body.matchAll(/<img\b([^>]*)>/giu)]
      .map((image) => decodeHtmlV2(readAttributeV2(image[1], 'alt')))
      .filter(Boolean);
    addCandidate(href, [anchorText, ...imageNames]);
    if (candidates.size >= 100) break;
  }

  for (const block of readJsonLdBlocksV2(source)) {
    visitJsonLdV2(block, (node) => {
      const names = [node.name, ...(Array.isArray(node.alternateName) ? node.alternateName : [node.alternateName])]
        .filter((name) => typeof name === 'string');
      const urls = collectUrlsV2([node.url, node.item, node.mainEntityOfPage]);
      for (const url of urls) addCandidate(url, names);
    });
  }
  return [...candidates.values()];
}

export function extractMiruroAniListMatchV2(html, expectedMediaId, candidateWatchUrl = '') {
  const expectedId = Number(expectedMediaId);
  if (!Number.isSafeInteger(expectedId) || expectedId < 1) return null;
  let exactEntity = null;
  for (const block of readJsonLdBlocksV2(html)) {
    visitJsonLdV2(block, (node) => {
      const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
      const hasExactId = sameAs.some((value) => {
        const match = String(value || '').match(/(?:https?:)?\/\/(?:www\.)?anilist\.co\/anime\/(\d+)(?:[/?#]|$)/iu);
        return match && Number(match[1]) === expectedId;
      });
      if (!hasExactId) return;
      exactEntity = node;
    });
  }
  if (!exactEntity) return null;

  const candidates = collectUrlsV2([
    exactEntity.url,
    exactEntity.mainEntityOfPage,
    exactEntity.potentialAction,
  ]);
  let canonical = null;
  for (const value of candidates) {
    const checked = safeWatchUrlV2(value);
    if (checked) { canonical = checked; break; }
  }
  canonical ||= safeWatchUrlV2(candidateWatchUrl);
  if (!canonical) return null;
  const count = Number(exactEntity.numberOfEpisodes);
  return {
    anilistMediaId: expectedId,
    watchUrl: canonical,
    title: String(exactEntity.name || ''),
    episodes: Number.isSafeInteger(count) && count > 0 ? count : null,
  };
}

function titleScoreV2(candidateNames, requestedTitles) {
  let best = 0;
  for (const name of candidateNames) {
    const candidate = normalizeTitleV2(name);
    if (!candidate) continue;
    for (const title of requestedTitles) {
      const requested = normalizeTitleV2(title);
      if (!requested) continue;
      if (candidate === requested) best = Math.max(best, 100);
      else if (candidate.startsWith(requested) || requested.startsWith(candidate)) {
        best = Math.max(best, 83 - Math.min(18, Math.abs(candidate.length - requested.length) / 6));
      } else {
        const left = new Set(candidate.split(' '));
        const right = new Set(requested.split(' '));
        const common = [...left].filter((word) => right.has(word)).length;
        const denominator = Math.max(left.size, right.size, 1);
        best = Math.max(best, Math.round(common / denominator * 72));
      }
    }
  }
  return best;
}

function validateRequestMediaV2(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A media object is required.');
  const mediaId = Number(value.mediaId);
  if (!Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2147483647) throw new TypeError('A valid AniList media ID is required.');
  const titles = Array.isArray(value.titles)
    ? [...new Set(value.titles.map((title) => String(title || '').trim()).filter((title) => title.length >= 2 && title.length <= 140))].slice(0, 6)
    : [];
  if (!titles.length) throw new TypeError('At least one anime title is required.');
  return { mediaId, titles };
}

async function readBoundedBytesV2(fetcher, url, timeoutMs, maxBytes, accept = 'text/html,application/xhtml+xml') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept,
        'user-agent': 'Mozilla/5.0 (compatible; ListR/2.0; +https://github.com/s4fire/ListR-Online)',
      },
    });
    if (!response?.ok || !response.body?.getReader) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
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
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, contentType: response.headers?.get?.('content-type') || '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function decodeGzipJsonV2(bytes, maxBytes) {
  try {
    const decoded = bytes.slice();
    for (let index = 0; index < decoded.length; index += 1) decoded[index] ^= CATALOG_XOR_KEY_V2[index % CATALOG_XOR_KEY_V2.length];
    const stream = new Blob([decoded]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(''));
  } catch {
    return null;
  }
}

async function fetchCatalogPageV2(fetcher, title) {
  const url = new URL(MIRURO_CATALOG_PATH_V2, MIRURO_ORIGIN_V2);
  url.searchParams.set('q', title);
  url.searchParams.set('limit', String(MIRURO_RESOLVER_LIMITS_V2.catalogLimit));
  url.searchParams.set('sort', '-popularity');
  const response = await readBoundedBytesV2(
    fetcher,
    url.toString(),
    MIRURO_RESOLVER_LIMITS_V2.timeoutMs,
    MIRURO_RESOLVER_LIMITS_V2.maxHtmlBytes,
    '*/*',
  );
  if (!response) return null;
  let payload;
  if (response.contentType.split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream') {
    payload = await decodeGzipJsonV2(response.bytes, MIRURO_RESOLVER_LIMITS_V2.maxHtmlBytes);
  } else {
    try { payload = JSON.parse(new TextDecoder().decode(response.bytes)); } catch { return null; }
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) return null;
  return payload;
}

async function fetchHtmlV2(fetcher, url, timeoutMs) {
  const response = await readBoundedBytesV2(fetcher, url, timeoutMs, MIRURO_RESOLVER_LIMITS_V2.maxHtmlBytes);
  return response ? new TextDecoder().decode(response.bytes) : '';
}

function buildCatalogCandidateV2(item) {
  if (!item || typeof item !== 'object') return null;
  const opaqueId = String(item.id || '');
  if (!/^[A-Za-z0-9_-]{1,120}$/u.test(opaqueId)) return null;
  const itemTitle = item.title && typeof item.title === 'object'
    ? String(item.title.english || item.title.romaji || item.title.native || '')
    : '';
  if (!itemTitle) return null;
  const slug = slugifyTitleV2(itemTitle) || `anime-${opaqueId.toLocaleLowerCase('en')}`;
  const infoUrl = safeInfoUrlV2(`/info/${opaqueId}/${slug}`);
  const watchUrl = safeWatchUrlV2(`/watch/${opaqueId}/${slug}`);
  if (!infoUrl || !watchUrl) return null;
  return {
    infoUrl,
    watchUrl,
    names: [itemTitle],
  };
}

function exactCatalogCandidatesV2(payload, mediaId) {
  const expected = String(mediaId);
  const candidates = new Map();
  for (const item of payload?.data || []) {
    const anilistIds = Array.isArray(item?.external_ids?.anilist) ? item.external_ids.anilist : [];
    if (!anilistIds.some((id) => String(id) === expected)) continue;
    const candidate = buildCatalogCandidateV2(item);
    if (candidate) candidates.set(candidate.infoUrl, candidate);
  }
  return [...candidates.values()];
}

function titleCatalogCandidatesV2(payload, titles) {
  const candidates = new Map();
  for (const item of payload?.data || []) {
    const candidate = buildCatalogCandidateV2(item);
    if (!candidate) continue;
    const score = titleScoreV2(candidate.names, titles);
    if (score < 70) continue;
    const current = candidates.get(candidate.infoUrl);
    if (!current || score > current.score) {
      candidates.set(candidate.infoUrl, { ...candidate, score });
    }
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.infoUrl.localeCompare(b.infoUrl))
    .slice(0, MIRURO_RESOLVER_LIMITS_V2.candidates)
    .map(({ score, ...candidate }) => candidate);
}

async function searchHtmlCandidatesV2(fetcher, titles) {
  const pages = await Promise.all(titles.map(async (title) => {
    const url = new URL('/search', MIRURO_ORIGIN_V2);
    url.searchParams.set('query', title);
    const html = await fetchHtmlV2(fetcher, url.toString(), MIRURO_RESOLVER_LIMITS_V2.timeoutMs);
    return extractMiruroCandidatesV2(html);
  }));
  const unique = new Map();
  for (const items of pages) {
    for (const item of items) {
      const current = unique.get(item.infoUrl) || { ...item, score: 0 };
      current.names = [...new Set([...current.names, ...item.names])];
      current.score = Math.max(current.score, titleScoreV2(current.names, titles));
      unique.set(item.infoUrl, current);
    }
  }
  return [...unique.values()]
    .sort((a, b) => b.score - a.score || a.infoUrl.localeCompare(b.infoUrl))
    .slice(0, MIRURO_RESOLVER_LIMITS_V2.candidates);
}

export async function resolveMiruroMatchV2(rawMedia, fetcher = fetch) {
  const media = validateRequestMediaV2(rawMedia);
  const queries = media.titles.slice(0, MIRURO_RESOLVER_LIMITS_V2.searchQueries);
  const catalogPages = await Promise.all(queries.map((title) => fetchCatalogPageV2(fetcher, title)));
  const catalogCandidates = new Map();
  const titleCandidates = new Map();
  for (const payload of catalogPages) {
    for (const candidate of exactCatalogCandidatesV2(payload, media.mediaId)) {
      catalogCandidates.set(candidate.infoUrl, candidate);
    }
    for (const candidate of titleCatalogCandidatesV2(payload, media.titles)) {
      titleCandidates.set(candidate.infoUrl, candidate);
    }
  }

  // Prefer exact AniList catalog mappings. If Miruro omitted that mapping, use a strongly
  // title-matched catalog candidate, then independently verify the exact AniList ID on the info page.
  let candidates = [...catalogCandidates.values()].slice(0, MIRURO_RESOLVER_LIMITS_V2.candidates);
  if (!candidates.length) candidates = [...titleCandidates.values()].slice(0, MIRURO_RESOLVER_LIMITS_V2.candidates);

  // Older Miruro page variants may have server-rendered result links; these remain a fallback only.
  if (!candidates.length) candidates = await searchHtmlCandidatesV2(fetcher, queries);
  if (!candidates.length) return null;

  const matches = await Promise.all(candidates.map(async (candidate) => {
    const html = await fetchHtmlV2(fetcher, candidate.infoUrl, MIRURO_RESOLVER_LIMITS_V2.timeoutMs);
    return extractMiruroAniListMatchV2(html, media.mediaId, candidate.watchUrl);
  }));
  return matches.find((match) => match?.anilistMediaId === media.mediaId) || null;
}
