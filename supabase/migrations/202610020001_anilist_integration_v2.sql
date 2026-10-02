begin;

create schema if not exists private;

create table if not exists private.anilist_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anilist_user_id bigint not null,
  anilist_username text not null,
  access_token text not null,
  token_expires_at timestamptz,
  oauth_state text unique,
  oauth_state_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.anilist_connections from public, anon, authenticated;

create index if not exists anilist_connections_state_idx
  on private.anilist_connections (oauth_state)
  where oauth_state is not null;

create or replace function public.sync_anilist_progress(p_items jsonb)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  item jsonb;
  uid uuid := auth.uid();
  media_id bigint;
  status text;
  category text;
  watched integer;
  total integer;
  metadata jsonb;
  changed integer := 0;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    media_id := nullif(item->>'mediaId','')::bigint;
    status := upper(coalesce(item->>'status',''));
    watched := greatest(0, floor(coalesce(nullif(item->>'progress','')::numeric, 0)))::integer;
    total := case
      when (item->>'episodes') ~ '^[0-9]+$' then greatest(0, (item->>'episodes')::integer)
      else null
    end;

    if media_id is null or media_id <= 0 then continue; end if;

    category := case
      when status in ('CURRENT','REPEATING','PAUSED') then 'watching'
      when status = 'COMPLETED' then 'completed'
      when status in ('PLANNING','DROPPED') then 'interested'
      else null
    end;
    if category is null then continue; end if;

    if total is not null and total > 0 then
      watched := least(watched, total);
    end if;

    if category = 'completed' and total is not null and total > 0 then
      watched := greatest(watched, total);
    end if;

    metadata := coalesce(item->'metadata', '{}'::jsonb);
    if total is not null and total > 0 and not (metadata ? 'episodes') then
      metadata := jsonb_set(metadata, '{episodes}', to_jsonb(total), true);
    end if;

    insert into public.anime_records (
      user_id, anilist_media_id, category, watched_episodes, anime_metadata
    )
    values (uid, media_id, category, watched, metadata)
    on conflict (user_id, anilist_media_id) do update
      set category = excluded.category,
          watched_episodes = excluded.watched_episodes,
          anime_metadata = case
            when jsonb_typeof(excluded.anime_metadata) = 'object'
            then public.anime_records.anime_metadata || excluded.anime_metadata
            else public.anime_records.anime_metadata
          end,
          updated_at = now()
      where public.anime_records.user_id = uid;

    changed := changed + 1;
  end loop;

  return changed;
end;
$$;

revoke all on function public.sync_anilist_progress(jsonb) from public, anon;
grant execute on function public.sync_anilist_progress(jsonb) to authenticated;

commit;