import SwiftUI

/// 行程列表:顯示使用者所屬行程,可建立新行程,點擊進入聊天。
struct TripListView: View {
    @Environment(AppState.self) private var app
    @State private var store: TripStore?
    @State private var showingNewTrip = false
    @State private var newTripName = ""
    @State private var showingSettings = false

    var body: some View {
        Group {
            if let store {
                content(store)
            } else {
                // 首次載入(store 尚未建立):顯示骨架屏而非單純轉圈。
                TripListSkeleton()
            }
        }
        .task { await setup() }
        .navigationTitle("行程")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showingSettings = true } label: {
                    Image(systemName: app.auth.isSignedIn
                          ? "person.crop.circle.fill" : "person.crop.circle")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button { showingNewTrip = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .alert("建立行程", isPresented: $showingNewTrip) {
            TextField("行程名稱", text: $newTripName)
            Button("取消", role: .cancel) { newTripName = "" }
            Button("建立") {
                let name = newTripName.trimmingCharacters(in: .whitespaces)
                newTripName = ""
                guard !name.isEmpty else { return }
                Task { await store?.createTrip(name: name) }
            }
        }
    }

    @ViewBuilder
    private func content(_ store: TripStore) -> some View {
        Group {
            // 尚無資料且仍在載入 → 骨架屏;否則顯示真實列表。
            if store.trips.isEmpty && store.isLoading {
                TripListSkeleton()
            } else {
                List {
                    ForEach(store.trips) { trip in
                        NavigationLink(value: trip) {
                            TripRow(trip: trip)
                        }
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
                .overlay {
                    if store.trips.isEmpty && !store.isLoading {
                        ContentUnavailableView("還沒有行程", systemImage: "bubble.left.and.bubble.right",
                                               description: Text("點右上角 + 建立第一個行程"))
                    }
                }
                .refreshable { await store.load() }
            }
        }
        .navigationDestination(for: Trip.self) { trip in
            ChatView(trip: trip)
        }
    }

    private func setup() async {
        guard store == nil else { return }
        let s = TripStore(backend: app.backend)
        store = s
        await s.load()
    }
}

/// 行程列表的骨架屏:一疊灰色佔位列 + 流光,版面比照 TripRow。
private struct TripListSkeleton: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<8, id: \.self) { _ in
                TripRowSkeleton()
            }
            Spacer()
        }
        .shimmering()
        .accessibilityLabel("載入中")
    }
}

/// 單列骨架:左方頭像方塊 + 兩行文字佔位 + 右側時間佔位(對齊 TripRow)。
private struct TripRowSkeleton: View {
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

private struct TripRow: View {
    let trip: Trip

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color.accentColor.gradient)
                .frame(width: 44, height: 44)
                .overlay {
                    Text(String(trip.name.prefix(1)))
                        .font(.headline).foregroundStyle(.white)
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.name).font(.body.weight(.medium))
                if let preview = trip.lastMessagePreview {
                    Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(trip.updatedAt, style: .time).font(.caption2).foregroundStyle(.secondary)
                Label("\(trip.memberCount)", systemImage: "person.2")
                    .font(.caption2).foregroundStyle(.secondary).labelStyle(.titleAndIcon)
            }
        }
        .padding(.vertical, 4)
    }
}
