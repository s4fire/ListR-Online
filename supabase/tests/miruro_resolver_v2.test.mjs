import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMiruroAniListMatchV2,
  extractMiruroCandidatesV2,
  resolveMiruroMatchV2,
} from '../functions/_shared/miruro-resolver-v2.mjs';

const watchUrl = 'https://www.miruro.tv/watch/opaque-123/the-sample-anime-season-2';
const infoUrl = 'https://www.miruro.tv/info/opaque-123/the-sample-anime-season-2';
const infoHtml = (id = 42) => `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'TVSeries',
  name: 'The Sample Anime Season 2',
  sameAs: [`https://anilist.co/anime/${id}`],
  numberOfEpisodes: 12,
  potentialAction: { '@type': 'WatchAction', target: watchUrl },
})}</script></head></html>`;
const searchHtml = `<html><body>
  <a href="/watch/opaque-123/the-sample-anime-season-2"><img alt="The Sample Anime Season 2" src="/cover.jpg">The Sample Anime Season 2</a>
  <a href="https://evil.example/watch/fake/not-miruro">The Sample Anime Season 2</a>
  <a href="/info/opaque-123/the-sample-anime-season-2">The Sample Anime Season 2 info</a>
</body></html>`;

async function catalogResponse(items) {
  const payload = JSON.stringify({ data: items, next_cursor: null, has_more: false });
  const gzip = new Uint8Array(await new Response(
    new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer());
  const key = new TextEncoder().encode('miruro/catalog');
  for (let index = 0; index < gzip.length; index += 1) gzip[index] ^= key[index % key.length];
  return new Response(gzip, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
}

function catalogItem(id, title = 'The Sample Anime Season 2') {
  return {
    id: 'opaque-123',
    title: { english: title, romaji: 'Sample Anime 2nd Season' },
    external_ids: { anilist: [String(id)] },
    episode_count: 12,
  };
}

test('candidate parsing accepts official info/watch links, deduplicates paths, and rejects other origins', () => {
  const candidates = extractMiruroCandidatesV2(searchHtml);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].watchUrl, watchUrl);
  assert.equal(candidates[0].infoUrl, infoUrl);
  assert.equal(candidates[0].names.some((name) => name.includes('The Sample Anime Season 2')), true);
});

test('info-page identity requires the exact AniList sameAs ID and a safe watch target', () => {
  assert.equal(extractMiruroAniListMatchV2(infoHtml(42), 42, watchUrl)?.watchUrl, watchUrl);
  assert.equal(extractMiruroAniListMatchV2(infoHtml(43), 42, watchUrl), null);
  assert.equal(extractMiruroAniListMatchV2(infoHtml(42).replace(watchUrl, 'https://evil.example/watch/id/title'), 42), null);
});

test('resolver queries the official catalog, filters by exact AniList ID, then confirms info-page JSON-LD', async () => {
  const requested = [];
  const fetcher = async (input) => {
    const url = new URL(input);
    requested.push(url);
    if (url.origin !== 'https://www.miruro.tv') return new Response('', { status: 404 });
    if (url.pathname === '/api/v1/anime') {
      return catalogResponse([
        catalogItem(999, 'A similar but different series'),
        catalogItem(42),
      ]);
    }
    if (url.pathname === '/info/opaque-123/the-sample-anime-season-2') {
      return new Response(infoHtml(42), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('', { status: 404 });
  };

  const match = await resolveMiruroMatchV2({ mediaId: 42, titles: ['The Sample Anime Season 2'] }, fetcher);
  assert.deepEqual(match, {
    anilistMediaId: 42,
    watchUrl,
    title: 'The Sample Anime Season 2',
    episodes: 12,
  });
  assert.equal(requested.some((url) => url.pathname === '/api/v1/anime'
    && url.searchParams.get('q') === 'The Sample Anime Season 2'
    && url.searchParams.get('limit') === '15'
    && url.searchParams.get('sort') === '-popularity'), true);
  assert.equal(requested.some((url) => url.pathname === '/info/opaque-123/the-sample-anime-season-2'), true);
  assert.equal(requested.some((url) => url.pathname === '/search'), false);
  assert.equal(requested.some((url) => url.pathname.startsWith('/watch/')), false);
  assert.equal(requested.some((url) => /player|stream|embed/i.test(url.pathname)), false);
});

test('a catalog title resemblance without the exact external AniList ID never resolves', async () => {
  const requested = [];
  const fetcher = async (input) => {
    const url = new URL(input);
    requested.push(url);
    if (url.pathname === '/api/v1/anime') return catalogResponse([catalogItem(999)]);
    if (url.pathname === '/search') return new Response(searchHtml, { status: 200 });
    if (url.pathname.startsWith('/info/')) return new Response(infoHtml(999), { status: 200 });
    return new Response('', { status: 404 });
  };
  assert.equal(await resolveMiruroMatchV2({ mediaId: 42, titles: ['The Sample Anime Season 2'] }, fetcher), null);
  assert.equal(requested.some((url) => url.pathname.startsWith('/info/')), true);
  assert.equal(requested.some((url) => url.pathname.startsWith('/watch/')), false);
});

test('catalog title fallback can resolve when Miruro omits the AniList mapping, but info JSON-LD must still match', async () => {
  const fetcher = async (input) => {
    const url = new URL(input);
    if (url.origin !== 'https://www.miruro.tv') return new Response('', { status: 404 });
    if (url.pathname === '/api/v1/anime') return catalogResponse([catalogItem(999, 'The Sample Anime Season 2')]);
    if (url.pathname === '/info/opaque-123/the-sample-anime-season-2') {
      return new Response(infoHtml(42), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('', { status: 404 });
  };

  const match = await resolveMiruroMatchV2({ mediaId: 42, titles: ['The Sample Anime Season 2'] }, fetcher);
  assert.equal(match?.anilistMediaId, 42);
  assert.equal(match?.watchUrl, watchUrl);
});

test('legacy server-rendered search links remain a fallback and are still verified against exact JSON-LD', async () => {
  const requested = [];
  const fetcher = async (input) => {
    const url = new URL(input);
    requested.push(url);
    if (url.pathname === '/api/v1/anime') return new Response('unavailable', { status: 503 });
    if (url.pathname === '/search') return new Response(searchHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/info/opaque-123/the-sample-anime-season-2') return new Response(infoHtml(42), { status: 200 });
    return new Response('', { status: 404 });
  };
  const match = await resolveMiruroMatchV2({ mediaId: 42, titles: ['The Sample Anime Season 2'] }, fetcher);
  assert.equal(match?.watchUrl, watchUrl);
  assert.equal(requested.some((url) => url.pathname === '/search'), true);
  assert.equal(requested.some((url) => url.pathname.startsWith('/watch/')), false);
});
