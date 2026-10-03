export const MIRURO_RESOLVER_FUNCTION_V2 = 'miruro-resolve-v2';
export const MIRURO_RESOLVER_FUNCTION_V2 = 'miruro-resolve-v2';

export async function resolveMiruroEpisodeUrlV2(client, entry, { storage = globalThis.localStorage } = {}) {
  const episode = nextEpisodeNumberV2(entry);
  if (!episode) throw new Error('Miruro Watch is available only for anime in your Watching list.');
  const media = buildMiruroPayloadV2(entry);

  if (!client?.functions?.invoke) {
    throw new Error('The Miruro resolver is unavailable. Check the ListR Supabase configuration and try again.');
  }

  const { data, error } = await client.functions.invoke(MIRURO_RESOLVER_FUNCTION_V2, { body: { media } });
  if (error) {
    throw new Error('Could not resolve this AniList anime in Miruro. Check your connection and try again.');
  }
  if (!data?.matched || Number(data.anilistMediaId) !== media.mediaId) {
    throw new Error('No exact AniList match was found in Miruro. Nothing was opened; try again later.');
  }

  const watchUrl = String(data.watchUrl || '');
  const url = buildMiruroEpisodeUrlV2(watchUrl, episode);
  if (!url) throw new Error('Miruro returned an invalid Watch page. Nothing was opened.');
  return { url, watchUrl, episode, mediaId: media.mediaId };
}
