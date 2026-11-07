# Time Tracker (browser-based)

A Hubstaff-inspired time tracker that runs entirely **in the browser** — no desktop
app, no installer, no executable. Employees and admins use it over the web.

- **Employee page** (`employee.html`): login, project/task, start / break / resume / stop,
  live elapsed counter, today's total, activity %, screenshot capture status.
- **Admin dashboard** (`admin.html`): working / idle / on break / offline overview,
  tracked hours, activity %, screenshot gallery, timesheets, daily/weekly/monthly reports,
  projects, settings, and filters (employee, status, date).

## How it stores data

Two modes, controlled by `BACKEND_URL` in `js/config.js`:

| Mode | When | Where data lives |
|------|------|------------------|
| **Backend (live)** | `BACKEND_URL` set to your Apps Script `/exec` URL | Google Spreadsheet + Drive (shared, synced, protected) |
| **Demo** | `BACKEND_URL` empty (default) | This browser only (localStorage) |

Demo mode is for testing the UI **only**. It never claims to be real tracking and shows a
clear banner. Real tracking requires deploying the backend.

## Go live (backend)

1. Create a Google Spreadsheet (the database) and a Drive folder (for screenshots).
2. Open **Extensions → Apps Script** on the spreadsheet, paste `backend/Code.gs`.
3. Set `SPREADSHEET_ID`, `SCREENSHOT_FOLDER_ID`, and a real `ADMIN_PASSWORD` in `Code.gs`.
4. **Deploy → New deployment → Web app**; *Execute as* = Me, *Who has access* = "Anyone
   with Google account" (recommended) or "Anyone".
5. Copy the `/exec` URL into `js/config.js` → `BACKEND_URL`.
6. Run `setup()` once, then add employees via the Employees sheet or `SeedEmployees.gs`.

## Privacy & transparency (by design)

- Screen capture uses the browser's **explicit** screen-share permission (`getDisplayMedia`).
  It never bypasses the picker, never runs during breaks, and stops when you revoke it.
  If permission is denied or unsupported, **no screenshot is recorded or claimed**.
- Activity is measured only from in-page mouse/keyboard interaction **counts** —
  no typed content, passwords, or clipboard are ever read or stored, and it is never
  presented as system-wide activity.
- A visible indicator shows whenever capture/tracking is active.
- Idle detection uses a configurable threshold; original records are preserved and idle
  adjustments only layer on top (never silently delete time).

## Browser limitations (honest)

No browser can do continuous background system-wide monitoring (that needs a desktop
agent, which we're intentionally not building). What browsers *can* do is what this app
uses: in-page activity measurement and consented screen capture while the page is open.
These limits are surfaced in the UI rather than faked.
