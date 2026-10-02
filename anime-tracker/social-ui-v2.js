import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config.js';
import {
  getMyProfileV2,
  listFriendsV2,
  normalizeUsernameV2,
  respondFriendRequestV2,
  searchListRUsersV2,
  sendFriendRequestV2,
  setUsernameV2,
  socialErrorMessageV2,
} from './social-v2.js';

const client = window.supabase?.createClient && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const $ = (id) => document.getElementById(id);
let profile = null;
let friends = [];
let usernamePromptOpen = false;

function message(text, type = '') {
  const el = $('friends-message');
  if (!el) return;
  el.textContent = text;
  el.dataset.type = type;
}

function showUsernamePrompt(force = false) {
  const dialog = $('username-dialog');
  if (!dialog || profile?.username || (!force && usernamePromptOpen)) return;
  usernamePromptOpen = true;
  const input = $('profile-username');
  const msg = $('username-message');
  if (msg) msg.textContent = '';
  if (input) input.value = '';
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => input?.focus());
}

function hideUsernamePrompt() {
  usernamePromptOpen = false;
  const dialog = $('username-dialog');
  if (dialog?.open) dialog.close();
}

async function loadProfile({ prompt = false } = {}) {
  if (!client) return null;
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user) {
    profile = null;
    $('edit-username')?.setAttribute('hidden', '');
    return null;
  }
  try {
    profile = await getMyProfileV2(client);
    if (profile?.username) {
      $('edit-username')?.removeAttribute('hidden');
      message(`Signed in as ${profile.username}. Search for a friend by username.`);
    } else {
      $('edit-username')?.removeAttribute('hidden');
      message('Choose a username to use Friends.');
      if (prompt) showUsernamePrompt(true);
    }
  } catch (error) {
    message(socialErrorMessageV2(error), 'error');
  }
  return profile;
}

function renderSearchResults(results) {
  const root = $('friend-search-results');
  if (!root) return;
  if (!results.length) {
    root.innerHTML = '<p class="social-empty">No ListR users found.</p>';
    return;
  }
  root.innerHTML = results.map((row) => {
    const relationship = row.relationship || 'none';
    const action = relationship === 'accepted'
      ? '<span class="social-status">Friends</span>'
      : relationship === 'pending'
        ? '<span class="social-status">Request pending</span>'
        : `<button class="button button-primary social-add-friend" type="button" data-user-id="${row.user_id}" data-username="${row.username}">Add Friend</button>`;
    return `<article class="social-item"><div><strong>@${row.username}</strong></div><div>${action}</div></article>`;
  }).join('');
}

function renderFriends(rows) {
  const incoming = $('incoming-friends');
  const list = $('friends-list');
  if (!incoming || !list) return;
  const pending = rows.filter((row) => row.status === 'pending' && row.incoming);
  const accepted = rows.filter((row) => row.status === 'accepted');
  incoming.innerHTML = pending.length ? pending.map((row) => `<article class="social-item"><div><strong>@${row.username}</strong><small>Friend request</small></div><div class="social-actions"><button class="button button-primary social-accept" type="button" data-id="${row.friendship_id}">Accept</button><button class="button button-quiet social-decline" type="button" data-id="${row.friendship_id}">Decline</button></div></article>`).join('') : '<p class="social-empty">No incoming requests.</p>';
  list.innerHTML = accepted.length ? accepted.map((row) => `<article class="social-item"><div><strong>@${row.username}</strong></div><span class="social-status">Friends</span></article>`).join('') : '<p class="social-empty">No friends yet. Click Add Friend to find someone.</p>';
}

async function refreshFriends() {
  if (!client || !profile?.username) {
    if (!profile?.username) showUsernamePrompt(true);
    return;
  }
  try {
    friends = await listFriendsV2(client);
    renderFriends(friends);
  } catch (error) {
    message(socialErrorMessageV2(error), 'error');
  }
}

function openFriendSearch() {
  if (!profile?.username) {
    showUsernamePrompt(true);
    return;
  }
  const input = $('friend-query');
  input?.focus();
  document.getElementById('friend-search-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('username-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('profile-username');
  const msg = $('username-message');
  const button = $('username-submit');
  if (!input || !client) return;
  button.disabled = true;
  if (msg) msg.textContent = 'Saving username…';
  try {
    profile = await setUsernameV2(client, input.value);
    if (msg) msg.textContent = `Username saved as @${profile.username}.`;
    hideUsernamePrompt();
    message(`Signed in as ${profile.username}. Search for a friend by username.`, 'ok');
    await refreshFriends();
  } catch (error) {
    if (msg) msg.textContent = socialErrorMessageV2(error);
  } finally {
    button.disabled = false;
  }
});

$('close-username')?.addEventListener('click', hideUsernamePrompt);
$('edit-username')?.addEventListener('click', () => showUsernamePrompt(true));
$('add-friend')?.addEventListener('click', openFriendSearch);
$('refresh-friends')?.addEventListener('click', refreshFriends);

$('friend-search-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!profile?.username) return showUsernamePrompt(true);
  const input = $('friend-query');
  if (!input) return;
  const query = normalizeUsernameV2(input.value);
  if (query.length < 3) return message('Enter at least 3 characters of a username.');
  message('Searching…');
  try {
    friendSearchResults = await searchListRUsersV2(client, query);
    renderSearchResults(friendSearchResults);
    message(friendSearchResults.length ? `${friendSearchResults.length} user${friendSearchResults.length === 1 ? '' : 's'} found.` : 'No matching users found.');
  } catch (error) {
    message(socialErrorMessageV2(error), 'error');
  }
});

document.addEventListener('click', async (event) => {
  const add = event.target.closest('.social-add-friend');
  if (add) {
    add.disabled = true;
    try {
      await sendFriendRequestV2(client, add.dataset.userId);
      add.outerHTML = '<span class="social-status">Request sent</span>';
      message(`Friend request sent to @${add.dataset.username}.`, 'ok');
    } catch (error) {
      add.disabled = false;
      message(socialErrorMessageV2(error), 'error');
    }
    return;
  }
  const response = event.target.closest('.social-accept, .social-decline');
  if (response) {
    response.disabled = true;
    try {
      await respondFriendRequestV2(client, response.dataset.id, response.classList.contains('social-accept'));
      await refreshFriends();
    } catch (error) {
      response.disabled = false;
      message(socialErrorMessageV2(error), 'error');
    }
  }
});

document.querySelector('[data-view="friends"]')?.addEventListener('click', async () => {
  const p = await loadProfile({ prompt: true });
  if (p?.username) await refreshFriends();
});

if (client) {
  client.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      profile = null;
      usernamePromptOpen = false;
      return;
    }
    setTimeout(() => { void loadProfile({ prompt: true }); }, 0);
  });
  void loadProfile({ prompt: true });
}
