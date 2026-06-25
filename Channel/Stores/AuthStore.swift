import SwiftUI
import Observation
import AuthenticationServices

/// 管理登入狀態:Apple 登入、token 持久化、目前使用者。
@MainActor
@Observable
final class AuthStore {
    private let backend: BackendService

    /// 目前登入的使用者;nil 表示訪客(未登入)。
    var user: User?
    /// 目前登入者的 email(私密資料 profile);訪客為 nil。
    var email: String?
    var isSigningIn = false
    var errorMessage: String?
    /// App 啟動還原 session 期間為 true:RootView 據此顯示 loading,
    /// 避免在還原既有登入時先閃一下登入畫面。
    var isRestoring = true

    var isSignedIn: Bool { user != nil }

    /// 從 backend 同步登入者的 email(僅 HTTP backend 有 profile)。
    private func syncEmail() {
        email = (backend as? HTTPBackendService)?.currentEmail
    }

    init(backend: BackendService) {
        self.backend = backend
    }

    /// App 啟動時還原既有 session。完成(無論成功與否)後 isRestoring 轉 false,
    /// RootView 才據 isSignedIn 決定顯示頻道或登入畫面。
    func restore() async {
        defer { isRestoring = false }
        guard let token = TokenStore.load() else { return }
        backend.setAuthToken(token)
        // 若 backend 支援向後端確認身分,則確認;失敗就清除。
        if let http = backend as? HTTPBackendService {
            do {
                user = try await http.refreshCurrentUser()
                syncEmail()
            } catch {
                signOut()
            }
        } else {
            user = backend.currentUser
        }
    }

    /// 處理 Sign in with Apple 的授權結果。
    func handleAppleAuthorization(_ result: Result<ASAuthorization, Error>) async {
        isSigningIn = true
        errorMessage = nil
        defer { isSigningIn = false }

        switch result {
        case .failure(let error):
            // 使用者取消不視為錯誤。
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            errorMessage = error.localizedDescription

        case .success(let auth):
            guard
                let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let identityToken = String(data: tokenData, encoding: .utf8)
            else {
                errorMessage = "無法取得 Apple identity token"
                return
            }
            let fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }.joined(separator: " ")
            do {
                user = try await backend.signInWithApple(
                    identityToken: identityToken,
                    fullName: fullName.isEmpty ? nil : fullName)
                persistToken()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// 以 email/密碼註冊新帳號。
    func register(email: String, password: String, name: String?) async {
        await runAuth { try await self.backend.register(email: email, password: password, name: name) }
    }

    /// 以 email/密碼登入。
    func signIn(email: String, password: String) async {
        await runAuth { try await self.backend.signIn(email: email, password: password) }
    }

    /// 共用的 email 認證流程:設定載入狀態、執行、保存 token。
    private func runAuth(_ action: () async throws -> User) async {
        isSigningIn = true
        errorMessage = nil
        defer { isSigningIn = false }
        do {
            user = try await action()
            persistToken()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// HTTP backend 登入成功後已在內部保存 token;取出存進 Keychain,並同步 email。
    private func persistToken() {
        syncEmail()
        if let http = backend as? HTTPBackendService, let t = http.currentToken {
            TokenStore.save(t)
        }
    }

    func signOut() {
        TokenStore.delete()
        backend.setAuthToken(nil)
        user = nil
        email = nil
    }
}
