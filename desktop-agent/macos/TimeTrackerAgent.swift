// ============================================================================
// TimeTrackerAgent.swift — macOS desktop capture agent (Option B)
// Captures the whole screen using ScreenCaptureKit (macOS 12.3+). Apple's TCC
// requires a ONE-TIME Screen Recording grant (System Settings > Privacy &
// Security > Screen Recording > allow this terminal/app). After that grant,
// capture runs silently on the configured interval — no per-capture prompt.
//
// Build:  swiftc -framework ScreenCaptureKit -o TimeTrackerAgent TimeTrackerAgent.swift
// Run:    ./TimeTrackerAgent agent.config.json
//
// Upload target: Supabase Storage + tt_record_screenshot RPC (see supabase SQL).
// ============================================================================
import Foundation
import ScreenCaptureKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct Config: Decodable {
    var SupabaseUrl: String = ""
    var SupabaseAnonKey: String = ""
    var StorageBucket: String = "screenshots"
    var EmployeeId: String = ""
    var CaptureIntervalSeconds: Int = 600
    var JpgQuality: Int = 70
    var QueueDir: String = ""
    var LogFile: String = ""
    var Enabled: Bool = true
}

func log(_ msg: String, cfg: Config) {
    let line = "[\(Date())] \(msg)"
    print(line)
    if !cfg.LogFile.isEmpty {
        let s = line + "\n"
        if let d = s.data(using: .utf8), let fh = FileHandle(forWritingAtPath: cfg.LogFile) {
            defer { try? fh.close() }
            _ = try? fh.seekToEnd()
            try? fh.write(contentsOf: d)
        } else {
            FileManager.default.createFile(atPath: cfg.LogFile, contents: d.data(using: .utf8))
        }
    }
}

func jpegData(from image: CGImage, quality: Int) -> Data? {
    let data = NSMutableData()
    let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
    guard let d = dest else { return nil }
    let opts = [kCGImageDestinationLossyCompressionQuality as String: Double(quality) / 100.0]
    CGImageDestinationAddImage(d, image, opts as CFDictionary)
    guard CGImageDestinationFinalize(d) else { return nil }
    return data as Data
}

@available(macOS 12.3, *)
func captureScreen() async -> Data? {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { return nil }
        let config = SCStreamConfiguration()
        config.width = Int(display.width * 2)   // 2x for quality
        config.height = Int(display.height * 2)
        config.showsCursor = true
        config.capturesAudio = false
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        return jpegData(from: image, quality: cfgQuality)
    } catch {
        return nil
    }
}

// not used in capture func; keep quality out of async scope
var cfgQuality: Int = 70

private func post(_ url: URL, body: Data?, headers: [String: String], jpeg: Data?) throws -> Bool {
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    if jpeg != nil { req.setValue("image/jpeg", forHTTPHeaderField: "Content-Type") }
    req.httpBody = body ?? (jpeg ?? Data())
    let (_, resp) = try URLSession.shared.data(for: req)
    return (resp as? HTTPURLResponse)?.statusCode ?? 0 < 400
}

func main() {
    let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "agent.config.json"
    let data = (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data()
    let cfg = (try? JSONDecoder().decode(Config.self, from: data)) ?? Config()
    cfgQuality = cfg.JpgQuality
    log("Agent started (macOS silent capture). Interval=\(cfg.CaptureIntervalSeconds)s", cfg: cfg)
    if #available(macOS 12.3, *) {
        // check screen-recording permission: CGPreflightScreenCaptureAccess
        let granted = CGPreflightScreenCaptureAccess()
        if !granted { log("WARNING: Screen Recording permission not granted yet. Grant it in System Settings > Privacy & Security > Screen Recording, then restart.", cfg: cfg) }

        // run the loop in an async task and keep the main thread alive
        let group = DispatchGroup(); group.enter()
        Task {
            while true {
                if cfg.Enabled {
                    if let jpg = await captureScreen() {
                        let name = "shot_\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
                        let localDir = cfg.QueueDir.isEmpty ? NSTemporaryDirectory() : cfg.QueueDir
                        try? FileManager.default.createDirectory(atPath: localDir, withIntermediateDirectories: true)
                        let localPath = localDir + name
                        try? jpg.write(to: URL(fileURLWithPath: localPath))
                        let base = cfg.SupabaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                        let url = URL(string: base + "/storage/v1/object/" + cfg.StorageBucket + "/" + name)!
                        let authHeaders = ["apikey": cfg.SupabaseAnonKey, "Authorization": "Bearer " + cfg.SupabaseAnonKey]
                        if let ok = try? post(url, body: nil, headers: authHeaders, jpeg: jpg), ok {
                            let rpc = URL(string: base + "/rest/v1/rpc/tt_record_screenshot")!
                            let body = try? JSONSerialization.data(withJSONObject: ["p_employee_id": cfg.EmployeeId, "p_file_id": name])
                            let jsonHeaders = ["apikey": cfg.SupabaseAnonKey, "Authorization": "Bearer " + cfg.SupabaseAnonKey, "Content-Type": "application/json"]
                            if let ok2 = try? post(rpc, body: body, headers: jsonHeaders, jpeg: nil), ok2 {
                                try? FileManager.default.removeItem(atPath: localPath)
                                log("uploaded \(name)", cfg: cfg)
                            }
                        }
                    }
                }
                try? await Task.sleep(nanoseconds: UInt64(cfg.CaptureIntervalSeconds) * 1_000_000_000)
            }
        }
        group.wait() // keep process alive
    } else {
        log("ScreenCaptureKit requires macOS 12.3+.", cfg: cfg)
    }
}
main()
