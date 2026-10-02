-- Fix ListR usernames: allow printable non-whitespace characters and remove the
-- PL/pgSQL RETURNS TABLE/user_id ambiguity in the username upsert.
begin;

alter table public.list_r_profiles_v2
  drop constraint if exists list_r_profiles_v2_username_format;

alter table public.list_r_profiles_v2
  add constraint list_r_profiles_v2_username_format check (
    username is null or (
      username = pg_catalog.lower(username)
      and username ~ '^[^[:space:][:cntrl:]]{3,20}$'
    )
  );

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
  elsif v_username !~ '^[^[:space:][:cntrl:]]{3,20}$' then
    raise exception 'Username must be 3–20 characters with no spaces or control characters.' using errcode = '22023';
  end if;
  insert into public.list_r_profiles_v2 (user_id, username)
  values (new.id, v_username)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

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
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if v_username !~ '^[^[:space:][:cntrl:]]{3,20}$' then
    raise exception 'Username must be 3–20 characters with no spaces or control characters.' using errcode = '22023';
  end if;

  insert into public.list_r_profiles_v2 (user_id, username)
  values (v_uid, null)
  on conflict on constraint list_r_profiles_v2_pkey do nothing;

  update public.list_r_profiles_v2 as p
  set username = v_username, updated_at = pg_catalog.now()
  where p.user_id = v_uid and p.username is null;

  if not found then
    if exists (
      select 1
      from public.list_r_profiles_v2 as p
      where p.user_id = v_uid and p.username = v_username
    ) then
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

create or replace function public.is_list_r_username_available_v2(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if v_username !~ '^[^[:space:][:cntrl:]]{3,20}$' then
    return false;
  end if;
  return not exists (
    select 1
    from public.list_r_profiles_v2 as p
    where p.username = v_username
  );
end;
$$;

create or replace function public.search_list_r_users_v2(p_username_prefix text)
returns table(user_id uuid, username text, relationship text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username_prefix, '')));
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if pg_catalog.length(v_prefix) < 3 or v_prefix ~ '[[:space:][:cntrl:]]' then
    return;
  end if;
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

commit;
