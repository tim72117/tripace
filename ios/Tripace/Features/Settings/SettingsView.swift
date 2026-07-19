import SwiftUI
import AuthenticationServices

/// 設定頁:帳密註冊/登入、Sign in with Apple,或顯示目前帳號 / 登出。
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    private enum Mode { case login, register }
    @State private var mode: Mode = .login
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""

    var body: some View {
        @Bindable var auth = app.auth
        NavigationStack {
            List {
                Section("帳號") {
                    if let user = auth.user {
                        // 點帳號列 → 進帳號詳情(name / email / id + 登出)。
                        NavigationLink {
                            AccountDetailView()
                        } label: {
                            signedInRow(user)
                        }
                    } else {
                        guestRow
                    }
                }

                if auth.user == nil {
                    emailAuthSection
                    Section {
                        signInButton
                    } header: {
                        Text("或")
                    } footer: {
                        Text("登入後,你發送的訊息會以你的身分顯示。未登入時以訪客身分使用。")
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

    // MARK: 帳密註冊/登入

    private var emailAuthSection: some View {
        Section {
            Picker("", selection: $mode) {
                Text("登入").tag(Mode.login)
                Text("註冊").tag(Mode.register)
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)

            if mode == .register {
                TextField("顯示名稱(選填)", text: $name)
                    .textContentType(.name)
            }
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("密碼(至少 6 字元)", text: $password)
                .textContentType(mode == .register ? .newPassword : .password)

            Button {
                Task { await submit() }
            } label: {
                HStack {
                    Spacer()
                    if app.auth.isSigningIn {
                        ProgressView()
                    } else {
                        Text(mode == .login ? "登入" : "註冊")
                    }
                    Spacer()
                }
            }
            .disabled(!canSubmit || app.auth.isSigningIn)
        } header: {
            Text("以 Email 登入")
        }
    }

    private var canSubmit: Bool {
        email.contains("@") && password.count >= 6
    }

    private func submit() async {
        let e = email.trimmingCharacters(in: .whitespaces)
        switch mode {
        case .login:
            await app.auth.signIn(email: e, password: password)
        case .register:
            await app.auth.register(email: e, password: password,
                                    name: name.isEmpty ? nil : name)
        }
        if app.auth.isSignedIn { password = "" }
    }

    // MARK: 帳號狀態列

    private func signedInRow(_ user: User) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: 44)
            VStack(alignment: .leading) {
                Text(user.name).font(.headline)
                Text(app.auth.email ?? "已登入")
                    .font(.caption).foregroundStyle(.secondary)
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
    }
}

/// 帳號詳情:顯示 name / email / ID,提供登出。
struct AccountDetailView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if let user = app.auth.user {
                Section {
                    HStack(spacing: 12) {
                        AvatarView(user: user, size: 56)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.name).font(.title3.weight(.semibold))
                            if let email = app.auth.email {
                                Text(email).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("帳號資料") {
                    LabeledContent("名稱", value: user.name)
                    LabeledContent("Email", value: app.auth.email ?? "—")
                    LabeledContent("使用者 ID", value: user.id)
                }

                Section {
                    Button("登出", role: .destructive) {
                        app.auth.signOut()
                        dismiss()
                    }
                }
            }
        }
        .navigationTitle("帳號")
        .navigationBarTitleDisplayMode(.inline)
    }
}
