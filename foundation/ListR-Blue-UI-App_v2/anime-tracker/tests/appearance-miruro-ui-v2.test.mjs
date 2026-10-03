import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appDir = new URL('../', import.meta.url);
const readApp = async (name) => readFile(new URL(name, appDir), 'utf8');

test('appearance settings expose five themes and three separate accessible layout choices', async () => {
  const html = await readApp('index.html');
  const appearance = await readApp('appearance-v2.js');
  const css = await readApp('appearance-v2.css');
  assert.match(html, /id="appearance-dialog"/);
  assert.match(html, /id="open-appearance"/);
  assert.equal((html.match(/data-appearance-theme=/g) || []).length, 5);
  assert.equal((html.match(/data-appearance-layout=/g) || []).length, 3);
  assert.match(html, /data-appearance-theme="soft-light"/);
  assert.match(html, /data-appearance-theme="emerald"/);
  assert.match(html, /role="group" aria-label="Colour theme"/);
  assert.match(html, /role="group" aria-label="Page layout"/);
  assert.match(appearance, /setTheme:/);
  assert.match(appearance, /setLayout:/);
  assert.match(appearance, /appearanceStorageKeyV2/);
  assert.match(css, /data-layout="reworked-old"/);
  assert.match(css, /data-layout="new"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('appearance persistence is owner-scoped and both stylesheets/modules are loaded', async () => {
  const html = await readApp('index.html');
  const script = await readApp('script.js');
  const migration = await readFile(new URL('../supabase/migrations/202610030002_appearance_preferences_v2.sql', appDir), 'utf8');
  assert.match(html, /data-theme="sub-zero" data-layout="current"/);
  assert.match(html, /appearance-v2\.css/);
  assert.match(script, /activateAccount\(supabaseClient, null\)/);
  assert.match(script, /activateAccount\(supabaseClient, userId\)/);
  assert.match(migration, /auth\.uid\(\)/);
});

test('Watch on Miruro renders conditionally for Watching entries and never mutates ListR progress', async () => {
  const script = await readApp('script.js');
  const html = await readApp('index.html');
  const client = await readApp('miruro-v2.js');
  const renderer = script.slice(script.indexOf('function renderCard'), script.indexOf('async function openMiruroNext'));
  const opener = script.slice(script.indexOf('async function openMiruroNext'), script.indexOf('function moveOptions'));
  assert.match(renderer, /const watchNext = entry\.category === 'watching'/);
  assert.match(renderer, /Watch on Miruro/);
  assert.match(script, /data-action="watch-next"/);
  assert.match(script, /nextEpisodeNumberV2\(latest\)/);
  assert.match(script, /popup\.location\.replace\(url\)/);
  assert.match(client, /No exact AniList match/i);
  assert.match(client, /url\.searchParams\.set\('ep', String\(episodeNumber\)\)/);
  assert.match(html, /never writes recommendation acceptance or tracker changes to an AniList list/i);
  assert.doesNotMatch(opener, /setWatched|persistEntry|persistUpdatedEntries/);
});
