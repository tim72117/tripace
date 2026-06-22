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

/// 單一頻道內的聊天狀態容器:訊息流、發訊息(樂觀更新 + LLM 標注回填)。
@MainActor
@Observable
final class ChatStore {
    private let backend: BackendService
    let channel: Channel

    var messages: [Message] = []
    var isLoading = false
    var errorMessage: String?

    init(backend: BackendService, channel: Channel) {
        self.backend = backend
        self.channel = channel
    }

    var currentUserID: String { backend.currentUser.id }

    func load() async {
        isLoading = true
        do {
            messages = try await backend.fetchMessages(channelID: channel.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    /// 發送訊息:先樂觀插入「處理中」的訊息,再等後端 LLM 標注回傳後就地替換。
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
            let saved = try await backend.postMessage(channelID: channel.id, text: trimmed)
            if let idx = messages.firstIndex(where: { $0.id == tempID }) {
                messages[idx] = saved
            }
        } catch {
            // 失敗:標記該樂觀訊息
            if let idx = messages.firstIndex(where: { $0.id == tempID }) {
                messages[idx].isProcessing = false
                messages[idx].text += " ⚠️(傳送失敗)"
            }
            errorMessage = error.localizedDescription
        }
    }
}
