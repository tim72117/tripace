import SwiftUI

/// 單則訊息列。新模型:message 只剩原話,LLM 標注已移至 Entry(在上方事件列表顯示)。
/// 助手「回答」訊息可在泡泡下掛上 present_entries 輸出的展示條目。
struct MessageRow: View {
    let message: Message
    let isMe: Bool
    /// agent 用 present_entries 輸出、要在答案泡泡下顯示的條目(查詢結果列表用)。
    var presented: [PresentedEntry] = []

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isMe { Spacer(minLength: 40) }

            VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
                // 助手回答泡泡不顯示作者名(不出現「助手」);其他人的訊息才標名字。
                if !isMe && message.authorID != ChatStore.assistantID {
                    Text(message.authorName).font(.caption).foregroundStyle(.secondary)
                }

                if message.isProcessing {
                    // 處理中:泡泡內只顯示波浪載入動畫(對齊 web,不顯示空文字)。
                    WaveLoadingView()
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Color(.secondarySystemBackground),
                                    in: RoundedRectangle(cornerRadius: 16))
                } else {
                    Text(message.text)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(isMe ? Color.accentColor : Color(.secondarySystemBackground),
                                    in: RoundedRectangle(cornerRadius: 16))
                        .foregroundStyle(isMe ? .white : .primary)
                }

                // 答案泡泡下的展示條目。
                ForEach(Array(presented.enumerated()), id: \.offset) { _, entry in
                    PresentedEntryCard(entry: entry)
                }
            }

            if !isMe { Spacer(minLength: 40) }
        }
    }
}

/// 處理中的波浪載入動畫:用 SF Symbol 波形 + 原生 variableColor 動畫,
/// 各段依序點亮、像海浪流動(對齊 web 的海浪載入)。iOS 17+ 原生,無需自訂動畫。
struct WaveLoadingView: View {
    var body: some View {
        Image(systemName: "waveform")
            .font(.title3)
            .foregroundStyle(.secondary)
            .symbolEffect(.variableColor.iterative)
            .accessibilityLabel("處理中")
    }
}

/// Entry 列表:頻道的事件/條目(承載結構化結果),顯示在訊息流上方。
struct EntryListView: View {
    let entries: [Entry]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("事件 / 條目")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(entries) { entry in
                EntryCard(entry: entry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// EntryCard 顯示一筆 Entry(事項 + 時間 + 標注)。
struct EntryCard: View {
    let entry: Entry

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("📅")
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.item).font(.subheadline).fontWeight(.medium)
                Text(entry.whenText ?? "未指定時間")
                    .font(.caption2).foregroundStyle(.secondary)

                // 地點(有填才顯示)。
                if let loc = entry.location, !loc.isEmpty {
                    Label(loc, systemImage: "mappin.and.ellipse")
                        .font(.caption2).foregroundStyle(.secondary)
                }

                if entry.hasAnnotations {
                    HStack(spacing: 6) {
                        if let category = entry.category {
                            TagChip(text: category, systemImage: "folder", tint: .orange)
                        }
                        ForEach(entry.tags, id: \.self) { tag in
                            TagChip(text: "#\(tag)", tint: .blue)
                        }
                    }
                    if let summary = entry.summary {
                        Text("摘要:\(summary)")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// PresentedEntryCard 顯示 present_entries 輸出的條目(查詢結果列表用,不含標注)。
struct PresentedEntryCard: View {
    let entry: PresentedEntry

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("📅")
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.item).font(.subheadline)
                Text(entry.whenText).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}
