import SwiftUI

/// 使用者 / 頻道成員。
struct User: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    /// 頭像底色(hex),App 端用首字母 + 底色當作預設頭像。
    var avatarColor: String

    var initials: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return String(trimmed.prefix(1)).uppercased()
    }

    var color: Color { Color(hex: avatarColor) ?? .blue }
}

extension Color {
    /// 從 "#RRGGBB" 建立 Color。
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self = Color(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}
