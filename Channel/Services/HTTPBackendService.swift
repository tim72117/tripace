import Foundation

/// 真實後端實作:透過 URLSession 呼叫 Golang 服務(對應 docs/API.md 與 server/)。
/// 與 MockBackendService 實作同一 protocol,App 入口切換注入即可,UI 無需更動。
@MainActor
final class HTTPBackendService: BackendService {

    private let baseURL: URL
    private let session: URLSession

    /// 訪客身分,需與後端 guestUser 一致。登入後 currentUser 會更新為登入者。
    private static let guest = User(id: "usr_me", name: "我", avatarColor: "#4A90D9")

    /// 目前使用者(訪客或已登入者)。
    private(set) var currentUser: User = HTTPBackendService.guest

    /// session token(登入後保存,帶在每個請求的 Authorization header)。
    private var authToken: String?

    /// 供 AuthStore 取出 token 存入 Keychain。
    var currentToken: String? { authToken }

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: 頻道

    func fetchChannels() async throws -> [Channel] {
        let res: ChannelsResponse = try await get("channels")
        return res.channels
    }

    func createChannel(name: String) async throws -> Channel {
        try await post("channels", body: ["name": name])
    }

    // MARK: 訊息

    func fetchMessages(channelID: String) async throws -> [Message] {
        let res: MessagesResponse = try await get("channels/\(channelID)/messages")
        return res.messages
    }

    func postMessage(channelID: String, text: String) async throws -> Message {
        try await post("channels/\(channelID)/messages", body: ["text": text])
    }

    // MARK: 成員

    func fetchMembers(channelID: String) async throws -> [User] {
        let res: MembersResponse = try await get("channels/\(channelID)/members")
        return res.members
    }

    func addMember(channelID: String, userID: String) async throws -> [User] {
        // 後端需要完整使用者資料;從使用者目錄查出 name/avatarColor。
        let user = try await searchUsers(keyword: "").first { $0.id == userID }
        let body: [String: String] = [
            "userID": userID,
            "name": user?.name ?? userID,
            "avatarColor": user?.avatarColor ?? "#888888",
        ]
        let res: MembersResponse = try await post("channels/\(channelID)/members", body: body)
        return res.members
    }

    func searchUsers(keyword: String) async throws -> [User] {
        let q = keyword.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let res: UsersResponse = try await get("users/search?q=\(q)")
        return res.users
    }

    // MARK: 語意查詢

    func semanticQuery(channelID: String, question: String) async throws -> SearchAnswer {
        // 後端回應不含 question,解碼後手動補上。
        let raw: QueryResponse = try await post("channels/\(channelID)/query",
                                                body: ["question": question])
        return SearchAnswer(
            question: question,
            answer: raw.answer,
            citedMessageIDs: raw.citedMessageIDs,
            confidence: raw.confidence
        )
    }

    // MARK: 認證

    func signInWithApple(identityToken: String, fullName: String?) async throws -> User {
        struct Body: Encodable { let identityToken: String; let fullName: String? }
        let res: AuthResponse = try await post(
            "auth/apple",
            body: Body(identityToken: identityToken, fullName: fullName))
        authToken = res.token
        currentUser = res.user
        return res.user
    }

    func setAuthToken(_ token: String?) {
        authToken = token
    }

    /// 已知 token 時向後端確認身分;失敗(token 失效)會丟錯,呼叫端據以登出。
    func refreshCurrentUser() async throws -> User {
        let user: User = try await get("me")
        currentUser = user
        return user
    }

    // MARK: - 傳輸

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET", body: Optional<Int>.none)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "POST", body: body)
    }

    private func send<T: Decodable, B: Encodable>(_ path: String, method: String, body: B?) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let authToken {
            req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw BackendError.server("連線失敗:\(error.localizedDescription)")
        }

        guard let http = response as? HTTPURLResponse else {
            throw BackendError.server("無效回應")
        }
        guard (200...299).contains(http.statusCode) else {
            if let apiErr = try? Self.decoder.decode(APIErrorEnvelope.self, from: data) {
                throw BackendError.server(apiErr.error.message)
            }
            throw BackendError.server("HTTP \(http.statusCode)")
        }

        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw BackendError.server("解析失敗:\(error.localizedDescription)")
        }
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601WithFractionalSeconds
        return d
    }()
}

// MARK: - 回應外殼

private struct ChannelsResponse: Decodable { let channels: [Channel] }
private struct MessagesResponse: Decodable { let messages: [Message] }
private struct MembersResponse: Decodable { let members: [User] }
private struct UsersResponse: Decodable { let users: [User] }
private struct AuthResponse: Decodable { let token: String; let user: User }
private struct QueryResponse: Decodable {
    let answer: String
    let citedMessageIDs: [String]
    let confidence: Double?
}
private struct APIErrorEnvelope: Decodable {
    struct Inner: Decodable { let code: String; let message: String }
    let error: Inner
}

// MARK: - ISO8601 含小數秒(後端時間如 2026-06-21T18:42:40.322772Z)

private extension JSONDecoder.DateDecodingStrategy {
    static var iso8601WithFractionalSeconds: JSONDecoder.DateDecodingStrategy {
        .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)
            if let date = ISO8601DateFormatter.fractional.date(from: str)
                ?? ISO8601DateFormatter.plain.date(from: str) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container,
                debugDescription: "無法解析日期:\(str)")
        }
    }
}

private extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
