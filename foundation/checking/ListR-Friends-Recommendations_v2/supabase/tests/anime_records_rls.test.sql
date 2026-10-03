-- Run with `supabase test db` against a local Supabase stack.
-- These tests set authenticated JWT claims directly and exercise Postgres RLS.
begin;
select plan(16);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'list-r-rls-a@example.invalid'),
  ('20000000-0000-4000-8000-000000000002', 'list-r-rls-b@example.invalid')
on conflict (id) do nothing;

insert into public.anime_records (id, user_id, anilist_media_id, category, watched_episodes, anime_metadata)
values
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 101, 'watching', 3, '{"episodes":12}'::jsonb),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 202, 'completed', 12, '{"episodes":12}'::jsonb),
  ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', 101, 'watching', 1, '{"episodes":12}'::jsonb)
on conflict (user_id, anilist_media_id) do nothing;

select ok(
  not has_table_privilege('anon', 'public.anime_records', 'select,insert,update,delete'),
  'anon has no direct table privileges'
);
select is(
  (select count(*)::integer from public.anime_records where anilist_media_id = 101), 2,
  'the same AniList ID may belong to two different users'
);

set local role anon;
select throws_ok(
  $$select * from public.anime_records$$,
  '42501', null,
  'signed-out users cannot read anime rows'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.anime_records), 1,
  'user A sees only user A rows'
);
select is(
  (select count(*)::integer from public.anime_records where id = '50000000-0000-4000-8000-000000000005'), 0,
  'user A cannot read user B row by record ID'
);
select is(
  (select count(*)::integer from public.anime_records where anilist_media_id = 202), 0,
  'user A cannot read a different user anime by AniList ID'
);
select throws_ok(
  $$insert into public.anime_records (user_id, anilist_media_id, category, watched_episodes, anime_metadata)
    values ('20000000-0000-4000-8000-000000000002', 303, 'watching', 0, '{}'::jsonb)$$,
  '42501', null,
  'user A cannot insert a row owned by user B'
);
select throws_ok(
  $$update public.anime_records set user_id = '20000000-0000-4000-8000-000000000002'
    where id = '30000000-0000-4000-8000-000000000003'$$,
  '42501', null,
  'user A cannot reassign an owned row to user B'
);
select lives_ok(
  $$insert into public.anime_records (user_id, anilist_media_id, category, watched_episodes, anime_metadata)
    values ('10000000-0000-4000-8000-000000000001', 303, 'interested', 0, '{}'::jsonb)$$,
  'user A can insert a row owned by user A'
);
select lives_ok(
  $$update public.anime_records set category = 'completed', watched_episodes = 12
    where id = '30000000-0000-4000-8000-000000000003'$$,
  'user A can update their own row'
);
select is(
  (select count(*)::integer from public.anime_records where anilist_media_id = 202), 0,
  'user A cannot see user B row after update attempt'
);
select lives_ok(
  $$delete from public.anime_records where id = '30000000-0000-4000-8000-000000000003'$$,
  'user A can delete their own row'
);
select lives_ok(
  $$update public.anime_records set watched_episodes = 0 where id = '50000000-0000-4000-8000-000000000005'$$,
  'user A cannot update user B row by primary key'
);
select lives_ok(
  $$delete from public.anime_records where id = '50000000-0000-4000-8000-000000000005'$$,
  'user A cannot delete user B row by primary key'
);

reset role;
select is(
  (select count(*)::integer from public.anime_records where anilist_media_id = 202), 1,
  'user B row remains unchanged and present'
);
select is(
  (select count(*)::integer from public.anime_records where id = '50000000-0000-4000-8000-000000000005'), 1,
  'user B same-AniList-ID row remains after user A deletes theirs'
);

select * from finish();
rollback;
