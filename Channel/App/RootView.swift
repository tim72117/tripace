import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        NavigationStack {
            ChannelListView()
        }
        .task { await app.auth.restore() }
    }
}

#Preview {
    RootView()
        .environment(AppState(backend: MockBackendService()))
}
