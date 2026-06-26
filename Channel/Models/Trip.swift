import Foundation

/// Trip 是 entries 的行程分組(後端依時間自動歸組:有跨度的區間事件框出行程範圍,
/// 落在範圍內的單點事件歸入同一 Trip)。對應後端 model.Trip 與 web 的 Trip。
struct Trip: Identifiable, Codable, Hashable {
    let id: String
    let channelID: String
    /// 行程名(後端暫用首筆 entry.item)。
    var title: String
    /// 行程起(ISO 字串,字典序=時間序);可空。
    var start: String?
    /// 行程訖;可空。
    var end: String?
    var createdAt: Date

    /// 顯示用的日期範圍字串;無 start 時為 nil。
    var rangeText: String? {
        guard let start, !start.isEmpty else { return nil }
        if let end, !end.isEmpty { return "\(start) ~ \(end)" }
        return start
    }

    private enum CodingKeys: String, CodingKey {
        case id, channelID, title, start, end, createdAt
    }

    init(
        id: String,
        channelID: String,
        title: String,
        start: String? = nil,
        end: String? = nil,
        createdAt: Date = .now
    ) {
        self.id = id
        self.channelID = channelID
        self.title = title
        self.start = start
        self.end = end
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        channelID = try c.decode(String.self, forKey: .channelID)
        title = try c.decode(String.self, forKey: .title)
        start = try c.decodeIfPresent(String.self, forKey: .start)
        end = try c.decodeIfPresent(String.self, forKey: .end)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
    }
}
