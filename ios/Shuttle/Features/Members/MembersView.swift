import SwiftUI

/// 成員管理:顯示頻道現有成員,搜尋並邀請朋友加入。
struct MembersView: View {
    let channel: Channel
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var members: [Member] = []
    @State private var showingInvite = false

    /// 目前使用者是否為頻道 owner(只有 owner 能改成員權限)。
    private var isOwner: Bool { channel.ownerID == app.currentUser.id }

    var body: some View {
        List {
            Section("成員(\(members.count))") {
                ForEach(members) { member in
                    HStack(spacing: 12) {
                        AvatarView(user: User(id: member.id, name: member.name, avatarColor: member.avatarColor))
                        Text(member.name)
                        if member.id == app.currentUser.id {
                            Text("你").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        roleControl(for: member)
                    }
                }
            }
        }
        .navigationTitle("成員")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingInvite = true } label: { Label("加朋友", systemImage: "person.badge.plus") }
            }
            ToolbarItem(placement: .topBarLeading) {
                Button("完成") { dismiss() }
            }
        }
        .sheet(isPresented: $showingInvite) {
            NavigationStack {
                InviteFriendView(channel: channel, existing: members) { updated in
                    members = updated
                }
            }
        }
        .task { await load() }
    }

    /// 角色控制:owner 可切換非 owner 成員的權限;其餘只顯示角色標籤。
    @ViewBuilder
    private func roleControl(for member: Member) -> some View {
        let isChannelOwner = member.id == channel.ownerID
        if isChannelOwner {
            roleTag("擁有者", tint: .orange)
        } else if isOwner {
            Menu {
                Button("可修改") { Task { await setRole(member, .editor) } }
                Button("僅查詢") { Task { await setRole(member, .viewer) } }
            } label: {
                roleTag(member.role == .editor ? "可修改" : "查詢",
                        tint: member.role == .editor ? .blue : .secondary)
            }
        } else {
            roleTag(member.role == .editor ? "可修改" : "查詢",
                    tint: member.role == .editor ? .blue : .secondary)
        }
    }

    private func roleTag(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption).foregroundStyle(tint)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
    }

    private func load() async {
        do { members = try await app.backend.fetchMembers(channelID: channel.id) }
        catch { }
    }

    private func setRole(_ member: Member, _ role: ChannelRole) async {
        guard member.role != role else { return }
        do { members = try await app.backend.setMemberRole(channelID: channel.id, userID: member.id, role: role) }
        catch { }
    }
}

/// 輸入 email 邀請使用者加入頻道。
private struct InviteFriendView: View {
    let channel: Channel
    let existing: [Member]
    let onAdded: ([Member]) -> Void

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var isAdding = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                TextField("輸入對方的 Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
            } footer: {
                Text("輸入已註冊使用者的 Email,即可邀請加入此頻道。")
            }

            Section {
                Button {
                    Task { await invite() }
                } label: {
                    HStack {
                        Spacer()
                        if isAdding { ProgressView() } else { Text("邀請加入") }
                        Spacer()
                    }
                }
                .disabled(!canInvite || isAdding)
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red).font(.callout) }
            }
        }
        .navigationTitle("加入成員")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
        .onAppear { focused = true }
    }

    private var canInvite: Bool { email.contains("@") }

    private func invite() async {
        let e = email.trimmingCharacters(in: .whitespaces).lowercased()
        isAdding = true
        errorMessage = nil
        defer { isAdding = false }
        do {
            // 新成員預設給查詢權限(viewer);owner 之後可在成員列表升為可修改。
            let updated = try await app.backend.addMember(channelID: channel.id, email: e, role: .viewer)
            onAdded(updated)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
