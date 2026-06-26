import SwiftUI

/// 行程詳情:列出某 Trip 底下的所有條目。獨立載入(避免回流閃動),複用 EntryCard。
/// 對應 web 的 TripEntriesScreen。
struct TripEntriesView: View {
    let trip: Trip
    /// 從 ChatStore 取該行程的條目(走後端 fetchTripEntries)。
    let loadEntries: (String) async throws -> [Entry]

    @State private var entries: [Entry] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let range = trip.rangeText {
                Section {
                    Text(range).font(.caption).foregroundStyle(.secondary)
                }
            }

            if isLoading {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.callout)
            } else if entries.isEmpty {
                ContentUnavailableView("這個行程還沒有條目", systemImage: "tray")
            } else {
                Section {
                    ForEach(entries) { entry in
                        EntryCard(entry: entry)
                    }
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
