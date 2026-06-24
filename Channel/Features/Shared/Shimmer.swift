import SwiftUI

/// Skeleton Screen 用的流光(shimmer)效果:一條高光由左掃到右,反覆循環,
/// 讓灰色佔位塊看起來像「載入中」而非靜止的空畫面。
private struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { geo in
                    let width = geo.size.width
                    LinearGradient(
                        colors: [.clear, Color.white.opacity(0.55), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: width * 0.6)
                    .offset(x: phase * width * 1.6)
                }
            }
            .mask(content) // 高光只在佔位塊形狀內顯示
            .onAppear {
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

extension View {
    /// 套用流光效果(配合灰色佔位塊做 Skeleton loading)。
    func shimmering() -> some View { modifier(Shimmer()) }
}

/// 灰色圓角佔位塊:Skeleton Screen 的基本積木。
struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat
    var cornerRadius: CGFloat = 6

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(Color(.systemGray5))
            .frame(width: width, height: height)
    }
}
