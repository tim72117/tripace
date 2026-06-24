import SwiftUI

@main
struct ChannelApp: App {
    // 依賴注入點:接 Golang 後端(server/)。
    // 要離線用假資料時,改回 AppState(backend: MockBackendService())。
    @State private var app = AppState(
        backend: HTTPBackendService(baseURL: URL(string: "https://channel-server-340121279179.asia-east1.run.app/v1")!)
    )

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }
}
