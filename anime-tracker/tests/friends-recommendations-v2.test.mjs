import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  dismissRecommendationV2,
  getFriendStatsV2,
  getMyProfileV2,
  listFriendsV2,
  listReceivedRecommendationsV2,
  respondFriendRequestV2,
  searchListRUsersV2,
  sendFriendRequestV2,
  setUsernameV2,
  socialErrorMessageV2,
  unfriendV2,
  validateUsernameV2,
} from '../social-v2.js';
import { AniListIntegrationError, completeRecommendationAcceptanceV2, ensureAniListPlanning, fetchAniListAnimeById } from '../../supabase/functions/_shared/anilist-v2.mjs';

const validMedia = {
  id: 31415,
  type: 'ANIME',
  isAdult: false,
  title: { userPreferred: 'A Test Series', romaji: 'Test Series', english: 'A Test Series', native: 'テスト' },
  coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/test.jpg' },
  episodes: 12,
  duration: 24,
  season: 'SPRING',
  seasonYear: 2025,
  format: 'TV',
  description: 'Description',
  siteUrl: 'https://anilist.co/anime/31415',
};

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function mockClient(handler) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve(handler(name, args));
    },
  };
}

test('usernames normalize case/whitespace and allow special characters within 3–20 characters', () => {
  assert.deepEqual(validateUsernameV2('  Anime_Fan7! '), { ok: true, username: 'anime_fan7!', message: '' });
  assert.deepEqual(validateUsernameV2('@My.Name-2'), { ok: true, username: '@my.name-2', message: '' });
  for (const bad of ['', 'ab', 'with space', 'x'.repeat(21), 'line\nbreak']) assert.equal(validateUsernameV2(bad).ok, false, bad);
});

test('profile RPC returns only own user_id and canonical username', async () => {
  const client = mockClient((name) => ({ data: [{ user_id: 'owner-1', username: 'ownername' }], error: null }));
  assert.deepEqual(await getMyProfileV2(client), { user_id: 'owner-1', username: 'ownername' });
  assert.equal(client.calls[0].name, 'get_my_list_r_profile_v2');
});

test('username creation always normalizes before the unique database RPC', async () => {
  const client = mockClient((name, args) => ({ data: [{ user_id: 'owner-1', username: args.p_username }], error: null }));
  assert.equal((await setUsernameV2(client, '  MyName_2 ')).username, 'myname_2');
  assert.deepEqual(client.calls[0], { name: 'set_list_r_profile_username_v2', args: { p_username: 'myname_2' } });
  const duplicate = mockClient(() => ({ data: null, error: { code: '23505', message: 'duplicate key' } }));
  await assert.rejects(setUsernameV2(duplicate, 'taken'), { code: '23505' });
  assert.equal((await setUsernameV2(client, '  Cool.Name-2! ')).username, 'cool.name-2!');
  await assert.rejects(setUsernameV2(client, 'bad name'), { code: 'invalid_username' });
});

test('user search is username-prefix-only and requests no email or private profile fields', async () => {
  const client = mockClient((name, args) => ({ data: [{ user_id: 'other-2', username: 'friend_2', relationship: 'none' }], error: null }));
  assert.deepEqual(await searchListRUsersV2(client, 'FRI'), [{ user_id: 'other-2', username: 'friend_2', relationship: 'none' }]);
  assert.deepEqual(client.calls[0], { name: 'search_list_r_users_v2', args: { p_username_prefix: 'fri' } });
  assert.deepEqual(await searchListRUsersV2(client, 'ab'), []);
  assert.equal(client.calls.length, 1);
});

test('friend requests reject missing IDs locally and send to the owner-scoped database RPC', async () => {
  const client = mockClient(() => ({ data: [{ friendship_id: 'f1', status: 'pending' }], error: null }));
  await assert.rejects(sendFriendRequestV2(client, ''), /username first/i);
  assert.deepEqual(await sendFriendRequestV2(client, 'target-2'), { friendship_id: 'f1', status: 'pending' });
  assert.deepEqual(client.calls[0], { name: 'send_list_r_friend_request_v2', args: { p_target_user_id: 'target-2' } });
});

test('friend inbox and unfriend APIs use relationship-scoped server RPCs', async () => {
  const client = mockClient((name) => {
    if (name === 'list_list_r_friends_v2') return { data: [{ friendship_id: 'f1', friend_user_id: 'friend-1', username: 'friend1', status: 'accepted' }], error: null };
    if (name === 'respond_list_r_friend_request_v2') return { data: 'accepted', error: null };
    return { data: true, error: null };
  });
  assert.equal((await listFriendsV2(client)).length, 1);
  assert.equal(await respondFriendRequestV2(client, 'f1', true), 'accepted');
  assert.equal(await unfriendV2(client, 'f1'), true);
  assert.equal(client.calls[1].name, 'respond_list_r_friend_request_v2');
  assert.equal(client.calls[2].name, 'remove_list_r_friend_v2');
});

test('friend statistics require one selected accepted friend and expose aggregate stats only', async () => {
  const client = mockClient((name, args) => ({ data: [{ total_anime: 3, watching: 1, completed: 1, interested: 1, watched_episodes: 15, watched_minutes: 360 }], error: null }));
  assert.deepEqual(await getFriendStatsV2(client, 'friend-1'), {
    total_anime: 3, watching: 1, completed: 1, interested: 1, watched_episodes: 15, watched_minutes: 360,
  });
  assert.deepEqual(client.calls[0], { name: 'get_list_r_friend_stats_v2', args: { p_friend_user_id: 'friend-1' } });
  const denied = mockClient(() => ({ data: null, error: { code: '42501', message: 'friend required' } }));
  await assert.rejects(getFriendStatsV2(denied, 'not-friend'), { code: '42501' });
});

test('recommendation inbox only uses recipient-scoped RPC and dismissal cannot invoke acceptance', async () => {
  const client = mockClient((name) => ({ data: name === 'list_received_list_r_recommendations_v2'
    ? [{ recommendation_id: 'r1', sender_user_id: 'sender-1', sender_username: 'friend1', anilist_media_id: 31415, anime_metadata: validMedia, status: 'pending', created_at: '2026-10-01T12:00:00Z' }]
    : 'dismissed', error: null }));
  assert.equal((await listReceivedRecommendationsV2(client)).length, 1);
  assert.equal(await dismissRecommendationV2(client, 'r1'), 'dismissed');
  assert.equal(client.calls[0].name, 'list_received_list_r_recommendations_v2');
  assert.equal(client.calls[1].name, 'act_on_list_r_recommendation_v2');
  assert.equal(client.calls[1].args.p_action, 'dismiss');
  assert.equal(JSON.stringify(client.calls).includes('email'), false);
});

test('username and friendship uniqueness errors are communicated without exposing profile emails', () => {
  assert.match(socialErrorMessageV2({ code: '23505' }), /already exists/i);
  assert.match(socialErrorMessageV2({ code: '42501' }), /not allowed/i);
  assert.match(socialErrorMessageV2({ code: 'PGRST202' }), /migration/i);
});

test('AniList anime is re-fetched by canonical ID and rejects adult/mismatched media', async () => {
  let requestBody;
  const media = await fetchAniListAnimeById(31415, async (url, options) => {
    assert.equal(url, 'https://graphql.anilist.co');
    requestBody = JSON.parse(options.body);
    return jsonResponse({ data: { Media: validMedia } });
  });
  assert.equal(media.id, 31415);
  assert.match(requestBody.query, /Media\(id: \$id, type: ANIME\)/);
  assert.deepEqual(requestBody.variables, { id: 31415 });

  await assert.rejects(fetchAniListAnimeById(31415, async () => jsonResponse({ data: { Media: { ...validMedia, isAdult: true } } })), { code: 'invalid_recommendation_anime' });
  await assert.rejects(fetchAniListAnimeById(0, async () => { throw new Error('must not fetch'); }), { code: 'invalid_recommendation_anime' });
  await assert.rejects(fetchAniListAnimeById(31415, async () => jsonResponse({ data: { Media: { ...validMedia, id: 41 } } })), { code: 'invalid_recommendation_anime' });
});

test('recommendation acceptance does not duplicate an existing AniList PLANNING entry', async () => {
  const calls = [];
  const result = await ensureAniListPlanning('server-token', 9001, 31415, async (_url, options) => {
    const payload = JSON.parse(options.body);
    calls.push(payload);
    return jsonResponse({ data: { MediaListCollection: { lists: [{ entries: [{ mediaId: 31415, status: 'PLANNING' }] }] } } });
  });
  assert.deepEqual(result, { state: 'already_planning', mediaId: 31415 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /MediaListCollection/);
});

test('explicit recommendation acceptance uses SaveMediaListEntry status PLANNING only when needed', async () => {
  const calls = [];
  const result = await ensureAniListPlanning('server-token', 9001, 31415, async (_url, options) => {
    const payload = JSON.parse(options.body);
    calls.push(payload);
    if (calls.length === 1) return jsonResponse({ data: { MediaListCollection: { lists: [{ entries: [{ mediaId: 222, status: 'CURRENT' }] }] } } });
    return jsonResponse({ data: { SaveMediaListEntry: { id: 700, mediaId: 31415, status: 'PLANNING' } } });
  });
  assert.deepEqual(result, { state: 'added_to_planning', mediaId: 31415 });
  assert.equal(calls.length, 2);
  assert.match(calls[1].query, /SaveMediaListEntry/);
  assert.deepEqual(calls[1].variables, { mediaId: 31415, status: 'PLANNING' });
});

test('AniList mutation errors and missing confirmations fail recommendation acceptance', async () => {
  let count = 0;
  await assert.rejects(ensureAniListPlanning('token', 9001, 31415, async () => {
    count += 1;
    if (count === 1) return jsonResponse({ data: { MediaListCollection: { lists: [] } } });
    return jsonResponse({ errors: [{ message: 'denied' }] });
  }), { code: 'anilist_query_failed' });

  count = 0;
  await assert.rejects(ensureAniListPlanning('token', 9001, 31415, async () => {
    count += 1;
    if (count === 1) return jsonResponse({ data: { MediaListCollection: { lists: [] } } });
    return jsonResponse({ data: { SaveMediaListEntry: null } });
  }), { code: 'anilist_planning_write_failed' });

  const limited = new AniListIntegrationError('anilist_rate_limited', 'wait', { status: 429, retryAfter: '2' });
  assert.equal(limited.retryAfter, 2);
});

test('acceptance persists ListR Interested first, then confirms AniList Planning, then finalizes the recipient inbox', async () => {
  const order = [];
  const result = await completeRecommendationAcceptanceV2({
    mediaId: 31415,
    persistInterested: async () => { order.push('list_r_interested'); return { ok: true, alreadyInListR: false }; },
    addToAniListPlanning: async () => { order.push('anilist_planning'); return { state: 'added_to_planning', mediaId: 31415 }; },
    finalizeRecommendation: async () => { order.push('recipient_finalize'); return 'accepted'; },
  });
  assert.deepEqual(order, ['list_r_interested', 'anilist_planning', 'recipient_finalize']);
  assert.deepEqual(result, { state: 'accepted', mediaId: 31415, anilistState: 'added_to_planning', alreadyInListR: false, existingCategory: null });
});

test('failed ListR persistence stops before AniList and leaves the recommendation unfinalized', async () => {
  const order = [];
  await assert.rejects(completeRecommendationAcceptanceV2({
    mediaId: 31415,
    persistInterested: async () => { order.push('list_r_interested'); return { ok: false }; },
    addToAniListPlanning: async () => { order.push('must_not_write_anilist'); return { state: 'added_to_planning', mediaId: 31415 }; },
    finalizeRecommendation: async () => { order.push('must_not_finalize'); return 'accepted'; },
  }), { code: 'list_r_save_failed' });
  assert.deepEqual(order, ['list_r_interested']);
});

test('AniList failure keeps the saved ListR item retryable and does not mark the recommendation accepted', async () => {
  const order = [];
  await assert.rejects(completeRecommendationAcceptanceV2({
    mediaId: 31415,
    existingCategory: 'completed',
    persistInterested: async () => { order.push('list_r_duplicate_safe_upsert'); return { ok: true, alreadyInListR: true, existingCategory: 'completed' }; },
    addToAniListPlanning: async () => { order.push('anilist_planning'); throw new AniListIntegrationError('anilist_rate_limited', 'AniList temporarily unavailable.', { status: 429, retryAfter: 4 }); },
    finalizeRecommendation: async () => { order.push('must_not_finalize'); return 'accepted'; },
  }), (error) => error.code === 'recommendation_anilist_write_failed'
    && error.retryAfter === 4
    && /saved in your ListR Interested list with any existing progress and metadata preserved/u.test(error.message));
  assert.deepEqual(order, ['list_r_duplicate_safe_upsert', 'anilist_planning']);
});

test('existing anime handling is duplicate-safe and finalization failure is recoverable/idempotent', async () => {
  const order = [];
  await assert.rejects(completeRecommendationAcceptanceV2({
    mediaId: 31415,
    existingCategory: 'watching',
    persistInterested: async () => { order.push({ operation: 'upsert', ignoreDuplicates: true, category: 'interested' }); return { ok: true, alreadyInListR: true, existingCategory: 'watching' }; },
    addToAniListPlanning: async () => { order.push('planning-confirmed'); return { state: 'already_planning', mediaId: 31415 }; },
    finalizeRecommendation: async () => { order.push('finalization'); return null; },
  }), (error) => error.code === 'recommendation_finalize_failed' && /already on AniList Planning/u.test(error.message));
  assert.deepEqual(order, [
    { operation: 'upsert', ignoreDuplicates: true, category: 'interested' },
    'planning-confirmed', 'finalization',
  ]);
});

test('only the received-recommendation acceptance handler can write AniList; normal tracker functions stay one-way', async () => {
  const app = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  const edge = await readFile(new URL('../../supabase/functions/anilist-account-v2/index.ts', import.meta.url), 'utf8');
  const helper = await readFile(new URL('../../supabase/functions/_shared/anilist-v2.mjs', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../supabase/migrations/202610020003_friends_recommendations_v2.sql', import.meta.url), 'utf8');
  assert.equal((edge.match(/ensureAniListPlanning\(/gu) || []).length, 1);
  assert.match(edge, /async function actionAcceptRecommendation[\s\S]*ensureAniListPlanning\(/u);
  assert.match(helper, /SaveMediaListEntry[\s\S]*status: 'PLANNING'/u);
  assert.match(edge, /category: 'interested'[\s\S]*onConflict: 'user_id,anilist_media_id', ignoreDuplicates: true/u);
  assert.match(edge, /\.update\(\{ category: 'interested' \}\)[\s\S]*\.eq\('user_id', userId\)[\s\S]*\.eq\('anilist_media_id', mediaId\)/u);
  assert.doesNotMatch(app, /SaveMediaListEntry|UpdateMediaListEntries|DeleteMediaListEntry/u);
  assert.match(app, /invokeAniListActionV2\(supabaseClient, 'accept-recommendation'/u);
  assert.match(migration, /unique index if not exists list_r_profiles_v2_username_unique[\s\S]*on public\.list_r_profiles_v2 \(username\)/u);
  assert.match(migration, /create or replace function public\.get_list_r_friend_stats_v2[\s\S]*status = 'accepted'/u);
  assert.match(migration, /where r\.recipient_id = v_uid and r\.status = 'pending'/u);
  assert.match(migration, /grant execute on function public\.finalize_list_r_recommendation_v2[\s\S]*to service_role/u);
  assert.doesNotMatch(migration, /grant execute on function public\.finalize_list_r_recommendation_v2[^;]*to authenticated/u);
});


test('profile dropdown closes outside and recommendation composer selects before explicit send', async () => {
  const app = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../account.css', import.meta.url), 'utf8');
  assert.match(html, /id="profile-menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="profile-dropdown"/u);
  for (const view of ['stats', 'friends', 'recommendations']) assert.match(html, new RegExp(`class="profile-dropdown-link"[^>]*data-view="${view}"`, 'u'));
  assert.match(app, /document\.addEventListener\('click',[\s\S]*?setProfileMenuOpen\(false\)/u);
  assert.match(app, /document\.addEventListener\('keydown',[\s\S]*?event\.key === 'Escape'[\s\S]*?setProfileMenuOpen\(false/u);
  assert.match(html, /id="recommend-search-results" class="recommend-results"/u);
  assert.equal((html.match(/id="send-recommendation"/gu) || []).length, 1);
  assert.match(app, /data-recommendation-search-action="select"/u);
  assert.ok(app.includes("$('#send-recommendation').addEventListener('click', () => { void sendAnimeRecommendation(); });"));
  assert.match(app, /async function sendAnimeRecommendation\(\)[\s\S]*?const media = selectedRecommendationMedia/u);
  assert.match(css, /\.recommend-dialog \.recommend-results\{[^}]*overflow-y:auto/u);
});