# Time Tracker (browser-based)

A Hubstaff-inspired time tracker that runs entirely **in the browser** — no desktop
app, no installer, no executable. Employees and admins use it over the web.

- **Employee page** (`employee.html`): login, project/task, start / break / resume / stop,
  live elapsed counter, today's total, activity %.
- **Admin dashboard** (`admin.html`): working / idle / on break / offline overview,
  tracked hours, activity %, timesheets, daily/weekly/monthly reports, schedule &
  attendance, payroll, employees/teams/projects, settings, and filters.

No screenshot / screen-capture feature (removed). Tracking data is time + activity only.

## Login (Supabase)
Login is **email + password on a dedicated Supabase project**
(`cnzsfbxixcfzaegayvpp.supabase.co`, separate from the Team Dashboard).
- Credentials live in `js/config.js` (`supabaseUrl`, `supabaseAnonKey`).
- The Supabase client is vendored at `assets/supabase.js`.
- If `supabaseUrl`/`supabaseAnonKey` are emptied, the app falls back to a local PIN login.

## Data storage
| Mode | When | Where data lives |
|------|------|------------------|
| **Supabase (live)** | the app is wired to the Supabase client | shared project DB (people/reference via `js/live.js`) |
| **Demo** | no Supabase / empty tables | this browser only (localStorage) |

Demo mode is for testing the UI **only** and always shows a clear banner.

## Privacy & transparency (by design)
- Only in-page mouse/keyboard interaction **counts** are measured — never typed
  content, passwords, or clipboard; never presented as system-wide activity.
- Idle detection uses a configurable threshold; original records are preserved and
  adjustments only layer on top (never silently delete time).
- No covert or hidden monitoring. No screen capture.
