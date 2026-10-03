import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEARANCE_LAYOUTS_V2,
  APPEARANCE_THEMES_V2,
  DEFAULT_APPEARANCE_V2,
  appearanceStorageKeyV2,
  createAppearanceControllerV2,
  normalizeAppearanceV2,
  readAppearanceLocalV2,
  writeAppearanceLocalV2,
} from '../appearance-v2.js';

function mockStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function mockClient(initial = {}) {
  const records = new Map(Object.entries(initial));
  const calls = [];
  return {
    records,
    calls,
    from(table) {
      assert.equal(table, 'list_r_appearance_preferences_v2');
      return {
        select(columns) {
          assert.equal(columns, 'theme,layout');
          return {
            eq(column, userId) {
              assert.equal(column, 'user_id');
              calls.push({ type: 'select', userId });
              return { maybeSingle: async () => ({ data: records.get(String(userId)) || null, error: null }) };
            },
          };
        },
        upsert(row) {
          calls.push({ type: 'upsert', row: { ...row } });
          records.set(String(row.user_id), { theme: row.theme, layout: row.layout });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('five themes and three layouts are separately enumerated and validated', () => {
  assert.deepEqual(DEFAULT_APPEARANCE_V2, { theme: 'sub-zero', layout: 'current' });
  assert.equal(APPEARANCE_THEMES_V2.length, 5);
  assert.equal(APPEARANCE_LAYOUTS_V2.length, 3);
  assert.equal(APPEARANCE_THEMES_V2.some(({ id }) => id === 'emerald'), true);
  assert.equal(APPEARANCE_THEMES_V2.some(({ id }) => id === 'soft-light'), true);
  assert.deepEqual(normalizeAppearanceV2({ theme: 'emerald', layout: 'new', extra: 'ignored' }), { theme: 'emerald', layout: 'new' });
  assert.deepEqual(normalizeAppearanceV2({ theme: 'unknown', layout: 'unknown' }), DEFAULT_APPEARANCE_V2);
});

test('guest and each signed-in user have distinct local fallback keys', () => {
  const storage = mockStorage();
  assert.equal(appearanceStorageKeyV2(null), 'listr-appearance-v2:guest');
  assert.notEqual(appearanceStorageKeyV2('user-a'), appearanceStorageKeyV2('user-b'));
  assert.equal(writeAppearanceLocalV2(storage, 'user-a', { theme: 'emerald', layout: 'new' }), true);
  assert.equal(writeAppearanceLocalV2(storage, 'user-b', { theme: 'cosmic', layout: 'current' }), true);
  assert.equal(writeAppearanceLocalV2(storage, null, { theme: 'onyx', layout: 'reworked-old' }), true);
  assert.deepEqual(readAppearanceLocalV2(storage, 'user-a'), { theme: 'emerald', layout: 'new' });
  assert.deepEqual(readAppearanceLocalV2(storage, 'user-b'), { theme: 'cosmic', layout: 'current' });
  assert.deepEqual(readAppearanceLocalV2(storage, null), { theme: 'onyx', layout: 'reworked-old' });
  assert.equal(readAppearanceLocalV2(storage, 'user-c'), null);
});

test('theme and layout changes sync independently to the authenticated owner row', async () => {
  const storage = mockStorage();
  const root = { dataset: {} };
  const client = mockClient({ 'owner-a': { theme: 'emerald', layout: 'reworked-old' } });
  const controller = createAppearanceControllerV2({ storage, root });
  await controller.activateAccount(client, 'owner-a');
  assert.deepEqual(controller.getCurrent(), { theme: 'emerald', layout: 'reworked-old' });
  assert.deepEqual(root.dataset, { theme: 'emerald', layout: 'reworked-old' });

  controller.setTheme('soft-light');
  await settle();
  assert.deepEqual(client.records.get('owner-a'), { theme: 'soft-light', layout: 'reworked-old' });
  controller.setLayout('new');
  await settle();
  assert.deepEqual(client.records.get('owner-a'), { theme: 'soft-light', layout: 'new' });
  assert.deepEqual(readAppearanceLocalV2(storage, 'owner-a'), { theme: 'soft-light', layout: 'new' });
});

test('switching to guest or another owner never carries the prior account appearance', async () => {
  const storage = mockStorage();
  const client = mockClient({
    'owner-a': { theme: 'emerald', layout: 'reworked-old' },
    'owner-b': { theme: 'cosmic', layout: 'new' },
  });
  const root = { dataset: {} };
  const controller = createAppearanceControllerV2({ storage, root });
  await controller.activateAccount(client, 'owner-a');
  await controller.activateAccount(client, null);
  assert.deepEqual(controller.getCurrent(), DEFAULT_APPEARANCE_V2);
  controller.setTheme('onyx');
  assert.deepEqual(readAppearanceLocalV2(storage, null), { theme: 'onyx', layout: 'current' });
  await controller.activateAccount(client, 'owner-b');
  assert.deepEqual(controller.getCurrent(), { theme: 'cosmic', layout: 'new' });
  assert.deepEqual(root.dataset, { theme: 'cosmic', layout: 'new' });
  assert.deepEqual(client.records.get('owner-a'), { theme: 'emerald', layout: 'reworked-old' });
  assert.deepEqual(client.records.get('owner-b'), { theme: 'cosmic', layout: 'new' });
});

test('a late previous-user load cannot overwrite the latest account appearance', async () => {
  const pending = new Map();
  const client = {
    from: () => ({
      select: () => ({
        eq: (_column, userId) => ({ maybeSingle: () => new Promise((resolve) => pending.set(String(userId), resolve)) }),
      }),
      upsert: async () => ({ error: null }),
    }),
  };
  const root = { dataset: {} };
  const controller = createAppearanceControllerV2({ storage: mockStorage(), root });
  const oldLoad = controller.activateAccount(client, 'old-user');
  const newLoad = controller.activateAccount(client, 'new-user');
  pending.get('new-user')({ data: { theme: 'cosmic', layout: 'new' }, error: null });
  await newLoad;
  pending.get('old-user')({ data: { theme: 'emerald', layout: 'reworked-old' }, error: null });
  await oldLoad;
  assert.deepEqual(controller.getCurrent(), { theme: 'cosmic', layout: 'new' });
  assert.deepEqual(root.dataset, { theme: 'cosmic', layout: 'new' });
});
