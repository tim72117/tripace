import Foundation

/// 本地快取(SQLite):messages 與 entries 以「頻道」為單位存放。
/// local-first 流程:進頻道先讀本地(秒開),背景 fetch 後端後用 replace* 覆蓋。
///
/// 設計取捨:
///   - 後端是唯一真實來源;本地只是快取,故同步用「整批覆蓋該頻道」而非逐筆 diff,簡單可靠。
///   - message 不可變、entry 會被 agent 重寫 → 整批覆蓋對兩者都正確(不會殘留舊 entry)。
@MainActor
final class LocalStore {
    private let db: SQLiteDatabase
    private let iso = ISO8601DateFormatter()

    /// 共用單例:DB 檔放在 app 的 Application Support 目錄。
    static let shared: LocalStore? = {
        do { return try LocalStore() } catch {
            print("[LocalStore] 初始化失敗,停用本地快取:\(error.localizedDescription)")
            return nil
        }
    }()

    init() throws {
        let dir = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true)
        let path = dir.appendingPathComponent("channel-cache.sqlite").path
        db = try SQLiteDatabase(path: path)
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try migrate()
    }

    private func migrate() throws {
        try db.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            channel_id  TEXT NOT NULL,
            author_id   TEXT NOT NULL,
            author_name TEXT NOT NULL,
            text        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_channel
            ON messages(channel_id, created_at);

        CREATE TABLE IF NOT EXISTS entries (
            id          TEXT PRIMARY KEY,
            channel_id  TEXT NOT NULL,
            item        TEXT NOT NULL,
            start       TEXT NOT NULL,
            end_at      TEXT,
            all_day     INTEGER NOT NULL DEFAULT 0,
            location    TEXT,
            category    TEXT,
            tags        TEXT,          -- JSON 陣列字串;NULL/空 視為無標籤
            summary     TEXT,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_entries_channel
            ON entries(channel_id, start, created_at);
        """)
        // 既有 DB(舊版本已建表)補上 location 欄位;已存在則忽略錯誤。
        try? db.execute("ALTER TABLE entries ADD COLUMN location TEXT;")
    }

    // MARK: - 讀(本地)

    func messages(channelID: String) -> [Message] {
        (try? db.query(
            "SELECT id, channel_id, author_id, author_name, text, created_at FROM messages WHERE channel_id = ? ORDER BY created_at ASC",
            [.text(channelID)]
        ) { r in
            Message(
                id: r.text(0), channelID: r.text(1),
                authorID: r.text(2), authorName: r.text(3),
                text: r.text(4),
                createdAt: self.parseDate(r.text(5)))
        }) ?? []
    }

    func entries(channelID: String) -> [Entry] {
        (try? db.query(
            "SELECT id, channel_id, item, start, end_at, all_day, location, category, tags, summary, created_at FROM entries WHERE channel_id = ? ORDER BY start ASC, created_at ASC",
            [.text(channelID)]
        ) { r in
            Entry(
                id: r.text(0), channelID: r.text(1),
                item: r.text(2), start: r.text(3),
                end: r.textOptional(4), allDay: r.bool(5),
                location: r.textOptional(6),
                category: r.textOptional(7),
                tags: self.decodeTags(r.textOptional(8)),
                summary: r.textOptional(9),
                createdAt: self.parseDate(r.text(10)))
        }) ?? []
    }

    // MARK: - 寫(背景同步後整批覆蓋該頻道)

    func replaceMessages(_ messages: [Message], channelID: String) {
        try? db.transaction {
            try db.run("DELETE FROM messages WHERE channel_id = ?", [.text(channelID)])
            for m in messages {
                try db.run(
                    "INSERT OR REPLACE INTO messages (id, channel_id, author_id, author_name, text, created_at) VALUES (?,?,?,?,?,?)",
                    [.text(m.id), .text(m.channelID), .text(m.authorID),
                     .text(m.authorName), .text(m.text), .text(iso.string(from: m.createdAt))])
            }
        }
    }

    func replaceEntries(_ entries: [Entry], channelID: String) {
        try? db.transaction {
            try db.run("DELETE FROM entries WHERE channel_id = ?", [.text(channelID)])
            for e in entries {
                try db.run(
                    "INSERT OR REPLACE INTO entries (id, channel_id, item, start, end_at, all_day, location, category, tags, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    [.text(e.id), .text(e.channelID), .text(e.item), .text(e.start),
                     .text(e.end), .bool(e.allDay), .text(e.location), .text(e.category),
                     .text(encodeTags(e.tags)), .text(e.summary),
                     .text(iso.string(from: e.createdAt))])
            }
        }
    }

    /// 樂觀寫入單則訊息(送出後立即落地,不必等整批同步)。
    func upsertMessage(_ m: Message) {
        try? db.run(
            "INSERT OR REPLACE INTO messages (id, channel_id, author_id, author_name, text, created_at) VALUES (?,?,?,?,?,?)",
            [.text(m.id), .text(m.channelID), .text(m.authorID),
             .text(m.authorName), .text(m.text), .text(iso.string(from: m.createdAt))])
    }

    // MARK: - helpers

    private func parseDate(_ s: String) -> Date {
        iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) ?? .now
    }

    private func decodeTags(_ json: String?) -> [String] {
        guard let json, let data = json.data(using: .utf8),
              let arr = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return arr
    }

    private func encodeTags(_ tags: [String]) -> String? {
        guard !tags.isEmpty, let data = try? JSONEncoder().encode(tags) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
