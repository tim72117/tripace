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
    private var membersByChannel: [String: [User]]

    init() {
        let now = Date()
        let ch1 = Channel(id: "ch_001", name: "產品討論", memberCount: 3,
                          lastMessagePreview: "下週一開會敲定 Q3 規格",
                          updatedAt: now.addingTimeInterval(-300))
        let ch2 = Channel(id: "ch_002", name: "旅遊計畫", memberCount: 2,
                          lastMessagePreview: "機票買好了嗎?",
                          updatedAt: now.addingTimeInterval(-7200))
        channels = [ch1, ch2]

        messagesByChannel = [
            "ch_001": [
                Message(id: "msg_001", channelID: "ch_001", authorID: "usr_alice", authorName: "Alice",
                        text: "我們下週一下午三點開會,敲定 Q3 產品規格",
                        category: "會議", tags: ["排程", "Q3", "規格"],
                        summary: "下週一 15:00 開會敲定 Q3 規格",
                        createdAt: now.addingTimeInterval(-3600)),
                Message(id: "msg_002", channelID: "ch_001", authorID: "usr_bob", authorName: "Bob",
                        text: "記得把預算上調的提案準備好,大概要 +15%",
                        category: "任務", tags: ["預算", "提案"],
                        createdAt: now.addingTimeInterval(-1800)),
                Message(id: "msg_003", channelID: "ch_001", authorID: "usr_me", authorName: "我",
                        text: "登入頁的 bug 修好了嗎?",
                        category: "問題", tags: ["bug", "登入"],
                        createdAt: now.addingTimeInterval(-600)),
            ],
            "ch_002": [
                Message(id: "msg_101", channelID: "ch_002", authorID: "usr_carol", authorName: "Carol",
                        text: "機票買好了嗎?七月初的那班",
                        category: "問題", tags: ["機票", "行程"],
                        createdAt: now.addingTimeInterval(-7200)),
            ],
        ]

        membersByChannel = [
            "ch_001": [currentUser, directory[0], directory[1]],
            "ch_002": [currentUser, directory[2]],
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
                         memberCount: 1, lastMessagePreview: nil, updatedAt: .now)
        channels.append(ch)
        messagesByChannel[ch.id] = []
        membersByChannel[ch.id] = [currentUser]
        return ch
    }

    // MARK: 訊息

    func fetchMessages(channelID: String) async throws -> [Message] {
        try await fakeDelay(0.2)
        return messagesByChannel[channelID] ?? []
    }

    /// 模擬後端 LLM:整理 → 分類 → 標注。
    func postMessage(channelID: String, text: String) async throws -> Message {
        // 模擬 LLM 處理時間
        try await fakeDelay(0.8)

        let (category, tags, summary) = Self.classify(text)
        let message = Message(
            id: "msg_\(UUID().uuidString.prefix(6))",
            channelID: channelID,
            authorID: currentUser.id,
            authorName: currentUser.name,
            text: text,
            category: category,
            tags: tags,
            summary: summary,
            createdAt: .now
        )
        messagesByChannel[channelID, default: []].append(message)
        if let idx = channels.firstIndex(where: { $0.id == channelID }) {
            channels[idx].lastMessagePreview = text
            channels[idx].updatedAt = .now
        }
        return message
    }

    // MARK: 成員

    func fetchMembers(channelID: String) async throws -> [User] {
        try await fakeDelay(0.2)
        return membersByChannel[channelID] ?? []
    }

    func addMember(channelID: String, userID: String) async throws -> [User] {
        try await fakeDelay(0.3)
        guard let user = directory.first(where: { $0.id == userID }) else {
            throw BackendError.notFound
        }
        var members = membersByChannel[channelID] ?? []
        if !members.contains(where: { $0.id == userID }) {
            members.append(user)
            membersByChannel[channelID] = members
            if let idx = channels.firstIndex(where: { $0.id == channelID }) {
                channels[idx].memberCount = members.count
            }
        }
        return members
    }

    func searchUsers(keyword: String) async throws -> [User] {
        try await fakeDelay(0.2)
        guard !keyword.isEmpty else { return directory }
        return directory.filter { $0.name.localizedCaseInsensitiveContains(keyword) }
    }

    // MARK: 語意查詢(RAG 模擬)

    /// 模擬後端 RAG:對頻道訊息做相關性檢索 → 組成回答 → 回傳引用來源。
    func semanticQuery(channelID: String, question: String) async throws -> SearchAnswer {
        try await fakeDelay(1.0)
        let pool = messagesByChannel[channelID] ?? []

        // 簡易檢索:用問句斷詞與訊息文字/標籤做包含比對打分,取 Top-K。
        let terms = Self.tokenize(question)
        let scored = pool.map { msg -> (Message, Int) in
            let haystack = (msg.text + " " + msg.tags.joined(separator: " ") + " " + (msg.category ?? "")).lowercased()
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
