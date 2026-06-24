import SwiftUI

@main
struct ChannelApp: App {
    // 依賴注入點:接 Golang 後端(server/)。
    // 要離線用假資料時,改回 AppState(backend: MockBackendService())。
    @State private var app = AppState(
        backend: HTTPBackendService(baseURL: URL(string: "http://100.65.2.62:8080/v1")!)
    )

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }
}
