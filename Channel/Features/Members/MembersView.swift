import SwiftUI

/// 成員管理:顯示頻道現有成員,搜尋並邀請朋友加入。
struct MembersView: View {
    let channel: Channel
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var members: [User] = []
    @State private var showingInvite = false

    var body: some View {
        List {
            Section("成員(\(members.count))") {
                ForEach(members) { user in
                    HStack(spacing: 12) {
                        AvatarView(user: user)
                        Text(user.name)
                        if user.id == app.currentUser.id {
                            Text("你").font(.caption).foregroundStyle(.secondary)
                        }
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

    private func load() async {
        do { members = try await app.backend.fetchMembers(channelID: channel.id) }
        catch { }
    }
}

/// 搜尋並邀請朋友加入頻道。
private struct InviteFriendView: View {
    let channel: Channel
    let existing: [User]
    let onAdded: ([User]) -> Void

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var keyword = ""
    @State private var results: [User] = []

    var body: some View {
        List(results) { user in
            let already = existing.contains { $0.id == user.id }
            HStack(spacing: 12) {
                AvatarView(user: user)
                Text(user.name)
                Spacer()
                if already {
                    Text("已加入").font(.caption).foregroundStyle(.secondary)
                } else {
                    Button("加入") { Task { await add(user) } }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                }
            }
        }
        .navigationTitle("加朋友")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $keyword, prompt: "搜尋使用者")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
        .task(id: keyword) { await search() }
    }

    private func search() async {
        do { results = try await app.backend.searchUsers(keyword: keyword) }
        catch { }
    }

    private func add(_ user: User) async {
        do {
            let updated = try await app.backend.addMember(channelID: channel.id, userID: user.id)
            onAdded(updated)
        } catch { }
    }
}
