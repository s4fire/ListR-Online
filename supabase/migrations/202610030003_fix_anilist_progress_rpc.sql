-- Fix AniList v2 progress sync JSON field mapping.
-- The browser and Edge Function use camelCase mediaId; the previous
-- jsonb_to_recordset definition asked PostgreSQL for snake_case media_id,
-- which produced NULL media IDs and therefore matched/updated zero rows.

begin;

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

  -- Build the incoming rows from the actual camelCase JSON key.
  with incoming as (
    select
      (item ->> 'mediaId')::integer as media_id,
      (item ->> 'progress')::integer as progress
    from pg_catalog.jsonb_array_elements(p_progress) as items(item)
  )
  select pg_catalog.count(*)::integer into v_matched
  from public.anime_records as anime
  join (
    select media_id, pg_catalog.max(progress) as progress
    from (
      select
        (item ->> 'mediaId')::integer as media_id,
        (item ->> 'progress')::integer as progress
      from pg_catalog.jsonb_array_elements(p_progress) as items(item)
    ) as incoming_rows
    group by media_id
  ) as incoming on incoming.media_id = anime.anilist_media_id
  where anime.user_id = (select auth.uid());

  with incoming as (
    select media_id, pg_catalog.max(progress) as progress
    from (
      select
        (item ->> 'mediaId')::integer as media_id,
        (item ->> 'progress')::integer as progress
      from pg_catalog.jsonb_array_elements(p_progress) as items(item)
    ) as incoming_rows
    group by media_id
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
