export const PROFILE_RPC_V2 = 'get_my_list_r_profile_v2';
export const SET_USERNAME_RPC_V2 = 'set_list_r_profile_username_v2';
export const USER_SEARCH_RPC_V2 = 'search_list_r_users_v2';
export const FRIENDS_RPC_V2 = 'list_list_r_friends_v2';
export const RECOMMENDATIONS_RPC_V2 = 'list_received_list_r_recommendations_v2';

export function normalizeUsernameV2(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateUsernameV2(value) {
  const normalized = normalizeUsernameV2(value);
  if (!normalized) return { ok: false, username: normalized, message: 'Choose a username for Friends features.' };
  if (!/^[^\s\p{C}]{3,20}$/u.test(normalized)) {
    return { ok: false, username: normalized, message: 'Use 3–20 characters with no spaces or control characters.' };
  }
  return { ok: true, username: normalized, message: '' };
}

async function rpc(client, name, args = {}) {
  if (!client?.rpc) throw new Error('Sign in and load your ListR cloud account first.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function getMyProfileV2(client) {
  const data = await rpc(client, PROFILE_RPC_V2);
  return Array.isArray(data) ? (data[0] || null) : data;
}

export async function setUsernameV2(client, rawUsername) {
  const validation = validateUsernameV2(rawUsername);
  if (!validation.ok) throw Object.assign(new Error(validation.message), { code: 'invalid_username' });
  const data = await rpc(client, SET_USERNAME_RPC_V2, { p_username: validation.username });
  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile?.user_id || profile.username !== validation.username) throw new Error('ListR did not confirm the username. Try again.');
  return profile;
}

export async function searchListRUsersV2(client, rawQuery) {
  const query = normalizeUsernameV2(rawQuery);
  if (query.length < 3 || /[\s\p{C}]/u.test(query)) return [];
  const data = await rpc(client, USER_SEARCH_RPC_V2, { p_username_prefix: query });
  return Array.isArray(data) ? data.filter((row) => row?.user_id && row.username) : [];
}

export async function sendFriendRequestV2(client, targetUserId) {
  if (!targetUserId) throw new Error('Choose a ListR username first.');
  const data = await rpc(client, 'send_list_r_friend_request_v2', { p_target_user_id: String(targetUserId) });
  return Array.isArray(data) ? data[0] : data;
}

export async function listFriendsV2(client) {
  const data = await rpc(client, FRIENDS_RPC_V2);
  return Array.isArray(data) ? data.filter((row) => row?.friend_user_id && row.friendship_id) : [];
}

export async function respondFriendRequestV2(client, friendshipId, accept) {
  if (typeof accept !== 'boolean') throw new Error('Choose whether to accept this friend request.');
  return rpc(client, 'respond_list_r_friend_request_v2', { p_friendship_id: friendshipId, p_accept: accept });
}

export async function unfriendV2(client, friendshipId) {
  return rpc(client, 'remove_list_r_friend_v2', { p_friendship_id: friendshipId });
}

export async function getFriendStatsV2(client, friendUserId) {
  if (!friendUserId) throw new Error('Choose a friend first.');
  const data = await rpc(client, 'get_list_r_friend_stats_v2', { p_friend_user_id: friendUserId });
  return Array.isArray(data) ? (data[0] || null) : data;
}

export async function listReceivedRecommendationsV2(client) {
  const data = await rpc(client, RECOMMENDATIONS_RPC_V2);
  return Array.isArray(data) ? data.filter((row) => row?.recommendation_id && row?.anilist_media_id && row?.anime_metadata) : [];
}

export async function dismissRecommendationV2(client, recommendationId) {
  if (!recommendationId) throw new Error('Choose a recommendation first.');
  return rpc(client, 'act_on_list_r_recommendation_v2', {
    p_recommendation_id: recommendationId,
    p_action: 'dismiss',
  });
}

export function socialErrorMessageV2(error) {
  const code = String(error?.code || '');
  if (code === '23505') return 'That username or friendship already exists. Check the details and try again.';
  if (code === 'invalid_username' || code === '22023') return error.message || 'Choose a valid username.';
  if (code === '42501' || /row-level security|permission denied/i.test(String(error?.message || ''))) {
    return 'This social action is not allowed. Check that you are signed in and the users are friends.';
  }
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || /could not find the function|does not exist|schema cache/i.test(String(error?.message || ''))) {
    return 'Friends features are not set up yet. Apply the v2 Friends and Recommendations migration, then refresh.';
  }
  const message = String(error?.message || 'Could not complete that social action. Try again.');
  return message.length <= 180 ? message : `${message.slice(0, 177)}…`;
}
