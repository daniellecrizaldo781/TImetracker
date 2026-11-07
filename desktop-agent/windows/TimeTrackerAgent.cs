// ============================================================================
// TimeTrackerAgent.cs — Windows desktop capture agent (Option B)
// Captures the whole screen via GDI (CopyFromScreen) — this runs in the
// logged-in interactive session, so Windows does NOT show a share prompt for
// it (unlike the browser Screen Capture API). No on-screen indicator.
//
// Flow: every captureIntervalSeconds -> capture screen -> JPEG -> save to local
// queue (survives offline) -> upload JPEG to Supabase Storage -> insert a row
// in public.screenshots via a SECURITY DEFINER RPC (tt_record_screenshot) so a
// normal anon-key client can write without a service key.
//
// Build (on a machine with .NET, or via VS):  dotnet build  /  csc
//   csc /r:System.Drawing.dll /r:System.Net.Http.dll TimeTrackerAgent.cs
// Run:  TimeTrackerAgent.exe agent.config.json
// ============================================================================
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

class TimeTrackerAgent
{
    class Config
    {
        public string SupabaseUrl { get; set; } = "";
        public string SupabaseAnonKey { get; set; } = "";
        public string StorageBucket { get; set; } = "screenshots";
        public string EmployeeId { get; set; } = "";
        public int CaptureIntervalSeconds { get; set; } = 600;
        public int JpgQuality { get; set; } = 70;
        public string QueueDir { get; set; } = "";
        public string LogFile { get; set; } = "";
        public bool Enabled { get; set; } = true;
    }

    static Config cfg;
    static HttpClient http = new HttpClient();
    static readonly object logLock = new object();

    static void Log(string msg)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}";
        Console.WriteLine(line);
        if (string.IsNullOrEmpty(cfg?.LogFile)) return;
        lock (logLock)
        {
            try { File.AppendAllText(cfg.LogFile, line + Environment.NewLine); } catch { }
        }
    }

    static Config LoadConfig(string path)
    {
        var text = File.ReadAllText(path);
        return JsonSerializer.Deserialize<Config>(text);
    }

    // GDI full-screen capture: silent in the interactive session.
    static byte[] CaptureScreenJpeg(int quality)
    {
        var bounds = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
        using (var bmp = new Bitmap(bounds.Width, bounds.Height))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size);
            }
            var jpeg = ImageCodecInfo.GetImageEncoders()[1]; // jpeg
            var enc = new EncoderParameters(1);
            enc.Param[0] = new EncoderParameter(Encoder.Quality, quality);
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, jpeg, enc);
                return ms.ToArray();
            }
        }
    }

    static string QueueFile()
    {
        if (string.IsNullOrEmpty(cfg.QueueDir)) return null;
        Directory.CreateDirectory(cfg.QueueDir);
        return Path.Combine(cfg.QueueDir, $"shot_{DateTime.Now:yyyyMMdd_HHmmss_fff}.jpg");
    }

    // Upload to Supabase Storage: POST /storage/v1/object/{bucket}/{name}
    static async Task<bool> UploadToStorage(string name, byte[] jpg)
    {
        var url = $"{cfg.SupabaseUrl.TrimEnd('/')}/storage/v1/object/{cfg.StorageBucket}/{name}";
        var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new ByteArrayContent(jpg) };
        req.Headers.Add("apikey", cfg.SupabaseAnonKey);
        req.Headers.Add("Authorization", "Bearer " + cfg.SupabaseAnonKey);
        req.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        var res = await http.SendAsync(req);
        return res.IsSuccessStatusCode;
    }

    // Record row via SECURITY DEFINER RPC (runs as postgres; bypasses RLS).
    static async Task<bool> RecordScreenshot(string fileId)
    {
        var url = $"{cfg.SupabaseUrl.TrimEnd('/')}/rest/v1/rpc/tt_record_screenshot";
        var body = JsonSerializer.Serialize(new { p_employee_id = cfg.EmployeeId, p_file_id = fileId });
        var req = new HttpRequestMessage(HttpMethod.Post, url)
        { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("apikey", cfg.SupabaseAnonKey);
        req.Headers.Add("Authorization", "Bearer " + cfg.SupabaseAnonKey);
        var res = await http.SendAsync(req);
        return res.IsSuccessStatusCode;
    }

    static async Task ProcessQueue()
    {
        if (string.IsNullOrEmpty(cfg.QueueDir) || !Directory.Exists(cfg.QueueDir)) return;
        foreach (var file in Directory.GetFiles(cfg.QueueDir, "*.jpg"))
        {
            try
            {
                var bytes = File.ReadAllBytes(file);
                var name = Path.GetFileName(file);
                var ok = await UploadToStorage(name, bytes);
                if (ok && await RecordScreenshot(name)) { File.Delete(file); Log($"uploaded {name}"); }
                else Log($"upload failed, kept {name}");
            }
            catch (Exception ex) { Log($"queue err {file}: {ex.Message}"); }
        }
    }

    static async Task RunLoop()
    {
        Log("Agent started (silent capture). Interval=" + cfg.CaptureIntervalSeconds + "s");
        while (!cfg.Enabled)
        {
            await Task.Delay(1000);
        }
        while (true)
        {
            try
            {
                var jpg = CaptureScreenJpeg(cfg.JpgQuality);
                var local = QueueFile();
                if (local != null) File.WriteAllBytes(local, jpg);
                // try immediate upload; leave in queue if offline
                var name = Path.GetFileName(local ?? $"shot_{DateTime.Now:yyyyMMdd_HHmmss}.jpg");
                var uploaded = await UploadToStorage(name, jpg);
                if (uploaded && await RecordScreenshot(name)) { if (local != null && File.Exists(local)) File.Delete(local); }
            }
            catch (Exception ex) { Log("capture err: " + ex.Message); }
            await Task.Delay(cfg.CaptureIntervalSeconds * 1000);
        }
    }

    static void Main(string[] args)
    {
        var path = args.Length > 0 ? args[0] : "agent.config.json";
        try { cfg = LoadConfig(path); }
        catch (Exception ex) { Console.WriteLine("config load failed: " + ex.Message); return; }
        Console.CancelKeyPress += (s, e) => { e.Cancel = true; Log("Agent stopping."); Environment.Exit(0); };
        RunLoop().GetAwaiter().GetResult();
    }
}
