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
    var isSigningIn = false
    var errorMessage: String?

    var isSignedIn: Bool { user != nil }

    init(backend: BackendService) {
        self.backend = backend
    }

    /// App 啟動時還原既有 session。
    func restore() async {
        guard let token = TokenStore.load() else { return }
        backend.setAuthToken(token)
        // 若 backend 支援向後端確認身分,則確認;失敗就清除。
        if let http = backend as? HTTPBackendService {
            do {
                user = try await http.refreshCurrentUser()
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
                let signedIn = try await backend.signInWithApple(
                    identityToken: identityToken,
                    fullName: fullName.isEmpty ? nil : fullName)
                user = signedIn
                // HTTP backend 已在內部保存 token;從中取出存進 Keychain。
                if let http = backend as? HTTPBackendService, let t = http.currentToken {
                    TokenStore.save(t)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func signOut() {
        TokenStore.delete()
        backend.setAuthToken(nil)
        user = nil
    }
}
