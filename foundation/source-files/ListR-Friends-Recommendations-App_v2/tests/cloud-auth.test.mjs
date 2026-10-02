import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../core.js';
import { validateAuthFields } from '../auth-validation.js';
import {
  databaseRowToEntry,
  enqueueCloudOperation,
  entryToDatabaseRow,
  loadUserEntries,
  mergePendingOperations,
  readCloudCache,
  readOutbox,
  removeUserEntry,
  removeCompletedOperation,
  saveUserEntry,
  writeCloudCache
} from '../cloud-store.js';

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values
  };
}

const media = (id, episodes = 12) => ({
  id,
  episodes,
  duration: 24,
  title: { english: `Anime ${id}`, romaji: `Series ${id}`, native: `作品 ${id}` },
  coverImage: { large: `https://example.invalid/${id}.jpg` },
  seasonYear: 2025,
  season: 'SPRING',
  description: 'Cached metadata'
});

test('registration validation checks email, required username, password, and matching confirmation', () => {
  const valid = { mode: 'register', email: 'user@example.com', username: 'Anime_Fan7', password: 'secret', confirmPassword: 'secret' };
  assert.match(validateAuthFields({ ...valid, email: '', username: 'Anime_Fan7' }), /email/i);
  assert.match(validateAuthFields({ ...valid, email: 'bad-email' }), /valid email/i);
  assert.match(validateAuthFields({ ...valid, username: '' }), /username/i);
  assert.match(validateAuthFields({ ...valid, username: 'ab' }), /3–20/i);
  assert.match(validateAuthFields({ ...valid, username: '_bad_name' }), /start with/i);
  assert.match(validateAuthFields({ ...valid, password: '' }), /password/i);
  assert.match(validateAuthFields({ ...valid, confirmPassword: 'different' }), /do not match/i);
  assert.equal(validateAuthFields(valid), '');
});

test('login validation accepts a valid email and password without a confirmation field', () => {
  assert.equal(validateAuthFields({ mode: 'login', email: 'user@example.com', password: 'secret' }), '');
  assert.match(validateAuthFields({ mode: 'login', email: 'user@example.com', password: '' }), /password/i);
});

test('database row mapping uses auth user ID plus AniList ID and keeps full metadata', () => {
  const entry = createEntry(media(42), 'watching');
  entry.watched = 7;
  const row = entryToDatabaseRow(entry, 'user-a');
  assert.equal(row.user_id, 'user-a');
  assert.equal(row.anilist_media_id, 42);
  assert.equal(row.category, 'watching');
  assert.equal(row.watched_episodes, 7);
  assert.equal(row.anime_metadata.title.native, '作品 42');
  assert.ok(row.updated_at);
});

test('database rows map back to tracker entries and clamp watched counts', () => {
  const entry = databaseRowToEntry({
    user_id: 'user-a', anilist_media_id: 43, category: 'completed', watched_episodes: 99,
    anime_metadata: media(43, 12), created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z'
  });
  assert.equal(entry.id, '43');
  assert.equal(entry.category, 'completed');
  assert.equal(entry.watched, 12);
  assert.equal(entry.meta.title.english, 'Anime 43');
  assert.ok(entry.addedAt > 0);
});

test('cloud caches and outboxes are namespaced by authenticated user ID', () => {
  const storage = makeStorage();
  const a = createEntry(media(51), 'watching');
  const b = createEntry(media(52), 'completed');
  assert.equal(writeCloudCache(storage, 'user-a', [a]).ok, true);
  assert.equal(writeCloudCache(storage, 'user-b', [b]).ok, true);
  assert.deepEqual(readCloudCache(storage, 'user-a').map((item) => item.id), ['51']);
  assert.deepEqual(readCloudCache(storage, 'user-b').map((item) => item.id), ['52']);
  enqueueCloudOperation(storage, 'user-a', { type: 'upsert', mediaId: a.id, entry: a });
  enqueueCloudOperation(storage, 'user-b', { type: 'upsert', mediaId: b.id, entry: b });
  assert.deepEqual(readOutbox(storage, 'user-a').map((item) => item.mediaId), ['51']);
  assert.deepEqual(readOutbox(storage, 'user-b').map((item) => item.mediaId), ['52']);
});

test('outbox coalesces later operations by AniList ID and preserves queued deletes', () => {
  const storage = makeStorage();
  const entry = createEntry(media(61), 'watching');
  enqueueCloudOperation(storage, 'user-a', { type: 'upsert', mediaId: entry.id, entry });
  entry.watched = 4;
  enqueueCloudOperation(storage, 'user-a', { type: 'upsert', mediaId: entry.id, entry });
  const afterUpdate = readOutbox(storage, 'user-a');
  assert.equal(afterUpdate.length, 1);
  assert.equal(afterUpdate[0].entry.watched, 4);
  const removed = enqueueCloudOperation(storage, 'user-a', { type: 'delete', mediaId: entry.id });
  assert.equal(removed.operations.length, 1);
  assert.equal(removed.operations[0].type, 'delete');
  const completed = removeCompletedOperation(storage, 'user-a', removed.operations[0].operationId);
  assert.equal(completed.ok, true);
  assert.deepEqual(readOutbox(storage, 'user-a'), []);
});

test('pending migration preserves cloud duplicates and ignores another user outbox', () => {
  const cloudEntry = createEntry(media(71), 'completed');
  cloudEntry.watched = 12;
  const guestDuplicate = createEntry(media(71), 'watching');
  guestDuplicate.watched = 2;
  const guestNew = createEntry(media(72), 'interested');
  const merged = mergePendingOperations([cloudEntry], [
    { userId: 'user-a', mediaId: '71', type: 'upsert', entry: guestDuplicate, ignoreDuplicates: true },
    { userId: 'user-a', mediaId: '72', type: 'upsert', entry: guestNew, ignoreDuplicates: true },
    { userId: 'user-b', mediaId: '73', type: 'upsert', entry: createEntry(media(73), 'watching') }
  ], 'user-a');
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === '71').category, 'completed');
  assert.equal(merged.find((item) => item.id === '72').category, 'interested');
});

test('cloud fetch requests only the authenticated owner and filters unexpected cross-owner rows', async () => {
  let filteredOwner;
  const query = {
    select() { return this; },
    eq(column, value) { assert.equal(column, 'user_id'); filteredOwner = value; return this; },
    order(column, options) {
      assert.equal(column, 'created_at');
      assert.equal(options.ascending, false);
      return Promise.resolve({ data: [
        { user_id: 'user-a', anilist_media_id: 81, category: 'watching', watched_episodes: 3, anime_metadata: media(81) },
        { user_id: 'user-b', anilist_media_id: 82, category: 'watching', watched_episodes: 8, anime_metadata: media(82) }
      ], error: null });
    }
  };
  const client = { from(table) { assert.equal(table, 'anime_records'); return query; } };
  const entries = await loadUserEntries(client, 'user-a');
  assert.equal(filteredOwner, 'user-a');
  assert.deepEqual(entries.map((item) => item.id), ['81']);
});

test('cloud upsert includes owner ID and uses the compound conflict key', async () => {
  const entry = createEntry(media(91), 'completed');
  let sentRow;
  let sentOptions;
  const client = { from(table) {
    assert.equal(table, 'anime_records');
    return { async upsert(row, options) { sentRow = row; sentOptions = options; return { error: null }; } };
  } };
  await saveUserEntry(client, 'user-a', entry, { ignoreDuplicates: true });
  assert.equal(sentRow.user_id, 'user-a');
  assert.equal(sentRow.anilist_media_id, 91);
  assert.deepEqual(sentOptions, { onConflict: 'user_id,anilist_media_id', ignoreDuplicates: true });
});

test('cloud delete filters by authenticated user ID and AniList media ID', async () => {
  const filters = [];
  const builder = {
    delete() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); }
  };
  const client = { from(table) { assert.equal(table, 'anime_records'); return builder; } };
  await removeUserEntry(client, 'user-a', 92);
  assert.deepEqual(filters, [['user_id', 'user-a'], ['anilist_media_id', 92]]);
});
