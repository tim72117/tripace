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

    /// local-first 載入:先讀本地快取秒開,再背景 fetch 後端、寫回本地並覆蓋畫面。
    /// owner 視角:訊息流只放本地查詢問答泡泡;記事原話已歸 entry,不灌進訊息流。
    /// member 視角:訊息流顯示自己的查詢問答(後端 messages)。
    func load() async {
        // 1) 先顯本地(若有快取,畫面立即有內容)。owner 不從快取灌 messages(訊息流非記事用)。
        if let local {
            if !isOwner {
                let cachedMsgs = local.messages(channelID: channel.id)
                if !cachedMsgs.isEmpty { messages = cachedMsgs }
            }
            if isOwner {
                let cachedEnts = local.entries(channelID: channel.id)
                if !cachedEnts.isEmpty { entries = cachedEnts }
            }
        }

        // 2) 背景重拉後端,成功則覆蓋畫面 + 寫回本地;失敗時保留本地內容、不洗掉。
        isLoading = true
        do {
            // Entry 條目只有 owner 看得到自己頻道的(成員聊天為空,無需載入)。
            async let msgs = backend.fetchMessages(channelID: channel.id)
            async let ents: [Entry] = isOwner
                ? backend.fetchEntries(channelID: channel.id)
                : []
            let freshMsgs = try await msgs
            let freshEnts = try await ents
            // owner 的記事原話歸 entry,不顯示在訊息流;member 才把訊息灌進訊息流。
            if !isOwner { messages = freshMsgs }
            entries = freshEnts
            local?.replaceMessages(freshMsgs, channelID: channel.id)
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
            case .recorded(let saved):
                // 記錄了 → 內容已歸入上方 entry 卡,訊息流不保留這則原話泡泡(移除樂觀泡泡)。
                messages.removeAll { $0.id == tempID }
                local?.upsertMessage(saved) // 仍落地本地快取(後端也有存),只是不顯示
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

    /// 成員用:把問題以自然語言查詢頻道,回答顯示在訊息流(本地,不寫入頻道)。
    func ask(_ question: String) async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // 我的提問氣泡。
        messages.append(Message(
            id: "ask_\(UUID().uuidString.prefix(6))",
            channelID: channel.id,
            authorID: backend.currentUser.id,
            authorName: backend.currentUser.name,
            text: trimmed))

        // 助手「思考中」氣泡。
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
        } catch {
            if let idx = messages.firstIndex(where: { $0.id == pendingID }) {
                messages[idx].text = "查詢失敗:\(error.localizedDescription)"
                messages[idx].isProcessing = false
            }
            errorMessage = error.localizedDescription
        }
    }
}
