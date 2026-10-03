-- Run with `supabase test db` after applying the initial ListR and AniList v2 migrations.
-- The sync function is SECURITY INVOKER; these checks run as authenticated users under RLS.
begin;
select plan(16);

insert into auth.users (id, email)
values
  ('61000000-0000-4000-8000-000000000001', 'anilist-sync-a@example.invalid'),
  ('62000000-0000-4000-8000-000000000002', 'anilist-sync-b@example.invalid')
on conflict (id) do nothing;

insert into public.anime_records (id, user_id, anilist_media_id, category, watched_episodes, anime_metadata)
values
  ('63000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000001', 91001, 'watching', 2, '{"episodes":12,"title":{"romaji":"Keep A"}}'::jsonb),
  ('64000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000001', 91002, 'completed', 2, '{"episodes":4,"title":{"romaji":"Keep B"}}'::jsonb),
  ('65000000-0000-4000-8000-000000000005', '62000000-0000-4000-8000-000000000002', 91001, 'watching', 1, '{"episodes":12,"title":{"romaji":"Other owner"}}'::jsonb),
  ('66000000-0000-4000-8000-000000000006', '62000000-0000-4000-8000-000000000002', 91003, 'watching', 3, '{"episodes":12}'::jsonb)
on conflict (user_id, anilist_media_id) do nothing;

select ok(
  not has_table_privilege('anon', 'public.anilist_connections_v2', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.anilist_connections_v2', 'select,insert,update,delete'),
  'browser roles cannot access AniList connection tokens'
);

set local role anon;
select throws_ok(
  $$select * from public.anilist_connections_v2$$,
  '42501', null,
  'signed-out users cannot read AniList connection data'
);
select throws_ok(
  $$select * from public.sync_anilist_progress_v2('[]'::jsonb)$$,
  '42501', null,
  'signed-out users cannot execute the AniList progress RPC'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '61000000-0000-4000-8000-000000000001';
select results_eq(
  $$select matched_count, updated_count from public.sync_anilist_progress_v2('[{"mediaId":91001,"progress":6},{"mediaId":91002,"progress":7},{"mediaId":91003,"progress":5},{"mediaId":91999,"progress":9}]'::jsonb)$$,
  $$values (2, 2)$$,
  'initial sync updates only the two existing rows visible to the authenticated owner'
);
select is(
  (select updated_count from public.sync_anilist_progress_v2('[{"mediaId":91001,"progress":6},{"mediaId":91002,"progress":7}]'::jsonb)),
  0,
  'repeating an already-applied sync makes no additional changes'
);
reset role;

select is((select watched_episodes from public.anime_records where user_id = '61000000-0000-4000-8000-000000000001' and anilist_media_id = 91001), 6, 'user A progress increased from AniList');
select is((select watched_episodes from public.anime_records where user_id = '61000000-0000-4000-8000-000000000001' and anilist_media_id = 91002), 4, 'known episode total clamps imported progress');
select is((select category from public.anime_records where user_id = '61000000-0000-4000-8000-000000000001' and anilist_media_id = 91002), 'completed', 'sync does not change the ListR category');
select is((select anime_metadata -> 'title' ->> 'romaji' from public.anime_records where user_id = '61000000-0000-4000-8000-000000000001' and anilist_media_id = 91001), 'Keep A', 'sync does not overwrite cached anime metadata');
select is((select watched_episodes from public.anime_records where user_id = '62000000-0000-4000-8000-000000000002' and anilist_media_id = 91001), 1, 'user B row with the same media ID remains untouched by user A');
select is((select count(*)::integer from public.anime_records where anilist_media_id = 91999), 0, 'unmatched AniList progress never creates a ListR record');

set local role authenticated;
set local request.jwt.claim.sub = '62000000-0000-4000-8000-000000000002';
select results_eq(
  $$select matched_count, updated_count from public.sync_anilist_progress_v2('[{"mediaId":91001,"progress":5}]'::jsonb)$$,
  $$values (1, 1)$$,
  'user B can sync and update their own separate matching row'
);
select is((select updated_count from public.sync_anilist_progress_v2('[{"mediaId":91001,"progress":5}]'::jsonb)), 0, 'user B repeat call is idempotent');
reset role;

select is((select watched_episodes from public.anime_records where user_id = '62000000-0000-4000-8000-000000000002' and anilist_media_id = 91001), 5, 'user B progress changes only after user B syncs');
select is((select watched_episodes from public.anime_records where user_id = '61000000-0000-4000-8000-000000000001' and anilist_media_id = 91001), 6, 'user A progress remains isolated from user B sync');

select throws_ok(
  $$select * from public.sync_anilist_progress_v2('[{"mediaId":1,"progress":-1}]'::jsonb)$$,
  '22023', null,
  'malformed/negative progress input is rejected before updates'
);

select * from finish();
rollback;
