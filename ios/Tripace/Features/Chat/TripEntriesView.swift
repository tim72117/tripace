import SwiftUI

/// 行程詳情:點入某 Trip 後,把該行程的條目以時間軸(TimelineView)呈現。
/// 獨立載入(避免回流閃動),複用 ChatView 既有的 TimelineView。
/// 對應 web 的 TripEntriesScreen。
struct TripEntriesView: View {
    let trip: Trip
    /// 從 ChatStore 取該行程的條目(走後端 fetchTripEntries)。
    let loadEntries: (String) async throws -> [Entry]

    @State private var entries: [Entry] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    /// timeline 需要依 start 排序;後端排序不保證,這裡再排一次。
    /// 無 start 者排最後。
    private var sortedEntries: [Entry] {
        entries.sorted { a, b in
            switch (a.start.isEmpty, b.start.isEmpty) {
            case (true, true): return false
            case (true, false): return false
            case (false, true): return true
            default: return a.start < b.start
            }
        }
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("載入失敗", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    // 行程日期範圍(在時間軸上方)。
                    if let range = trip.rangeText {
                        Text(range)
                            .font(.caption.monospaced()).foregroundStyle(.secondary)
                            .padding(.horizontal).padding(.top, 8)
                    }
                    TimelineView(entries: sortedEntries)
                }
            }
        }
        .navigationTitle("🧳 \(trip.title)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            entries = try await loadEntries(trip.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
