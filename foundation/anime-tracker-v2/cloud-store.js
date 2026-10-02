import { CATEGORIES, clampWatched, readEntries, saveEntries } from './core.js';

export const ANIME_TABLE = 'anime_records';
const OUTBOX_PREFIX = 'afterglow-cloud-outbox-v1:';
const CACHE_PREFIX = 'afterglow-cloud-cache-v1:';
const ROW_FIELDS = 'user_id,anilist_media_id,category,watched_episodes,anime_metadata,created_at,updated_at';

function storageKey(prefix, userId) {
  return `${prefix}${encodeURIComponent(String(userId))}`;
}

function safeParse(storage, key, fallback) {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function idAsNumber(id) {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('AniList media ID must be a positive integer.');
  return value;
}

export function entryToDatabaseRow(entry, userId) {
  if (!entry || userId == null || !CATEGORIES[entry.category]) throw new Error('A signed-in owner and valid anime entry are required.');
  const metadata = entry.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta) ? entry.meta : {};
  return {
    user_id: String(userId),
    anilist_media_id: idAsNumber(entry.id),
    category: entry.category,
    watched_episodes: clampWatched(entry.watched, metadata.episodes),
    anime_metadata: metadata,
    updated_at: new Date().toISOString()
  };
}

export function databaseRowToEntry(row) {
  if (!row || row.user_id == null || row.anilist_media_id == null || !CATEGORIES[row.category]) return null;
  const id = idAsNumber(row.anilist_media_id);
  const meta = row.anime_metadata && typeof row.anime_metadata === 'object' && !Array.isArray(row.anime_metadata) ? row.anime_metadata : {};
  return {
    id: String(id),
    category: row.category,
    watched: clampWatched(row.watched_episodes, meta.episodes),
    meta,
    addedAt: Number.isFinite(Date.parse(row.created_at || '')) ? Date.parse(row.created_at) : 0,
    updatedAt: Number.isFinite(Date.parse(row.updated_at || '')) ? Date.parse(row.updated_at) : 0
  };
}

export async function loadUserEntries(client, userId) {
  const { data, error } = await client
    .from(ANIME_TABLE)
    .select(ROW_FIELDS)
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false });
  if (error) throw error;
  const unique = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    // RLS is the security boundary; this client-side check is only defense in depth.
    if (String(row.user_id) !== String(userId)) continue;
    const entry = databaseRowToEntry(row);
    if (entry) unique.set(entry.id, entry);
  }
  return [...unique.values()];
}

export async function saveUserEntry(client, userId, entry, { ignoreDuplicates = false } = {}) {
  const { error } = await client
    .from(ANIME_TABLE)
    .upsert(entryToDatabaseRow(entry, userId), {
      onConflict: 'user_id,anilist_media_id',
      ignoreDuplicates
    });
  if (error) throw error;
}

export async function removeUserEntry(client, userId, mediaId) {
  const { error } = await client
    .from(ANIME_TABLE)
    .delete()
    .eq('user_id', String(userId))
    .eq('anilist_media_id', idAsNumber(mediaId));
  if (error) throw error;
}

export function readOutbox(storage, userId) {
  if (!storage || userId == null) return [];
  const value = safeParse(storage, storageKey(OUTBOX_PREFIX, userId), []);
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && String(item.userId) === String(userId)
    && ['upsert', 'delete'].includes(item.type)
    && Number.isSafeInteger(Number(item.mediaId))
    && typeof item.operationId === 'string'
    && (item.type === 'delete' || (item.entry && String(item.entry.id) === String(item.mediaId))));
}

function writeOutbox(storage, userId, operations) {
  try {
    storage?.setItem(storageKey(OUTBOX_PREFIX, userId), JSON.stringify(operations));
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function enqueueCloudOperation(storage, userId, operation) {
  if (!storage || userId == null || !operation || !['upsert', 'delete'].includes(operation.type)) return { ok: false, operations: [] };
  const mediaId = String(operation.mediaId ?? operation.entry?.id ?? '');
  try { idAsNumber(mediaId); } catch { return { ok: false, operations: [] }; }
  const existing = readOutbox(storage, userId).filter((item) => String(item.mediaId) !== mediaId);
  const operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const next = [...existing, {
    operationId,
    userId: String(userId),
    mediaId,
    type: operation.type,
    entry: operation.type === 'upsert' ? operation.entry : undefined,
    ignoreDuplicates: Boolean(operation.ignoreDuplicates)
  }];
  const ok = writeOutbox(storage, userId, next);
  return { ok, operations: ok ? next : existing };
}

export function removeCompletedOperation(storage, userId, operationId) {
  const next = readOutbox(storage, userId).filter((item) => item.operationId !== operationId);
  return { ok: writeOutbox(storage, userId, next), operations: next };
}

export function readCloudCache(storage, userId) {
  if (!storage || userId == null) return [];
  return readEntries(storage, storageKey(CACHE_PREFIX, userId));
}

export function writeCloudCache(storage, userId, entries) {
  if (!storage || userId == null) return { ok: false };
  return saveEntries(storage, storageKey(CACHE_PREFIX, userId), entries);
}

export function mergePendingOperations(serverEntries, operations, userId) {
  const merged = new Map(serverEntries.map((entry) => [String(entry.id), entry]));
  for (const operation of operations) {
    if (String(operation.userId) !== String(userId)) continue;
    const id = String(operation.mediaId);
    if (operation.type === 'delete') merged.delete(id);
    else if (operation.type === 'upsert' && operation.entry
      && (!operation.ignoreDuplicates || !merged.has(id))) merged.set(id, operation.entry);
  }
  return [...merged.values()];
}
