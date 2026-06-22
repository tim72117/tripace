import SwiftUI

/// 頻道列表:顯示使用者所屬頻道,可建立新頻道,點擊進入聊天。
struct ChannelListView: View {
    @Environment(AppState.self) private var app
    @State private var store: ChannelStore?
    @State private var showingNewChannel = false
    @State private var newChannelName = ""
    @State private var showingSettings = false

    var body: some View {
        Group {
            if let store {
                content(store)
            } else {
                ProgressView()
            }
        }
        .task { await setup() }
        .navigationTitle("頻道")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showingSettings = true } label: {
                    Image(systemName: app.auth.isSignedIn
                          ? "person.crop.circle.fill" : "person.crop.circle")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button { showingNewChannel = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .alert("建立頻道", isPresented: $showingNewChannel) {
            TextField("頻道名稱", text: $newChannelName)
            Button("取消", role: .cancel) { newChannelName = "" }
            Button("建立") {
                let name = newChannelName.trimmingCharacters(in: .whitespaces)
                newChannelName = ""
                guard !name.isEmpty else { return }
                Task { await store?.createChannel(name: name) }
            }
        }
    }

    @ViewBuilder
    private func content(_ store: ChannelStore) -> some View {
        List {
            ForEach(store.channels) { channel in
                NavigationLink(value: channel) {
                    ChannelRow(channel: channel)
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if store.channels.isEmpty && !store.isLoading {
                ContentUnavailableView("還沒有頻道", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("點右上角 + 建立第一個頻道"))
            }
        }
        .refreshable { await store.load() }
        .navigationDestination(for: Channel.self) { channel in
            ChatView(channel: channel)
        }
    }

    private func setup() async {
        guard store == nil else { return }
        let s = ChannelStore(backend: app.backend)
        store = s
        await s.load()
    }
}

private struct ChannelRow: View {
    let channel: Channel

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.accentColor.gradient)
                .frame(width: 44, height: 44)
                .overlay {
                    Text(String(channel.name.prefix(1)))
                        .font(.headline).foregroundStyle(.white)
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(channel.name).font(.body.weight(.medium))
                if let preview = channel.lastMessagePreview {
                    Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(channel.updatedAt, style: .time).font(.caption2).foregroundStyle(.secondary)
                Label("\(channel.memberCount)", systemImage: "person.2")
                    .font(.caption2).foregroundStyle(.secondary).labelStyle(.titleAndIcon)
            }
        }
        .padding(.vertical, 4)
    }
}
