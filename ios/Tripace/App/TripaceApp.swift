import SwiftUI

@main
struct ChannelApp: App {
    /// 後端 base URL,依 build 組態與執行環境自動切換:
    /// - Debug + 模擬器:localhost,直連這台 Mac 上的 dev server(模擬器與 Mac 共用網路)。
    /// - Debug + 實機:Tailscale IP,實機不在 Mac 上,經 Tailscale 連 Mac 的 dev server。
    /// - Release(正式):GCP Cloud Run。
    /// 注意:dev 為明文 HTTP,需在 Info.plist 的 ATS 例外/local networking 允許才連得上。
    private static var backendBaseURL: URL {
        #if DEBUG
        #if targetEnvironment(simulator)
        return URL(string: "http://localhost:8080/v1")!
        #else
        return URL(string: "http://100.65.2.62:8080/v1")!
        #endif
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
