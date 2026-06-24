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

    // 條目(Entry):LLM 從訊息解析出的事件/條目,承載結構化結果。
    /// 取頻道的 Entry 條目(只有 owner 看得到自己頻道的)。
    func fetchEntries(channelID: String) async throws -> [Entry]

    // owner 統一輸入(assist):送進後端,LLM 自主判斷「記錄事項」或「回答提問」。
    /// 記錄(recorded)會存成訊息並產生關聯 Entry;回答(answer)不存訊息,附帶展示條目。
    func assist(channelID: String, text: String) async throws -> AssistResult

    // 成員
    func fetchMembers(channelID: String) async throws -> [User]
    /// 以 email 邀請使用者加入頻道。
    func addMember(channelID: String, email: String) async throws -> [User]

    // 語意查詢(RAG)
    func semanticQuery(channelID: String, question: String) async throws -> SearchAnswer

    // 認證
    /// 用 Apple identity token 登入,成功後回傳使用者並在內部保存 session token。
    func signInWithApple(identityToken: String, fullName: String?) async throws -> User
    /// 以 email/密碼註冊新帳號,成功後回傳使用者並在內部保存 session token。
    func register(email: String, password: String, name: String?) async throws -> User
    /// 以 email/密碼登入,成功後回傳使用者並在內部保存 session token。
    func signIn(email: String, password: String) async throws -> User
    /// 設定既有的 session token(App 啟動時從 Keychain 還原)。
    func setAuthToken(_ token: String?)

    /// 目前使用者(訪客或已登入者)。
    var currentUser: User { get }
}
