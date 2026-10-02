import { CATEGORIES, createEntry, calculateStats, clampWatched, getTitle, isKnownTotal, progressPercent, readEntries, saveEntries } from './core.js';
import { refreshAnimeByIds, searchAnime } from './api.js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config.js';
import { enqueueCloudOperation, loadUserEntries, mergePendingOperations, readCloudCache, readOutbox, removeCompletedOperation, removeUserEntry, saveUserEntry, writeCloudCache } from './cloud-store.js';
import { validateAuthFields } from './auth-validation.js';
import { canUseAniListV2, clearAniListOAuthAttemptV2, invokeAniListActionV2, isPotentialAniListOAuthReturnV2, readAniListCallbackV2, readAniListOAuthAttemptV2, removeAniListCallbackParamsV2, safeAniListErrorMessageV2, shouldAutoSyncAniListV2, storeAniListOAuthAttemptV2, validateProgressResponseV2 } from './anilist-integration-v2.js';

// ----------------------------- App state -----------------------------------
const STORE_KEY = 'afterglow-anime-tracker-v1';
const entries = new Map();
function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}
const storage = browserStorage();
// AniList's authorization-code return also uses ?code=. Do not let Supabase Auth's
// PKCE URL detector attempt to exchange the AniList code as a ListR auth code.
const anilistOAuthReturnInUrl = isPotentialAniListOAuthReturnV2(window.location);
let supabaseClient = null;
try {
  if (window.supabase?.createClient && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !anilistOAuthReturnInUrl }
    });
  }
} catch {
  supabaseClient = null;
}
let currentUser = null;
let authEpoch = 0;
let cloudLibraryReady = false;
let authMode = 'login';
const activeFlushes = new Map();
let activeView = 'watching';
let searchResults = [];
let searchController = null;
let toastTimer = null;
let anilistConnectionState = 'not_connected';
let anilistUsername = '';
let anilistLastSyncedAt = null;
let anilistSyncMessage = 'Your AniList account remains separate from your ListR sign-in.';
let anilistSyncMessageType = '';
let anilistSyncing = false;
let anilistLastRequestAt = 0;
let anilistSyncEpoch = 0;
let anilistStatusUserId = null;
const activeAniListStatusLoads = new Map();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const collectionView = $('#collection-view');
const searchView = $('#search-view');
const statsView = $('#stats-view');
const collectionGrid = $('#collection-grid');
const collectionEmpty = $('#collection-empty');
const searchResultsEl = $('#search-results');
const searchMessage = $('#search-message');

// ----------------------------- Storage -------------------------------------
function persist() {
  const current = [...entries.values()];
  const result = currentUser ? writeCloudCache(storage, currentUser.id, current) : saveEntries(storage, STORE_KEY, current);
  if (!result.ok) showToast('Could not save a local recovery copy. Check browser storage space.');
}

function queueCloudChange(operation) {
  if (!currentUser) return;
  if (!storage) {
    if (navigator.onLine === false) {
      setSyncStatus('Browser storage is unavailable while offline; this change cannot be queued for later.', 'error');
      return;
    }
    const userId = currentUser.id;
    setSyncStatus('Saving directly to your cloud library…', 'pending');
    const request = operation.type === 'delete'
      ? removeUserEntry(supabaseClient, userId, operation.mediaId)
      : saveUserEntry(supabaseClient, userId, operation.entry, { ignoreDuplicates: operation.ignoreDuplicates });
    void request.then(() => {
      if (currentUser?.id === userId) setSyncStatus('All changes saved to your cloud library.', 'ok');
    }).catch((error) => {
      if (currentUser?.id === userId) setSyncStatus(`${cloudErrorMessage(error)} This browser cannot retain a retry copy.`, 'error');
    });
    return;
  }
  const result = enqueueCloudOperation(storage, currentUser.id, operation);
  if (!result.ok) {
    setSyncStatus('This change could not be queued for cloud sync. Check browser storage.', 'error');
    showToast('Could not queue this cloud change. Your account data was not confirmed as saved.');
    return;
  }
  setSyncStatus(navigator.onLine === false ? 'Offline — changes are queued on this device.' : 'Saving changes to your cloud library…', 'pending');
  void flushCloudQueue(currentUser.id);
}

function persistEntry(entry, options = {}) {
  persist();
  if (currentUser) queueCloudChange({ type: 'upsert', mediaId: entry.id, entry, ignoreDuplicates: options.ignoreDuplicates });
}

function persistDeletedEntry(id) {
  persist();
  if (currentUser) queueCloudChange({ type: 'delete', mediaId: id });
}

function persistUpdatedEntries(updatedEntries) {
  persist();
  if (currentUser) for (const entry of updatedEntries) queueCloudChange({ type: 'upsert', mediaId: entry.id, entry });
}

// ----------------------------- AniList API ---------------------------------
async function refreshAllMetadata() {
  const list = [...entries.values()];
  if (!list.length) { showToast('Your list is empty — add an anime first.'); return; }
  const button = $('#refresh-metadata');
  button.disabled = true;
  button.innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span> Refreshing…';
  let updated = 0;
  const updatedEntries = new Map();
  try {
    for (let index = 0; index < list.length; index += 20) {
      const ids = list.slice(index, index + 20).map((item) => Number(item.id));
      const mediaList = await refreshAnimeByIds(ids);
      for (const media of mediaList) {
        const old = entries.get(String(media.id));
        if (old) {
          old.meta = media;
          old.watched = clampWatched(old.watched, media.episodes);
          updated += 1;
          updatedEntries.set(old.id, old);
        }
      }
      if (index + 20 < list.length) await new Promise((resolve) => setTimeout(resolve, 550));
    }
    persistUpdatedEntries([...updatedEntries.values()]); render(); showToast(`Updated details for ${updated} anime.`);
  } catch (error) {
    if (updated) { persistUpdatedEntries([...updatedEntries.values()]); render(); }
    showToast(error.message || 'Could not refresh details. Your saved list is unchanged.');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span> Refresh details';
  }
}

// ----------------------------- Display helpers -----------------------------
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function titleOf(entry) { return getTitle(entry.meta?.title, entry.id); }
function safeCover(meta) { return meta?.coverImage?.extraLarge || meta?.coverImage?.large || meta?.coverImage?.medium || ''; }
function formatStatus(value) {
  if (!value) return 'Status unknown';
  return String(value).toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function releaseLabel(meta) {
  const season = meta?.season ? String(meta.season).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : '';
  const year = Number.isFinite(meta?.seasonYear) ? String(meta.seasonYear) : '';
  if (season && year) return `${season} ${year}`;
  if (year) return year;
  return 'Release year unknown';
}
function formatHours(minutes) {
  const hours = minutes / 60;
  if (hours < 10) return hours.toFixed(1);
  return hours.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function categoryName(category) { return CATEGORIES[category] || category; }
function imageMarkup(meta, title) {
  const cover = safeCover(meta);
  if (!cover) return '<div class="cover-placeholder" aria-label="Cover unavailable">✦</div>';
  return `<img class="cover" src="${escapeHtml(cover)}" alt="Cover art for ${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer"><div class="cover-shade"></div>`;
}
function badgeLabel(entry) { return categoryName(entry.category); }

function renderCard(entry) {
  const meta = entry.meta || {};
  const id = escapeHtml(entry.id);
  const title = titleOf(entry);
  const totalKnown = isKnownTotal(meta.episodes);
  const total = totalKnown ? Math.floor(meta.episodes) : null;
  const watched = clampWatched(entry.watched, total);
  const duration = Number.isFinite(meta.duration) && meta.duration > 0 ? `${meta.duration} min/episode` : '';
  const time = entry.category !== 'interested' && duration ? `<p class="card-time"><strong>${formatHours(watched * meta.duration)} hours watched</strong> <span>· est.</span></p>` : '';
  const statusChip = `<span class="meta-chip">${escapeHtml(formatStatus(meta.status))}</span>`;
  const yearChip = `<span class="meta-chip">${escapeHtml(releaseLabel(meta))}</span>`;
  let progress;
  let controls = '';
  if (entry.category === 'interested') {
    progress = `<div class="card-progress-line"><span class="episode-label">${totalKnown ? `${total} total episodes` : 'Episode count unknown'}</span></div>`;
    controls = `<div class="card-actions"><label class="sr-only" for="move-${id}">Move ${escapeHtml(title)} to another category</label><select id="move-${id}" class="move-select" data-action="move" data-id="${id}">${moveOptions(entry.category)}</select><button class="remove-button" data-action="remove" data-id="${id}" type="button">Remove</button></div>`;
  } else {
    const percentage = progressPercent(watched, total);
    const episodeText = `${watched} / ${totalKnown ? total : '?'} episodes`;
    progress = `<div class="card-progress-line"><span class="episode-label"><strong>${watched}</strong> / ${totalKnown ? total : '?'} episodes</span>${percentage !== null ? `<span class="percent-label">${percentage}%</span>` : ''}</div>${percentage !== null ? `<div class="progress-track" role="progressbar" aria-label="${escapeHtml(title)} episode progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${watched}"><div class="progress-fill" style="width:${percentage}%"></div></div>` : '<div class="unknown-track" aria-label="Progress unavailable because total episode count is unknown"></div>'}`;
    const maxAttribute = totalKnown ? `max="${total}"` : '';
    controls = `<div class="episode-controls"><button class="step-button" type="button" data-action="decrease" data-id="${id}" aria-label="Decrease watched episodes for ${escapeHtml(title)}" ${watched <= 0 ? 'disabled' : ''}>−</button><label class="sr-only" for="watched-${id}">Watched episode count for ${escapeHtml(title)}</label><input id="watched-${id}" class="watched-input" type="number" inputmode="numeric" min="0" ${maxAttribute} step="1" value="${watched}" data-action="edit-count" data-id="${id}"><span class="control-total">of ${totalKnown ? total : '?'}</span><button class="step-button" type="button" data-action="increase" data-id="${id}" aria-label="Increase watched episodes for ${escapeHtml(title)}" ${(totalKnown && watched >= total) ? 'disabled' : ''}>+</button><span class="control-spacer"></span></div><div class="card-actions"><label class="sr-only" for="move-${id}">Move ${escapeHtml(title)} to another category</label><select id="move-${id}" class="move-select" data-action="move" data-id="${id}">${moveOptions(entry.category)}</select><button class="remove-button" data-action="remove" data-id="${id}" type="button">Remove</button></div>`;
  }
  return `<article class="anime-card ${entry.category === 'interested' ? 'interested-card' : ''}" data-id="${id}"><div class="cover-wrap">${imageMarkup(meta, title)}<span class="cover-badge"><i></i>${escapeHtml(badgeLabel(entry))}</span></div><div class="card-body"><h3 class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3><p class="card-subtitle">${escapeHtml(meta.title?.romaji && meta.title?.english ? meta.title.romaji : (meta.format ? String(meta.format).replaceAll('_', ' ') : releaseLabel(meta)))}</p>${progress}<div class="card-meta">${duration ? `<span class="meta-chip">${escapeHtml(duration)}</span>` : ''}${statusChip}${entry.category === 'interested' ? yearChip : ''}</div>${time}${controls}</div></article>`;
}

function moveOptions(current) {
  return Object.entries(CATEGORIES).filter(([key]) => key !== current).map(([key, label]) => `<option value="${key}">Move to ${label}</option>`).join('');
}

function renderCollection() {
  const categoryEntries = [...entries.values()].filter((entry) => entry.category === activeView);
  const filter = $('#list-search').value.trim().toLocaleLowerCase();
  const sort = $('#sort-order').value;
  const visible = categoryEntries.filter((entry) => `${titleOf(entry)} ${entry.meta?.title?.romaji || ''} ${entry.meta?.title?.english || ''}`.toLocaleLowerCase().includes(filter));
  visible.sort((a, b) => {
    if (sort === 'alphabetical') return titleOf(a).localeCompare(titleOf(b));
    if (sort === 'watched') return (b.watched || 0) - (a.watched || 0);
    if (sort === 'total') return (Number(b.meta?.episodes) || 0) - (Number(a.meta?.episodes) || 0);
    return (b.addedAt || 0) - (a.addedAt || 0);
  });
  collectionGrid.innerHTML = visible.map(renderCard).join('');
  const heading = { watching: 'Currently watching', completed: 'Completed anime', interested: 'On your list' }[activeView];
  $('#collection-heading').textContent = heading;
  collectionEmpty.hidden = categoryEntries.length > 0;
  if (categoryEntries.length === 0) collectionGrid.hidden = true;
  else collectionGrid.hidden = false;
  if (categoryEntries.length > 0 && visible.length === 0) collectionGrid.innerHTML = '<div class="empty-filter">No anime match that filter.</div>';
}

function renderCounts() {
  for (const category of Object.keys(CATEGORIES)) $(`#nav-${category}`).textContent = String([...entries.values()].filter((entry) => entry.category === category).length);
  $('#quick-total').textContent = String(entries.size);
  const stats = calculateStats([...entries.values()]);
  $('#quick-episodes').textContent = stats.episodes.toLocaleString();
}

function renderStats() {
  const stats = calculateStats([...entries.values()]);
  $('#stat-total').textContent = String(entries.size);
  $('#stat-watching').textContent = String(stats.counts.watching);
  $('#stat-completed').textContent = String(stats.counts.completed);
  $('#stat-interested').textContent = String(stats.counts.interested);
  $('#stat-episodes').textContent = stats.episodes.toLocaleString();
  $('#stat-hours').textContent = formatHours(stats.minutes);
  $('#stat-days').textContent = (stats.minutes / 1440).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const max = Math.max(stats.categoryEpisodes.watching, stats.categoryEpisodes.completed, 1);
  for (const category of ['watching', 'completed']) {
    const value = stats.categoryEpisodes[category];
    $(`#bar-${category}`).style.width = `${Math.round(value / max * 100)}%`;
    $(`#bar-${category}-value`).textContent = value.toLocaleString();
  }
}

function render() {
  renderCounts();
  renderStats();
  if (activeView === 'stats' || activeView === 'search') return;
  renderCollection();
}

function renderResults() {
  const category = $('#add-category').value;
  searchResultsEl.innerHTML = searchResults.map((media) => {
    const id = String(media.id);
    const title = getTitle(media.title, id);
    const existing = entries.get(id);
    const total = isKnownTotal(media.episodes) ? `${Math.floor(media.episodes)} episodes` : 'Episode count unknown';
    const format = media.format ? String(media.format).replaceAll('_', ' ') : 'Format unknown';
    const description = media.description ? media.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : 'No description provided by AniList.';
    const addButton = existing
      ? `<p class="duplicate-note">Already in ${escapeHtml(categoryName(existing.category))}</p>`
      : `<button class="button button-primary result-add" type="button" data-action="add-result" data-id="${escapeHtml(id)}">＋ Add to ${escapeHtml(categoryName(category))}</button>`;
    return `<article class="anime-card result-card" data-id="${escapeHtml(id)}"><div class="cover-wrap">${imageMarkup(media, title)}<span class="cover-badge"><i></i>${escapeHtml(formatStatus(media.status))}</span></div><div class="card-body"><h3 class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3><p class="card-subtitle">${escapeHtml(media.title?.romaji && media.title?.english ? media.title.romaji : format)}</p><div class="result-info"><span><strong>${escapeHtml(String(media.seasonYear || 'Year unknown'))}</strong> · ${escapeHtml(format)}</span><span><strong>${escapeHtml(total)}</strong></span><span>AniList ID: ${escapeHtml(id)}</span></div><p class="result-desc">${escapeHtml(description)}</p>${addButton}</div></article>`;
  }).join('');
  if (searchResults.length === 0) searchResultsEl.innerHTML = '';
}

// ----------------------------- Navigation ----------------------------------
function setView(view, { updateHash = true } = {}) {
  activeView = view;
  collectionView.hidden = view === 'search' || view === 'stats';
  searchView.hidden = view !== 'search';
  statsView.hidden = view !== 'stats';
  $$('.nav-link').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  if (view !== 'search' && view !== 'stats') renderCollection();
  if (view === 'stats') renderStats();
  if (updateHash) window.location.hash = view === 'search' ? 'add' : view;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function setSearchMessage(message, type = '') {
  searchMessage.textContent = message;
  searchMessage.className = `message ${type}`.trim();
}

// ----------------------------- Accounts / cloud ----------------------------
let activatingUserId = null;
let activeUserLoad = null;

function setSyncStatus(message, type = '') {
  const status = $('#sync-status');
  status.textContent = message;
  status.className = `sync-status ${type ? `is-${type}` : ''}`.trim();
}

function cloudErrorMessage(error) {
  const message = String(error?.message || 'Cloud request failed.');
  if (error?.code === 'PGRST205' || error?.code === '42P01' || /could not find the table|relation .* does not exist/i.test(message)) {
    return 'Cloud storage is not set up yet. Apply the SQL migration in supabase/migrations, then refresh.';
  }
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Cloud access was denied. Check the table grants and owner-only RLS policies.';
  }
  return message.length > 150 ? `${message.slice(0, 147)}…` : message;
}

function setAppReady() {
  document.body.classList.remove('auth-loading');
  $('#app-loading').hidden = true;
}

function setAniListMessage(message, type = '') {
  anilistSyncMessage = String(message || '');
  anilistSyncMessageType = type;
  const element = $('#anilist-sync-message');
  element.textContent = anilistSyncMessage;
  element.className = `anilist-sync-message ${type ? `is-${type}` : ''}`.trim();
}

function renderAniListPanel() {
  const panel = $('#anilist-panel');
  const signedIn = Boolean(currentUser);
  panel.hidden = !signedIn;
  if (!signedIn) return;

  const labels = { not_connected: 'Not Connected', connecting: 'Connecting', connected: 'Connected', error: 'Error' };
  const state = labels[anilistConnectionState] ? anilistConnectionState : 'error';
  const stateElement = $('#anilist-connection-state');
  stateElement.textContent = labels[state];
  stateElement.className = `anilist-state ${state === 'not_connected' ? 'is-idle' : `is-${state}`}`;
  $('#anilist-account-name').textContent = anilistUsername
    ? `Connected as ${anilistUsername}. ListR will sync only this signed-in account’s existing anime.`
    : 'Connect your AniList account to sync watch progress. This does not replace your ListR sign-in.';
  const connect = $('#connect-anilist');
  connect.hidden = state === 'connected';
  connect.disabled = state === 'connecting' || !cloudLibraryReady || navigator.onLine === false;
  connect.textContent = state === 'connecting' ? 'Connecting…' : (state === 'error' ? 'Reconnect AniList' : 'Connect AniList');
  $('#sync-anilist').hidden = state !== 'connected';
  $('#sync-anilist').disabled = anilistSyncing || !cloudLibraryReady || navigator.onLine === false;
  $('#sync-anilist').textContent = anilistSyncing ? 'Syncing…' : 'Sync with AniList';
  $('#disconnect-anilist').hidden = state !== 'connected';
  $('#disconnect-anilist').disabled = anilistSyncing;
  $('#anilist-sync-message').textContent = anilistSyncMessage;
  $('#anilist-sync-message').className = `anilist-sync-message ${anilistSyncMessageType ? `is-${anilistSyncMessageType}` : ''}`.trim();
  $('#anilist-sync-progress').hidden = !anilistSyncing;
  $('#anilist-last-sync').textContent = anilistLastSyncedAt && Number.isFinite(Date.parse(anilistLastSyncedAt))
    ? `Last successful sync: ${new Date(anilistLastSyncedAt).toLocaleString()}`
    : 'Last successful sync: never';
}

function resetAniListPanel() {
  anilistConnectionState = 'not_connected';
  anilistUsername = '';
  anilistLastSyncedAt = null;
  anilistSyncing = false;
  anilistLastRequestAt = 0;
  anilistSyncEpoch += 1;
  anilistStatusUserId = null;
  setAniListMessage('Your AniList account remains separate from your ListR sign-in.');
}

function updateAccountBar() {
  const signedIn = Boolean(currentUser);
  $('#guest-actions').hidden = signedIn;
  $('#logout-button').hidden = !signedIn;
  $('#account-email').hidden = !signedIn;
  $('#account-email').textContent = signedIn ? currentUser.email : '';
  $('#data-mode-label').textContent = signedIn ? 'Private cloud library' : 'Guest library · this browser';
  $('#local-note').textContent = signedIn
    ? 'This account’s library is stored in Supabase. A private, per-account recovery cache is kept on this device.'
    : 'Guest lists stay in this browser. Sign in to sync a separate private cloud list.';
  renderAniListPanel();
}

function importDismissedKey(userId) { return `afterglow-import-dismissed-v1:${String(userId)}`; }

function updateMigrationBanner() {
  const banner = $('#migration-banner');
  if (!currentUser) { banner.hidden = true; return; }
  const guestEntries = readEntries(storage, STORE_KEY);
  let dismissed = false;
  try { dismissed = storage?.getItem(importDismissedKey(currentUser.id)) === 'yes'; } catch { /* storage may be unavailable */ }
  banner.hidden = dismissed || guestEntries.length === 0;
  $('#migration-copy').textContent = `This browser has ${guestEntries.length} guest anime. Importing adds only AniList IDs missing from this account; duplicate cloud records are kept and the guest list is not deleted.`;
  $('#import-guest').disabled = !cloudLibraryReady;
  $('#import-guest').textContent = cloudLibraryReady ? `Import ${guestEntries.length} local anime` : 'Connect to import';
}

function rememberImportDismissal(userId) {
  try { storage?.setItem(importDismissedKey(userId), 'yes'); } catch { /* optional preference only */ }
  updateMigrationBanner();
}

function enterGuest(message = '') {
  authEpoch += 1;
  activatingUserId = null;
  activeUserLoad = null;
  currentUser = null;
  cloudLibraryReady = false;
  resetAniListPanel();
  entries.clear();
  for (const entry of readEntries(storage, STORE_KEY)) entries.set(String(entry.id), entry);
  updateAccountBar();
  updateMigrationBanner();
  if (message) setSyncStatus(message, 'error');
  else if (!supabaseClient) setSyncStatus('Cloud sign-in is unavailable; guest mode still works.', 'error');
  else setSyncStatus('Guest list is stored in this browser.');
  render();
  setAppReady();
}

async function activateUser(user) {
  if (!user?.id) { enterGuest('Could not restore the account session. Your guest list is still available.'); return; }
  const userId = String(user.id);
  if (currentUser?.id === userId && cloudLibraryReady) { void initializeAniListForUser(userId); return; }
  if (activatingUserId === userId && activeUserLoad) return activeUserLoad;

  const token = ++authEpoch;
  if (currentUser?.id !== userId) resetAniListPanel();
  activatingUserId = userId;
  currentUser = { id: userId, email: String(user.email || '') };
  cloudLibraryReady = false;
  entries.clear();
  updateAccountBar();
  updateMigrationBanner();
  setSyncStatus('Loading your private cloud library…');
  render();

  const task = (async () => {
    try {
      const serverEntries = await loadUserEntries(supabaseClient, userId);
      if (token !== authEpoch) return;
      const pending = readOutbox(storage, userId);
      const merged = mergePendingOperations(serverEntries, pending, userId);
      entries.clear();
      for (const entry of merged) entries.set(String(entry.id), entry);
      cloudLibraryReady = true;
      const cacheResult = writeCloudCache(storage, userId, merged);
      if (!cacheResult.ok) setSyncStatus('Cloud library loaded, but a recovery cache could not be saved here.', 'pending');
      else if (pending.length) setSyncStatus(`${pending.length} change${pending.length === 1 ? '' : 's'} waiting to sync.`, 'pending');
      else setSyncStatus('Your cloud library is synced.', 'ok');
      render();
      updateMigrationBanner();
      setAppReady();
      if (pending.length) {
        void initializeAniListForUser(userId, { allowAutoSync: false });
        void flushCloudQueue(userId).then(() => maybeAutoSyncAniList(userId));
      } else {
        void initializeAniListForUser(userId);
      }
    } catch (error) {
      if (token !== authEpoch) return;
      const cached = readCloudCache(storage, userId);
      const pending = readOutbox(storage, userId);
      const merged = mergePendingOperations(cached, pending, userId);
      entries.clear();
      for (const entry of merged) entries.set(String(entry.id), entry);
      cloudLibraryReady = false;
      setSyncStatus(`${cloudErrorMessage(error)} ${pending.length ? 'Queued changes remain on this device.' : 'No guest data was mixed into this account.'}`, 'error');
      render();
      updateMigrationBanner();
      setAppReady();
    } finally {
      if (activatingUserId === userId) {
        activatingUserId = null;
        activeUserLoad = null;
      }
    }
  })();
  activeUserLoad = task;
  return task;
}

function flushCloudQueue(userId) {
  const uid = String(userId);
  if (activeFlushes.has(uid)) return activeFlushes.get(uid);
  if (!supabaseClient || !currentUser || currentUser.id !== uid) return Promise.resolve();
  if (navigator.onLine === false) {
    setSyncStatus('Offline — changes are queued on this device and will sync when online.', 'pending');
    return Promise.resolve();
  }
  let task;
  task = Promise.resolve().then(async () => {
    try {
      let pending = readOutbox(storage, uid);
      while (pending.length && currentUser?.id === uid) {
        const operation = pending[0];
        try {
          if (operation.type === 'delete') await removeUserEntry(supabaseClient, uid, operation.mediaId);
          else await saveUserEntry(supabaseClient, uid, operation.entry, { ignoreDuplicates: operation.ignoreDuplicates });
        } catch (error) {
          setSyncStatus(`${cloudErrorMessage(error)} Queued changes are retained for retry.`, 'error');
          return;
        }
        const removed = removeCompletedOperation(storage, uid, operation.operationId);
        if (!removed.ok) {
          setSyncStatus('Cloud accepted a change, but the local queue could not be updated. Sign in again to retry safely.', 'error');
          return;
        }
        pending = removed.operations;
      }
      if (currentUser?.id === uid) {
        setSyncStatus(pending.length ? `${pending.length} change${pending.length === 1 ? '' : 's'} waiting to sync.` : 'All changes saved to your cloud library.', pending.length ? 'pending' : 'ok');
      }
    } finally {
      if (activeFlushes.get(uid) === task) activeFlushes.delete(uid);
    }
  });
  activeFlushes.set(uid, task);
  return task;
}

function aniListSessionStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

function updateAniListState(state, { username, lastSyncedAt, message, messageType } = {}) {
  anilistConnectionState = state;
  if (username !== undefined) anilistUsername = String(username || '');
  if (lastSyncedAt !== undefined) anilistLastSyncedAt = lastSyncedAt || null;
  if (message !== undefined) setAniListMessage(message, messageType || '');
  renderAniListPanel();
}

function removeAniListCallback() {
  try { removeAniListCallbackParamsV2(window.location, window.history); } catch { /* callback cleanup is best effort */ }
  clearAniListOAuthAttemptV2(aniListSessionStorage());
}

async function processAniListCallback(userId) {
  const tabStorage = aniListSessionStorage();
  const callback = readAniListCallbackV2(window.location, tabStorage);
  if (!callback && isPotentialAniListOAuthReturnV2(window.location)) {
    const attempt = readAniListOAuthAttemptV2(tabStorage);
    if (attempt?.userId === String(userId)) {
      try { await invokeAniListActionV2(supabaseClient, 'cancel', { state: attempt.state }); } catch { /* expired server state is harmless */ }
    }
    updateAniListState('error', { message: 'This AniList callback is expired or has no matching request in this browser. Nothing was connected; start Connect AniList again.', messageType: 'error' });
    removeAniListCallback();
    return true;
  }
  if (!callback) return false;

  const uid = String(userId);
  if (callback.expectedUserId !== uid) {
    updateAniListState('error', { message: 'The ListR account changed during AniList authorization. Nothing was connected; start Connect AniList again.' });
    removeAniListCallback();
    return true;
  }

  if (callback.kind === 'invalid_state' || callback.kind === 'invalid_code') {
    const attempt = readAniListOAuthAttemptV2(tabStorage);
    if (attempt?.userId === uid) {
      try { await invokeAniListActionV2(supabaseClient, 'cancel', { state: attempt.state }); } catch { /* the short-lived server transaction will expire */ }
    }
    updateAniListState('error', { message: 'AniList authorization could not be verified. Nothing was connected; start Connect AniList again.' });
    removeAniListCallback();
    return true;
  }

  updateAniListState('connecting', { message: 'Completing AniList authorization…' });
  try {
    if (callback.kind === 'denied') {
      await invokeAniListActionV2(supabaseClient, 'cancel', { state: callback.state });
      anilistStatusUserId = uid;
      updateAniListState('not_connected', { message: 'AniList authorization was cancelled. Your ListR account and library are unchanged.' });
      return true;
    }

    const connected = await invokeAniListActionV2(supabaseClient, 'callback', { code: callback.code, state: callback.state });
    if (currentUser?.id !== uid) return true;
    anilistStatusUserId = uid;
    updateAniListState('connected', {
      username: connected.username,
      lastSyncedAt: connected.lastSyncedAt,
      message: `Connected as ${connected.username}. Starting the first progress sync…`,
      messageType: 'success',
    });
    await runAniListSync(uid, { automatic: false });
    return true;
  } catch (error) {
    if (currentUser?.id === uid) {
      const code = String(error?.code || '');
      updateAniListState('error', { message: safeAniListErrorMessageV2(error), messageType: 'error' });
      if (code === 'anilist_reauthorization_required') anilistUsername = '';
    }
    return true;
  } finally {
    removeAniListCallback();
  }
}

async function initializeAniListForUser(userId, { forceStatus = false, allowAutoSync = true } = {}) {
  const uid = String(userId);
  if (!supabaseClient || !canUseAniListV2(currentUser?.id, cloudLibraryReady) || currentUser.id !== uid) return;
  const callback = readAniListCallbackV2(window.location, aniListSessionStorage());
  if (!callback && !forceStatus && anilistStatusUserId === uid) {
    if (allowAutoSync) void maybeAutoSyncAniList(uid);
    return;
  }
  if (activeAniListStatusLoads.has(uid)) return activeAniListStatusLoads.get(uid);

  let task;
  task = Promise.resolve().then(async () => {
    try {
      if (await processAniListCallback(uid)) return;
      const status = await invokeAniListActionV2(supabaseClient, 'status');
      if (currentUser?.id !== uid) return;
      anilistStatusUserId = uid;
      updateAniListState(status.state === 'connected' || status.state === 'error' ? status.state : 'not_connected', {
        username: status.username || '',
        lastSyncedAt: status.lastSyncedAt || null,
        message: status.state === 'connected'
          ? `Connected as ${status.username}. ListR only updates matching anime already in this account.`
          : (status.state === 'error' ? (status.message || 'AniList needs to be reconnected.') : 'Connect AniList to sync viewing progress from Miruro and other services.'),
        messageType: status.state === 'error' ? 'error' : '',
      });
      if (allowAutoSync) void maybeAutoSyncAniList(uid);
    } catch (error) {
      if (currentUser?.id !== uid) return;
      anilistStatusUserId = uid;
      updateAniListState('error', { message: safeAniListErrorMessageV2(error), messageType: 'error' });
    }
  }).finally(() => {
    if (activeAniListStatusLoads.get(uid) === task) activeAniListStatusLoads.delete(uid);
  });
  activeAniListStatusLoads.set(uid, task);
  return task;
}

async function connectAniList() {
  if (!canUseAniListV2(currentUser?.id, cloudLibraryReady) || !supabaseClient) {
    setAniListMessage('Sign in to ListR and wait for your private library to load before connecting AniList.', 'error');
    return;
  }
  if (navigator.onLine === false) {
    updateAniListState('error', { message: 'Connect AniList requires an internet connection.', messageType: 'error' });
    return;
  }
  const uid = currentUser.id;
  updateAniListState('connecting', { message: 'Preparing a secure AniList authorization request…' });
  try {
    const response = await invokeAniListActionV2(supabaseClient, 'start');
    const authorize = new URL(response.authorizeUrl);
    const state = authorize.searchParams.get('state');
    if (authorize.origin !== 'https://anilist.co' || authorize.pathname !== '/api/v2/oauth/authorize'
      || authorize.searchParams.get('response_type') !== 'code' || !state
      || !storeAniListOAuthAttemptV2(aniListSessionStorage(), { state, userId: uid })) {
      throw new Error('A secure AniList authorization could not be prepared in this browser.');
    }
    window.location.assign(authorize.toString());
  } catch (error) {
    if (currentUser?.id === uid) updateAniListState('error', { message: safeAniListErrorMessageV2(error), messageType: 'error' });
  }
}

async function runAniListSync(userId, { automatic = false } = {}) {
  const uid = String(userId);
  if (anilistSyncing) return false;
  if (!canUseAniListV2(currentUser?.id, cloudLibraryReady) || currentUser.id !== uid || !supabaseClient) {
    if (currentUser?.id === uid) setAniListMessage('Your ListR cloud library must finish loading before progress can sync.', 'error');
    return false;
  }
  if (navigator.onLine === false) {
    setAniListMessage('You are offline. AniList progress can sync when the connection returns.', 'error');
    return false;
  }
  const lastSuccessfulSync = Date.parse(anilistLastSyncedAt || '') || 0;
  const lastRequest = Math.max(anilistLastRequestAt, lastSuccessfulSync);
  const retryInMs = 30_000 - (Date.now() - lastRequest);
  if (lastRequest && retryInMs > 0) {
    if (!automatic) setAniListMessage(`Please wait ${Math.ceil(retryInMs / 1000)} seconds before another AniList request.`, 'error');
    return false;
  }

  const runId = ++anilistSyncEpoch;
  anilistSyncing = true;
  $('#anilist-progress-label').textContent = readOutbox(storage, uid).length
    ? 'Saving queued ListR changes before AniList sync…'
    : (automatic ? 'Refreshing AniList progress after the sync interval…' : 'Fetching your AniList anime progress…');
  setAniListMessage('Syncing with AniList… your existing ListR anime will be checked; no new records will be created.');
  renderAniListPanel();

  try {
    if (readOutbox(storage, uid).length) {
      setAniListMessage('Saving your queued ListR changes before the AniList sync…');
      await flushCloudQueue(uid);
      if (currentUser?.id !== uid) return false;
      if (readOutbox(storage, uid).length) {
        setAniListMessage('A ListR cloud change is still waiting to sync. Resolve that connection issue before importing AniList progress.', 'error');
        return false;
      }
    }

    anilistLastRequestAt = Date.now();
    const fetched = await invokeAniListActionV2(supabaseClient, 'sync');
    const progress = validateProgressResponseV2(fetched);
    if (currentUser?.id !== uid) return false;
    $('#anilist-progress-label').textContent = `Applying progress to existing ListR anime (${progress.length} AniList entries checked)…`;
    setAniListMessage(`Found ${progress.length.toLocaleString()} AniList entries. Updating only matching anime already in your ListR library…`);

    const { data, error } = await supabaseClient.rpc('sync_anilist_progress_v2', { p_progress: progress });
    if (error) {
      const saveError = new Error('AniList was read, but ListR could not save the progress. Apply the v2 database migration and try again.');
      saveError.code = 'sync_database_failed';
      throw saveError;
    }
    if (currentUser?.id !== uid) return false;
    const counts = Array.isArray(data) ? data[0] : data;
    const matchedCount = Number(counts?.matched_count);
    const updatedCount = Number(counts?.updated_count);
    if (!Number.isSafeInteger(matchedCount) || matchedCount < 0 || !Number.isSafeInteger(updatedCount) || updatedCount < 0) {
      throw new Error('ListR returned an invalid sync result. The cloud update may need to be checked before retrying.');
    }

    const progressById = new Map(progress.map((item) => [String(item.mediaId), item.progress]));
    for (const entry of entries.values()) {
      if (progressById.has(String(entry.id))) entry.watched = clampWatched(progressById.get(String(entry.id)), entry.meta?.episodes);
    }
    persist();
    render();

    let completionRecorded = true;
    try {
      const completed = await invokeAniListActionV2(supabaseClient, 'sync-complete');
      if (currentUser?.id !== uid) return false;
      anilistLastSyncedAt = completed.lastSyncedAt || new Date().toISOString();
    } catch {
      completionRecorded = false;
    }

    if (currentUser?.id !== uid) return false;
    anilistStatusUserId = uid;
    if (updatedCount > 0) {
      setAniListMessage(`Updated watched progress for ${updatedCount.toLocaleString()} existing anime${completionRecorded ? '.' : '; the progress is saved, but its sync time could not be recorded.'}`, completionRecorded ? 'success' : 'error');
    } else {
      setAniListMessage(`Nothing changed. ${matchedCount.toLocaleString()} existing ListR anime matched AniList progress; no new records were created.${completionRecorded ? '' : ' Sync time could not be recorded.'}`, completionRecorded ? 'success' : 'error');
    }
    if (!completionRecorded) anilistLastSyncedAt = null;
    updateAniListState('connected', { lastSyncedAt: anilistLastSyncedAt, username: anilistUsername });
    return true;
  } catch (error) {
    if (currentUser?.id !== uid) return false;
    if (String(error?.code || '') === 'anilist_reauthorization_required') {
      updateAniListState('error', { message: safeAniListErrorMessageV2(error), messageType: 'error' });
    } else {
      setAniListMessage(safeAniListErrorMessageV2(error), 'error');
    }
    return false;
  } finally {
    if (anilistSyncEpoch === runId) {
      anilistSyncing = false;
      if (currentUser?.id === uid) renderAniListPanel();
    }
  }
}

async function maybeAutoSyncAniList(userId) {
  const uid = String(userId);
  if (!currentUser || currentUser.id !== uid || !cloudLibraryReady || anilistConnectionState !== 'connected'
    || navigator.onLine === false || anilistSyncing || !shouldAutoSyncAniListV2(anilistLastSyncedAt)) return false;
  if (readOutbox(storage, uid).length) return false;
  return runAniListSync(uid, { automatic: true });
}

async function disconnectAniList() {
  if (!currentUser || !supabaseClient || anilistSyncing) return;
  if (!window.confirm('Disconnect the linked AniList account? Your ListR library and ListR sign-in will remain unchanged.')) return;
  const uid = currentUser.id;
  updateAniListState('connecting', { message: 'Disconnecting the AniList link…' });
  try {
    await invokeAniListActionV2(supabaseClient, 'disconnect');
    if (currentUser?.id !== uid) return;
    anilistStatusUserId = uid;
    updateAniListState('not_connected', { message: 'AniList is disconnected. Your ListR account, cloud library, and guest list are unchanged.' });
  } catch (error) {
    if (currentUser?.id === uid) updateAniListState('error', { message: safeAniListErrorMessageV2(error), messageType: 'error' });
  }
}

function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const registering = authMode === 'register';
  $('#auth-tab-login').classList.toggle('is-active', !registering);
  $('#auth-tab-register').classList.toggle('is-active', registering);
  $('#auth-tab-login').setAttribute('aria-selected', String(!registering));
  $('#auth-tab-register').setAttribute('aria-selected', String(registering));
  $('#confirm-password-field').hidden = !registering;
  $('#auth-confirm-password').required = registering;
  $('#auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-title').textContent = registering ? 'Create your account.' : 'Welcome back.';
  $('#auth-intro').textContent = registering ? 'Make an account to keep your anime library in sync across devices.' : 'Sign in to load your private library from the cloud.';
  $('#auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  setAuthMessage('');
}

function setAuthMessage(message, type = '') {
  const element = $('#auth-message');
  element.textContent = message;
  element.className = `auth-message ${type ? `is-${type}` : ''}`.trim();
}

function openAuthDialog(mode) {
  setAuthMode(mode);
  if (!supabaseClient) setAuthMessage('The account service is unavailable right now. You can continue using a guest list.', 'error');
  const dialog = $('#auth-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  $('#auth-email').focus();
}

function friendlyAuthError(error, mode) {
  const message = String(error?.message || '');
  if (/network|fetch|timeout|unavailable/i.test(message)) return 'Could not reach the account service. Check your connection and try again.';
  if (mode === 'login' && /not confirmed|confirm your email/i.test(message)) return 'Verify your email first, then sign in again.';
  if (mode === 'login') return 'Email or password did not match. If you just registered, verify your email first.';
  return message.length > 180 ? `${message.slice(0, 177)}…` : (message || 'Could not create the account. Please try again.');
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = $('#auth-email').value.trim().toLowerCase();
  const password = $('#auth-password').value;
  const confirmPassword = $('#auth-confirm-password').value;
  const validation = validateAuthFields({ mode: authMode, email, password, confirmPassword });
  if (validation) { setAuthMessage(validation, 'error'); return; }
  if (!supabaseClient) { setAuthMessage('Supabase could not be loaded. Refresh the page or continue as a guest.', 'error'); return; }

  const submit = $('#auth-submit');
  submit.disabled = true;
  setAuthMessage(authMode === 'register' ? 'Creating your account…' : 'Signing in…');
  try {
    if (authMode === 'register') {
      const redirectTo = new URL(window.location.pathname, window.location.origin).href;
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;
      $('#auth-password').value = '';
      $('#auth-confirm-password').value = '';
      if (data?.session && data?.user) {
        $('#auth-dialog').close();
        await activateUser(data.user);
        showToast(cloudLibraryReady ? 'Your account is ready and your private cloud library is loaded.' : 'Your account is ready. Check the sync status for cloud setup or connection details.');
      } else {
        setAuthMessage('Account created. Check your email to verify it; the confirmation link returns you here, then your cloud library will load.', 'success');
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $('#auth-dialog').close();
      if (data?.user) await activateUser(data.user);
      showToast(cloudLibraryReady ? 'Signed in. Your private cloud library is loaded.' : 'Signed in. Check the sync status for cloud setup or connection details.');
    }
  } catch (error) {
    setAuthMessage(friendlyAuthError(error, authMode), 'error');
  } finally {
    submit.disabled = false;
  }
}

async function signOut() {
  if (!supabaseClient) return;
  const button = $('#logout-button');
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    enterGuest();
    showToast('Signed out. Your guest list is separate from your cloud library.');
  } catch (error) {
    showToast(`Could not sign out: ${friendlyAuthError(error, 'login')}`);
  } finally {
    button.disabled = false;
  }
}

async function importGuestLibrary() {
  if (!currentUser || !cloudLibraryReady) return;
  const userId = currentUser.id;
  const guestEntries = readEntries(storage, STORE_KEY);
  const candidates = guestEntries.filter((entry) => !entries.has(String(entry.id)));
  if (!candidates.length) {
    rememberImportDismissal(userId);
    showToast('Every guest anime is already in this cloud library. Nothing was overwritten.');
    return;
  }
  for (const entry of candidates) {
    entries.set(String(entry.id), entry);
    const result = enqueueCloudOperation(storage, userId, {
      type: 'upsert', mediaId: entry.id, entry, ignoreDuplicates: true
    });
    if (!result.ok) {
      setSyncStatus('Import could not be queued. Check browser storage and retry.', 'error');
      showToast('The guest list is unchanged; browser storage could not queue the import.');
      render();
      return;
    }
  }
  persist();
  render();
  rememberImportDismissal(userId);
  setSyncStatus(`Importing ${candidates.length} new anime…`, 'pending');
  await flushCloudQueue(userId);
  if (currentUser?.id !== userId || readOutbox(storage, userId).length) return;
  try {
    const remote = await loadUserEntries(supabaseClient, userId);
    if (currentUser?.id !== userId) return;
    entries.clear();
    for (const entry of remote) entries.set(String(entry.id), entry);
    writeCloudCache(storage, userId, remote);
    render();
    updateMigrationBanner();
    showToast(`Imported ${candidates.length} anime. Your guest list remains on this browser.`);
  } catch (error) {
    setSyncStatus(`${cloudErrorMessage(error)} The queued import remains available for retry.`, 'error');
  }
}

async function initializeAccount() {
  if (!supabaseClient) { enterGuest('Supabase could not be loaded. Guest mode is available; sign-in needs the account service.'); return; }
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    supabaseClient.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (event === 'SIGNED_OUT') enterGuest();
        else if (session?.user) void activateUser(session.user);
      }, 0);
    });
    if (data?.session?.user) await activateUser(data.session.user);
    else enterGuest();
  } catch (error) {
    enterGuest(`Could not restore your cloud session: ${cloudErrorMessage(error)} Guest data remains separate.`);
  }
}

// ----------------------------- Mutations -----------------------------------
function addMedia(media, category) {
  const id = String(media.id);
  const existing = entries.get(id);
  if (existing) {
    showToast(`Already in ${categoryName(existing.category)} — duplicates are not added.`);
    renderResults();
    return false;
  }
  entries.set(id, createEntry(media, category));
  persistEntry(entries.get(id)); render();
  showToast(`${getTitle(media.title, id)} added to ${categoryName(category)}.`);
  return true;
}

function setWatched(id, rawValue) {
  const entry = entries.get(String(id));
  if (!entry || entry.category === 'interested') return;
  const number = Number(rawValue);
  const value = clampWatched(Number.isFinite(number) ? Math.floor(number) : 0, entry.meta?.episodes);
  entry.watched = value;
  persistEntry(entry); render();
}

function moveEntry(id, category) {
  const entry = entries.get(String(id));
  if (!entry || !CATEGORIES[category] || entry.category === category) return;
  entry.category = category;
  entry.watched = clampWatched(entry.watched, entry.meta?.episodes);
  persistEntry(entry); render();
  showToast(`Moved to ${categoryName(category)}.`);
}

// ----------------------------- Event handling ------------------------------
$('#open-login').addEventListener('click', () => openAuthDialog('login'));
$('#open-register').addEventListener('click', () => openAuthDialog('register'));
$('#auth-tab-login').addEventListener('click', () => setAuthMode('login'));
$('#auth-tab-register').addEventListener('click', () => setAuthMode('register'));
$('#close-auth').addEventListener('click', () => $('#auth-dialog').close());
$('#auth-dialog').addEventListener('close', () => {
  $('#auth-password').value = '';
  $('#auth-confirm-password').value = '';
});
$('#auth-form').addEventListener('submit', handleAuthSubmit);
$('#logout-button').addEventListener('click', signOut);
$('#import-guest').addEventListener('click', importGuestLibrary);
$('#dismiss-import').addEventListener('click', () => { if (currentUser) rememberImportDismissal(currentUser.id); });
$('#connect-anilist').addEventListener('click', connectAniList);
$('#sync-anilist').addEventListener('click', () => { if (currentUser) void runAniListSync(currentUser.id); });
$('#disconnect-anilist').addEventListener('click', disconnectAniList);
window.addEventListener('online', () => {
  if (!currentUser) return;
  if (!cloudLibraryReady) void activateUser(currentUser);
  else {
    const userId = currentUser.id;
    void flushCloudQueue(userId).then(() => initializeAniListForUser(userId, { forceStatus: true }));
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) void maybeAutoSyncAniList(currentUser.id);
});

$$('.nav-link').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
['open-search', 'hero-add', 'empty-add'].forEach((id) => $(`#${id}`).addEventListener('click', () => setView('search')));
$('#list-search').addEventListener('input', renderCollection);
$('#sort-order').addEventListener('change', renderCollection);
$('#refresh-metadata').addEventListener('click', refreshAllMetadata);
$('#add-category').addEventListener('change', renderResults);

$('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const term = $('#anime-query').value.trim();
  if (term.length < 2) { setSearchMessage('Enter at least two characters to search.', 'error'); return; }
  if (searchController) searchController.abort();
  searchController = new AbortController();
  const button = $('.search-submit');
  button.disabled = true;
  searchResults = [];
  renderResults();
  setSearchMessage('Searching AniList…');
  try {
    const found = await searchAnime(term, searchController.signal);
    const unique = new Map(found.filter((media) => media?.id != null).map((media) => [String(media.id), media]));
    searchResults = [...unique.values()];
    renderResults();
    setSearchMessage(searchResults.length ? `${searchResults.length} results for “${term}”.` : `No anime found for “${term}”. Try another title.`, searchResults.length ? '' : '');
  } catch (error) {
    if (error.name !== 'AbortError') setSearchMessage(error.message || 'Search failed. Your saved list is still available.', 'error');
  } finally {
    button.disabled = false;
  }
});

searchResultsEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="add-result"]');
  if (!button) return;
  const media = searchResults.find((item) => String(item.id) === button.dataset.id);
  if (media) addMedia(media, $('#add-category').value);
  renderResults();
});

collectionGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const entry = entries.get(String(button.dataset.id));
  if (!entry) return;
  const total = entry.meta?.episodes;
  if (button.dataset.action === 'increase') setWatched(entry.id, (entry.watched || 0) + 1);
  if (button.dataset.action === 'decrease') setWatched(entry.id, (entry.watched || 0) - 1);
  if (button.dataset.action === 'remove') {
    entries.delete(String(entry.id)); persistDeletedEntry(entry.id); render(); showToast(`${titleOf(entry)} removed from your list.`);
  }
});

collectionGrid.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.action === 'move') moveEntry(target.dataset.id, target.value);
  if (target.dataset.action === 'edit-count') setWatched(target.dataset.id, target.value);
});

collectionGrid.addEventListener('keydown', (event) => {
  if (event.target.matches('[data-action="edit-count"]') && event.key === 'Enter') {
    event.preventDefault(); event.target.blur();
  }
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'add') setView('search');
  else if (hash === 'stats') setView('stats');
  else if (CATEGORIES[hash]) setView(hash);
});

// ----------------------------- Initial render ------------------------------
const initialHash = window.location.hash.replace('#', '');
if (initialHash === 'add') activeView = 'search';
else if (initialHash === 'stats') activeView = 'stats';
else if (CATEGORIES[initialHash]) activeView = initialHash;
const authCallbackInUrl = /(?:access_token|code|error|error_description)=/.test(`${window.location.search}&${window.location.hash}`);
setView(activeView, { updateHash: !authCallbackInUrl });
render();
void initializeAccount();
