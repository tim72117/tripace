import SwiftUI

/// 單則訊息列。顯示作者、內容,以及後端 LLM 的分類/標籤/摘要。
struct MessageRow: View {
    let message: Message
    let isMe: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isMe { Spacer(minLength: 40) }

            VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
                if !isMe {
                    Text(message.authorName).font(.caption).foregroundStyle(.secondary)
                }

                Text(message.text)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(isMe ? Color.accentColor : Color(.secondarySystemBackground),
                                in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(isMe ? .white : .primary)

                // LLM 標注區
                if message.isProcessing {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        Text("LLM 整理中…").font(.caption2).foregroundStyle(.secondary)
                    }
                } else if message.hasAnnotations {
                    annotations
                }
            }

            if !isMe { Spacer(minLength: 40) }
        }
    }

    private var annotations: some View {
        VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
            HStack(spacing: 6) {
                if let category = message.category {
                    TagChip(text: category, systemImage: "folder", tint: .orange)
                }
                ForEach(message.tags, id: \.self) { tag in
                    TagChip(text: "#\(tag)", tint: .blue)
                }
            }
            if let summary = message.summary {
                Text("摘要:\(summary)")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
