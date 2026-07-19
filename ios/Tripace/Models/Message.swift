import Foundation

/// 頻道中的一則訊息:使用者說的「原話」。
/// LLM 處理後的結構化資訊(分類/標籤/摘要/事件時間)改放在 `Entry`。
struct Message: Identifiable, Codable, Hashable {
    let id: String
    let channelID: String
    let authorID: String
    var authorName: String
    var text: String

    var createdAt: Date

    /// 樂觀更新用:訊息是否還在等待後端回傳。
    var isProcessing: Bool

    init(
        id: String,
        channelID: String,
        authorID: String,
        authorName: String,
        text: String,
        createdAt: Date = .now,
        isProcessing: Bool = false
    ) {
        self.id = id
        self.channelID = channelID
        self.authorID = authorID
        self.authorName = authorName
        self.text = text
        self.createdAt = createdAt
        self.isProcessing = isProcessing
    }

    // isProcessing 是純 UI 狀態,不參與後端編解碼。
    // 後端回應沒有此欄位,解碼時預設為 false。
    private enum CodingKeys: String, CodingKey {
        case id, channelID, authorID, authorName, text, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        channelID = try c.decode(String.self, forKey: .channelID)
        authorID = try c.decode(String.self, forKey: .authorID)
        authorName = try c.decode(String.self, forKey: .authorName)
        text = try c.decode(String.self, forKey: .text)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        isProcessing = false
    }
}
