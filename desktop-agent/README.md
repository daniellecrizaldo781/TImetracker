# Desktop Capture Agent (Option B)

Silent, no-indicator desktop screen capture that uploads screenshots to Supabase.
This is the agent that captures the **whole screen without a per-screenshot prompt**.

> ⚠️ **By enabling this you chose covert monitoring.** There is no on-screen
> indicator, and screenshots are captured automatically. Notify/obtain consent
> from employees as your local law requires — that protects you legally.

## What it does
- Captures the **entire screen** (not just a browser tab) on a set interval
- Saves each JPEG to a local queue (offline-safe), then uploads to **Supabase Storage**
- Inserts a metadata row into `public.screenshots` via a Secure RPC
- No user prompt, no "sharing your screen" bar

## Platforms
| OS | File | Capture API | Permission needed |
|----|------|-------------|-------------------|
| Windows | `windows/TimeTrackerAgent.cs` | GDI `CopyFromScreen` | **None** (silent, runs in the logged-in session) |
| macOS | `macos/TimeTrackerAgent.swift` | ScreenCaptureKit | **One-time** Screen Recording grant (Apple TCC requires it) |

## One-time database setup (Supabase SQL Editor)
Run **`supabase_agent.sql`** once. It creates a **public** `screenshots` storage bucket
(anon write) and the `tt_record_screenshot(uuid, text)` RPC.

## Build

### Windows
On a machine with .NET (or Visual Studio):
```bat
csc /r:System.Drawing.dll /r:System.Net.Http.dll /r:System.Windows.Forms.dll TimeTrackerAgent.cs /out:TimeTrackerAgent.exe
```
Or drop the `.cs` into a new **Console App (.NET)** project and build. Deploy the EXE
(+ `agent.config.json`) to each employee's logged-in session. To install silently use
an Intune/AD package or the Microsoft Store — first run may trigger a one-time
SmartScreen "Allow anyway".

### macOS
```bash
swiftc -o TimeTrackerAgent TimeTrackerAgent.swift   # macOS 12.3+
./TimeTrackerAgent agent.config.json
```
First run: **System Settings → Privacy & Security → Screen Recording → enable** for
Terminal (or the agent). Grant once, then it captures silently on the interval.

## Config (`agent.config.json`)
```json
{
  "supabaseUrl": "https://cnzsfbxixcfzaegayvpp.supabase.co",
  "supabaseAnonKey": "sb_publishable_...",
  "storageBucket": "screenshots",
  "employeeId": "<supabase employee uuid>",
  "captureIntervalSeconds": 600,
  "jpgQuality": 70,
  "queueDir": "...",
  "logFile": "...",
  "enabled": true
}
```
`employeeId` = the `uuid` of that employee's row in `public.employees`
(not their email). Query it with:
```sql
select id, email from public.employees;
```

## How a screenshot reaches the dashboard gallery
1. Agent → `POST /storage/v1/object/screenshots/shot_xxxx.jpg` (anon key)
2. Agent → `POST /rest/v1/rpc/tt_record_screenshot` `{p_employee_id, p_file_id}`
3. Admin gallery reads `public.screenshots` + the **public** object URL:
   `{supabaseUrl}/storage/v1/object/public/screenshots/{file_id}`

## Pause / "only while tracking"
The `enabled` flag in config is process-level. Wiring the agent to pause during
breaks and stop when tracking stops (a control loop that watches the employee's
active session) is the next step once it's proven on one real device — I'll add it
after you test a capture round-trip.
