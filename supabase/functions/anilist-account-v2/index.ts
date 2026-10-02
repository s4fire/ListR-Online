import { withSupabase } from 'npm:@supabase/server@1'
import {
  AniListIntegrationError,
  addOneYear,
  buildAniListAuthorizationUrl,
  constantTimeEqual,
  createOAuthState,
  exchangeAniListCode,
  fetchAniListMediaProgress,
  fetchAniListAnimeById,
  addAniListAnimeToPlanning,
  getAniListViewer,
  hashOAuthState,
} from '../_shared/anilist-v2.mjs'

const CONNECTIONS = 'anilist_connections_v2'
const OAUTH_STATES = 'anilist_oauth_states_v2'
const ALLOWED_ORIGINS = new Set([
  'https://s4fire.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  ...(Deno.env.get('LISTR_ALLOWED_ORIGINS') || '').split(',').map((value) => value.trim()).filter(Boolean),
])

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function configValue(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw Object.assign(new Error('The AniList integration is not configured on the server.'), { status: 503, code: 'integration_not_configured' })
  return value
}

function safeCode(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/u.test(value) ? value : 'anilist_request_failed'
}

function syncCooldownError(retryAfter = 30) {
  return new AniListIntegrationError('anilist_sync_cooldown', 'An AniList sync was requested recently. Please wait before starting another one.', {
    status: 429,
    retryAfter,
  })
}

async function readBody(request: Request) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > 8192) throw Object.assign(new Error('Request is too large.'), { status: 413, code: 'request_too_large' })
  const reader = request.body?.getReader()
  if (!reader) throw Object.assign(new Error('A valid JSON request is required.'), { status: 400, code: 'invalid_request' })
  let size = 0
  let text = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) {
        await reader.cancel().catch(() => {})
        throw Object.assign(new Error('Request is too large.'), { status: 413, code: 'request_too_large' })
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch (error) {
    if ((error as any)?.code === 'request_too_large') throw error
    throw Object.assign(new Error('A valid JSON request is required.'), { status: 400, code: 'invalid_request' })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw Object.assign(new Error('A valid JSON request is required.'), { status: 400, code: 'invalid_request' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('A valid JSON request is required.'), { status: 400, code: 'invalid_request' })
  }
  return body as Record<string, unknown>
}

function requireString(value: unknown, name: string, min = 1, max = 4096) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw Object.assign(new Error(`The ${name} value is invalid.`), { status: 400, code: 'invalid_request' })
  }
  return value
}

async function getAuthenticatedUser(ctx: any) {
  const { data, error } = await ctx.supabase.auth.getUser()
  if (error || !data?.user?.id) throw Object.assign(new Error('Sign in to ListR before connecting AniList.'), { status: 401, code: 'unauthorized' })
  return data.user
}


async function actionSendRecommendation(admin, userId, body) {
  const recipientId = requireString(body.recipientId, 'recipient ID', 36, 36);
  const mediaId = Number(body.mediaId);
  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.test(recipientId)
    || !Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2147483647) {
    throw Object.assign(new Error('A valid friend and AniList anime are required.'), { status: 400, code: 'invalid_request' });
  }
  const media = await fetchAniListAnimeById(mediaId);
  const metadata = {
    ...media,
    type: 'ANIME',
    id: Number(media.id),
    isAdult: Boolean(media.isAdult),
  };
  const { data, error } = await admin.rpc('create_list_r_recommendation_v2', {
    p_recipient_id: recipientId,
    p_media_id: mediaId,
    p_metadata: metadata,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400;
    throw Object.assign(new Error(error.message || 'Could not create the recommendation.'), { status, code: error.code || 'recommendation_create_failed' });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.recommendation_id) {
    throw Object.assign(new Error('ListR did not confirm the recommendation was saved.'), { status: 503, code: 'recommendation_create_failed' });
  }
  return { state: 'sent', recommendationId: row.recommendation_id, createdAt: row.created_at };
}

async function actionAcceptRecommendation(admin, userId, body) {
  const recommendationId = requireString(body.recommendationId, 'recommendation ID', 36, 36);
  const { data: recommendation, error: recommendationError } = await admin
    .from('list_r_recommendations_v2')
    .select('id,recipient_id,anilist_media_id,status')
    .eq('id', recommendationId)
    .eq('recipient_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (recommendationError) throw Object.assign(new Error('Could not load this recommendation.'), { status: 503, code: 'recommendation_load_failed' });
  if (!recommendation) throw Object.assign(new Error('This recommendation is unavailable.'), { status: 404, code: 'recommendation_unavailable' });

  const { data: connection, error: connectionError } = await admin
    .from(CONNECTIONS)
    .select('access_token,token_expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (connectionError) throw Object.assign(new Error('Could not load the AniList connection.'), { status: 503, code: 'connection_status_unavailable' });
  if (!connection) throw Object.assign(new Error('Connect your AniList account before accepting this recommendation.'), { status: 409, code: 'anilist_not_connected' });
  if (Date.parse(connection.token_expires_at) <= Date.now()) {
    throw Object.assign(new Error('Your AniList authorization has expired. Reconnect AniList to continue.'), { status: 409, code: 'anilist_reauthorization_required' });
  }

  const entry = await addAniListAnimeToPlanning(connection.access_token, recommendation.anilist_media_id);
  const finalize = await admin.rpc('finalize_list_r_recommendation_v2', {
    p_recommendation_id: recommendationId,
    p_recipient_id: userId,
  });
  if (finalize.error) throw Object.assign(new Error('AniList confirmed the change, but ListR could not finalize the recommendation. It remains retryable.'), { status: 503, code: 'recommendation_finalize_failed' });
  const finalizedStatus = Array.isArray(finalize.data) ? finalize.data[0] : finalize.data;
  if (finalizedStatus !== 'accepted') throw Object.assign(new Error('ListR did not confirm the recommendation acceptance. It remains retryable.'), { status: 503, code: 'recommendation_finalize_failed' });
  return { state: 'accepted', anilistState: 'planning', alreadyInListR: false };
}

async function actionStatus(admin: any, userId: string) {
  const { data, error } = await admin
    .from(CONNECTIONS)
    .select('anilist_user_id,anilist_username,token_expires_at,last_synced_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw Object.assign(new Error('Could not load AniList connection status.'), { status: 503, code: 'connection_status_unavailable' })
  if (!data) return { state: 'not_connected' }
  if (Date.parse(data.token_expires_at) <= Date.now()) {
    return {
      state: 'error',
      code: 'anilist_reauthorization_required',
      message: 'Your AniList authorization has expired. Reconnect AniList to continue.',
      username: data.anilist_username,
      lastSyncedAt: data.last_synced_at,
    }
  }
  return {
    state: 'connected',
    username: data.anilist_username,
    anilistUserId: data.anilist_user_id,
    tokenExpiresAt: data.token_expires_at,
    lastSyncedAt: data.last_synced_at,
  }
}

async function deleteOAuthState(admin: any, userId: string, hash?: string) {
  let query = admin.from(OAUTH_STATES).delete().eq('user_id', userId)
  if (hash) query = query.eq('state_hash', hash)
  const { error } = await query
  if (error) throw Object.assign(new Error('Could not finish the AniList authorization request.'), { status: 503, code: 'oauth_state_unavailable' })
}

async function consumeOAuthState(admin: any, userId: string, state: string) {
  const hash = await hashOAuthState(state)
  // A conditional DELETE consumes the state exactly once even when two callbacks race.
  const { data, error } = await admin
    .from(OAUTH_STATES)
    .delete()
    .eq('user_id', userId)
    .eq('state_hash', hash)
    .gt('expires_at', new Date().toISOString())
    .select('state_hash')
    .maybeSingle()
  if (error) throw Object.assign(new Error('Could not verify the AniList authorization request.'), { status: 503, code: 'oauth_state_unavailable' })
  if (!data || !constantTimeEqual(data.state_hash, hash)) {
    throw Object.assign(new Error('AniList authorization could not be verified. Start Connect AniList again.'), { status: 400, code: 'invalid_oauth_state' })
  }
  return hash
}

async function actionStart(admin: any, userId: string) {
  const state = createOAuthState()
  const hash = await hashOAuthState(state)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { error } = await admin.from(OAUTH_STATES).upsert({ user_id: userId, state_hash: hash, expires_at: expiresAt })
  if (error) throw Object.assign(new Error('Could not start AniList authorization. Check the database migration.'), { status: 503, code: 'oauth_state_unavailable' })
  const authorizeUrl = buildAniListAuthorizationUrl({
    clientId: configValue('ANILIST_CLIENT_ID'),
    redirectUri: configValue('ANILIST_REDIRECT_URI'),
    state,
  })
  return { state: 'connecting', authorizeUrl, expiresAt }
}

async function actionCallback(admin: any, userId: string, body: Record<string, unknown>) {
  const code = requireString(body.code, 'authorization code', 1, 4096)
  const state = requireString(body.state, 'OAuth state', 32, 256)
  const stateHash = await consumeOAuthState(admin, userId, state)
  try {
    const accessToken = await exchangeAniListCode({
      code,
      clientId: configValue('ANILIST_CLIENT_ID'),
      clientSecret: configValue('ANILIST_CLIENT_SECRET'),
      redirectUri: configValue('ANILIST_REDIRECT_URI'),
    })
    const viewer = await getAniListViewer(accessToken)
    const expiresAt = addOneYear().toISOString() // AniList documents a one-year lifetime and no refresh tokens.
    const { error } = await admin.from(CONNECTIONS).upsert({
      user_id: userId,
      anilist_user_id: viewer.id,
      anilist_username: viewer.name,
      access_token: accessToken,
      token_expires_at: expiresAt,
      last_synced_at: null,
      last_sync_requested_at: null,
    })
    if (error) throw Object.assign(new Error('AniList authorized successfully, but ListR could not save the connection. Check the migration.'), { status: 503, code: 'connection_store_failed' })
    return { state: 'connected', username: viewer.name, anilistUserId: viewer.id, tokenExpiresAt: expiresAt, lastSyncedAt: null }
  } catch (error) {
    await deleteOAuthState(admin, userId, stateHash).catch(() => {})
    throw error
  }
}

async function actionCancel(admin: any, userId: string, body: Record<string, unknown>) {
  const state = requireString(body.state, 'OAuth state', 32, 256)
  await consumeOAuthState(admin, userId, state)
  return { state: 'not_connected', cancelled: true }
}

async function actionDisconnect(admin: any, userId: string) {
  const { error } = await admin.from(CONNECTIONS).delete().eq('user_id', userId)
  if (error) throw Object.assign(new Error('Could not disconnect AniList. Try again.'), { status: 503, code: 'disconnect_failed' })
  await deleteOAuthState(admin, userId).catch(() => {})
  return { state: 'not_connected' }
}

async function actionSync(admin: any, userId: string) {
  const { data, error } = await admin
    .from(CONNECTIONS)
    .select('anilist_user_id,access_token,token_expires_at,anilist_username,last_sync_requested_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw Object.assign(new Error('Could not load the AniList connection.'), { status: 503, code: 'connection_status_unavailable' })
  if (!data) throw Object.assign(new Error('Connect an AniList account before syncing progress.'), { status: 409, code: 'anilist_not_connected' })
  if (Date.parse(data.token_expires_at) <= Date.now()) {
    throw Object.assign(new Error('Your AniList authorization has expired. Reconnect AniList to continue.'), { status: 409, code: 'anilist_reauthorization_required' })
  }
  const requestedAt = Date.now()
  const now = new Date(requestedAt).toISOString()
  const lastRequested = Date.parse(data.last_sync_requested_at || '')
  const remaining = Number.isFinite(lastRequested) ? 30_000 - (requestedAt - lastRequested) : 0
  if (remaining > 0) throw syncCooldownError(Math.ceil(remaining / 1000))

  // Compare-and-set the stored timestamp so parallel requests cannot both reach AniList.
  let reservation = admin.from(CONNECTIONS)
    .update({ last_sync_requested_at: now })
    .eq('user_id', userId)
    .eq('anilist_user_id', data.anilist_user_id)
  reservation = data.last_sync_requested_at == null
    ? reservation.is('last_sync_requested_at', null)
    : reservation.eq('last_sync_requested_at', data.last_sync_requested_at)
  const { data: reserved, error: reservationError } = await reservation.select('user_id').maybeSingle()
  if (reservationError) throw Object.assign(new Error('Could not reserve an AniList sync request.'), { status: 503, code: 'sync_reservation_unavailable' })
  if (!reserved) {
    const { data: latest, error: latestError } = await admin
      .from(CONNECTIONS)
      .select('anilist_user_id,token_expires_at,last_sync_requested_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (latestError) throw Object.assign(new Error('Could not verify the AniList sync request.'), { status: 503, code: 'sync_reservation_unavailable' })
    if (!latest) throw Object.assign(new Error('The AniList account was disconnected before sync.'), { status: 409, code: 'anilist_not_connected' })
    if (Number(latest.anilist_user_id) !== Number(data.anilist_user_id)) {
      throw Object.assign(new Error('The linked AniList account changed before sync. Refresh its status and try again.'), { status: 409, code: 'anilist_connection_changed' })
    }
    if (Date.parse(latest.token_expires_at) <= Date.now()) {
      throw Object.assign(new Error('Your AniList authorization has expired. Reconnect AniList to continue.'), { status: 409, code: 'anilist_reauthorization_required' })
    }
    const latestRequested = Date.parse(latest.last_sync_requested_at || '')
    const waitMs = Number.isFinite(latestRequested) ? 30_000 - (Date.now() - latestRequested) : 0
    if (waitMs > 0) throw syncCooldownError(Math.ceil(waitMs / 1000))
    throw Object.assign(new Error('Could not reserve this AniList sync. Please try again.'), { status: 409, code: 'sync_reservation_conflict' })
  }

  // Only the authenticated owner receives their own sanitized media IDs and counts. Tokens never leave this function.
  const progress = await fetchAniListMediaProgress(data.access_token, data.anilist_user_id)
  const { data: current, error: currentError } = await admin
    .from(CONNECTIONS)
    .select('anilist_user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (currentError) throw Object.assign(new Error('Could not verify the current AniList account after sync.'), { status: 503, code: 'connection_status_unavailable' })
  if (!current) throw Object.assign(new Error('The AniList account was disconnected during sync. No ListR rows were changed.'), { status: 409, code: 'anilist_not_connected' })
  if (Number(current.anilist_user_id) !== Number(data.anilist_user_id)) {
    throw Object.assign(new Error('The linked AniList account changed during sync. No ListR rows were changed.'), { status: 409, code: 'anilist_connection_changed' })
  }
  return { state: 'connected', username: data.anilist_username, entries: progress, entryCount: progress.length }
}

async function actionCompleteSync(admin: any, userId: string) {
  const lastSyncedAt = new Date().toISOString()
  const { data, error } = await admin
    .from(CONNECTIONS)
    .update({ last_synced_at: lastSyncedAt })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (error || !data) throw Object.assign(new Error('Progress was saved, but the last-sync time could not be recorded.'), { status: 503, code: 'sync_timestamp_failed' })
  return { state: 'connected', lastSyncedAt }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request: Request, ctx: any) => {
    const origin = request.headers.get('origin')
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed', message: 'This site is not allowed to use the AniList integration.' }, 403)
    if (request.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Use a POST request.' }, 405)

    try {
      const user = await getAuthenticatedUser(ctx)
      const userId = String(user.id)
      const body = await readBody(request)
      const action = requireString(body.action, 'action', 1, 40)
      const admin = ctx.supabaseAdmin
      let result: Record<string, unknown>

      switch (action) {
        case 'status': result = await actionStatus(admin, userId); break
        case 'start': result = await actionStart(admin, userId); break
        case 'callback': result = await actionCallback(admin, userId, body); break
        case 'cancel': result = await actionCancel(admin, userId, body); break
        case 'disconnect': result = await actionDisconnect(admin, userId); break
        case 'sync': result = await actionSync(admin, userId); break
        case 'sync-complete': result = await actionCompleteSync(admin, userId); break
        default: return json({ error: 'unknown_action', message: 'Unknown AniList action.' }, 400)
      }
      return json(result)
    } catch (error) {
      if (error instanceof AniListIntegrationError) {
        return json({
          error: safeCode(error.code),
          message: error.message,
          ...(error.retryAfter == null ? {} : { retryAfter: error.retryAfter }),
        }, error.status)
      }
      const status = Number((error as any)?.status) || 500
      const code = safeCode((error as any)?.code)
      const message = status < 500 && (error as Error)?.message
        ? (error as Error).message
        : 'The AniList integration could not complete this request. Try again; your ListR library has not been overwritten.'
      // Never log request bodies, OAuth codes, bearer tokens, or provider credentials.
      console.error('AniList integration request failed', code, status)
      return json({ error: code, message }, status)
    }
  }),
}
