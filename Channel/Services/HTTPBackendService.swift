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

    /// 目前登入者的 email(私密資料 profile),訪客為 nil。
    private(set) var currentEmail: String?

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

    // 原話(message)已移至裝置端 DB,後端不再提供 messages 端點;故無 fetchMessages。

    func fetchEntries(channelID: String) async throws -> [Entry] {
        let res: EntriesResponse = try await get("channels/\(channelID)/entries")
        return res.entries
    }

    func fetchTrips(channelID: String) async throws -> [Trip] {
        let res: TripsResponse = try await get("channels/\(channelID)/trips")
        return res.trips
    }

    func fetchTripEntries(channelID: String, tripID: String) async throws -> [Entry] {
        let res: EntriesResponse = try await get("channels/\(channelID)/trips/\(tripID)/entries")
        return res.entries
    }

    func assist(channelID: String, text: String) async throws -> AssistResult {
        let res: AssistEnvelope = try await post("channels/\(channelID)/assist",
                                                 body: ["text": text])
        switch res.kind {
        case "recorded":
            // 原話不在後端;回原話 text 供前端存裝置端 DB,entryIDs 為新寫入的條目。
            return .recorded(text: res.text ?? text, entryIDs: res.entryIDs ?? [])
        case "answer":
            return .answer(text: res.answer ?? "", entries: res.entries ?? [])
        default:
            throw BackendError.server("未知的 assist 結果:\(res.kind)")
        }
    }

    // MARK: 成員

    func fetchMembers(channelID: String) async throws -> [Member] {
        let res: MembersResponse = try await get("channels/\(channelID)/members")
        return res.members
    }

    func addMember(channelID: String, email: String, role: ChannelRole) async throws -> [Member] {
        // 後端以 email 查出使用者後加入;role 預設 viewer。
        let res: MembersResponse = try await post("channels/\(channelID)/members",
                                                  body: ["email": email, "role": role.rawValue])
        return res.members
    }

    func setMemberRole(channelID: String, userID: String, role: ChannelRole) async throws -> [Member] {
        let res: MembersResponse = try await send(
            "channels/\(channelID)/members/\(userID)",
            method: "PATCH",
            body: ["role": role.rawValue])
        return res.members
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
        currentEmail = res.profile.email
        return res.user
    }

    func register(email: String, password: String, name: String?) async throws -> User {
        struct Body: Encodable { let email: String; let password: String; let name: String? }
        let res: AuthResponse = try await post(
            "auth/register",
            body: Body(email: email, password: password, name: name))
        authToken = res.token
        currentUser = res.user
        currentEmail = res.profile.email
        return res.user
    }

    func signIn(email: String, password: String) async throws -> User {
        struct Body: Encodable { let email: String; let password: String }
        let res: AuthResponse = try await post(
            "auth/login",
            body: Body(email: email, password: password))
        authToken = res.token
        currentUser = res.user
        currentEmail = res.profile.email
        return res.user
    }

    func setAuthToken(_ token: String?) {
        authToken = token
        if token == nil {
            currentUser = HTTPBackendService.guest
            currentEmail = nil
        }
    }

    /// 已知 token 時向後端確認身分;失敗(token 失效)會丟錯,呼叫端據以登出。
    /// /me 回 { user, profile },解析後同步 currentUser 與 currentEmail。
    func refreshCurrentUser() async throws -> User {
        let me: MeResponse = try await get("me")
        currentUser = me.user
        currentEmail = me.profile.email
        return me.user
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
private struct EntriesResponse: Decodable { let entries: [Entry] }
private struct TripsResponse: Decodable { let trips: [Trip] }
private struct MembersResponse: Decodable { let members: [Member] }

// assist 的標籤式回應:
// kind=recorded → text(原話)+ entryIDs(新寫入條目);kind=answer → answer + entries。
private struct AssistEnvelope: Decodable {
    let kind: String
    let text: String?
    let entryIDs: [String]?
    let answer: String?
    let entries: [PresentedEntry]?
}
private struct Profile: Decodable { let email: String }
private struct AuthResponse: Decodable { let token: String; let user: User; let profile: Profile }
private struct MeResponse: Decodable { let user: User; let profile: Profile }
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
