import Foundation

/// 頻道中的一則訊息。
/// `category` / `tags` / `summary` 由後端 LLM 整理、分類、標注後填入。
struct Message: Identifiable, Codable, Hashable {
    let id: String
    let channelID: String
    let authorID: String
    var authorName: String
    var text: String

    /// LLM 標注:單一主分類(如 會議 / 任務 / 問題 / 公告 / 閒聊)。
    var category: String?
    /// LLM 標注:關鍵字標籤。
    var tags: [String]
    /// LLM 標注:一句話摘要(長訊息時提供)。
    var summary: String?

    var createdAt: Date

    /// 樂觀更新用:訊息是否還在等待後端 LLM 標注回傳。
    var isProcessing: Bool

    init(
        id: String,
        channelID: String,
        authorID: String,
        authorName: String,
        text: String,
        category: String? = nil,
        tags: [String] = [],
        summary: String? = nil,
        createdAt: Date = .now,
        isProcessing: Bool = false
    ) {
        self.id = id
        self.channelID = channelID
        self.authorID = authorID
        self.authorName = authorName
        self.text = text
        self.category = category
        self.tags = tags
        self.summary = summary
        self.createdAt = createdAt
        self.isProcessing = isProcessing
    }

    var hasAnnotations: Bool {
        category != nil || !tags.isEmpty || summary != nil
    }

    // isProcessing 是純 UI 狀態,不參與後端編解碼。
    // 後端回應沒有此欄位,解碼時預設為 false。
    private enum CodingKeys: String, CodingKey {
        case id, channelID, authorID, authorName, text, category, tags, summary, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        channelID = try c.decode(String.self, forKey: .channelID)
        authorID = try c.decode(String.self, forKey: .authorID)
        authorName = try c.decode(String.self, forKey: .authorName)
        text = try c.decode(String.self, forKey: .text)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        isProcessing = false
    }
}
