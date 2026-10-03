-- Post-overhaul production hardening.
-- The recommendation finalizer is intentionally callable only by service_role.
-- SECURITY DEFINER executes as its owner, so authorization is enforced by ACL rather than current_user.
create or replace function public.finalize_list_r_recommendation_v2(p_recommendation_id uuid, p_recipient_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  update public.list_r_recommendations_v2 r
  set status = 'accepted', acted_at = pg_catalog.now()
  where r.id = p_recommendation_id
    and r.recipient_id = p_recipient_id
    and r.status in ('pending','accepted')
  returning r.status into v_status;

  if v_status is null then
    raise exception 'This recommendation is unavailable.' using errcode = '42501';
  end if;

  return v_status;
end;
$$;

revoke execute on function public.finalize_list_r_recommendation_v2(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_list_r_recommendation_v2(uuid, uuid) to service_role;

-- This helper is an internal event-trigger function, not an API endpoint.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Covers the requested_by foreign key used by friendship/request queries.
create index if not exists list_r_friendships_v2_requested_by_idx
  on public.list_r_friendships_v2 (requested_by);
