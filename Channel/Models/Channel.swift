import Foundation

/// 一個頻道。成員可在其中發訊息、查詢。
struct Channel: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var memberCount: Int
    var lastMessagePreview: String?
    var updatedAt: Date

    init(
        id: String,
        name: String,
        memberCount: Int = 1,
        lastMessagePreview: String? = nil,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.name = name
        self.memberCount = memberCount
        self.lastMessagePreview = lastMessagePreview
        self.updatedAt = updatedAt
    }
}
