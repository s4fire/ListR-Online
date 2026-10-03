-- Run after the base anime_records and Friends/Recommendations v2 migrations using `supabase test db`.
-- These tests use separate Auth identities and exercise actual PostgreSQL privileges, RLS, and RPC boundaries.
begin;
select plan(42);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('60000000-0000-4000-8000-000000000006', 'friends-a@example.invalid', '{"username":"Alice"}'::jsonb),
  ('70000000-0000-4000-8000-000000000007', 'friends-b@example.invalid', '{"username":"Bob"}'::jsonb),
  ('80000000-0000-4000-8000-000000000008', 'friends-c@example.invalid', '{"username":"Carol"}'::jsonb)
on conflict (id) do nothing;

-- Existing/legacy profiles may be null after backfill; this simulates an old account.
update public.list_r_profiles_v2 set username = null
where user_id = '80000000-0000-4000-8000-000000000008';

insert into public.anime_records (user_id, anilist_media_id, category, watched_episodes, anime_metadata)
values
  ('70000000-0000-4000-8000-000000000007', 101, 'watching', 3, '{"id":101,"episodes":12,"duration":24}'::jsonb),
  ('70000000-0000-4000-8000-000000000007', 102, 'completed', 12, '{"id":102,"episodes":12,"duration":24}'::jsonb),
  ('70000000-0000-4000-8000-000000000007', 103, 'interested', 0, '{"id":103,"episodes":12,"duration":24}'::jsonb)
on conflict (user_id, anilist_media_id) do nothing;

select ok(not has_table_privilege('anon', 'public.list_r_profiles_v2', 'select,insert,update,delete'), 'anon has no profile table privileges');
select ok(not has_table_privilege('anon', 'public.list_r_friendships_v2', 'select,insert,update,delete'), 'anon has no friendship table privileges');
select ok(not has_table_privilege('anon', 'public.list_r_recommendations_v2', 'select,insert,update,delete'), 'anon has no recommendation table privileges');
select ok(not has_function_privilege('anon', 'public.finalize_list_r_recommendation_v2(uuid,uuid)', 'execute'), 'anon cannot finalize recommendations');

select throws_ok(
  $$insert into auth.users (id,email,raw_user_meta_data) values ('90000000-0000-4000-8000-000000000009','no-username@example.invalid','{}'::jsonb)$$,
  '22023', 'A ListR username is required for a new account.',
  'new accounts cannot be created with an empty username'
);

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000006';
select is((select username from public.get_my_list_r_profile_v2()), 'alice', 'signup username is stored in canonical lowercase form');
select is((select count(*)::integer from public.list_r_profiles_v2 where user_id = '70000000-0000-4000-8000-000000000007'), 0, 'users cannot directly read another profile');
select is((select count(*)::integer from public.search_list_r_users_v2('bob') where username = 'bob'), 1, 'user search matches username only');
select ok(position('@example.invalid' in coalesce((select pg_catalog.to_jsonb(s)::text from public.search_list_r_users_v2('bob') s limit 1), '')) = 0, 'search profile data does not contain an email address');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '80000000-0000-4000-8000-000000000008';
select throws_ok(
  $$select * from public.set_list_r_profile_username_v2('ALICE')$$,
  '23505', 'That username is already taken. Choose another.',
  'case-insensitive duplicate usernames are rejected by the unique index'
);
select is((select username from public.set_list_r_profile_username_v2('Carol_2')), 'carol_2', 'legacy user can create a normalized username once');
select throws_ok(
  $$select * from public.set_list_r_profile_username_v2('Carol_3')$$,
  '23505', 'A username is already set for this account.',
  'a username cannot be silently replaced after creation'
);
reset role;

set local role anon;
select throws_ok($$select * from public.search_list_r_users_v2('bob')$$, '42501', null, 'unauthenticated users cannot search ListR profiles');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000006';
select throws_ok(
  $$select * from public.send_list_r_friend_request_v2('60000000-0000-4000-8000-000000000006')$$,
  '22023', 'You cannot add yourself as a friend.',
  'users cannot friend themselves'
);
select lives_ok(
  $$select * from public.send_list_r_friend_request_v2('70000000-0000-4000-8000-000000000007')$$,
  'user A can send a friend request to user B'
);
select throws_ok(
  $$select * from public.send_list_r_friend_request_v2('70000000-0000-4000-8000-000000000007')$$,
  '23505', 'A friendship or request already exists.',
  'duplicate friendship requests are prevented'
);
select throws_ok(
  $$select * from public.get_list_r_friend_stats_v2('70000000-0000-4000-8000-000000000007')$$,
  '42501', 'Friend statistics are available only for an accepted friend.',
  'pending requests do not expose friend statistics'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-4000-8000-000000000007';
select is(
  public.respond_list_r_friend_request_v2((select id from public.list_r_friendships_v2 where user_low = '60000000-0000-4000-8000-000000000006' and user_high = '70000000-0000-4000-8000-000000000007'), true),
  'accepted', 'recipient may accept the incoming friend request'
);
select is((select count(*)::integer from public.list_list_r_friends_v2() where status = 'accepted' and username = 'alice'), 1, 'friends list returns accepted friend usernames');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000006';
select is(
  (select watched_episodes::text || ':' || watched_minutes::text from public.get_list_r_friend_stats_v2('70000000-0000-4000-8000-000000000007')),
  '15:360', 'friend stats reuse watched/time rules and exclude Interested anime'
);
select is(
  (select total_anime::text || ':' || watching::text || ':' || completed::text || ':' || interested::text from public.get_list_r_friend_stats_v2('70000000-0000-4000-8000-000000000007')),
  '3:1:1:1', 'friend stats include Interested titles in category totals'
);
select throws_ok(
  $$select * from public.get_list_r_friend_stats_v2('80000000-0000-4000-8000-000000000008')$$,
  '42501', 'Friend statistics are available only for an accepted friend.',
  'non-friends cannot view aggregate statistics'
);
select throws_ok(
  $$insert into public.list_r_friendships_v2 (user_low,user_high,requested_by) values ('60000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000008','60000000-0000-4000-8000-000000000006')$$,
  '42501', null, 'users cannot write friendship rows directly'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000006';
select throws_ok(
  $$select * from public.create_list_r_recommendation_v2('80000000-0000-4000-8000-000000000008',101,'{"id":101,"type":"ANIME","isAdult":false,"title":{"userPreferred":"Example"}}'::jsonb)$$,
  '42501', 'Recommendations can only be sent to an accepted friend.',
  'recommendations cannot be sent to a non-friend'
);
select lives_ok(
  $$select * from public.create_list_r_recommendation_v2('70000000-0000-4000-8000-000000000007',101,'{"id":101,"type":"ANIME","isAdult":false,"title":{"userPreferred":"Example Anime"}}'::jsonb)$$,
  'friend can send a valid canonical AniList anime recommendation'
);
select throws_ok(
  $$select * from public.create_list_r_recommendation_v2('70000000-0000-4000-8000-000000000007',101,'{"id":101,"type":"ANIME","isAdult":false,"title":{"userPreferred":"Example Anime"}}'::jsonb)$$,
  '23505', 'This anime is already pending as a recommendation to this friend.',
  'duplicate pending recommendations are rejected'
);
select is((select count(*)::integer from public.list_r_recommendations_v2), 0, 'sender cannot directly read sent recommendation rows');
select throws_ok(
  $$insert into public.list_r_recommendations_v2 (sender_id,recipient_id,anilist_media_id,anime_metadata) values ('60000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000007',104,'{"id":104,"type":"ANIME","isAdult":false,"title":{"userPreferred":"Direct"}}'::jsonb)$$,
  '42501', null, 'users cannot directly insert recommendations outside the authorized RPC'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-4000-8000-000000000007';
select is((select count(*)::integer from public.list_r_recommendations_v2), 1, 'recipient can read received recommendation rows');
select is((select count(*)::integer from public.list_received_list_r_recommendations_v2() where sender_username = 'alice'), 1, 'inbox reveals sender username but no private account fields');
select is(
  public.act_on_list_r_recommendation_v2((select id from public.list_r_recommendations_v2 where anilist_media_id = 101), 'dismiss'),
  'dismissed', 'recipient may dismiss a received recommendation'
);
select is((select count(*)::integer from public.list_received_list_r_recommendations_v2()), 0, 'dismissed recommendation leaves the pending inbox');
select throws_ok(
  $$select public.finalize_list_r_recommendation_v2((select id from public.list_r_recommendations_v2 where anilist_media_id = 101),'70000000-0000-4000-8000-000000000007')$$,
  '42501', 'Server authorization required.', 'authenticated users cannot use server-only acceptance finalization'
);
select lives_ok(
  $$select * from public.create_list_r_recommendation_v2('70000000-0000-4000-8000-000000000007',102,'{"id":102,"type":"ANIME","isAdult":false,"title":{"userPreferred":"Completed Anime"}}'::jsonb)$$,
  'accepted friend can receive a second recommendation'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '80000000-0000-4000-8000-000000000008';
select is((select count(*)::integer from public.list_r_recommendations_v2), 0, 'another authenticated user cannot read a different recipient inbox');
select is((select count(*)::integer from public.list_received_list_r_recommendations_v2()), 0, 'inbox RPC returns only the caller recipient rows');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-4000-8000-000000000007';
select is((select count(*)::integer from public.list_received_list_r_recommendations_v2() where anilist_media_id = 102), 1, 'recipient sees its pending recommendation by canonical media ID');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select is(
  public.finalize_list_r_recommendation_v2((select id from public.list_r_recommendations_v2 where anilist_media_id = 102), '70000000-0000-4000-8000-000000000007'),
  'accepted', 'only the server can finalize acceptance after external side effects succeed'
);
reset role;

select is((select count(*)::integer from public.list_r_recommendations_v2 where anilist_media_id = 102 and status = 'accepted'), 1, 'server-finalized recommendation status is stored');
select is((select count(*)::integer from public.anime_records where user_id = '70000000-0000-4000-8000-000000000007' and anilist_media_id = 102), 1, 'canonical media uniqueness prevents a duplicate user anime row');

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000006';
select is(public.remove_list_r_friend_v2((select id from public.list_r_friendships_v2 where user_low = '60000000-0000-4000-8000-000000000006' and user_high = '70000000-0000-4000-8000-000000000007')), true, 'either participant may end their friendship');
select throws_ok(
  $$select * from public.get_list_r_friend_stats_v2('70000000-0000-4000-8000-000000000007')$$,
  '42501', 'Friend statistics are available only for an accepted friend.',
  'stats access is revoked when the friendship ends'
);
reset role;

select * from finish();
rollback;
