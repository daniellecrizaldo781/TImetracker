// ============================================================================
// TimeTrackerAgent.cs — Windows desktop agent — RUNNING + ACTIVE APP tracking
// (Option A). Replaces screenshot capture with a lightweight text activity log.
//
// Every sampleIntervalSeconds it reads:
//   • the FOREGROUND (active) window title + its process name   -> "active app"
//   • the list of running processes/apps                        -> "running apps"
// and POSTs each sample to Supabase via a SECURITY DEFINER RPC
// (tt_record_app_usage) so a normal anon-key client can write without a service
// key. Runs in the logged-in Windows session => NO permission prompt, NO
// on-screen indicator, and records TEXT ONLY (no images, no keystrokes).
//
// Build:  csc /r:System.Net.Http.dll TimeTrackerAgent.cs /out:TimeTrackerAgent.exe
//   (or drop into a .NET Console App project and build)
// Run:    TimeTrackerAgent.exe agent.config.json
// ============================================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

class TimeTrackerAgent
{
    class Config
    {
        public string SupabaseUrl { get; set; } = "";
        public string SupabaseAnonKey { get; set; } = "";
        public string EmployeeId { get; set; } = "";
        public int SampleIntervalSeconds { get; set; } = 60;
        public string LogFile { get; set; } = "";
        public bool Enabled { get; set; } = true;
        public int MaxAppsLog { get; set; } = 4;
    }

    static Config cfg;
    static HttpClient http = new HttpClient();
    static readonly object logLock = new object();

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    static void Log(string msg)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}";
        Console.WriteLine(line);
        if (string.IsNullOrEmpty(cfg?.LogFile)) return;
        lock (logLock)
        {
            try { Directory.CreateDirectory(Path.GetDirectoryName(cfg.LogFile)); File.AppendAllText(cfg.LogFile, line + Environment.NewLine); } catch { }
        }
    }

    // Foreground (active) app: window title + owning process name.
    static (string title, string proc) ForegroundApp()
    {
        var hwnd = GetForegroundWindow();
        var sb = new StringBuilder(512);
        GetWindowText(hwnd, sb, sb.Capacity);
        uint pid = 0;
        GetWindowThreadProcessId(hwnd, out pid);
        var title = sb.ToString().Trim();
        var proc = "unknown";
        try { using (var p = Process.GetProcessById((int)pid)) proc = p.ProcessName; } catch { }
        return (title, proc);
    }

    // Running apps: distinct process names currently alive (text only).
    static List<string> RunningApps(int max)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in Process.GetProcesses())
            {
                if (names.Count >= max) break;
                try { if (!string.IsNullOrEmpty(p.ProcessName)) names.Add(p.ProcessName); } catch { }
            }
        }
        catch { }
        var list = new List<string>(names);
        list.Sort(StringComparer.OrdinalIgnoreCase);
        return list;
    }

    static async Task<bool> RecordAppUsage(string app, string title, List<string> running)
    {
        var url = $"{cfg.SupabaseUrl.TrimEnd('/')}/rest/v1/rpc/tt_record_app_usage";
        var body = JsonSerializer.Serialize(new
        {
            p_employee_id = cfg.EmployeeId,
            p_app_name = app,
            p_window_title = title,
            p_running = running
        });
        var req = new HttpRequestMessage(HttpMethod.Post, url)
        { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("apikey", cfg.SupabaseAnonKey);
        req.Headers.Add("Authorization", "Bearer " + cfg.SupabaseAnonKey);
        var res = await http.SendAsync(req);
        return res.IsSuccessStatusCode;
    }

    static async Task RunLoop()
    {
        Log("Agent started (app tracking). Interval=" + cfg.SampleIntervalSeconds + "s");
        while (true)
        {
            try
            {
                if (!cfg.Enabled) { await Task.Delay(1000); continue; }
                var (title, proc) = ForegroundApp();
                var running = RunningApps(cfg.MaxAppsLog);
                var ok = await RecordAppUsage(proc, title, running);
                Log($"active={proc}{(string.IsNullOrEmpty(title) ? "" : " / " + title)} running={string.Join(",", running)} {(ok ? "OK" : "FAIL")}");
            }
            catch (Exception ex) { Log("err: " + ex.Message); }
            await Task.Delay(cfg.SampleIntervalSeconds * 1000);
        }
    }

    static void Main(string[] args)
    {
        var path = args.Length > 0 ? args[0] : "agent.config.json";
        try { cfg = JsonSerializer.Deserialize<Config>(File.ReadAllText(path)); }
        catch (Exception ex) { Console.WriteLine("config load failed: " + ex.Message); return; }
        Console.CancelKeyPress += (s, e) => { e.Cancel = true; Log("Agent stopping."); Environment.Exit(0); };
        RunLoop().GetAwaiter().GetResult();
    }
}
