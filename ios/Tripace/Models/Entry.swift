import Foundation

/// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
/// 可獨立存在,並可關聯多則來源訊息(多對多)。對應後端 model.Entry。
struct Entry: Identifiable, Codable, Hashable {
    let id: String
    let channelID: String
    /// 事項描述。
    var item: String
    /// 'YYYY-MM-DD HH:MM' 或全日 'YYYY-MM-DD';可空。
    var start: String
    /// 範圍結束;可空。
    var end: String?
    /// 全日事件。
    var allDay: Bool
    /// 地點(可空);目前由人工/前端填,LLM 暫不自動抽取。
    var location: String?
    /// 所屬行程(Trip);後端依時間自動歸組,未歸組為 nil。
    var tripID: String?

    /// LLM 標注(原本在 Message 上,改放 Entry;後端目前先留空)。
    var category: String?
    var tags: [String]
    var summary: String?

    var createdAt: Date

    var hasAnnotations: Bool {
        category != nil || !tags.isEmpty || summary != nil
    }

    /// 顯示用的時間字串:全日只取日期,否則整串;無 start 時為 nil。
    var whenText: String? {
        guard !start.isEmpty else { return nil }
        let base = allDay ? String(start.prefix(10)) : start
        if let end, !end.isEmpty { return "\(base) ~ \(end)" }
        return base
    }

    private enum CodingKeys: String, CodingKey {
        case id, channelID, item, start, end, allDay, location, tripID, category, tags, summary, createdAt
    }

    init(
        id: String,
        channelID: String,
        item: String,
        start: String,
        end: String? = nil,
        allDay: Bool = false,
        location: String? = nil,
        tripID: String? = nil,
        category: String? = nil,
        tags: [String] = [],
        summary: String? = nil,
        createdAt: Date = .now
    ) {
        self.id = id
        self.channelID = channelID
        self.item = item
        self.start = start
        self.end = end
        self.allDay = allDay
        self.location = location
        self.tripID = tripID
        self.category = category
        self.tags = tags
        self.summary = summary
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        channelID = try c.decode(String.self, forKey: .channelID)
        item = try c.decode(String.self, forKey: .item)
        start = try c.decodeIfPresent(String.self, forKey: .start) ?? ""
        end = try c.decodeIfPresent(String.self, forKey: .end)
        allDay = try c.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        location = try c.decodeIfPresent(String.self, forKey: .location)
        tripID = try c.decodeIfPresent(String.self, forKey: .tripID)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
    }
}

/// present_entries 工具輸出、要展示給使用者的條目(不含 id/messageID)。
/// 對應後端 llm.AssistEntry 與 web 的 PresentedEntry。
struct PresentedEntry: Codable, Hashable {
    var item: String
    var start: String
    var end: String?
    var allDay: Bool

    var whenText: String {
        guard !start.isEmpty else { return "未指定時間" }
        let base = allDay ? String(start.prefix(10)) : start
        if let end, !end.isEmpty { return "\(base) ~ \(end)" }
        return base
    }

    private enum CodingKeys: String, CodingKey {
        case item, start, end, allDay
    }

    init(item: String, start: String, end: String? = nil, allDay: Bool = false) {
        self.item = item
        self.start = start
        self.end = end
        self.allDay = allDay
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        item = try c.decode(String.self, forKey: .item)
        start = try c.decodeIfPresent(String.self, forKey: .start) ?? ""
        end = try c.decodeIfPresent(String.self, forKey: .end)
        allDay = try c.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
    }
}

/// owner 統一輸入(assist)的結果:LLM 自主判斷記錄事項或回答提問。
/// - recorded:記錄了。後端只回原話 text(原話不存後端,由前端存進裝置端 DB)
///   與新寫入的 entryIDs(entry 在後端,前端重拉顯示)。
/// - answer:回答了,不寫訊息;附帶 present_entries 輸出的條目(可空)。
enum AssistResult {
    case recorded(text: String, entryIDs: [String])
    case answer(text: String, entries: [PresentedEntry])
}
