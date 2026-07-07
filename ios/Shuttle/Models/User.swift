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

/// 頻道成員角色:決定該成員在頻道內的權限。對應後端 model 的 role。
enum ChannelRole: String, Codable, Hashable {
    case editor // 可修改(記事/編輯條目);owner 預設為此。
    case viewer // 只能查詢(自然語言提問),不能記事。
}

/// Member 是頻道成員:公開身分 + 在該頻道的角色。對應後端 model.Member(扁平 User 欄位 + role)。
struct Member: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var avatarColor: String
    var role: ChannelRole

    var initials: String {
        String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }
    var color: Color { Color(hex: avatarColor) ?? .blue }

    init(id: String, name: String, avatarColor: String, role: ChannelRole = .viewer) {
        self.id = id; self.name = name; self.avatarColor = avatarColor; self.role = role
    }
    /// 後端未填 role 時預設 viewer(防呆)。
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        avatarColor = try c.decode(String.self, forKey: .avatarColor)
        role = (try? c.decode(ChannelRole.self, forKey: .role)) ?? .viewer
    }
    private enum CodingKeys: String, CodingKey { case id, name, avatarColor, role }
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
