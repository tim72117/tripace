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
                // 首次載入(store 尚未建立):顯示骨架屏而非單純轉圈。
                ChannelListSkeleton()
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
        Group {
            // 尚無資料且仍在載入 → 骨架屏;否則顯示真實列表。
            if store.channels.isEmpty && store.isLoading {
                ChannelListSkeleton()
            } else {
                List {
                    ForEach(store.channels) { channel in
                        NavigationLink(value: channel) {
                            ChannelRow(channel: channel)
                        }
                        .listRowSeparator(.hidden)
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
            }
        }
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

/// 頻道列表的骨架屏:一疊灰色佔位列 + 流光,版面比照 ChannelRow。
private struct ChannelListSkeleton: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<8, id: \.self) { _ in
                ChannelRowSkeleton()
            }
            Spacer()
        }
        .shimmering()
        .accessibilityLabel("載入中")
    }
}

/// 單列骨架:左方頭像方塊 + 兩行文字佔位 + 右側時間佔位(對齊 ChannelRow)。
private struct ChannelRowSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            SkeletonBlock(height: 44, cornerRadius: 22) // 圓形頭像佔位(半徑=寬高一半)
                .frame(width: 44)
            VStack(alignment: .leading, spacing: 6) {
                SkeletonBlock(width: 120, height: 13)
                SkeletonBlock(width: 200, height: 11)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                SkeletonBlock(width: 36, height: 10)
                SkeletonBlock(width: 28, height: 10)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }
}

private struct ChannelRow: View {
    let channel: Channel

    var body: some View {
        HStack(spacing: 12) {
            Circle()
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
