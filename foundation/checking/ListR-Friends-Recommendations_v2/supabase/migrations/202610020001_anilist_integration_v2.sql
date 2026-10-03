-- ListR AniList OAuth + progress synchronization v2.
-- OAuth secrets/tokens are server-only; browser roles have no access to these tables.
-- The progress RPC is SECURITY INVOKER and updates only the caller's existing rows.
begin;

create table if not exists public.anilist_connections_v2 (
  user_id uuid primary key references auth.users (id) on delete cascade,
  anilist_user_id integer not null check (anilist_user_id > 0),
  anilist_username text not null check (length(anilist_username) between 1 and 80),
  access_token text not null,
  token_expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_sync_requested_at timestamptz,
  connected_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.anilist_connections_v2
  add column if not exists last_sync_requested_at timestamptz;

create table if not exists public.anilist_oauth_states_v2 (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.anilist_connections_v2 enable row level security;
alter table public.anilist_oauth_states_v2 enable row level security;
-- There are deliberately no client policies or grants for the connection/token/state tables.
revoke all on table public.anilist_connections_v2 from public, anon, authenticated;
revoke all on table public.anilist_oauth_states_v2 from public, anon, authenticated;
grant all on table public.anilist_connections_v2 to service_role;
grant all on table public.anilist_oauth_states_v2 to service_role;

create or replace function public.set_anilist_connections_v2_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.set_anilist_connections_v2_updated_at() from public, anon, authenticated;
drop trigger if exists anilist_connections_v2_updated_at on public.anilist_connections_v2;
create trigger anilist_connections_v2_updated_at
  before update on public.anilist_connections_v2
  for each row execute function public.set_anilist_connections_v2_updated_at();

create or replace function public.sync_anilist_progress_v2(p_progress jsonb)
returns table(matched_count integer, updated_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_media_id numeric;
  v_progress numeric;
  v_matched integer := 0;
  v_updated integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_progress is null or pg_catalog.jsonb_typeof(p_progress) is distinct from 'array' then
    raise exception 'Progress must be a JSON array.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_progress) > 12000 then
    raise exception 'Progress array exceeds the maximum allowed size.' using errcode = '22023';
  end if;

  -- Validate every element before casting it to SQL integers.
  for v_item in select value from pg_catalog.jsonb_array_elements(p_progress) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_item -> 'mediaId') is distinct from 'number'
       or pg_catalog.jsonb_typeof(v_item -> 'progress') is distinct from 'number' then
      raise exception 'Each progress item must contain numeric mediaId and progress fields.' using errcode = '22023';
    end if;
    v_media_id := (v_item ->> 'mediaId')::numeric;
    v_progress := (v_item ->> 'progress')::numeric;
    if v_media_id < 1 or v_media_id > 2147483647 or pg_catalog.floor(v_media_id) <> v_media_id
       or v_progress < 0 or v_progress > 2147483647 or pg_catalog.floor(v_progress) <> v_progress then
      raise exception 'Progress IDs and counts must be valid non-negative AniList integers.' using errcode = '22023';
    end if;
  end loop;

  with incoming as (
    select item.media_id, pg_catalog.max(item.progress) as progress
    from pg_catalog.jsonb_to_recordset(p_progress) as item(media_id integer, progress integer)
    group by item.media_id
  )
  select pg_catalog.count(*)::integer into v_matched
  from public.anime_records as anime
  join incoming on incoming.media_id = anime.anilist_media_id
  where anime.user_id = (select auth.uid());

  with incoming as (
    select item.media_id, pg_catalog.max(item.progress) as progress
    from pg_catalog.jsonb_to_recordset(p_progress) as item(media_id integer, progress integer)
    group by item.media_id
  )
  update public.anime_records as anime
  set watched_episodes = case
    when pg_catalog.jsonb_typeof(anime.anime_metadata -> 'episodes') = 'number'
      and (anime.anime_metadata ->> 'episodes')::numeric between 1 and 2147483647
    then least(incoming.progress, pg_catalog.floor((anime.anime_metadata ->> 'episodes')::numeric)::integer)
    else incoming.progress
  end
  from incoming
  where anime.user_id = (select auth.uid())
    and incoming.media_id = anime.anilist_media_id
    and anime.watched_episodes is distinct from case
      when pg_catalog.jsonb_typeof(anime.anime_metadata -> 'episodes') = 'number'
        and (anime.anime_metadata ->> 'episodes')::numeric between 1 and 2147483647
      then least(incoming.progress, pg_catalog.floor((anime.anime_metadata ->> 'episodes')::numeric)::integer)
      else incoming.progress
    end;

  get diagnostics v_updated = row_count;
  matched_count := v_matched;
  updated_count := v_updated;
  return next;
end;
$$;
revoke all on function public.sync_anilist_progress_v2(jsonb) from public, anon;
grant execute on function public.sync_anilist_progress_v2(jsonb) to authenticated;

commit;
