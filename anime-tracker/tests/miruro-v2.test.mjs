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

test('only Watching entries reach the resolver; cache retains the series and recomputes the latest episode', async () => {
  const storage = mockStorage();
  let invokes = 0;
  const client = { functions: { invoke: async (_name, { body }) => {
    invokes += 1;
    assert.equal(body.media.mediaId, 195516);
    return { data: { matched: true, anilistMediaId: 195516, watchUrl: 'https://www.miruro.tv/watch/EHT-j9hg7K6M__5XDixVgMh9rKe6Nwcz/the-apothecary-diaries-season-3' }, error: null };
  } } };
  const first = await resolveMiruroEpisodeUrlV2(client, entry({ watched: 0 }), { storage, now: 1_000 });
  assert.equal(first.episode, 1);
  assert.equal(new URL(first.url).searchParams.get('ep'), '1');
  const later = await resolveMiruroEpisodeUrlV2(client, entry({ watched: 6 }), { storage, now: 2_000 });
  assert.equal(later.episode, 7);
  assert.equal(new URL(later.url).searchParams.get('ep'), '7');
  assert.equal(invokes, 1);
  await assert.rejects(resolveMiruroEpisodeUrlV2(client, entry({ category: 'interested' }), { storage }), /only for anime in your Watching list/i);
  assert.equal(invokes, 1);
});

test('an AniList ID mismatch or invalid server URL never opens a Miruro link', async () => {
  const client = { functions: { invoke: async () => ({ data: { matched: true, anilistMediaId: 1, watchUrl: 'https://www.miruro.tv/watch/id/title' }, error: null }) } };
  await assert.rejects(resolveMiruroEpisodeUrlV2(client, entry(), { storage: mockStorage() }), /No exact AniList match/i);
  const unsafe = { functions: { invoke: async () => ({ data: { matched: true, anilistMediaId: 195516, watchUrl: 'https://evil.example/watch/id/title' }, error: null }) } };
  await assert.rejects(resolveMiruroEpisodeUrlV2(unsafe, entry(), { storage: mockStorage() }), /invalid Watch page/i);
});
