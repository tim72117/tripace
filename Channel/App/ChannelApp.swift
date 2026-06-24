import SwiftUI

@main
struct ChannelApp: App {
    /// 後端 base URL,依 build 組態自動切換:
    /// - Debug(開發):dev server,經 Tailscale 連本機 Go server。
    /// - Release(正式):GCP Cloud Run。
    /// 注意:dev 為明文 HTTP,需在 Info.plist 的 ATS 例外列出該位址才連得上。
    private static var backendBaseURL: URL {
        #if DEBUG
        return URL(string: "http://100.117.181.90:8080/v1")!
        #else
        return URL(string: "https://channel-server-340121279179.asia-east1.run.app/v1")!
        #endif
    }

    // 依賴注入點:接 Golang 後端(server/)。
    // 要離線用假資料時,改回 AppState(backend: MockBackendService())。
    @State private var app = AppState(
        backend: HTTPBackendService(baseURL: backendBaseURL)
    )

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }
}
