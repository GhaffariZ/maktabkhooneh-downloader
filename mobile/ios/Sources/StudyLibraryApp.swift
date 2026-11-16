import Foundation
import NodeMobile
import Security
import SwiftUI
import WebKit

private let dashboard = URL(string: "http://127.0.0.1:3210/")!

@main
@MainActor
struct StudyLibraryApp: App {
    @StateObject private var engine = MobileEngine()

    var body: some Scene {
        WindowGroup {
            Group {
                if let error = engine.error {
                    ContentUnavailableView("برنامه راه‌اندازی نشد", systemImage: "exclamationmark.circle", description: Text(error))
                } else if let request = engine.request {
                    DashboardView(request: request)
                } else {
                    ProgressView("در حال باز کردن کتابخانه…")
                }
            }
            .task { await engine.start() }
        }
    }
}

@MainActor
private final class MobileEngine: ObservableObject {
    @Published private(set) var request: URLRequest?
    @Published private(set) var error: String?
    private var started = false

    func start() async {
        guard !started else { return }
        started = true
        do {
            let manager = FileManager.default
            guard let assets = Bundle.main.url(forResource: "app", withExtension: nil) else {
                throw CocoaError(.fileNoSuchFile)
            }
            var profile = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                          appropriateFor: nil, create: true).appendingPathComponent("LibraryData")
            try manager.createDirectory(at: profile, withIntermediateDirectories: true)
            var resources = URLResourceValues()
            resources.isExcludedFromBackup = true
            try profile.setResourceValues(resources)

            let ready = profile.appendingPathComponent("ready-\(UUID().uuidString)")
            defer { try? manager.removeItem(at: ready) }
            let token = try Self.makeToken()
            var args = ["node", assets.appendingPathComponent("mobile.mjs").path, profile.path, ready.path, token]
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--demo") { args.append("--demo") }
            #endif
            let launchArgs = args
            DispatchQueue.global(qos: .userInitiated).async {
                Self.runNode(launchArgs)
            }

            for _ in 0..<150 {
                if (try? String(contentsOf: ready, encoding: .utf8)) == dashboard.absoluteString {
                    let url = dashboard.appendingPathComponent("__mobile").appendingPathComponent("start")
                    var bootstrap = URLRequest(url: url)
                    bootstrap.setValue(token, forHTTPHeaderField: "X-MK-Mobile-Token")
                    request = bootstrap
                    return
                }
                try await Task.sleep(for: .milliseconds(200))
            }
            error = "سرور محلی آماده نشد. برنامه را ببندید و دوباره باز کنید."
        } catch {
            self.error = "فایل‌های برنامه یا حافظه محلی در دسترس نیستند."
        }
    }

    private static func makeToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }
        guard status == errSecSuccess else { throw CocoaError(.fileWriteUnknown) }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func runNode(_ arguments: [String]) {
        var pointers = arguments.map { strdup($0) }
        defer { pointers.forEach { free($0) } }
        guard pointers.allSatisfy({ $0 != nil }) else { return }
        pointers.append(nil)
        pointers.withUnsafeMutableBufferPointer { buffer in
            _ = node_start(Int32(arguments.count), buffer.baseAddress)
        }
    }
}

private struct DashboardView: UIViewRepresentable {
    let request: URLRequest

    func makeCoordinator() -> Navigation { Navigation() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.load(request)
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Navigation: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = action.request.url
            let insideApp = url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == 3210
            decisionHandler(insideApp ? .allow : .cancel)
        }
    }
}
