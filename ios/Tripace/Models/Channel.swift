import Foundation

/// 一個頻道。成員可在其中發訊息、查詢。
struct Channel: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    /// 頻道擁有者的使用者 ID。只有 owner 能發訊息,成員只能查詢。
    var ownerID: String
    var memberCount: Int
    var lastMessagePreview: String?
    var updatedAt: Date

    init(
        id: String,
        name: String,
        ownerID: String = "",
        memberCount: Int = 1,
        lastMessagePreview: String? = nil,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.name = name
        self.ownerID = ownerID
        self.memberCount = memberCount
        self.lastMessagePreview = lastMessagePreview
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, ownerID, memberCount, lastMessagePreview, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        ownerID = try c.decodeIfPresent(String.self, forKey: .ownerID) ?? ""
        memberCount = try c.decodeIfPresent(Int.self, forKey: .memberCount) ?? 1
        lastMessagePreview = try c.decodeIfPresent(String.self, forKey: .lastMessagePreview)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    }
}
