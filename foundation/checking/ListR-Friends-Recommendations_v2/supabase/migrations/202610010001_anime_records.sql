-- ListR / Afterglow user-owned anime library.
-- Run this migration in the Supabase SQL Editor or with `supabase db push`.
-- The browser uses only the project's publishable key; RLS is the authorization boundary.

begin;

create table if not exists public.anime_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  anilist_media_id bigint not null check (anilist_media_id > 0),
  category text not null check (category in ('watching', 'completed', 'interested')),
  watched_episodes integer not null default 0 check (watched_episodes >= 0),
  anime_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(anime_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint anime_records_user_media_unique unique (user_id, anilist_media_id),
  constraint anime_records_watched_within_total check (
    case
      when jsonb_typeof(anime_metadata -> 'episodes') = 'number'
        and (anime_metadata ->> 'episodes')::numeric > 0
      then watched_episodes <= floor((anime_metadata ->> 'episodes')::numeric)::integer
      else true
    end
  )
);

create index if not exists anime_records_user_id_idx
  on public.anime_records (user_id);

create or replace function public.set_anime_records_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_anime_records_updated_at() from public, anon, authenticated;

drop trigger if exists anime_records_set_updated_at on public.anime_records;
create trigger anime_records_set_updated_at
  before update on public.anime_records
  for each row execute function public.set_anime_records_updated_at();

alter table public.anime_records enable row level security;

-- The frontend has no reason to expose a signed-out table API.
revoke all on table public.anime_records from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.anime_records to authenticated;

drop policy if exists anime_records_select_own on public.anime_records;
create policy anime_records_select_own
  on public.anime_records for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists anime_records_insert_own on public.anime_records;
create policy anime_records_insert_own
  on public.anime_records for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists anime_records_update_own on public.anime_records;
create policy anime_records_update_own
  on public.anime_records for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists anime_records_delete_own on public.anime_records;
create policy anime_records_delete_own
  on public.anime_records for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;
