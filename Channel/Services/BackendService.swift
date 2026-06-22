import Foundation

/// 後端服務抽象介面。
/// UI/Store 只依賴此 protocol,不知道背後是 Mock 還是真實 Golang HTTP 服務。
/// 切換後端只需在 App 入口注入不同實作。對應 docs/API.md。
protocol BackendService {
    // 頻道
    func fetchChannels() async throws -> [Channel]
    func createChannel(name: String) async throws -> Channel

    // 訊息
    func fetchMessages(channelID: String) async throws -> [Message]
    /// 發送訊息。後端 LLM 在此整理/分類/標注,回傳處理後的訊息。
    func postMessage(channelID: String, text: String) async throws -> Message

    // 成員
    func fetchMembers(channelID: String) async throws -> [User]
    func addMember(channelID: String, userID: String) async throws -> [User]
    func searchUsers(keyword: String) async throws -> [User]

    // 語意查詢(RAG)
    func semanticQuery(channelID: String, question: String) async throws -> SearchAnswer

    // 認證
    /// 用 Apple identity token 登入,成功後回傳使用者並在內部保存 session token。
    func signInWithApple(identityToken: String, fullName: String?) async throws -> User
    /// 設定既有的 session token(App 啟動時從 Keychain 還原)。
    func setAuthToken(_ token: String?)

    /// 目前使用者(訪客或已登入者)。
    var currentUser: User { get }
}
