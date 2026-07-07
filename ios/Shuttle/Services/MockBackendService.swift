import Foundation

/// 本地假後端。實作與真實服務相同的 `BackendService` 介面,
/// 用規則模擬「後端 LLM 分類/標注」與「RAG 語意查詢」的行為,讓 App 在無後端時可完整操作。
/// 之後替換成 HTTPBackendService(接 Golang 服務)即可,UI 無需更動。
@MainActor
final class MockBackendService: BackendService {

    private(set) var currentUser = User(id: "usr_me", name: "我", avatarColor: "#4A90D9")

    // MARK: 認證(Mock:本地模擬登入,不打網路)

    func signInWithApple(identityToken: String, fullName: String?) async throws -> User {
        try await fakeDelay(0.4)
        let user = User(id: "usr_apple", name: fullName ?? "Apple 使用者", avatarColor: "#4A90D9")
        currentUser = user
        return user
    }

    func register(email: String, password: String, name: String?) async throws -> User {
        try await fakeDelay(0.4)
        let display = (name?.isEmpty == false ? name! : email)
        let user = User(id: "usr_\(abs(email.hashValue))", name: display, avatarColor: "#4A90D9")
        currentUser = user
        return user
    }

    func signIn(email: String, password: String) async throws -> User {
        try await fakeDelay(0.4)
        let user = User(id: "usr_\(abs(email.hashValue))", name: email, avatarColor: "#4A90D9")
        currentUser = user
        return user
    }

    func setAuthToken(_ token: String?) {
        // Mock 無 token 概念,忽略。
    }

    // 內建假使用者(可被搜尋邀請)
    private let directory: [User] = [
        User(id: "usr_alice", name: "Alice", avatarColor: "#E07A5F"),
        User(id: "usr_bob", name: "Bob", avatarColor: "#3D9970"),
        User(id: "usr_carol", name: "Carol", avatarColor: "#B07AE0"),
        User(id: "usr_dave", name: "Dave", avatarColor: "#E0B24A"),
    ]

    // 記憶體狀態
    private var channels: [Channel]
    private var messagesByChannel: [String: [Message]]
    private var entriesByChannel: [String: [Entry]]
    private var membersByChannel: [String: [Member]]

    init() {
        let now = Date()
        // ch_001:我是 owner(可發訊息);ch_002:他人 owner(我是成員,只能查詢)。
        let ch1 = Channel(id: "ch_001", name: "產品討論", ownerID: "usr_me", memberCount: 3,
                          lastMessagePreview: "下週一開會敲定 Q3 規格",
                          updatedAt: now.addingTimeInterval(-300))
        let ch2 = Channel(id: "ch_002", name: "旅遊計畫", ownerID: "usr_carol", memberCount: 2,
                          lastMessagePreview: "機票買好了嗎?",
                          updatedAt: now.addingTimeInterval(-7200))
        channels = [ch1, ch2]

        // Message 只存原話(標注/事件時間已移至 Entry)。
        messagesByChannel = [
            "ch_001": [
                Message(id: "msg_001", channelID: "ch_001", authorID: "usr_alice", authorName: "Alice",
                        text: "我們下週一下午三點開會,敲定 Q3 產品規格",
                        createdAt: now.addingTimeInterval(-3600)),
                Message(id: "msg_002", channelID: "ch_001", authorID: "usr_bob", authorName: "Bob",
                        text: "記得把預算上調的提案準備好,大概要 +15%",
                        createdAt: now.addingTimeInterval(-1800)),
                Message(id: "msg_003", channelID: "ch_001", authorID: "usr_me", authorName: "我",
                        text: "登入頁的 bug 修好了嗎?",
                        createdAt: now.addingTimeInterval(-600)),
            ],
            "ch_002": [
                Message(id: "msg_101", channelID: "ch_002", authorID: "usr_carol", authorName: "Carol",
                        text: "機票買好了嗎?七月初的那班",
                        createdAt: now.addingTimeInterval(-7200)),
            ],
        ]

        // Entry 是主體:結構化結果(事項 + 時間 + 標注)。owner 頻道(ch_001)才有。
        let cal = Calendar.current
        let nextMon = cal.date(byAdding: .day, value: 5, to: now) ?? now
        entriesByChannel = [
            "ch_001": [
                Entry(id: "ent_001", channelID: "ch_001",
                      item: "開會敲定 Q3 產品規格",
                      start: Self.dateTimeStr(nextMon, hour: 15, minute: 0),
                      allDay: false,
                      location: "台北辦公室 3F 會議室",
                      category: "會議", tags: ["排程", "Q3", "規格"],
                      summary: "下週一 15:00 開會敲定 Q3 規格",
                      createdAt: now.addingTimeInterval(-3600)),
                Entry(id: "ent_002", channelID: "ch_001",
                      item: "準備預算上調提案(約 +15%)",
                      start: "", allDay: false,
                      category: "任務", tags: ["預算", "提案"],
                      createdAt: now.addingTimeInterval(-1800)),
            ],
        ]

        // ch_001:我是 owner(editor);其他成員預設 viewer。
        // ch_002:他人 owner,我是 viewer 成員。
        membersByChannel = [
            "ch_001": [
                Self.member(currentUser, .editor),
                Self.member(directory[0], .viewer),
                Self.member(directory[1], .viewer),
            ],
            "ch_002": [
                Self.member(currentUser, .viewer),
                Self.member(directory[2], .editor),
            ],
        ]
    }

    // MARK: 頻道

    func fetchChannels() async throws -> [Channel] {
        try await fakeDelay(0.2)
        return channels.sorted { $0.updatedAt > $1.updatedAt }
    }

    func createChannel(name: String) async throws -> Channel {
        try await fakeDelay(0.3)
        let ch = Channel(id: "ch_\(UUID().uuidString.prefix(6))", name: name,
                         ownerID: currentUser.id, memberCount: 1,
                         lastMessagePreview: nil, updatedAt: .now)
        channels.append(ch)
        messagesByChannel[ch.id] = []
        // 建立者即 owner,給 editor 角色。
        membersByChannel[ch.id] = [Self.member(currentUser, .editor)]
        return ch
    }

    // 原話(message)已移至裝置端 DB,Mock 不再提供 fetchMessages。

    // MARK: 條目(Entry)

    func fetchEntries(channelID: String) async throws -> [Entry] {
        try await fakeDelay(0.2)
        return entriesByChannel[channelID] ?? []
    }

    func fetchTrips(channelID: String) async throws -> [Trip] {
        try await fakeDelay(0.2)
        // Mock 無自動歸組:回空(行程列不顯示),由真實後端提供 Trip。
        return []
    }

    func fetchTripEntries(channelID: String, tripID: String) async throws -> [Entry] {
        try await fakeDelay(0.2)
        return (entriesByChannel[channelID] ?? []).filter { $0.tripID == tripID }
    }

    // MARK: owner 統一輸入(assist)

    /// 模擬後端 LLM 自主判斷:提問 → 回答(answer,不存訊息);否則 → 記錄(recorded)。
    /// 記錄時把原話存成訊息,並產生承載標注/事件時間的 Entry。
    func assist(channelID: String, text: String) async throws -> AssistResult {
        try await fakeDelay(0.8)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // 提問:不存訊息,語意查詢後回答,並附上相關條目供前端展示。
        if Self.looksLikeQuestion(trimmed) {
            let answer = try await semanticQuery(channelID: channelID, question: trimmed)
            let presented = (entriesByChannel[channelID] ?? [])
                .filter { Self.entryMatches($0, question: trimmed) }
                .prefix(3)
                .map { PresentedEntry(item: $0.item, start: $0.start, end: $0.end, allDay: $0.allDay) }
            return .answer(text: answer.answer, entries: Array(presented))
        }

        // 記錄:產生 Entry(後端)。原話不存後端,由前端存裝置端 DB。
        let (category, tags, summary) = Self.classify(trimmed)
        let entryID = "ent_\(UUID().uuidString.prefix(6))"
        let entry = Entry(
            id: entryID,
            channelID: channelID,
            item: trimmed,
            start: "", allDay: false,
            category: category, tags: tags, summary: summary,
            createdAt: .now
        )
        entriesByChannel[channelID, default: []].append(entry)

        if let idx = channels.firstIndex(where: { $0.id == channelID }) {
            channels[idx].lastMessagePreview = trimmed
            channels[idx].updatedAt = .now
        }
        return .recorded(text: trimmed, entryIDs: [entryID])
    }

    // MARK: 成員

    func fetchMembers(channelID: String) async throws -> [Member] {
        try await fakeDelay(0.2)
        return membersByChannel[channelID] ?? []
    }

    func addMember(channelID: String, email: String, role: ChannelRole) async throws -> [Member] {
        try await fakeDelay(0.3)
        // 以 email 前綴比對內建使用者(例如 alice@... → Alice);否則用 email 當名稱建立。
        let prefix = email.split(separator: "@").first.map(String.init) ?? email
        let user = directory.first { $0.name.localizedCaseInsensitiveContains(prefix) }
            ?? User(id: "usr_\(abs(email.hashValue))", name: email, avatarColor: "#888888")

        var members = membersByChannel[channelID] ?? []
        if !members.contains(where: { $0.id == user.id }) {
            members.append(Self.member(user, role))
            membersByChannel[channelID] = members
            if let idx = channels.firstIndex(where: { $0.id == channelID }) {
                channels[idx].memberCount = members.count
            }
        }
        return members
    }

    func setMemberRole(channelID: String, userID: String, role: ChannelRole) async throws -> [Member] {
        try await fakeDelay(0.2)
        var members = membersByChannel[channelID] ?? []
        if let idx = members.firstIndex(where: { $0.id == userID }) {
            members[idx].role = role
            membersByChannel[channelID] = members
        }
        return members
    }

    // MARK: 語意查詢(RAG 模擬)

    /// 模擬後端 RAG:對頻道訊息做相關性檢索 → 組成回答 → 回傳引用來源。
    func semanticQuery(channelID: String, question: String) async throws -> SearchAnswer {
        try await fakeDelay(1.0)
        let pool = messagesByChannel[channelID] ?? []
        let entries = entriesByChannel[channelID] ?? []
        // 標注/事件時間已移至 Entry:依訊息文字 + 同頻道 Entry 的標籤/分類/事項組成檢索文字。
        let entryText = entries
            .map { $0.item + " " + $0.tags.joined(separator: " ") + " " + ($0.category ?? "") }
            .joined(separator: " ")
            .lowercased()

        // 簡易檢索:用問句斷詞與訊息文字 + Entry 標注做包含比對打分,取 Top-K。
        let terms = Self.tokenize(question)
        let scored = pool.map { msg -> (Message, Int) in
            let haystack = (msg.text + " " + entryText).lowercased()
            let score = terms.reduce(0) { $0 + (haystack.contains($1) ? 1 : 0) }
            return (msg, score)
        }
        let top = scored.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.prefix(3).map { $0.0 }

        let answer: String
        let confidence: Double?
        if top.isEmpty {
            answer = "我在這個頻道找不到與「\(question)」相關的訊息。換個問法或確認相關內容是否已被討論過。"
            confidence = 0.2
        } else {
            let snippets = top.map { "・\($0.authorName):\($0.text)" }.joined(separator: "\n")
            answer = "根據頻道中相關的訊息,我整理如下:\n\n\(snippets)"
            confidence = min(0.95, 0.5 + Double(top.count) * 0.15)
        }

        return SearchAnswer(
            question: question,
            answer: answer,
            citedMessageIDs: top.map { $0.id },
            confidence: confidence
        )
    }

    // MARK: - 模擬 LLM 分類規則

    /// 把 User 包成帶角色的 Member。
    private static func member(_ u: User, _ role: ChannelRole) -> Member {
        Member(id: u.id, name: u.name, avatarColor: u.avatarColor, role: role)
    }

    /// 粗略判斷輸入是否為「提問」(決定 assist 走回答還是記錄)。
    private static func looksLikeQuestion(_ text: String) -> Bool {
        if text.contains("?") || text.contains("?") { return true }
        let qWords = ["嗎", "呢", "哪", "幾", "什麼", "怎麼", "為什麼", "誰", "何時", "多少", "是不是"]
        return qWords.contains { text.contains($0) }
    }

    /// 條目是否與問句相關(供回答時挑選展示條目)。
    private static func entryMatches(_ entry: Entry, question: String) -> Bool {
        let terms = tokenize(question)
        let hay = (entry.item + " " + entry.tags.joined(separator: " ") + " " + (entry.category ?? "")).lowercased()
        return terms.contains { hay.contains($0) }
    }

    /// 組出 'YYYY-MM-DD HH:MM' 格式的時間字串。
    private static func dateTimeStr(_ date: Date, hour: Int, minute: Int) -> String {
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: date)
        comps.hour = hour
        comps.minute = minute
        let d = Calendar.current.date(from: comps) ?? date
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.string(from: d)
    }

    private static func classify(_ text: String) -> (String?, [String], String?) {
        let lower = text.lowercased()
        var category: String? = nil
        var tags: [String] = []

        let rules: [(keywords: [String], category: String, tag: String)] = [
            (["開會", "會議", "meeting", "敲定", "討論"], "會議", "排程"),
            (["待辦", "todo", "記得", "準備", "負責", "完成"], "任務", "待辦"),
            (["bug", "錯誤", "壞掉", "修好", "問題"], "問題", "bug"),
            (["公告", "通知", "請注意", "重要"], "公告", "公告"),
        ]
        for rule in rules where rule.keywords.contains(where: { lower.contains($0) }) {
            category = rule.category
            tags.append(rule.tag)
            break
        }
        if text.contains("?") || text.contains("?") || text.contains("嗎") {
            if category == nil { category = "問題" }
        }
        if category == nil { category = "閒聊" }

        // 關鍵字標籤:抽取常見主題字
        for kw in ["預算", "Q1", "Q2", "Q3", "Q4", "機票", "規格", "登入", "上線", "設計"]
        where text.localizedCaseInsensitiveContains(kw) && !tags.contains(kw) {
            tags.append(kw)
        }

        let summary = text.count > 30 ? String(text.prefix(28)) + "…" : nil
        return (category, tags, summary)
    }

    private static func tokenize(_ s: String) -> [String] {
        let lower = s.lowercased()
        var terms: [String] = []
        for kw in ["預算", "q3", "q1", "q2", "q4", "機票", "規格", "登入", "bug", "會議",
                   "開會", "排程", "上線", "設計", "提案", "行程", "任務", "問題"]
        where lower.contains(kw) { terms.append(kw) }
        // 也加入長度 >= 2 的中文 / 英文片段
        let extra = lower.split { " ,.!?。,、!?".contains($0) }.map(String.init).filter { $0.count >= 2 }
        return Array(Set(terms + extra))
    }

    private func fakeDelay(_ seconds: Double) async throws {
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }
}

enum BackendError: LocalizedError {
    case notFound
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notFound: return "找不到資源"
        case .server(let m): return m
        }
    }
}
