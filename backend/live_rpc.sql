-- ============================================================================
-- LIVE write-through RPCs — run once in Supabase SQL Editor
-- Lets the app push admin-created/edited projects & tasks to Supabase so they
-- sync across every device (the tracker's live.js calls this with the anon key).
--
-- SECURITY NOTE: this function is SECURITY DEFINER (runs as the owner/postgres)
-- and is callable by anyone holding the anon key, which is public inside the SPA
-- anyway. It upserts by NAME and is idempotent, and only touches projects/tasks.
-- For a stricter build you can add a caller check (e.g. require a JWT claim or a
-- shared admin token) — say the word and I'll harden it.
-- ===========================================================================

create or replace function public.tt_sync_projects_tasks(
  p_projects jsonb,
  p_tasks jsonb default '[]'
)
returns jsonb language plpgsql security definer as $$
declare
  pr record; tk record;
  pid uuid; out_projects int := 0; out_tasks int := 0;
begin
  -- upsert projects by name
  for pr in select * from jsonb_to_recordset(
      coalesce(p_projects, '[]')
    ) as x(name text, is_archived boolean)
  loop
    if pr.name is null or trim(pr.name) = '' then continue; end if;
    insert into public.projects (name, is_archived)
      values (trim(pr.name), coalesce(pr.is_archived, false))
      on conflict (name) do update set is_archived = excluded.is_archived
      returning id into pid;
    out_projects := out_projects + 1;
  end loop;

  -- upsert tasks by (project_name, name)
  for tk in select * from jsonb_to_recordset(
      coalesce(p_tasks, '[]')
    ) as x(project_name text, name text, is_archived boolean)
  loop
    if tk.name is null or trim(tk.name) = '' then continue; end if;
    if tk.project_name is null or trim(tk.project_name) = '' then continue; end if;
    select id into pid from public.projects
      where lower(name) = lower(trim(tk.project_name)) limit 1;
    if pid is null then continue; end if;
    -- unique(project_id, name); idempotent
    insert into public.tasks (project_id, name, is_archived)
      values (pid, trim(tk.name), coalesce(tk.is_archived, false))
      on conflict (project_id, name) do update set is_archived = excluded.is_archived;
    out_tasks := out_tasks + 1;
  end loop;

  return jsonb_build_object('ok', true, 'projects', out_projects, 'tasks', out_tasks);
end;
$$;
grant execute on function public.tt_sync_projects_tasks(jsonb, jsonb) to anon, authenticated;
