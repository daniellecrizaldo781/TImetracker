// ============================================================================
// TimeTrackerAgent.swift — macOS desktop agent — ACTIVE APP tracking (Option A)
// Every sampleIntervalSeconds it records the FRONTMOST app + running apps via
// NSWorkspace (text only — no screenshots, no keystrokes) and POSTs to Supabase
// through tt_record_app_usage. macOS 11+.
//
// Reading the frontmost APP NAME via NSWorkspace needs NO Screen Recording grant.
// Reading the active WINDOW TITLE via AX (accessibility) WOULD need the
// Accessibility grant — disabled by default; set WINDOW_TITLES=1 to enable.
//
// Build:  swiftc -o TimeTrackerAgent TimeTrackerAgent.swift
// Run:    ./TimeTrackerAgent agent.config.json
// ============================================================================
import Foundation
import AppKit

struct Config: Decodable {
    var SupabaseUrl: String = ""
    var SupabaseAnonKey: String = ""
    var EmployeeId: String = ""
    var SampleIntervalSeconds: Int = 60
    var LogFile: String = ""
    var Enabled: Bool = true
    var MaxAppsLog: Int = 4
}

func log(_ msg: String, cfg: Config) {
    let line = "[\(Date())] \(msg)"
    print(line)
    if !cfg.LogFile.isEmpty, let d = (line + "\n").data(using: .utf8) {
        if let fh = FileHandle(forWritingAtPath: cfg.LogFile) {
            defer { try? fh.close() }
            _ = try? fh.seekToEnd()
            try? fh.write(contentsOf: d)
        } else {
            FileManager.default.createFile(atPath: cfg.LogFile, contents: d)
        }
    }
}

private func postJson(_ url: URL, object: [String: Any], anon: String) throws -> Bool {
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue(anon, forHTTPHeaderField: "apikey")
    req.setValue("Bearer " + anon, forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONSerialization.data(withJSONObject: object)
    let (_, resp) = try URLSession.shared.data(for: req)
    return (resp as? HTTPURLResponse)?.statusCode ?? 0 < 400
}

func main() {
    let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "agent.config.json"
    let data = (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data()
    let cfg = (try? JSONDecoder().decode(Config.self, from: data)) ?? Config()
    log("Agent started (macOS app tracking). Interval=\(cfg.SampleIntervalSeconds)s", cfg: cfg)

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let ws = NSWorkspace.shared

    let group = DispatchGroup(); group.enter()
    Task {
        while true {
            if cfg.Enabled {
                var running: [String] = []
                var activeName = "unknown"
                var activeTitle: String? = nil
                for a in ws.runningApplications where a.activationPolicy == .regular {
                    if running.count >= cfg.MaxAppsLog { break }
                    if let n = a.localizedName, !n.isEmpty { running.append(n) }
                }
                if let front = ws.frontmostApplication, let n = front.localizedName {
                    activeName = n
                    _ = activeTitle // placeholder; window title needs AX/Accessibility
                }
                let url = URL(string: cfg.SupabaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    + "/rest/v1/rpc/tt_record_app_usage")!
                let body: [String: Any] = [
                    "p_employee_id": cfg.EmployeeId,
                    "p_app_name": activeName,
                    "p_window_title": NSNull(),
                    "p_running": running
                ]
                let ok = (try? postJson(url, object: body, anon: cfg.SupabaseAnonKey)) ?? false
                log("active=\(activeName) running=\(running.joined(separator: ",")) \(ok ? "OK" : "FAIL")", cfg: cfg)
            }
            try? await Task.sleep(nanoseconds: UInt64(cfg.SampleIntervalSeconds) * 1_000_000_000)
        }
    }
    group.wait()
}
main()

