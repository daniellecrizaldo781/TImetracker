-- ============================================================================
-- Time Tracker — full schema (run once in Supabase SQL Editor)
-- Dedicated project: cnzsfbxixcfzaegayvpp
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EMPLOYEES — links a Supabase auth user (id = auth.users.id) to a worker.
--    role: 'admin' or 'employee'
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  full_name    text not null default '',
  role         text not null default 'employee' check (role in ('admin','employee')),
  hourly_rate  numeric(10,2) not null default 0,
  currency     text not null default 'PHP',
  team         text not null default '',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1. PROJECTS and TASKS
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  is_archived boolean not null default false,
  unique (project_id, name)
);

-- ---------------------------------------------------------------------------
-- 2. SESSIONS — one row per start..stop cycle. status:
--    'active','paused','completed'
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  project_id   uuid not null references public.projects(id),
  task_id      uuid references public.tasks(id),
  started_at   timestamptz not null,
  ended_at     timestamptz,
  status       text not null default 'active' check (status in ('active','paused','completed')),
  break_ms     bigint not null default 0,          -- total break time during session
  idle_ms      bigint not null default 0,
  activity_pct numeric(5,2),                        -- 0..100, computed from real events
  is_reviewed  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_sessions_emp   on public.sessions(employee_id, started_at);
create index if not exists idx_sessions_proj  on public.sessions(project_id);

-- Tracked duration is derived: (ended - started) - break_ms.
-- We keep started_at/ended_at as authoritative timestamps.

-- ---------------------------------------------------------------------------
-- 3. BREAKS — four permitted categories (Break Management spec)
--    break_type: 'first','second','restroom','lunch'
--    status: 'in_progress','within','overbreak','admin_exception','incomplete'
-- ---------------------------------------------------------------------------
create table if not exists public.breaks (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references public.sessions(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  break_type      text not null check (break_type in ('first','second','restroom','lunch')),
  started_at      timestamptz not null,
  ended_at        timestamptz,
  allowed_min     int not null,
  actual_ms       bigint not null default 0,
  overbreak_ms    bigint not null default 0,   -- max(actual - allowed, 0)
  status          text not null default 'in_progress'
                  check (status in ('in_progress','within','overbreak','admin_exception','incomplete')),
  admin_approved  boolean not null default false,
  exception_min   int not null default 0,      -- minutes admin approved as exception
  reason          text not null default '',
  approved_by     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_breaks_emp on public.breaks(employee_id, started_at);

-- A helper view: remaining restroom allowance per day is enforced in app logic
-- (max 3/day); the view aggregates counts for the UI.
create or replace view public.restroom_usage as
select employee_id, (started_at::date) as work_date, count(*) as used
from public.breaks where break_type = 'restroom'
group by employee_id, started_at::date;

-- ---------------------------------------------------------------------------
-- 4. ACTIVITY — aggregated interaction counts (mouse + keyboard) per bucket.
--    NEVER stores keystroke content — only counts, per privacy requirement.
-- ---------------------------------------------------------------------------
create table if not exists public.activity (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid references public.sessions(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  bucket_at      timestamptz not null,          -- start of the interval bucket
  mouse_events   int not null default 0,
  key_events     int not null default 0,
  active_ms      bigint not null default 0,
  idle_ms        bigint not null default 0
);
create index if not exists idx_activity_emp on public.activity(employee_id, bucket_at);

-- ---------------------------------------------------------------------------
-- 5. SCREENSHOTS — file_id stored; image bytes live in Supabase Storage.
--    Only ever written while tracking is active + permission granted.
-- ---------------------------------------------------------------------------
create table if not exists public.screenshots (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references public.sessions(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  file_id     text not null,                    -- storage object name
  captured_at timestamptz not null default now(),
  activity_pct numeric(5,2),                    -- activity around capture time
  is_flagged  boolean not null default false,
  flag_note   text not null default '',
  flagged_by  uuid references auth.users(id)
);
create index if not exists idx_shots_emp on public.screenshots(employee_id, captured_at);

-- ---------------------------------------------------------------------------
-- 6. SCHEDULES — assigned shifts. week_copy_group lets you copy across a week.
-- ---------------------------------------------------------------------------
create table if not exists public.schedules (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id) on delete cascade,
  shift_date       date not null,
  shift_start      time not null,
  shift_end        time not null,
  break_start      time,
  break_end        time,
  grace_minutes    int not null default 5,      -- late grace
  week_copy_group  text not null default '',
  is_template      boolean not null default false,
  created_by       uuid references auth.users(id),
  unique (employee_id, shift_date)
);
create index if not exists idx_sched_emp on public.schedules(employee_id, shift_date);

-- ---------------------------------------------------------------------------
-- 7. ATTENDANCE — auto-compared from sessions vs schedules.
--    status: 'on_time','late','absent','missed_shift','abandoned','early_departure',
--            'overtime','incomplete','pending','approved'
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  schedule_id     uuid not null references public.schedules(id) on delete cascade,
  shift_date      date not null,
  actual_start    timestamptz,
  actual_end      timestamptz,
  status          text not null default 'pending',
  late_minutes    int not null default 0,
  early_minutes   int not null default 0,
  overtime_ms     bigint not null default 0,
  reason          text not null default '',
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,
  unique (employee_id, shift_date)
);
create index if not exists idx_attend_emp on public.attendance(employee_id, shift_date);

-- ---------------------------------------------------------------------------
-- 8. PAYROLL — one row per employee per pay period. hours in decimal.
--    snapshot + audit-friendly: we store the component breakdown, not just total.
-- ---------------------------------------------------------------------------
create table if not exists public.payroll (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.employees(id) on delete cascade,
  period_start           date not null,
  period_end             date not null,
  scheduled_hours        numeric(8,3) not null default 0,
  tracked_hours          numeric(8,3) not null default 0,
  break_hours            numeric(8,3) not null default 0,
  idle_hours             numeric(8,3) not null default 0,
  overbreak_hours        numeric(8,3) not null default 0,
  unapproved_ext_hours   numeric(8,3) not null default 0,
  approved_overtime_hours numeric(8,3) not null default 0,
  deducted_hours         numeric(8,3) not null default 0,
  valid_rendered_hours   numeric(8,3) not null default 0,
  hourly_rate            numeric(10,2) not null default 0,
  currency               text not null default 'PHP',
  estimated_payable      numeric(12,2) not null default 0,
  status                 text not null default 'draft'
                         check (status in ('draft','review','approved','flagged')),
  reviewed_by            uuid references auth.users(id),
  reviewed_at            timestamptz,
  unique (employee_id, period_start, period_end)
);
create index if not exists idx_payroll_emp on public.payroll(employee_id, period_start);

-- ---------------------------------------------------------------------------
-- 9. TIMESHEET ENTRIES — explicit approvals + flags over a session.
--    status: 'pending','approved','rejected','correction_requested','flagged'
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_entries (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  valid_hours     numeric(8,3) not null default 0,   -- valid rendered work hours
  status          text not null default 'pending',
  admin_note      text not null default '',
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz
);
create index if not exists idx_tse_emp on public.timesheet_entries(employee_id);

-- ---------------------------------------------------------------------------
-- 10. AUDIT LOG — every manual change / approval / correction / adjustment.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  user_email  text,
  action      text not null,
  entity      text not null,          -- e.g. 'break','payroll','attendance','timesheet'
  entity_id   uuid,
  note        text not null default '',
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_ent on public.audit_log(entity, entity_id);

-- ============================================================================
-- ALLOWED EMAILS gate + ROW LEVEL SECURITY
-- ============================================================================
create table if not exists public.allowed_emails (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;
alter table public.employees       enable row level security;
alter table public.projects        enable row level security;
alter table public.tasks           enable row level security;
alter table public.sessions        enable row level security;
alter table public.breaks          enable row level security;
alter table public.activity        enable row level security;
alter table public.screenshots     enable row level security;
alter table public.schedules       enable row level security;
alter table public.attendance      enable row level security;
alter table public.payroll         enable row level security;
alter table public.timesheet_entries enable row level security;
alter table public.audit_log       enable row level security;

-- allow_emails is publicly readable (the auth gate checks it before login)
drop policy if exists "allowed_emails public read" on public.allowed_emails;
create policy "allowed_emails public read" on public.allowed_emails
  for select using (true);

-- Everyone can read the reference data (projects, tasks) once authenticated.
drop policy if exists "projects read auth" on public.projects;
create policy "projects read auth" on public.projects for select using (auth.uid() is not null);

drop policy if exists "tasks read auth" on public.tasks;
create policy "tasks read auth" on public.tasks for select using (auth.uid() is not null);

-- ---------- EMPLOYEES: read own profile (all), full access for admins ----------
drop policy if exists "employees read" on public.employees;
create policy "employees read" on public.employees
  for select using (true);

drop policy if exists "employees insert admin" on public.employees;
create policy "employees insert admin" on public.employees
  for insert with check (
    exists (select 1 from public.employees where id = auth.uid() and role = 'admin')
  );

drop policy if exists "employees update own or admin" on public.employees;
create policy "employees update own or admin" on public.employees
  for update using (
    id = auth.uid() or
    exists (select 1 from public.employees where id = auth.uid() and role = 'admin')
  );

-- ---------- own-records policies for the shared tracking tables ----------
-- Sessions: employees manage their own; admins see/alter all.
drop policy if exists "sessions select" on public.sessions;
create policy "sessions select" on public.sessions for select using (
  employee_id = auth.uid() or is_admin()
);
drop policy if exists "sessions insert" on public.sessions;
create policy "sessions insert" on public.sessions for insert with check (
  employee_id = auth.uid()
);
drop policy if exists "sessions update" on public.sessions;
create policy "sessions update" on public.sessions for update using (
  employee_id = auth.uid() or is_admin()
);

-- Breaks
drop policy if exists "breaks select" on public.breaks;
create policy "breaks select" on public.breaks for select using (employee_id = auth.uid() or is_admin());
drop policy if exists "breaks insert" on public.breaks;
create policy "breaks insert" on public.breaks for insert with check (employee_id = auth.uid());
drop policy if exists "breaks update" on public.breaks;
create policy "breaks update" on public.breaks for update using (employee_id = auth.uid() or is_admin());

-- Activity
drop policy if exists "activity select" on public.activity;
create policy "activity select" on public.activity for select using (employee_id = auth.uid() or is_admin());
drop policy if exists "activity insert" on public.activity;
create policy "activity insert" on public.activity for insert with check (employee_id = auth.uid());

-- Screenshots are SENSITIVE: only admins may read/write (spec: restrict to admins).
drop policy if exists "screenshots admin" on public.screenshots;
create policy "screenshots admin" on public.screenshots for all using (is_admin()) with check (is_admin());

-- Schedules: admins manage; employees read their own.
drop policy if exists "schedules select" on public.schedules;
create policy "schedules select" on public.schedules for select using (employee_id = auth.uid() or is_admin());
drop policy if exists "schedules write" on public.schedules;
create policy "schedules write" on public.schedules for all using (is_admin()) with check (is_admin());

-- Attendance: admins manage; employees read their own.
drop policy if exists "attendance select" on public.attendance;
create policy "attendance select" on public.attendance for select using (employee_id = auth.uid() or is_admin());
drop policy if exists "attendance write" on public.attendance;
create policy "attendance write" on public.attendance for all using (is_admin()) with check (is_admin());

-- Payroll: admins only (pay is sensitive).
drop policy if exists "payroll admin" on public.payroll;
create policy "payroll admin" on public.payroll for all using (is_admin()) with check (is_admin());

-- Timesheet entries: admin manages; employee reads own.
drop policy if exists "tse select" on public.timesheet_entries;
create policy "tse select" on public.timesheet_entries for select using (employee_id = auth.uid() or is_admin());
drop policy if exists "tse write" on public.timesheet_entries;
create policy "tse write" on public.timesheet_entries for all using (is_admin()) with check (is_admin());

-- Audit log: admins read + write only.
drop policy if exists "audit admin" on public.audit_log;
create policy "audit admin" on public.audit_log for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Helper function is_admin() — used by RLS policies above.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from public.employees
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

-- Allow authenticated users to call the function.
grant execute on function public.is_admin() to authenticated;
grant usage on schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Bonus: ready-made inserts so the dashboard has working data immediately.
-- Admin: change the email to YOUR admin address before running.
-- ---------------------------------------------------------------------------
-- insert into public.allowed_emails (email) values ('YOU@oricle.com');
-- insert into public.employees (id, email, full_name, role, hourly_rate, currency)
--   select id, email, coalesce(raw_user_meta_data->>'full_name','Admin'), 'admin', 250, 'PHP'
--   from auth.users where email = 'YOU@oricle.com';
-- insert into public.projects (name) values ('Oricle Support'), ('Oricle Sales');
-- insert into public.tasks (project_id, name)
--   select p.id, t.name from public.projects p, (values ('Oricle Support','Inbound call'),
--    ('Oricle Support','Ticket handling'),('Oricle Sales','Lead follow-up')) as t(project,name)
--   where p.name = t.project;
