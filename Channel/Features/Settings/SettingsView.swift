import SwiftUI
import AuthenticationServices

/// 設定頁:登入(Sign in with Apple)或顯示目前帳號 / 登出。
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var auth = app.auth
        NavigationStack {
            List {
                Section("帳號") {
                    if let user = auth.user {
                        signedInRow(user)
                    } else {
                        guestRow
                    }
                }

                if auth.user == nil {
                    Section {
                        signInButton
                    } footer: {
                        Text("登入後,你發送的訊息會以你的身分顯示。未登入時以訪客身分使用。")
                    }
                } else {
                    Section {
                        Button("登出", role: .destructive) { auth.signOut() }
                    }
                }

                if let err = auth.errorMessage {
                    Section { Text(err).foregroundStyle(.red).font(.callout) }
                }
            }
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } }
            }
        }
    }

    private func signedInRow(_ user: User) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: 44)
            VStack(alignment: .leading) {
                Text(user.name).font(.headline)
                Text("已透過 Apple 登入").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var guestRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 36)).foregroundStyle(.secondary)
            VStack(alignment: .leading) {
                Text("訪客").font(.headline)
                Text("尚未登入").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var signInButton: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
        } onCompletion: { result in
            Task { await app.auth.handleAppleAuthorization(result) }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: 48)
        .disabled(app.auth.isSigningIn)
        .overlay {
            if app.auth.isSigningIn { ProgressView() }
        }
    }
}
