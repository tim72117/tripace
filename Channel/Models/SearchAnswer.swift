import Foundation

/// 語意查詢的回應:後端對頻道訊息做 RAG 檢索 + LLM 生成的回答。
struct SearchAnswer: Identifiable, Codable, Hashable {
    var id = UUID()
    /// 使用者的自然語言問句。
    var question: String
    /// LLM 生成的回答。
    var answer: String
    /// 被引用、作為回答依據的訊息 ID(供 App 顯示來源)。
    var citedMessageIDs: [String]
    /// 信心分數 0~1(可選)。
    var confidence: Double?

    private enum CodingKeys: String, CodingKey {
        case question, answer, citedMessageIDs, confidence
    }
}
