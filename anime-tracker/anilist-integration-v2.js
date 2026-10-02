export const ANILIST_EDGE_FUNCTION_V2 = 'anilist-account-v3';
export const ANILIST_AUTO_SYNC_INTERVAL_MS_V2 = 15 * 60 * 1000;
const OAUTH_ATTEMPT_KEY = 'afterglow-anilist-oauth-attempt-v2';

export function canUseAniListV2(userId, cloudLibraryReady) {
  return userId != null && String(userId).length > 0 && cloudLibraryReady === true;
}

export function shouldAutoSyncAniListV2(lastSuccessfulSync, now = Date.now()) {
  if (!lastSuccessfulSync) return true;
  const timestamp = Date.parse(lastSuccessfulSync);
  if (!Number.isFinite(timestamp) || timestamp > now) return false;
  return now - timestamp >= ANILIST_AUTO_SYNC_INTERVAL_MS_V2;
}

export function validateProgressResponseV2(response) {
  if (!response || !Array.isArray(response.entries) || response.entries.length > 12000) {
    throw new Error('AniList returned an incomplete progress list. No ListR data was changed.');
  }
  const seen = new Set();
  return response.entries.map((item) => {
    const mediaId = Number(item?.mediaId);
    const progress = Number(item?.progress);
    if (!Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2147483647
      || !Number.isSafeInteger(progress) || progress < 0 || progress > 2147483647
      || seen.has(mediaId)) {
      throw new Error('AniList returned invalid or duplicate progress values. No ListR data was changed.');
    }
    seen.add(mediaId);
    const media = item?.media;
    if (!media || Number(media.id) !== mediaId || typeof media !== 'object') {
      throw new Error('AniList returned incomplete anime metadata. No ListR data was changed.');
    }
    const episodes = media.episodes == null ? null : Number(media.episodes);
    if (episodes != null && (!Number.isSafeInteger(episodes) || episodes < 0 || episodes > 2147483647)) {
      throw new Error('AniList returned an invalid episode total. No ListR data was changed.');
    }
    return { mediaId, progress, media };
  });
}

export function storeAniListOAuthAttemptV2(storage, { state, userId }) {
  if (!storage || typeof state !== 'string' || state.length < 32 || userId == null) return false;
  try {
    storage.setItem(OAUTH_ATTEMPT_KEY, JSON.stringify({ state, userId: String(userId), startedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function readAniListOAuthAttemptV2(storage) {
  try {
    const value = JSON.parse(storage?.getItem(OAUTH_ATTEMPT_KEY) || 'null');
    if (!value || typeof value.state !== 'string' || value.state.length < 32 || value.userId == null
      || !Number.isFinite(value.startedAt) || Date.now() - value.startedAt > 10 * 60 * 1000) return null;
    return { state: value.state, userId: String(value.userId) };
  } catch {
    return null;
  }
}

export function clearAniListOAuthAttemptV2(storage) {
  try { storage?.removeItem(OAUTH_ATTEMPT_KEY); } catch { /* optional temporary state marker */ }
}

export function isPotentialAniListOAuthReturnV2(location) {
  const params = new URLSearchParams(location.search || '');
  return params.has('state') && (params.has('code') || params.has('error'));
}

export function readAniListCallbackV2(location, storage) {
  const attempt = readAniListOAuthAttemptV2(storage);
  if (!attempt) return null;
  const params = new URLSearchParams(location.search || '');
  const code = params.get('code');
  const returnedState = params.get('state');
  const providerError = params.get('error');
  if (!code && !providerError) return null;
  if (!returnedState || returnedState !== attempt.state) {
    return { kind: 'invalid_state', expectedUserId: attempt.userId };
  }
  if (providerError) return { kind: 'denied', state: returnedState, expectedUserId: attempt.userId };
  if (typeof code !== 'string' || !code || code.length > 4096) return { kind: 'invalid_code', expectedUserId: attempt.userId };
  return { kind: 'code', code, state: returnedState, expectedUserId: attempt.userId };
}

export function removeAniListCallbackParamsV2(location, history) {
  const url = new URL(location.href);
  for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function safeAniListErrorMessageV2(error) {
  const code = String(error?.code || error?.context?.error || '');
  const retry = Number(error?.retryAfter ?? error?.context?.retryAfter);
  if (code === 'anilist_not_connected') return 'Connect your AniList account before syncing progress.';
  if (code === 'anilist_reauthorization_required') return 'Your AniList connection needs reauthorization. Reconnect AniList to continue.';
  if (code === 'anilist_sync_cooldown') return Number.isFinite(retry) && retry > 0
    ? `Please wait about ${Math.ceil(retry)} seconds before the next AniList sync.`
    : 'Please wait a little before starting another AniList sync.';
  if (code === 'anilist_rate_limited') return Number.isFinite(retry) && retry > 0
    ? `AniList is rate-limiting requests. Wait about ${Math.ceil(retry)} seconds, then try again.`
    : 'AniList is rate-limiting requests. Wait a little before trying again.';
  if (code === 'invalid_oauth_state') return 'The AniList authorization could not be verified. Start Connect AniList again.';
  if (/failed to send a request|fetch|network|timeout/i.test(String(error?.message || ''))) {
    return 'The AniList integration is unavailable. Check your connection and confirm the Supabase function is deployed.';
  }
  const message = error?.context?.message || error?.message;
  return typeof message === 'string' && message.length <= 180
    ? message
    : 'The AniList integration could not complete this request. Your saved ListR library is unchanged.';
}

export async function invokeAniListActionV2(client, action, data = {}) {
  if (!client?.functions?.invoke) throw new Error('Sign in and load the cloud library before using AniList sync.');
  const { data: response, error } = await client.functions.invoke(ANILIST_EDGE_FUNCTION_V2, {
    body: { ...data, action },
  });
  if (error) {
    let body = null;
    try {
      const context = error.context;
      body = context && typeof context.json === 'function' ? await context.json() : null;
    } catch { /* use the safe SDK error fallback */ }
    const wrapped = new Error(body?.message || error.message || 'AniList request failed.');
    wrapped.code = body?.error || error.code;
    wrapped.retryAfter = body?.retryAfter;
    wrapped.status = error.status || error.context?.status;
    throw wrapped;
  }
  if (!response || typeof response !== 'object') throw new Error('The AniList integration returned an empty response.');
  if (response.error) {
    const wrapped = new Error(response.message || 'AniList request failed.');
    wrapped.code = response.error;
    wrapped.retryAfter = response.retryAfter;
    wrapped.status = response.status;
    throw wrapped;
  }
  return response;
}
