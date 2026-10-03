-- ListR appearance preferences v2. Theme and layout are independent fields.
-- Each authenticated account can read/write only its own preference row.
begin;

create table if not exists public.list_r_appearance_preferences_v2 (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'sub-zero'
    check (theme in ('sub-zero', 'onyx', 'cosmic', 'emerald', 'soft-light')),
  layout text not null default 'current'
    check (layout in ('current', 'reworked-old', 'new')),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.list_r_appearance_preferences_v2 enable row level security;
revoke all on table public.list_r_appearance_preferences_v2 from public, anon, authenticated;
grant select, insert, update on table public.list_r_appearance_preferences_v2 to authenticated;
grant all on table public.list_r_appearance_preferences_v2 to service_role;

drop policy if exists list_r_appearance_preferences_v2_select_self on public.list_r_appearance_preferences_v2;
create policy list_r_appearance_preferences_v2_select_self
  on public.list_r_appearance_preferences_v2
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists list_r_appearance_preferences_v2_insert_self on public.list_r_appearance_preferences_v2;
create policy list_r_appearance_preferences_v2_insert_self
  on public.list_r_appearance_preferences_v2
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists list_r_appearance_preferences_v2_update_self on public.list_r_appearance_preferences_v2;
create policy list_r_appearance_preferences_v2_update_self
  on public.list_r_appearance_preferences_v2
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
