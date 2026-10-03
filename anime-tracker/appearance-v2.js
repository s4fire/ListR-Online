export const APPEARANCE_TABLE_V2 = 'list_r_appearance_preferences_v2';
export const APPEARANCE_STORAGE_PREFIX_V2 = 'listr-appearance-v2:';
export const DEFAULT_APPEARANCE_V2 = Object.freeze({ theme: 'sub-zero', layout: 'current' });

export const APPEARANCE_THEMES_V2 = Object.freeze([
  Object.freeze({ id: 'sub-zero', label: 'Sub-Zero', description: 'The current midnight-blue ListR look.' }),
  Object.freeze({ id: 'onyx', label: 'Onyx', description: 'Quiet charcoal with cool silver accents.' }),
  Object.freeze({ id: 'cosmic', label: 'Cosmic', description: 'Indigo surfaces with violet and rose light.' }),
  Object.freeze({ id: 'emerald', label: 'Emerald', description: 'Deep green with mint highlights.' }),
  Object.freeze({ id: 'ghost', label: 'Ghost', description: 'A calm, readable light palette.' }),
]);

export const APPEARANCE_LAYOUTS_V2 = Object.freeze([
  Object.freeze({ id: 'current', label: 'Current', description: 'The existing side rail and poster cards.' }),
  Object.freeze({ id: 'reworked-old', label: 'Reworked Old', description: 'A classic top navigation with a poster grid.' }),
  Object.freeze({ id: 'new', label: 'New', description: 'A compact workspace with horizontal library cards.' }),
]);

const THEME_IDS = new Set(APPEARANCE_THEMES_V2.map(({ id }) => id));
const LAYOUT_IDS = new Set(APPEARANCE_LAYOUTS_V2.map(({ id }) => id));

export function normalizeAppearanceV2(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    theme: THEME_IDS.has(source.theme) ? source.theme : DEFAULT_APPEARANCE_V2.theme,
    layout: LAYOUT_IDS.has(source.layout) ? source.layout : DEFAULT_APPEARANCE_V2.layout,
  };
}

export function appearanceStorageKeyV2(userId) {
  const scope = userId == null || String(userId).trim() === ''
    ? 'guest'
    : `user:${encodeURIComponent(String(userId))}`;
  return `${APPEARANCE_STORAGE_PREFIX_V2}${scope}`;
}

export function readAppearanceLocalV2(storage, userId) {
  if (!storage?.getItem) return null;
  try {
    const raw = storage.getItem(appearanceStorageKeyV2(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return normalizeAppearanceV2(parsed);
  } catch {
    return null;
  }
}

export function writeAppearanceLocalV2(storage, userId, value) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(appearanceStorageKeyV2(userId), JSON.stringify(normalizeAppearanceV2(value)));
    return true;
  } catch {
    return false;
  }
}

export function applyAppearanceV2(value, root = globalThis.document?.documentElement) {
  const appearance = normalizeAppearanceV2(value);
  if (!root?.dataset) return appearance;
  root.dataset.theme = appearance.theme;
  root.dataset.layout = appearance.layout;
  return appearance;
}

function appearanceCloudError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (['42P01', 'PGRST205', 'PGRST204'].includes(code) || /does not exist|schema cache|could not find the table/i.test(message)) {
    return 'Cloud appearance settings are not installed yet. Apply the v2 appearance migration; this device still remembers your choice.';
  }
  return 'Cloud appearance could not be saved. This device still remembers your choice.';
}

export function createAppearanceControllerV2({ storage = globalThis.localStorage, root = globalThis.document?.documentElement, onStatus = () => {} } = {}) {
  let client = null;
  let userId = null;
  let generation = 0;
  let preferenceRevision = 0;
  let preferences = { ...DEFAULT_APPEARANCE_V2 };
  let dirtyFields = new Set();
  let loadTask = null;
  let saveQueue = Promise.resolve();

  const current = () => ({ ...preferences });
  const apply = () => applyAppearanceV2(preferences, root);
  const report = (message, state = '') => {
    try { onStatus({ message, state }); } catch { /* status UI is optional */ }
  };

  function saveCloudSnapshot() {
    const uid = userId;
    const ownerClient = client;
    const token = generation;
    if (!uid || !ownerClient?.from) return Promise.resolve(false);

    const task = saveQueue.catch(() => {}).then(async () => {
      const loading = loadTask;
      if (loading?.generation === token) await loading.promise;
      if (generation !== token || userId !== uid || client !== ownerClient) return false;

      const snapshot = current();
      const snapshotRevision = preferenceRevision;
      const { error } = await ownerClient.from(APPEARANCE_TABLE_V2).upsert({
        user_id: uid,
        theme: snapshot.theme,
        layout: snapshot.layout,
      });
      if (error) throw error;
      if (generation === token && userId === uid) {
        if (preferenceRevision === snapshotRevision) dirtyFields.clear();
        report('Appearance saved to your ListR account.', 'saved');
      }
      return true;
    }).catch((error) => {
      if (generation === token && userId === uid) report(appearanceCloudError(error), 'error');
      return false;
    });
    saveQueue = task;
    return task;
  }

  async function activateAccount(nextClient, nextUserId) {
    const nextId = nextUserId == null || String(nextUserId).trim() === '' ? null : String(nextUserId);
    if (nextId === userId && nextClient === client) {
      if (loadTask?.generation === generation) return loadTask.promise;
      return current();
    }

    generation += 1;
    const token = generation;
    client = nextClient || null;
    userId = nextId;
    dirtyFields = new Set();
    preferenceRevision = 0;

    const local = readAppearanceLocalV2(storage, userId);
    preferences = normalizeAppearanceV2(local || DEFAULT_APPEARANCE_V2);
    apply();

    if (!userId) {
      loadTask = null;
      report('Guest appearance is saved only in this browser.', 'saved');
      return current();
    }
    if (!client?.from) {
      loadTask = null;
      report('Cloud appearance is unavailable. Your choice is saved on this device.', 'error');
      return current();
    }

    report('Loading your saved appearance…', 'pending');
    const task = (async () => {
      try {
        const { data, error } = await client.from(APPEARANCE_TABLE_V2)
          .select('theme,layout')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        if (generation !== token || userId !== nextId) return current();

        const cloud = data ? normalizeAppearanceV2(data) : null;
        const edited = Object.fromEntries([...dirtyFields].map((field) => [field, preferences[field]]));
        preferences = normalizeAppearanceV2({ ...(cloud || local || DEFAULT_APPEARANCE_V2), ...edited });
        apply();
        const localSaved = writeAppearanceLocalV2(storage, userId, preferences);
        if (!localSaved) report('Your appearance is active, but browser storage is unavailable.', 'error');

        if (!cloud && local) {
          report('Syncing this device’s saved appearance to your account…', 'pending');
          void saveCloudSnapshot();
        } else if (dirtyFields.size) {
          report('Saving your appearance…', 'pending');
          void saveCloudSnapshot();
        } else {
          report('Appearance loaded from your ListR account.', 'saved');
        }
        return current();
      } catch (error) {
        if (generation === token && userId === nextId) {
          preferences = normalizeAppearanceV2(readAppearanceLocalV2(storage, userId) || preferences);
          apply();
          report(appearanceCloudError(error), 'error');
        }
        return current();
      }
    })();
    loadTask = { generation: token, promise: task };
    const result = await task;
    if (loadTask?.generation === token) loadTask = null;
    return result;
  }

  function set(field, value) {
    if ((field === 'theme' && !THEME_IDS.has(value)) || (field === 'layout' && !LAYOUT_IDS.has(value))) return false;
    if (preferences[field] === value) return true;
    preferences = { ...preferences, [field]: value };
    preferenceRevision += 1;
    dirtyFields.add(field);
    apply();
    const localSaved = writeAppearanceLocalV2(storage, userId, preferences);
    if (userId && client?.from) {
      report(localSaved ? 'Saving your appearance to your ListR account…' : 'Saving to your account; browser recovery storage is unavailable.', 'pending');
      void saveCloudSnapshot();
    } else {
      report(localSaved ? 'Guest appearance saved in this browser.' : 'Appearance applies for this visit; browser storage is unavailable.', localSaved ? 'saved' : 'error');
    }
    return true;
  }

  return Object.freeze({
    activateAccount,
    setTheme: (theme) => set('theme', theme),
    setLayout: (layout) => set('layout', layout),
    getCurrent: current,
  });
}
