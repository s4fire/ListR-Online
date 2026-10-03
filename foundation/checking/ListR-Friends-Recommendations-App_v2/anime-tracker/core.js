// Pure tracker rules and storage helpers. Kept separate from the UI for easy testing.
export const CATEGORIES = Object.freeze({ watching: 'Watching', completed: 'Completed', interested: 'Interested' });

export function isKnownTotal(total) {
  return Number.isFinite(total) && total > 0;
}

export function clampWatched(value, total) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  return isKnownTotal(total) ? Math.min(safe, Math.floor(total)) : safe;
}

export function progressPercent(watched, total) {
  if (!isKnownTotal(total)) return null;
  return Math.round(clampWatched(watched, total) / Math.floor(total) * 1000) / 10;
}

export function getTitle(title, id) {
  const preferred = title?.userPreferred || title?.english || title?.romaji || title?.native;
  return typeof preferred === 'string' && preferred.trim() ? preferred.trim() : `Untitled anime · ${id}`;
}

export function createEntry(media, category, prior = null, addedAt = Date.now()) {
  const id = media?.id;
  if (id === undefined || id === null || !CATEGORIES[category]) throw new Error('A valid AniList ID and category are required.');
  const total = media.episodes;
  let watched = prior?.watched ?? 0;
  if (!prior && category === 'completed' && isKnownTotal(total)) watched = total;
  return {
    id: String(id),
    category,
    watched: clampWatched(watched, total),
    meta: media,
    addedAt: prior?.addedAt ?? addedAt,
    updatedAt: Date.now()
  };
}

export function calculateStats(entries) {
  const counts = { watching: 0, completed: 0, interested: 0 };
  const categoryEpisodes = { watching: 0, completed: 0 };
  let episodes = 0;
  let minutes = 0;
  for (const entry of entries) {
    if (!Object.hasOwn(counts, entry.category)) continue;
    counts[entry.category] += 1;
    if (entry.category === 'interested') continue;
    const watched = clampWatched(entry.watched, entry.meta?.episodes);
    episodes += watched;
    categoryEpisodes[entry.category] += watched;
    if (Number.isFinite(entry.meta?.duration) && entry.meta.duration > 0) minutes += watched * entry.meta.duration;
  }
  return { counts, episodes, minutes, hours: minutes / 60, days: minutes / 1440, categoryEpisodes };
}

export function readEntries(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map();
    for (const item of parsed) {
      if (!item || item.id == null || !CATEGORIES[item.category] || item.meta === null || typeof item.meta !== 'object') continue;
      const id = String(item.id);
      unique.set(id, {
        id,
        category: item.category,
        watched: clampWatched(item.watched, item.meta.episodes),
        meta: item.meta,
        addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0,
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0
      });
    }
    return [...unique.values()];
  } catch {
    // Storage may be unavailable or contain malformed JSON. Do not clear it automatically.
    return [];
  }
}

export function saveEntries(storage, key, entries) {
  try {
    storage.setItem(key, JSON.stringify(entries));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
