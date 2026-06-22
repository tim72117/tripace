import SwiftUI

/// 語意查詢:成員用自然語言提問,後端對頻道訊息做 RAG 檢索 + LLM 回答。
/// 顯示回答與被引用的來源訊息。
struct SemanticSearchView: View {
    let channel: Channel
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var question = ""
    @State private var answer: SearchAnswer?
    @State private var citedMessages: [Message] = []
    @State private var isAsking = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private let suggestions = ["有討論到預算嗎?", "下次開會是什麼時候?", "有什麼待解決的問題?"]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if answer == nil && !isAsking {
                        emptyState
                    }
                    if isAsking {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("正在檢索頻道並生成回答…").foregroundStyle(.secondary)
                        }
                        .padding(.top, 40)
                    }
                    if let answer {
                        answerCard(answer)
                    }
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(.red).font(.callout)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            inputBar
        }
        .navigationTitle("語意查詢")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("完成") { dismiss() } } }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("用自然語言查詢「\(channel.name)」的訊息", systemImage: "sparkles")
                .font(.headline)
            Text("例如:").font(.caption).foregroundStyle(.secondary)
            ForEach(suggestions, id: \.self) { s in
                Button {
                    question = s
                    Task { await ask() }
                } label: {
                    Text(s).padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 24)
    }

    private func answerCard(_ answer: SearchAnswer) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "sparkles").foregroundStyle(.purple)
                Text("回答").font(.headline)
                Spacer()
                if let c = answer.confidence {
                    Text("信心 \(Int(c * 100))%").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text(answer.answer)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))

            if !citedMessages.isEmpty {
                Text("引用來源(\(citedMessages.count))").font(.subheadline.weight(.semibold))
                ForEach(citedMessages) { msg in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(msg.authorName).font(.caption).foregroundStyle(.secondary)
                        Text(msg.text).font(.callout)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("用自然語言提問…", text: $question, axis: .vertical)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: Capsule())
                .focused($focused)
                .lineLimit(1...3)
            Button {
                Task { await ask() }
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title)
                    .foregroundStyle(canAsk ? .purple : .gray)
            }
            .disabled(!canAsk)
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    private var canAsk: Bool {
        !isAsking && !question.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func ask() async {
        let q = question.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        focused = false
        isAsking = true
        errorMessage = nil
        answer = nil
        citedMessages = []
        do {
            let result = try await app.backend.semanticQuery(channelID: channel.id, question: q)
            answer = result
            // 取回被引用的訊息以顯示來源
            let all = try await app.backend.fetchMessages(channelID: channel.id)
            citedMessages = all.filter { result.citedMessageIDs.contains($0.id) }
        } catch {
            errorMessage = error.localizedDescription
        }
        isAsking = false
    }
}
