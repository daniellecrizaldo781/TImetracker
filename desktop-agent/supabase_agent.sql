-- ============================================================================
-- Desktop Agent support (Option B) — run once in Supabase SQL Editor
-- 1) Public storage bucket for screenshot JPFs (agent uploads with anon key)
-- 2) tt_record_screenshot SECURITY DEFINER RPC so the agent can INSERT a row
--    into public.screenshots without a service-role key (RLS bypassed by the
--    function owner = postgres).
-- ===========================================================================

-- 1. Storage bucket (public so the anon-key agent can write and the gallery can read)
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

-- allow anon + authenticated to INSERT objects into the bucket
drop policy if exists "screenshot insert anon" on storage.objects;
create policy "screenshot insert anon" on storage.objects
  for insert with check (bucket_id = 'screenshots');
drop policy if exists "screenshot read anon" on storage.objects;
create policy "screenshot read anon" on storage.objects
  for select using (bucket_id = 'screenshots');

-- 2. RPC to write the metadata row (agent posts employee id + file name)
create or replace function public.tt_record_screenshot(p_employee_id uuid, p_file_id text)
returns jsonb
language plpgsql security definer
as $$
declare v jsonb;
begin
  insert into public.screenshots (employee_id, file_id, captured_at, activity_pct)
  values (p_employee_id, p_file_id, now(), null);
  return jsonb_build_object('ok', true, 'employee_id', p_employee_id, 'file_id', p_file_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
grant execute on function public.tt_record_screenshot(uuid, text) to anon, authenticated;

-- 3. Function the GALLERY uses to fetch screenshot images as a resized URL
--    (public bucket → direct /storage/v1/object/public/... URL works already,
--     so no extra function needed; the gallery just builds the URL.)
