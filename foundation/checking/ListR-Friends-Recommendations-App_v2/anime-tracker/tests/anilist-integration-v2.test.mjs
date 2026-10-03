import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ANILIST_AUTHORIZE_URL,
  ANILIST_GRAPHQL_URL,
  ANILIST_TOKEN_URL,
  AniListIntegrationError,
  buildAniListAuthorizationUrl,
  constantTimeEqual,
  createOAuthState,
  exchangeAniListCode,
  fetchAniListMediaProgress,
  getAniListViewer,
  hashOAuthState,
  normalizeAniListProgress,
} from '../../supabase/functions/_shared/anilist-v2.mjs';
import {
  ANILIST_AUTO_SYNC_INTERVAL_MS_V2,
  ANILIST_EDGE_FUNCTION_V2,
  canUseAniListV2,
  clearAniListOAuthAttemptV2,
  invokeAniListActionV2,
  isPotentialAniListOAuthReturnV2,
  readAniListCallbackV2,
  readAniListOAuthAttemptV2,
  removeAniListCallbackParamsV2,
  safeAniListErrorMessageV2,
  shouldAutoSyncAniListV2,
  storeAniListOAuthAttemptV2,
  validateProgressResponseV2,
} from '../anilist-integration-v2.js';

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers[key] ?? headers[key.toLowerCase()] ?? null },
    json: async () => payload,
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

test('OAuth state has cryptographic entropy, is hashed server-side, and authorization uses the documented code endpoint', async () => {
  const left = createOAuthState(webcrypto);
  const right = createOAuthState(webcrypto);
  assert.equal(left.length, 43);
  assert.notEqual(left, right);
  const digest = await hashOAuthState(left, webcrypto);
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(constantTimeEqual(digest, await hashOAuthState(left, webcrypto)), true);
  assert.equal(constantTimeEqual(digest, await hashOAuthState(right, webcrypto)), false);

  const url = new URL(buildAniListAuthorizationUrl({ clientId: 'client-public-id', redirectUri: 'https://s4fire.github.io/ListR-Online/', state: left }));
  assert.equal(url.origin + url.pathname, ANILIST_AUTHORIZE_URL);
  assert.equal(url.searchParams.get('client_id'), 'client-public-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://s4fire.github.io/ListR-Online/');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), left);
  assert.equal(url.searchParams.has('scope'), false);
  assert.equal(url.searchParams.has('client_secret'), false);
});

test('Authorization Code exchange posts only to AniList documented endpoint and never adds credentials to the URL', async () => {
  let request;
  const token = await exchangeAniListCode({
    code: 'single-use-code',
    clientId: 'public-id',
    clientSecret: 'server-only-secret',
    redirectUri: 'https://s4fire.github.io/ListR-Online/',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ access_token: 'private-token' });
    },
  });
  assert.equal(token, 'private-token');
  assert.equal(request.url, ANILIST_TOKEN_URL);
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {
    grant_type: 'authorization_code',
    client_id: 'public-id',
    client_secret: 'server-only-secret',
    redirect_uri: 'https://s4fire.github.io/ListR-Online/',
    code: 'single-use-code',
  });
});

test('connection verification queries the authorized AniList Viewer with a Bearer token', async () => {
  let request;
  const viewer = await getAniListViewer('server-token', async (url, options) => {
    request = { url, options };
    return jsonResponse({ data: { Viewer: { id: 414, name: 'ListRUser' } } });
  });
  assert.deepEqual(viewer, { id: 414, name: 'ListRUser' });
  assert.equal(request.url, ANILIST_GRAPHQL_URL);
  assert.equal(request.options.headers.Authorization, 'Bearer server-token');
  assert.match(JSON.parse(request.options.body).query, /Viewer\s*\{\s*id\s+name\s*\}/u);
});

test('full anime collection queries the verified AniList user ID and includes custom-list entries', async () => {
  let request;
  const progress = await fetchAniListMediaProgress('server-only-token', 414, async (url, options) => {
    request = { url, options };
    return jsonResponse({ data: { MediaListCollection: { lists: [
      { isCustomList: false, entries: [{ mediaId: 71, progress: 4, updatedAt: 10 }, { mediaId: 72, progress: 0, updatedAt: 2 }] },
      { isCustomList: true, entries: [{ mediaId: 73, progress: 9, updatedAt: 3 }] },
    ] } } });
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, ANILIST_GRAPHQL_URL);
  assert.equal(request.options.headers.Authorization, 'Bearer server-only-token');
  assert.equal(body.variables.userId, 414);
  assert.equal(body.variables.type, 'ANIME');
  assert.match(body.query, /MediaListCollection\(userId: \$userId, type: \$type\)/u);
  assert.match(body.query, /isCustomList/u);
  assert.match(body.query, /entries \{ mediaId progress updatedAt \}/u);
  assert.deepEqual(progress, [{ mediaId: 71, progress: 4 }, { mediaId: 72, progress: 0 }, { mediaId: 73, progress: 9 }]);
});

test('progress normalization deduplicates media IDs by latest update and skips null progress instead of resetting it', () => {
  const normalized = normalizeAniListProgress({ lists: [
    { entries: [
      { mediaId: 10, progress: 2, updatedAt: 10 },
      { mediaId: 11, progress: null, updatedAt: 20 },
      { mediaId: 12, progress: 0, updatedAt: 2 },
    ] },
    { entries: [
      { mediaId: 10, progress: 7, updatedAt: 11 },
      { mediaId: 10, progress: 1, updatedAt: 8 },
      { mediaId: 11, progress: 5, updatedAt: 21 },
    ] },
  ] });
  assert.deepEqual(normalized, [{ mediaId: 10, progress: 7 }, { mediaId: 11, progress: 5 }, { mediaId: 12, progress: 0 }]);
});

test('malformed AniList list structures or IDs fail closed before any ListR update', () => {
  assert.throws(() => normalizeAniListProgress({}), (error) => error instanceof AniListIntegrationError && error.code === 'anilist_malformed_response');
  assert.throws(() => normalizeAniListProgress({ lists: [{ entries: [{ mediaId: -1, progress: 4 }] }] }), /invalid media ID/u);
  assert.throws(() => normalizeAniListProgress({ lists: [{ entries: [{ mediaId: 1, progress: -1 }] }] }), /invalid episode count/u);
});

test('AniList 429 propagates Retry-After and the current account rate-limit error', async () => {
  await assert.rejects(
    fetchAniListMediaProgress('token', 414, async () => jsonResponse({ errors: [{ message: 'Too Many Requests.' }] }, 429, { 'Retry-After': '60' })),
    (error) => error.code === 'anilist_rate_limited' && error.status === 429 && error.retryAfter === 60,
  );
  await assert.rejects(
    fetchAniListMediaProgress('token', 414, async () => ({ ok: false, status: 429, headers: { get: () => '45' }, json: async () => { throw new Error('not JSON'); } })),
    (error) => error.code === 'anilist_rate_limited' && error.retryAfter === 45,
  );
  const retryDate = new Date(Date.now() + 90_000).toUTCString();
  await assert.rejects(
    fetchAniListMediaProgress('token', 414, async () => ({ ok: false, status: 429, headers: { get: () => retryDate }, json: async () => { throw new Error('not JSON'); } })),
    (error) => error.code === 'anilist_rate_limited' && error.retryAfter > 0 && error.retryAfter <= 90,
  );
  assert.match(safeAniListErrorMessageV2({ code: 'anilist_rate_limited', retryAfter: 60 }), /60 seconds/u);
});

test('revoked authorization, GraphQL errors, and unreachable AniList are explicit failures', async () => {
  await assert.rejects(fetchAniListMediaProgress('token', 414, async () => jsonResponse({}, 401)), (error) => error.code === 'anilist_reauthorization_required');
  await assert.rejects(fetchAniListMediaProgress('token', 414, async () => jsonResponse({ errors: [{ message: 'private provider detail' }] })), (error) => error.code === 'anilist_query_failed' && !error.message.includes('private provider detail'));
  await assert.rejects(fetchAniListMediaProgress('token', 414, async () => { throw new Error('offline'); }), (error) => error.code === 'anilist_unavailable');
  await assert.rejects(exchangeAniListCode({ code: 'x', clientId: 'id', clientSecret: 's', redirectUri: 'https://example.invalid/', fetchImpl: async () => jsonResponse({ error: 'invalid_grant' }, 400) }), (error) => error.code === 'anilist_token_exchange_failed');
});

test('OAuth callback accepts only the same tab/user and exact state; denial is handled without code exchange', () => {
  const storage = memoryStorage();
  const state = 'a'.repeat(43);
  assert.equal(storeAniListOAuthAttemptV2(storage, { state, userId: 'list-r-user-a' }), true);
  assert.deepEqual(readAniListOAuthAttemptV2(storage), { state, userId: 'list-r-user-a' });
  assert.deepEqual(readAniListCallbackV2({ search: `?code=one-time-code&state=${state}` }, storage), {
    kind: 'code', code: 'one-time-code', state, expectedUserId: 'list-r-user-a',
  });
  assert.deepEqual(readAniListCallbackV2({ search: `?error=access_denied&state=${state}` }, storage), {
    kind: 'denied', state, expectedUserId: 'list-r-user-a',
  });
  assert.equal(readAniListCallbackV2({ search: `?code=attacker-code&state=${'b'.repeat(43)}` }, storage).kind, 'invalid_state');
  assert.equal(readAniListCallbackV2({ search: '?code=missing-state' }, storage).kind, 'invalid_state');
});

test('AniList code/state redirects are distinguished from normal Supabase email callbacks', () => {
  assert.equal(isPotentialAniListOAuthReturnV2({ search: '?code=anilist-code&state=opaque-state' }), true);
  assert.equal(isPotentialAniListOAuthReturnV2({ search: '?error=access_denied&state=opaque-state' }), true);
  assert.equal(isPotentialAniListOAuthReturnV2({ search: '?code=supabase-email-code&type=signup' }), false);
  assert.equal(isPotentialAniListOAuthReturnV2({ search: '?token_hash=confirmation&type=signup' }), false);
});

test('pending OAuth markers expire, clear cleanly, and callback parameters are scrubbed from browser history', () => {
  const storage = memoryStorage();
  const state = 'c'.repeat(43);
  storeAniListOAuthAttemptV2(storage, { state, userId: 'user-a' });
  const historyCalls = [];
  const url = new URL('https://s4fire.github.io/ListR-Online/?code=secret-code&state=state-value&error_description=ignored#watching');
  removeAniListCallbackParamsV2(url, { state: { page: 1 }, replaceState: (...args) => historyCalls.push(args) });
  assert.equal(historyCalls[0][2], '/ListR-Online/#watching');
  clearAniListOAuthAttemptV2(storage);
  assert.equal(readAniListOAuthAttemptV2(storage), null);
});

test('automatic refresh is event/cooldown based at 15 minutes, not a polling loop', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  assert.equal(ANILIST_AUTO_SYNC_INTERVAL_MS_V2, 15 * 60 * 1000);
  assert.equal(shouldAutoSyncAniListV2(null, now), true);
  assert.equal(shouldAutoSyncAniListV2(new Date(now - 14 * 60 * 1000).toISOString(), now), false);
  assert.equal(shouldAutoSyncAniListV2(new Date(now - 15 * 60 * 1000).toISOString(), now), true);
  assert.equal(shouldAutoSyncAniListV2(new Date(now + 1000).toISOString(), now), false);
});

test('browser validates a unique sanitized progress response before calling the RLS RPC', () => {
  assert.deepEqual(validateProgressResponseV2({ entries: [{ mediaId: 10, progress: 3 }, { mediaId: 11, progress: 0 }] }), [
    { mediaId: 10, progress: 3 }, { mediaId: 11, progress: 0 },
  ]);
  assert.throws(() => validateProgressResponseV2({ entries: [{ mediaId: 10, progress: 2 }, { mediaId: 10, progress: 3 }] }), /duplicate/u);
  assert.throws(() => validateProgressResponseV2({ entries: [{ mediaId: 'bad', progress: 3 }] }), /invalid/u);
  assert.throws(() => validateProgressResponseV2({ entries: 'not-a-list' }), /incomplete/u);
});

test('browser calls only the named authenticated Edge Function and does not send AniList credentials', async () => {
  let call;
  const client = { functions: { invoke: async (name, options) => { call = { name, options }; return { data: { state: 'connected' }, error: null }; } } };
  assert.deepEqual(await invokeAniListActionV2(client, 'status'), { state: 'connected' });
  assert.equal(call.name, ANILIST_EDGE_FUNCTION_V2);
  assert.deepEqual(call.options.body, { action: 'status' });
  assert.equal(JSON.stringify(call.options).includes('access_token'), false);
  assert.equal(JSON.stringify(call.options).includes('client_secret'), false);
  await assert.rejects(invokeAniListActionV2(null, 'sync'), /Sign in/u);
});

test('AniList operations require an authenticated ListR user and a loaded cloud library', () => {
  assert.equal(canUseAniListV2(null, true), false);
  assert.equal(canUseAniListV2('', true), false);
  assert.equal(canUseAniListV2('user-a', false), false);
  assert.equal(canUseAniListV2('user-a', true), true);
});

test('browser SDK errors become useful non-sensitive sync messages', async () => {
  const error = new Error('request failed');
  error.context = new Response(JSON.stringify({ error: 'anilist_not_connected', message: 'Connect an AniList account before syncing progress.' }), { status: 409 });
  await assert.rejects(invokeAniListActionV2({ functions: { invoke: async () => ({ data: null, error }) } }, 'sync'), (caught) => caught.code === 'anilist_not_connected');
  assert.match(safeAniListErrorMessageV2({ code: 'anilist_not_connected' }), /Connect your AniList account/u);
  assert.match(safeAniListErrorMessageV2({ code: 'anilist_sync_cooldown', retryAfter: 12 }), /12 seconds/u);
});
