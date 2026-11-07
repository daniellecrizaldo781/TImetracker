-- ============================================================================
-- Desktop Agent support — ACTIVE APP TRACKING (Option A)
-- Run once in Supabase SQL Editor. Creates the app_usage table + the
-- tt_record_app_usage SECURITY DEFINER RPC that the desktop agent calls
-- (writes with just the anon key, no service key).
-- ============================================================================

create table if not exists public.app_usage (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  app_name text not null,
  window_title text,
  running_apps jsonb,
  sample_ts timestamptz not null default now()
);
create index if not exists app_usage_emp_ts on public.app_usage (employee_id, sample_ts desc);

-- RLS: employees can see their own usage; admins see all.
alter table public.app_usage enable row level security;
drop policy if exists "app_usage own" on public.app_usage;
create policy "app_usage own" on public.app_usage
  for select using (employee_id = auth.uid());
drop policy if exists "app_usage admin" on public.app_usage;
create policy "app_usage admin" on public.app_usage
  for select using (public.is_admin());

-- SECURITY DEFINER RPC: lets the agent insert even though inserts are RLS-blocked,
-- running as the function owner (postgres). Parameters match the agent POST body.
create or replace function public.tt_record_app_usage(
  p_employee_id uuid,
  p_app_name text,
  p_window_title text default null,
  p_running jsonb default null
)
returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  insert into public.app_usage (employee_id, app_name, window_title, running_apps)
  values (p_employee_id, p_app_name, p_window_title, p_running);
  return jsonb_build_object('ok', true, 'employee_id', p_employee_id, 'app', p_app_name);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
grant execute on function public.tt_record_app_usage(uuid, text, text, jsonb) to anon, authenticated;
