import SwiftUI

/// 預設頭像:底色 + 首字母。
struct AvatarView: View {
    let user: User
    var size: CGFloat = 36

    var body: some View {
        Circle()
            .fill(user.color)
            .frame(width: size, height: size)
            .overlay {
                Text(user.initials)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }
}

/// LLM 標籤膠囊。
struct TagChip: View {
    let text: String
    var systemImage: String? = nil
    var tint: Color = .accentColor

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage).font(.caption2) }
            Text(text).font(.caption2)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tint.opacity(0.15), in: Capsule())
        .foregroundStyle(tint)
    }
}
