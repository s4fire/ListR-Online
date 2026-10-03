import { MIRURO_RESOLVER_LIMITS_V2, resolveMiruroMatchV2 } from '../_shared/miruro-resolver-v2.mjs';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const MAX_BODY_BYTES = 12_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const RATE_KEY_MAX = 2_000;
const cache = new Map<string, { expiresAt: number; value: Record<string, unknown> | null }>();
const rateLimits = new Map<string, { startedAt: number; count: number }>();
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-max-age': '86400',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders },
  });
}

async function readBoundedJson(request: Request): Promise<{ value?: unknown; error?: 'too-large' | 'invalid' }> {
  const reader = request.body?.getReader();
  if (!reader) return { error: 'invalid' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: 'too-large' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
    catch { return { error: 'invalid' }; }
  } catch {
    return { error: 'invalid' };
  } finally {
    try { reader.releaseLock(); } catch { /* stream may already be cancelled */ }
  }
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || forwarded
    || 'unknown';
}

function rateLimited(request: Request): boolean {
  const key = clientKey(request);
  const now = Date.now();
  const previous = rateLimits.get(key);
  if (!previous || now - previous.startedAt >= RATE_WINDOW_MS) {
    if (rateLimits.size >= RATE_KEY_MAX) {
      for (const [candidate, state] of rateLimits) {
        if (now - state.startedAt >= RATE_WINDOW_MS) rateLimits.delete(candidate);
      }
      if (rateLimits.size >= RATE_KEY_MAX) rateLimits.delete(rateLimits.keys().next().value!);
    }
    rateLimits.set(key, { startedAt: now, count: 1 });
    return false;
  }
  previous.count += 1;
  return previous.count > RATE_MAX_REQUESTS;
}

function cachePut(key: string, value: Record<string, unknown> | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + (value ? CACHE_TTL_MS : 15 * 60 * 1000), value });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Use POST to resolve a public anime link.' }, 405);
  if (rateLimited(request)) return json({ error: 'Too many Miruro lookups. Wait a minute, then try again.' }, 429);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: 'Request is too large.' }, 413);
  const parsed = await readBoundedJson(request);
  if (parsed.error === 'too-large') return json({ error: 'Request is too large.' }, 413);
  if (parsed.error) return json({ error: 'Request body must be valid JSON.' }, 400);

  const body = parsed.value;
  const media = (body as { media?: unknown } | null)?.media;
  if (!media || typeof media !== 'object' || Array.isArray(media)) return json({ error: 'A media object is required.' }, 400);

  const mediaId = Number((media as { mediaId?: unknown }).mediaId);
  const titles = (media as { titles?: unknown }).titles;
  if (!Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2_147_483_647
    || !Array.isArray(titles) || titles.length < 1 || titles.length > 6
    || titles.some((title) => typeof title !== 'string' || title.length > 140)) {
    return json({ error: 'Anime ID or title metadata is invalid.' }, 400);
  }

  const key = `${mediaId}:${(titles as string[]).join('|').toLocaleLowerCase('en')}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
      ? json(cached.value)
      : json({ matched: false, anilistMediaId: mediaId, reason: 'no-exact-match' });
  }
  if (cached) cache.delete(key);

  try {
    const match = await resolveMiruroMatchV2({ mediaId, titles }, fetch);
    if (!match || match.anilistMediaId !== mediaId) {
      cachePut(key, null);
      return json({ matched: false, anilistMediaId: mediaId, reason: 'no-exact-match' });
    }
    const result = {
      matched: true,
      anilistMediaId: mediaId,
      watchUrl: match.watchUrl,
      miruroTitle: match.title,
      episodes: match.episodes,
    };
    cachePut(key, result);
    return json(result);
  } catch {
    return json({ error: 'Miruro could not be checked right now. Try again later.' }, 502);
  }
});
