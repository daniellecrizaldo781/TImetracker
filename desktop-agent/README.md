# Desktop Agent — Active App Tracking (Option A)

Records what the employee is actually working on — the **foreground app** and the list
of **running apps** — as text, on an interval. No screenshots, no images, no keystrokes,
no clipboard. Replaces the previous screenshot-capture agent.

> ⚠️ This is **monitoring.** There is no on-screen indicator and it logs the active
> app automatically. Notify / obtain consent from employees as your local law requires.

## What it records (into `public.app_usage`)
Every `sampleIntervalSeconds`:
- **active app** — the foreground app (e.g. `chrome`, `WINWORD`, `EXCEL`)
- **running apps** — up to `maxAppsLog` currently-open apps (text names only)
- **timestamp**, tagged to the employee id

## Platforms
| OS | File | API | Permission needed |
|----|------|-----|-------------------|
| Windows | `windows/TimeTrackerAgent.cs` | GetForegroundWindow / GetWindowText / Process | **None** (runs in the logged-in session) |
| macOS | `macos/TimeTrackerAgent.swift` | NSWorkspace (frontmost + running applications) | None for app names; window **titles** would need the Accessibility grant (disabled by default) |

## One-time database setup (Supabase SQL Editor)
Run **`supabase_app_usage.sql`** once. It creates the `app_usage` table (RLS:
employee sees own, admin sees all), indexes, and the **`tt_record_app_usage(uuid,text,text,jsonb)`**
SECURITY DEFINER RPC the agent calls with just the anon key.

## Build

### Windows
```bat
csc /r:System.Net.Http.dll windows\TimeTrackerAgent.cs /out:TimeTrackerAgent.exe
```
Or drop into a .NET Console App project and build. Deploy the EXE + `agent.config.json`
into each employee's logged-in session. First run may show a one-time SmartScreen
"More info → Run anyway" (or push via Intune/AD for silent install).

### macOS (macOS 11+)
```bash
swiftc -o TimeTrackerAgent macos/TimeTrackerAgent.swift
./TimeTrackerAgent agent.config.json
```
No Screen Recording grant needed for app names (that requirement only applies to the
old screenshot mode). If you later want active **window titles**, the app needs the
Accessibility grant and the code change flag `WINDOW_TITLES`.

## Config (`agent.config.json`)
```json
{
  "supabaseUrl": "https://cnzsfbxixcfzaegayvpp.supabase.co",
  "supabaseAnonKey": "sb_publishable_...",
  "employeeId": "<supabase employee uuid>",
  "sampleIntervalSeconds": 60,
  "logFile": "C:\\tt-agent\\agent.log",
  "enabled": true,
  "maxAppsLog": 4
}
```
`employeeId` = the `uuid` in `public.employees` (not email):
```sql
select id, email from public.employees;
```

## How a sample reaches the dashboard
1. Agent → `POST /rest/v1/rpc/tt_record_app_usage` `{p_employee_id, p_app_name, p_window_title, p_running}`
2. Admin dashboard reads `public.app_usage` and rolls it up per employee / per app.

## Current limit / next step
`enabled` is process-level. Making the agent **auto-start when the employee clocks in
and pause during breaks** is a control loop (agent watches the employee's active session)
— I'll add it once a sample round-trip is proven on one device.
