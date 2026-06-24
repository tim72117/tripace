import SwiftUI

/// 頻道條目的垂直時間軸:依「日期」分組,每個日期一個軸點(左側軸線串圓點),
/// 日期標題對齊圓點,當天多筆事項以小卡列在下方。對齊 web TimelineScreen 設計。
/// entries 沿用後端/上層的排序(已依 start 排)。
struct TimelineView: View {
    let entries: [Entry]

    /// 依日期分組(保留原順序);無 start 歸「未指定時間」。
    private var groups: [(day: String, items: [Entry])] {
        var result: [(day: String, items: [Entry])] = []
        for e in entries {
            let day = Self.dayKey(e)
            if var last = result.last, last.day == day {
                last.items.append(e)
                result[result.count - 1] = last
            } else {
                result.append((day: day, items: [e]))
            }
        }
        return result
    }

    /// entry 的日期分組鍵(YYYY-MM-DD);無 start 歸「未指定時間」。
    private static func dayKey(_ e: Entry) -> String {
        e.start.isEmpty ? "未指定時間" : String(e.start.prefix(10))
    }

    var body: some View {
        Group {
            if entries.isEmpty {
                ContentUnavailableView("還沒有條目", systemImage: "clock",
                                       description: Text("在頻道裡記事後,會在這裡依時間排列。"))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        let gs = groups
                        ForEach(Array(gs.enumerated()), id: \.element.day) { idx, g in
                            TimelineRow(day: g.day, items: g.items,
                                        isFirst: idx == 0,
                                        isLast: idx == gs.count - 1)
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.vertical, 8)
                }
            }
        }
        .navigationTitle("時間軸")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// 時間軸的一節:左側軸線 + 圓點,右側「日期標題 + 當天所有事項小卡」。
/// 圓點對齊日期那一行;首節不畫上半線、末節不畫下半線,讓軸線頭尾收齊。
private struct TimelineRow: View {
    let day: String
    let items: [Entry]
    let isFirst: Bool
    let isLast: Bool

    private let dotSize: CGFloat = 12
    private let railWidth: CGFloat = 24
    private let topInset: CGFloat = 6 // 圓點距頂(對齊日期文字基線)

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            rail
                .frame(width: railWidth)
            group
                .padding(.bottom, 18)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var rail: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                // 圓點上方那段(到 dot 的 inset);首節隱藏。
                Rectangle()
                    .fill(isFirst ? Color.clear : Color(.systemGray4))
                    .frame(width: 2, height: dotSize / 2 + topInset)
                // 撐滿到下一節;末節隱藏。
                Rectangle()
                    .fill(isLast ? Color.clear : Color(.systemGray4))
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
            }
            Circle()
                .fill(Color.accentColor)
                .frame(width: dotSize, height: dotSize)
                .padding(.top, topInset)
        }
    }

    private var group: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 日期標題(對齊軸點)。
            Text(day)
                .font(.caption.monospaced()).fontWeight(.bold)
                .foregroundStyle(Color.accentColor)
                .padding(.bottom, 2)
            ForEach(items) { e in
                card(e)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func card(_ e: Entry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                // 事項旁的時刻(非全日事件才顯示)。
                if let t = timeOf(e) {
                    Text(t)
                        .font(.caption.monospaced()).fontWeight(.semibold)
                        .foregroundStyle(Color.accentColor)
                }
                Text(e.item).font(.subheadline)
            }
            if let loc = e.location, !loc.isEmpty {
                Label(loc, systemImage: "mappin.and.ellipse")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if e.hasAnnotations {
                HStack(spacing: 6) {
                    if let category = e.category {
                        TagChip(text: category, systemImage: "folder", tint: .orange)
                    }
                    ForEach(e.tags, id: \.self) { tag in
                        TagChip(text: "#\(tag)", tint: .blue)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }

    /// 非全日事件取時刻(start 的 HH:MM 部分);全日/無時間回 nil。
    private func timeOf(_ e: Entry) -> String? {
        guard !e.allDay, e.start.count > 10 else { return nil }
        return String(e.start.dropFirst(11)) // 'YYYY-MM-DD HH:MM' → 'HH:MM'
    }
}
