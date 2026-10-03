import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMiruroEpisodeUrlV2,
  buildMiruroPayloadV2,
  nextEpisodeNumberV2,
  resolveMiruroEpisodeUrlV2,
} from '../miruro-v2.js';

function mockStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function entry({ id = '195516', category = 'watching', watched = 0, episodes = 12 } = {}) {
  return {
    id,
    category,
    watched,
    meta: {
      episodes,
      seasonYear: 2026,
      format: 'TV',
      title: { userPreferred: 'The Apothecary Diaries Season 3', english: 'The Apothecary Diaries Season 3', romaji: 'Kusuriya no Hitorigoto 3rd Season' },
    },
  };
}

test('next Miruro episode is the latest ListR watched count plus one, defaulting to one', () => {
  assert.equal(nextEpisodeNumberV2(entry({ watched: 0 })), 1);
  assert.equal(nextEpisodeNumberV2(entry({ watched: 7 })), 8);
  assert.equal(nextEpisodeNumberV2(entry({ watched: 20, episodes: 12 })), 13);
  assert.equal(nextEpisodeNumberV2(entry({ watched: Number.NaN })), 1);
  assert.equal(nextEpisodeNumberV2(entry({ category: 'completed' })), null);
  assert.equal(nextEpisodeNumberV2(entry({ category: 'interested' })), null);
});

test('resolution payload contains AniList identity and title variants only', () => {
  const media = buildMiruroPayloadV2(entry());
  assert.equal(media.mediaId, 195516);
  assert.deepEqual(media.titles, ['The Apothecary Diaries Season 3', 'Kusuriya no Hitorigoto 3rd Season']);
  assert.equal(media.seasonYear, 2026);
  assert.equal('token' in media, false);
  assert.throws(() => buildMiruroPayloadV2({ ...entry(), id: 'invalid' }), /valid AniList ID/i);
});

test('episode links use Miruro’s verified ep query and reject non-Miruro destinations', () => {
  assert.equal(
    buildMiruroEpisodeUrlV2('https://www.miruro.tv/watch/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3', 9),
    'https://www.miruro.tv/watch/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3?ep=9',
  );
  assert.equal(buildMiruroEpisodeUrlV2('https://evil.example/watch/id/title', 2), null);
  assert.equal(buildMiruroEpisodeUrlV2('http://www.miruro.tv/watch/id/title', 2), null);
  assert.equal(buildMiruroEpisodeUrlV2('https://www.miruro.tv/info/id/title', 2), null);
  assert.equal(buildMiruroEpisodeUrlV2('https://www.miruro.tv/watch/id/title', 0), null);
});

test('only Watching entries reach a fresh resolver lookup and recompute the latest episode', async () => {
  let invokes = 0;
  const client = { functions: { invoke: async (_name, { body }) => {
    invokes += 1;
    assert.equal(body.media.mediaId, 195516);
    return { data: { matched: true, anilistMediaId: 195516, watchUrl: 'https://www.miruro.tv/watch/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3' }, error: null };
  } } };
  const first = await resolveMiruroEpisodeUrlV2(client, entry({ watched: 0 }), { storage: mockStorage(), now: 1_000 });
  assert.equal(first.episode, 1);
  assert.equal(new URL(first.url).searchParams.get('ep'), '1');
  const later = await resolveMiruroEpisodeUrlV2(client, entry({ watched: 6 }), { storage: mockStorage(), now: 2_000 });
  assert.equal(later.episode, 7);
  assert.equal(new URL(later.url).searchParams.get('ep'), '7');
  assert.equal(invokes, 2);
  await assert.rejects(resolveMiruroEpisodeUrlV2(client, entry({ category: 'interested' }), { storage: mockStorage() }), /only for anime in your Watching list/i);
  assert.equal(invokes, 2);
});

test('an AniList ID mismatch or invalid server URL never opens a Miruro link', async () => {
  const client = { functions: { invoke: async () => ({ data: { matched: true, anilistMediaId: 1, watchUrl: 'https://www.miruro.tv/watch/id/title' }, error: null }) } };
  await assert.rejects(resolveMiruroEpisodeUrlV2(client, entry(), { storage: mockStorage() }), /No exact AniList match/i);
  const unsafe = { functions: { invoke: async () => ({ data: { matched: true, anilistMediaId: 195516, watchUrl: 'https://evil.example/watch/id/title' }, error: null }) } };
  await assert.rejects(resolveMiruroEpisodeUrlV2(unsafe, entry(), { storage: mockStorage() }), /invalid Watch page/i);
});


test('catalog title fallback can still resolve when the external AniList mapping is missing', async () => {
  const fetcher = async (input) => {
    const url = new URL(input);
    if (url.origin !== 'https://www.miruro.tv') return new Response('', { status: 404 });
    if (url.pathname === '/api/v1/anime') return catalogResponse([catalogItem(999)]);
    if (url.pathname === '/info/opaque-123/the-sample-anime-season-2') {
      return new Response(infoHtml(42), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('', { status: 404 });
  };
  const match = await resolveMiruroMatchV2({ mediaId: 42, titles: ['The Sample Anime Season 2'] }, fetcher);
  assert.equal(match?.anilistMediaId, 42);
  assert.equal(match?.watchUrl, watchUrl);
});
