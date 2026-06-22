import SwiftUI
import Observation

/// 全域狀態:持有後端服務與目前使用者。
/// 透過 environment 注入,讓所有畫面共用同一個 backend 實例。
@MainActor
@Observable
final class AppState {
    let backend: BackendService
    let auth: AuthStore

    /// 目前使用者:已登入者優先,否則為 backend 的訪客身分。
    var currentUser: User { auth.user ?? backend.currentUser }

    init(backend: BackendService) {
        self.backend = backend
        self.auth = AuthStore(backend: backend)
    }
}
