-- ListR Friends, usernames, and recommendations v2.
-- Public identifiers are canonical lowercase usernames only; email and tokens are never exposed.
begin;

create table if not exists public.list_r_profiles_v2 (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint list_r_profiles_v2_username_format check (
    username is null or (
      username = pg_catalog.lower(username)
      and username ~ '^[a-z0-9][a-z0-9_]{2,19}$'
    )
  )
);
create unique index if not exists list_r_profiles_v2_username_unique
  on public.list_r_profiles_v2 (username) where username is not null;

-- Existing accounts get a profile; users without a valid existing username are prompted in-app.
-- Resolve legacy case-variant duplicates deterministically before populating the unique index.
insert into public.list_r_profiles_v2 (user_id, username)
select u.id, null from auth.users as u
on conflict (user_id) do nothing;

with candidates as (
  select u.id,
    pg_catalog.lower(pg_catalog.btrim(u.raw_user_meta_data ->> 'username')) as username,
    pg_catalog.row_number() over (
      partition by pg_catalog.lower(pg_catalog.btrim(u.raw_user_meta_data ->> 'username'))
      order by u.created_at, u.id
    ) as name_rank
  from auth.users as u
  where pg_catalog.lower(pg_catalog.btrim(coalesce(u.raw_user_meta_data ->> 'username', ''))) ~ '^[a-z0-9][a-z0-9_]{2,19}$'
)
update public.list_r_profiles_v2 as p
set username = c.username
from candidates as c
where p.user_id = c.id and c.name_rank = 1 and p.username is null;

create or replace function public.provision_list_r_profile_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  v_username := pg_catalog.lower(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if v_username = '' then
    raise exception 'A ListR username is required for a new account.' using errcode = '22023';
  elsif v_username !~ '^[a-z0-9][a-z0-9_]{2,19}$' then
    raise exception 'Username must be 3–20 letters, numbers, or underscores, and start with a letter or number.' using errcode = '22023';
  end if;
  insert into public.list_r_profiles_v2 (user_id, username)
  values (new.id, v_username)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.provision_list_r_profile_v2() from public, anon, authenticated;
drop trigger if exists provision_list_r_profile_v2 on auth.users;
create trigger provision_list_r_profile_v2
  after insert on auth.users
  for each row execute function public.provision_list_r_profile_v2();

create table if not exists public.list_r_friendships_v2 (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.list_r_profiles_v2 (user_id) on delete cascade,
  user_high uuid not null references public.list_r_profiles_v2 (user_id) on delete cascade,
  requested_by uuid not null references public.list_r_profiles_v2 (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint list_r_friendships_v2_pair_order check (user_low < user_high),
  constraint list_r_friendships_v2_requester check (requested_by in (user_low, user_high)),
  constraint list_r_friendships_v2_pair_unique unique (user_low, user_high)
);
create index if not exists list_r_friendships_v2_low_status_idx on public.list_r_friendships_v2 (user_low, status);
create index if not exists list_r_friendships_v2_high_status_idx on public.list_r_friendships_v2 (user_high, status);

create table if not exists public.list_r_recommendations_v2 (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.list_r_profiles_v2 (user_id) on delete cascade,
  recipient_id uuid not null references public.list_r_profiles_v2 (user_id) on delete cascade,
  anilist_media_id bigint not null check (anilist_media_id > 0 and anilist_media_id <= 2147483647),
  anime_metadata jsonb not null check (pg_catalog.jsonb_typeof(anime_metadata) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default pg_catalog.now(),
  acted_at timestamptz,
  constraint list_r_recommendations_v2_not_self check (sender_id <> recipient_id),
  constraint list_r_recommendations_v2_media_match check (
    pg_catalog.jsonb_typeof(anime_metadata -> 'id') = 'number'
    and (anime_metadata ->> 'id')::numeric = anilist_media_id
    and anime_metadata ->> 'type' = 'ANIME'
    and pg_catalog.jsonb_typeof(anime_metadata -> 'title') = 'object'
  )
);
create index if not exists list_r_recommendations_v2_recipient_pending_idx
  on public.list_r_recommendations_v2 (recipient_id, created_at desc) where status = 'pending';
create index if not exists list_r_recommendations_v2_sender_idx
  on public.list_r_recommendations_v2 (sender_id, created_at desc);
create unique index if not exists list_r_recommendations_v2_one_pending
  on public.list_r_recommendations_v2 (sender_id, recipient_id, anilist_media_id) where status = 'pending';

alter table public.list_r_profiles_v2 enable row level security;
alter table public.list_r_friendships_v2 enable row level security;
alter table public.list_r_recommendations_v2 enable row level security;
revoke all on table public.list_r_profiles_v2 from public, anon, authenticated;
revoke all on table public.list_r_friendships_v2 from public, anon, authenticated;
revoke all on table public.list_r_recommendations_v2 from public, anon, authenticated;
grant select on table public.list_r_profiles_v2 to authenticated;
grant select on table public.list_r_friendships_v2 to authenticated;
grant select on table public.list_r_recommendations_v2 to authenticated;
grant all on table public.list_r_profiles_v2 to service_role;
grant all on table public.list_r_friendships_v2 to service_role;
grant all on table public.list_r_recommendations_v2 to service_role;

create policy list_r_profiles_v2_select_self on public.list_r_profiles_v2
  for select to authenticated using ((select auth.uid()) = user_id);
create policy list_r_friendships_v2_select_participant on public.list_r_friendships_v2
  for select to authenticated using ((select auth.uid()) in (user_low, user_high));
create policy list_r_recommendations_v2_select_recipient on public.list_r_recommendations_v2
  for select to authenticated using ((select auth.uid()) = recipient_id);

create or replace function public.set_list_r_profile_username_v2(p_username text)
returns table(user_id uuid, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if v_username !~ '^[a-z0-9][a-z0-9_]{2,19}$' then
    raise exception 'Username must be 3–20 characters: letters, numbers, or underscores; it must start with a letter or number.' using errcode = '22023';
  end if;
  insert into public.list_r_profiles_v2 (user_id, username) values (v_uid, null) on conflict (user_id) do nothing;
  update public.list_r_profiles_v2 as p set username = v_username, updated_at = pg_catalog.now()
    where p.user_id = v_uid and p.username is null;
  if not found then
    if exists (select 1 from public.list_r_profiles_v2 as p where p.user_id = v_uid and p.username = v_username) then
      return query select v_uid, v_username;
      return;
    end if;
    raise exception 'A username is already set for this account.' using errcode = '23505';
  end if;
  return query select v_uid, v_username;
exception when unique_violation then
  raise exception 'That username is already taken. Choose another.' using errcode = '23505';
end;
$$;

create or replace function public.get_my_list_r_profile_v2()
returns table(user_id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.username
  from public.list_r_profiles_v2 as p
  where p.user_id = (select auth.uid())
$$;

create or replace function public.is_list_r_username_available_v2(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_username text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if v_username !~ '^[a-z0-9][a-z0-9_]{2,19}$' then return false; end if;
  return not exists (select 1 from public.list_r_profiles_v2 as p where p.username = v_username);
end;
$$;

create or replace function public.search_list_r_users_v2(p_username_prefix text)
returns table(user_id uuid, username text, relationship text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_prefix text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username_prefix, '')));
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if pg_catalog.length(v_prefix) < 3 or v_prefix !~ '^[a-z0-9_]+$' then return; end if;
  return query
  select p.user_id, p.username,
    coalesce(f.status, 'none')
  from public.list_r_profiles_v2 as p
  left join public.list_r_friendships_v2 as f
    on f.user_low = least(v_uid, p.user_id) and f.user_high = greatest(v_uid, p.user_id)
  where p.user_id <> v_uid and p.username is not null
    and pg_catalog.left(p.username, pg_catalog.length(v_prefix)) = v_prefix
  order by p.username
  limit 20;
end;
$$;

create or replace function public.send_list_r_friend_request_v2(p_target_user_id uuid)
returns table(friendship_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_low uuid; v_high uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_target_user_id is null or p_target_user_id = v_uid then raise exception 'You cannot add yourself as a friend.' using errcode = '22023'; end if;
  if not exists (select 1 from public.list_r_profiles_v2 p where p.user_id = v_uid and p.username is not null)
     or not exists (select 1 from public.list_r_profiles_v2 p where p.user_id = p_target_user_id and p.username is not null) then
    raise exception 'A username is required before sending a friend request.' using errcode = '23503';
  end if;
  v_low := least(v_uid, p_target_user_id); v_high := greatest(v_uid, p_target_user_id);
  insert into public.list_r_friendships_v2 (user_low, user_high, requested_by)
  values (v_low, v_high, v_uid) returning id into v_id;
  return query select v_id, 'pending'::text;
exception when unique_violation then
  raise exception 'A friendship or request already exists.' using errcode = '23505';
end;
$$;

create or replace function public.respond_list_r_friend_request_v2(p_friendship_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_requester uuid; v_status text;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select f.requested_by, f.status into v_requester, v_status
    from public.list_r_friendships_v2 f
    where f.id = p_friendship_id and v_uid in (f.user_low, f.user_high);
  if not found or v_status <> 'pending' or v_requester = v_uid then
    raise exception 'This incoming friend request is unavailable.' using errcode = '42501';
  end if;
  if p_accept then
    update public.list_r_friendships_v2 set status = 'accepted', updated_at = pg_catalog.now() where id = p_friendship_id;
    return 'accepted';
  end if;
  delete from public.list_r_friendships_v2 where id = p_friendship_id;
  return 'declined';
end;
$$;

create or replace function public.remove_list_r_friend_v2(p_friendship_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_deleted integer;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  delete from public.list_r_friendships_v2 f where f.id = p_friendship_id and v_uid in (f.user_low, f.user_high);
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

create or replace function public.list_list_r_friends_v2()
returns table(friendship_id uuid, friend_user_id uuid, username text, status text, incoming boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  return query
  select f.id, p.user_id, p.username, f.status, (f.status = 'pending' and f.requested_by <> v_uid), f.created_at
  from public.list_r_friendships_v2 f
  join public.list_r_profiles_v2 p on p.user_id = case when f.user_low = v_uid then f.user_high else f.user_low end
  where v_uid in (f.user_low, f.user_high)
  order by case when f.status = 'pending' and f.requested_by <> v_uid then 0 else 1 end, f.created_at desc;
end;
$$;

create or replace function public.get_list_r_friend_stats_v2(p_friend_user_id uuid)
returns table(total_anime bigint, watching bigint, completed bigint, interested bigint, watched_episodes bigint, watched_minutes numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not exists (select 1 from public.list_r_friendships_v2 f where f.status = 'accepted'
    and f.user_low = least(v_uid, p_friend_user_id) and f.user_high = greatest(v_uid, p_friend_user_id)) then
    raise exception 'Friend statistics are available only for an accepted friend.' using errcode = '42501';
  end if;
  return query
  select count(*)::bigint,
    count(*) filter (where a.category = 'watching')::bigint,
    count(*) filter (where a.category = 'completed')::bigint,
    count(*) filter (where a.category = 'interested')::bigint,
    coalesce(sum(a.watched_episodes) filter (where a.category in ('watching','completed')),0)::bigint,
    coalesce(sum(case when a.category in ('watching','completed')
      and pg_catalog.jsonb_typeof(a.anime_metadata -> 'duration') = 'number'
      and (a.anime_metadata ->> 'duration')::numeric > 0
      then a.watched_episodes::numeric * (a.anime_metadata ->> 'duration')::numeric else 0 end),0)
  from public.anime_records a where a.user_id = p_friend_user_id;
end;
$$;

create or replace function public.create_list_r_recommendation_v2(p_recipient_id uuid, p_media_id bigint, p_metadata jsonb)
returns table(recommendation_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_created timestamptz;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_recipient_id is null or p_recipient_id = v_uid or p_media_id is null or p_media_id < 1 or p_media_id > 2147483647 then
    raise exception 'A valid friend and AniList anime are required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.list_r_friendships_v2 f where f.status = 'accepted'
    and f.user_low = least(v_uid,p_recipient_id) and f.user_high = greatest(v_uid,p_recipient_id)) then
    raise exception 'Recommendations can only be sent to an accepted friend.' using errcode = '42501';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    or p_metadata ->> 'type' <> 'ANIME'
    or pg_catalog.jsonb_typeof(p_metadata -> 'id') <> 'number'
    or (p_metadata ->> 'id')::numeric <> p_media_id
    or pg_catalog.jsonb_typeof(p_metadata -> 'title') <> 'object'
    or coalesce(p_metadata -> 'title' ->> 'userPreferred', p_metadata -> 'title' ->> 'english', p_metadata -> 'title' ->> 'romaji', '') = ''
    or coalesce((p_metadata ->> 'isAdult')::boolean, true) then
    raise exception 'AniList did not provide valid, non-adult anime metadata for this recommendation.' using errcode = '22023';
  end if;
  insert into public.list_r_recommendations_v2 (sender_id, recipient_id, anilist_media_id, anime_metadata)
  values (v_uid, p_recipient_id, p_media_id, p_metadata)
  returning id, list_r_recommendations_v2.created_at into v_id, v_created;
  return query select v_id, v_created;
exception when unique_violation then
  raise exception 'This anime is already pending as a recommendation to this friend.' using errcode = '23505';
end;
$$;

create or replace function public.list_received_list_r_recommendations_v2()
returns table(recommendation_id uuid, sender_user_id uuid, sender_username text, anilist_media_id bigint, anime_metadata jsonb, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  return query
  select r.id, r.sender_id, p.username, r.anilist_media_id, r.anime_metadata, r.status, r.created_at
  from public.list_r_recommendations_v2 r
  join public.list_r_profiles_v2 p on p.user_id = r.sender_id
  where r.recipient_id = v_uid and r.status = 'pending'
  order by r.created_at desc
  limit 100;
end;
$$;

create or replace function public.act_on_list_r_recommendation_v2(p_recommendation_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_status text;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_action not in ('dismiss') then raise exception 'Invalid recommendation action.' using errcode = '22023'; end if;
  update public.list_r_recommendations_v2 r set status = 'dismissed', acted_at = pg_catalog.now()
    where r.id = p_recommendation_id and r.recipient_id = v_uid and r.status = 'pending'
    returning r.status into v_status;
  if v_status is null then raise exception 'This recommendation is unavailable.' using errcode = '42501'; end if;
  return v_status;
end;
$$;

-- Only the server-side Edge Function may finalize acceptance after the recipient-owned
-- anime_records row has been saved successfully.
create or replace function public.finalize_list_r_recommendation_v2(p_recommendation_id uuid, p_recipient_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required.' using errcode = '42501'; end if;
  update public.list_r_recommendations_v2 r set status = 'accepted', acted_at = pg_catalog.now()
    where r.id = p_recommendation_id and r.recipient_id = p_recipient_id and r.status in ('pending','accepted')
    returning r.status into v_status;
  if v_status is null then raise exception 'This recommendation is unavailable.' using errcode = '42501'; end if;
  return v_status;
end;
$$;

-- All exposed RPCs are callable only by authenticated ListR users, except server-only acceptance finalization.
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_list_r_profile_username_v2(text)', 'get_my_list_r_profile_v2()', 'is_list_r_username_available_v2(text)',
    'search_list_r_users_v2(text)', 'send_list_r_friend_request_v2(uuid)', 'respond_list_r_friend_request_v2(uuid,boolean)',
    'remove_list_r_friend_v2(uuid)', 'list_list_r_friends_v2()', 'get_list_r_friend_stats_v2(uuid)',
    'create_list_r_recommendation_v2(uuid,bigint,jsonb)', 'list_received_list_r_recommendations_v2()',
    'act_on_list_r_recommendation_v2(uuid,text)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon', fn);
    execute pg_catalog.format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;
revoke all on function public.finalize_list_r_recommendation_v2(uuid,uuid) from public, anon, authenticated;
grant execute on function public.finalize_list_r_recommendation_v2(uuid,uuid) to service_role;

commit;
