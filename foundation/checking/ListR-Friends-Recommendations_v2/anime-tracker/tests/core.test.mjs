import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStats, clampWatched, createEntry, progressPercent, readEntries, saveEntries } from '../core.js';
import { anilistRequest, searchAnime } from '../api.js';

const anime = (id, episodes = 12, duration = 24) => ({ id, episodes, duration, title: { romaji: `Anime ${id}` } });
test('watched counts clamp below zero and above a known total', () => {
  assert.equal(clampWatched(-5, 12), 0);
  assert.equal(clampWatched(99, 12), 12);
  assert.equal(clampWatched(4.9, 12), 4);
});
test('unknown totals allow non-negative watched count and do not yield percentage', () => {
  assert.equal(clampWatched(27, null), 27);
  assert.equal(progressPercent(27, null), null);
});
test('known progress percentage is calculated dynamically', () => {
  assert.equal(progressPercent(309, 1150), 26.9);
  assert.equal(progressPercent(63, 63), 100);
});
test('new Completed anime starts at its known total; other categories start at zero', () => {
  assert.equal(createEntry(anime(1), 'completed').watched, 12);
  assert.equal(createEntry(anime(2), 'watching').watched, 0);
  assert.equal(createEntry(anime(3, null), 'completed').watched, 0);
});
test('moving an existing record preserves its count and added date', () => {
  const original = createEntry(anime(5), 'watching', null, 100);
  original.watched = 8;
  const moved = createEntry(anime(5), 'completed', original, 200);
  assert.equal(moved.watched, 8);
  assert.equal(moved.addedAt, 100);
});
test('statistics count only Watching and Completed episodes', () => {
  const records = [
    { id: 'a', category: 'watching', watched: 10, meta: anime('a', 30) },
    { id: 'b', category: 'watching', watched: 20, meta: anime('b', 30) },
    { id: 'c', category: 'completed', watched: 12, meta: anime('c', 20) },
    { id: 'd', category: 'interested', watched: 99, meta: anime('d') }
  ];
  const stats = calculateStats(records);
  assert.equal(stats.episodes, 42);
  assert.deepEqual(stats.categoryEpisodes, { watching: 30, completed: 12 });
  assert.equal(stats.counts.interested, 1);
});
test('time uses provided durations and excludes missing or invalid duration', () => {
  const records = [
    { id: 'a', category: 'watching', watched: 10, meta: anime('a', 30, 24) },
    { id: 'b', category: 'completed', watched: 5, meta: anime('b', 20, null) },
    { id: 'c', category: 'completed', watched: 2, meta: anime('c', 20, 0) }
  ];
  const stats = calculateStats(records);
  assert.equal(stats.episodes, 17);
  assert.equal(stats.minutes, 240);
  assert.equal(stats.hours, 4);
  assert.equal(stats.days, 240 / 1440);
});
test('local storage round-trip persists and de-duplicates by AniList ID', () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const record = createEntry(anime(123), 'watching');
  record.watched = 3;
  assert.equal(saveEntries(storage, 'tracker', [record]).ok, true);
  const loaded = readEntries(storage, 'tracker');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, '123');
  assert.equal(loaded[0].watched, 3);
  const duplicate = { ...record, category: 'completed', watched: 11 };
  const deduplicated = readEntries({ getItem: () => JSON.stringify([record, duplicate]) }, 'tracker');
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].category, 'completed');
});
test('malformed storage is tolerated without attempting to clear it', () => {
  let removed = false;
  const storage = { getItem: () => '{broken', removeItem: () => { removed = true; } };
  assert.deepEqual(readEntries(storage, 'tracker'), []);
  assert.equal(removed, false);
});

test('AniList search sends a GraphQL query and returns matching media', async () => {
  let request;
  const media = [{ id: 42, episodes: 13 }];
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: { Page: { media } } }) };
  };
  assert.deepEqual(await searchAnime('Frieren', undefined, fetchImpl), media);
  assert.equal(request.url, 'https://graphql.anilist.co');
  const body = JSON.parse(request.options.body);
  assert.match(body.query, /type: ANIME/);
  assert.equal(body.variables.search, 'Frieren');
});

test('AniList rate limits and temporary failures return clear messages', async () => {
  await assert.rejects(
    anilistRequest('query { viewer { id } }', {}, { fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => '30' } }) }),
    /rate-limiting.*30 seconds/
  );
  await assert.rejects(
    anilistRequest('query { viewer { id } }', {}, { fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /temporarily unavailable.*saved list is safe/
  );
  await assert.rejects(
    anilistRequest('query { viewer { id } }', {}, { fetchImpl: async () => { throw new Error('offline'); } }),
    /could not be reached/
  );
});

test('AniList GraphQL errors do not become empty successful results', async () => {
  await assert.rejects(
    anilistRequest('query { viewer { id } }', {}, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Bad query' }] }) }) }),
    /Bad query/
  );
});
