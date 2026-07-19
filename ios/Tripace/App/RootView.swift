import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Group {
            if app.auth.isRestoring {
                // 還原既有 session 中:顯示 loading,避免閃登入畫面。
                ProgressView()
            } else if app.auth.isSignedIn {
                NavigationStack {
                    ChannelListView()
                }
            } else {
                // 強制登入:未登入一律進登入畫面,不提供訪客瀏覽。
                LoginView()
            }
        }
        .task { await app.auth.restore() }
    }
}

#Preview {
    RootView()
        .environment(AppState(backend: MockBackendService()))
}
