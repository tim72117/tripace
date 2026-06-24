import SwiftUI
import Observation

/// 頻道列表的狀態容器。
@MainActor
@Observable
final class ChannelStore {
    private let backend: BackendService

    var channels: [Channel] = []
    var isLoading = false
    var errorMessage: String?

    init(backend: BackendService) {
        self.backend = backend
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            channels = try await backend.fetchChannels()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func createChannel(name: String) async {
        do {
            let ch = try await backend.createChannel(name: name)
            channels.insert(ch, at: 0)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// 單一頻道內的聊天狀態容器:訊息流、Entry 條目、owner 統一輸入(assist)。
@MainActor
@Observable
final class ChatStore {
    private let backend: BackendService
    let channel: Channel

    var messages: [Message] = []
    /// LLM 解析出的事件/條目(承載結構化結果),顯示在訊息流上方。owner 才有。
    var entries: [Entry] = []
    /// 答案泡泡掛上的展示條目(present_entries 輸出),依訊息 ID 對應。
    var presentedByMessage: [String: [PresentedEntry]] = [:]
    var isLoading = false
    var errorMessage: String?

    init(backend: BackendService, channel: Channel) {
        self.backend = backend
        self.channel = channel
    }

    var currentUserID: String { backend.currentUser.id }

    /// 目前使用者是否為頻道擁有者。
    private var isOwner: Bool { channel.ownerID == backend.currentUser.id }

    /// 本地快取(可為 nil,初始化失敗時降級為純線上)。
    private let local = LocalStore.shared

    /// local-first 載入。原話(message)的唯一真實來源是裝置端 LocalStore(後端不存原話);
    /// Entry 由後端拉取(僅 owner)。
    /// owner 視角:記事原話已歸 entry,訊息流不顯示原話泡泡,只保留本地查詢問答泡泡。
    /// member 視角:訊息流顯示自己裝置存的查詢問答原話。
    func load() async {
        // 1) 原話一律從裝置端讀(owner 不灌進訊息流,member 才顯示)。
        if let local, !isOwner {
            messages = local.messages(channelID: channel.id)
        }
        if let local, isOwner {
            let cachedEnts = local.entries(channelID: channel.id)
            if !cachedEnts.isEmpty { entries = cachedEnts }
        }

        // 2) 背景重拉後端 Entry(只有 owner);原話不在後端,無需 fetch。
        isLoading = true
        do {
            let freshEnts: [Entry] = isOwner
                ? try await backend.fetchEntries(channelID: channel.id)
                : []
            entries = freshEnts
            if isOwner { local?.replaceEntries(freshEnts, channelID: channel.id) }
        } catch {
            // 線上失敗:若本地有東西就靜默(離線可讀);完全沒快取才顯示錯誤。
            if messages.isEmpty && entries.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }

    /// owner 統一輸入:送進 assist,LLM 自主判斷記錄事項或回答提問。
    /// - 記錄(recorded):原話歸入上方 entry 卡,訊息流不留泡泡;重拉 entries。
    /// - 回答(answer):提問 + 答案兩個本地泡泡(不寫入頻道),答案掛上展示條目。
    func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let tempID = "temp_\(UUID().uuidString.prefix(6))"
        let optimistic = Message(
            id: tempID,
            channelID: channel.id,
            authorID: backend.currentUser.id,
            authorName: backend.currentUser.name,
            text: trimmed,
            isProcessing: true
        )
        messages.append(optimistic)

        do {
            let result = try await backend.assist(channelID: channel.id, text: trimmed)
            switch result {
            case .recorded(let recordedText, _):
                // 記錄了 → 原話存進裝置端 LocalStore(原話的唯一真實來源,後端不存);
                // 內容已歸入上方 entry 卡,訊息流不保留這則原話泡泡(移除樂觀泡泡)。
                messages.removeAll { $0.id == tempID }
                local?.upsertMessage(Message(
                    id: "msg_\(UUID().uuidString.prefix(6))",
                    channelID: channel.id,
                    authorID: backend.currentUser.id,
                    authorName: backend.currentUser.name,
                    text: recordedText,
                    createdAt: .now))
                if let fresh = try? await backend.fetchEntries(channelID: channel.id) {
                    entries = fresh
                    local?.replaceEntries(fresh, channelID: channel.id)
                }
            case .answer(let answer, let presented):
                // 回答了 → 移除樂觀「處理中」泡泡,改放提問 + 答案兩個本地泡泡。
                messages.removeAll { $0.id == tempID }
                messages.append(Message(
                    id: "ask_\(UUID().uuidString.prefix(6))",
                    channelID: channel.id,
                    authorID: backend.currentUser.id,
                    authorName: backend.currentUser.name,
                    text: trimmed))
                let ansID = "ans_\(UUID().uuidString.prefix(6))"
                messages.append(Message(
                    id: ansID,
                    channelID: channel.id,
                    authorID: ChatStore.assistantID,
                    authorName: "",
                    text: answer))
                if !presented.isEmpty { presentedByMessage[ansID] = presented }
            }
        } catch {
            // 失敗:標記該樂觀訊息,並帶上真正的失敗原因方便排查。
            if let idx = messages.firstIndex(where: { $0.id == tempID }) {
                messages[idx].isProcessing = false
                messages[idx].text += "\n⚠️ 傳送失敗:\(error.localizedDescription)"
            }
            errorMessage = error.localizedDescription
        }
    }

    /// 助手回答用的固定作者 ID(本地顯示,不存後端)。
    static let assistantID = "usr_assistant"

    /// 成員用:把問題以自然語言查詢頻道。問答持久化進裝置端 LocalStore
    /// (重開頻道仍在,後端不存)。
    func ask(_ question: String) async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // 我的提問氣泡(持久化)。
        let askMsg = Message(
            id: "ask_\(UUID().uuidString.prefix(6))",
            channelID: channel.id,
            authorID: backend.currentUser.id,
            authorName: backend.currentUser.name,
            text: trimmed)
        messages.append(askMsg)
        local?.upsertMessage(askMsg)

        // 助手「思考中」氣泡(暫態佔位)。
        let pendingID = "ans_\(UUID().uuidString.prefix(6))"
        messages.append(Message(
            id: pendingID,
            channelID: channel.id,
            authorID: ChatStore.assistantID,
            authorName: "助手",
            text: "",
            isProcessing: true))

        do {
            let answer = try await backend.semanticQuery(channelID: channel.id, question: trimmed)
            if let idx = messages.firstIndex(where: { $0.id == pendingID }) {
                messages[idx].text = answer.answer
                messages[idx].isProcessing = false
            }
            // 答案氣泡持久化(用同一 id,確保重載順序一致)。
            local?.upsertMessage(Message(
                id: pendingID,
                channelID: channel.id,
                authorID: ChatStore.assistantID,
                authorName: "助手",
                text: answer.answer))
        } catch {
            if let idx = messages.firstIndex(where: { $0.id == pendingID }) {
                messages[idx].text = "查詢失敗:\(error.localizedDescription)"
                messages[idx].isProcessing = false
            }
            errorMessage = error.localizedDescription
        }
    }
}
