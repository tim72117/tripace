import SwiftUI

/// 頻道條目的垂直時間軸視圖:左側一條垂線串起圓點,每個 entry 一節,
/// 依 start 時間排序(沿用後端/快取的排序),顯示時間、事項、地點與標注。
struct TimelineView: View {
    let entries: [Entry]

    var body: some View {
        Group {
            if entries.isEmpty {
                ContentUnavailableView("還沒有條目", systemImage: "clock",
                                       description: Text("在頻道裡記事後,會在這裡依時間排列。"))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { idx, entry in
                            TimelineRow(entry: entry,
                                        isFirst: idx == 0,
                                        isLast: idx == entries.count - 1)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
            }
        }
        .navigationTitle("時間軸")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// 時間軸的一節:左側軸線 + 圓點,右側 entry 內容卡。
private struct TimelineRow: View {
    let entry: Entry
    let isFirst: Bool
    let isLast: Bool

    private let dotSize: CGFloat = 12
    private let railWidth: CGFloat = 24

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // 左側軸線(上下連接線 + 圓點)。
            ZStack(alignment: .top) {
                // 連接線:第一節不畫上半、最後一節不畫下半,讓軸線頭尾收齊。
                VStack(spacing: 0) {
                    Rectangle()
                        .fill(isFirst ? Color.clear : Color(.systemGray4))
                        .frame(width: 2, height: dotSize / 2 + 6)
                    Rectangle()
                        .fill(isLast ? Color.clear : Color(.systemGray4))
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                }
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: dotSize, height: dotSize)
                    .padding(.top, 6)
            }
            .frame(width: railWidth)

            content
                .padding(.bottom, 18)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.whenText ?? "未指定時間")
                .font(.caption).fontWeight(.semibold)
                .foregroundStyle(Color.accentColor)
            Text(entry.item)
                .font(.subheadline)
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
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}
