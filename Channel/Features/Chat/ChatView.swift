import SwiftUI

/// 頻道聊天畫面:訊息流 + 底部輸入列。
/// 工具列可進入「成員管理」與「語意查詢」。
struct ChatView: View {
    let channel: Channel
    @Environment(AppState.self) private var app
    @State private var store: ChatStore?
    @State private var draft = ""
    @State private var showingSearch = false
    @State private var showingMembers = false
    @FocusState private var inputFocused: Bool

    var body: some View {
        Group {
            if let store {
                content(store)
            } else {
                ProgressView()
            }
        }
        .task { await setup() }
        .navigationTitle(channel.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { showingSearch = true } label: { Label("語意查詢", systemImage: "sparkle.magnifyingglass") }
                    Button { showingMembers = true } label: { Label("成員", systemImage: "person.2") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .sheet(isPresented: $showingSearch) {
            NavigationStack { SemanticSearchView(channel: channel) }
        }
        .sheet(isPresented: $showingMembers) {
            NavigationStack { MembersView(channel: channel) }
        }
    }

    @ViewBuilder
    private func content(_ store: ChatStore) -> some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(store.messages) { msg in
                            MessageRow(message: msg, isMe: msg.authorID == store.currentUserID)
                                .id(msg.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: store.messages.count) {
                    if let last = store.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
            inputBar(store)
        }
    }

    private func inputBar(_ store: ChatStore) -> some View {
        HStack(spacing: 10) {
            TextField("輸入訊息…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: Capsule())
                .focused($inputFocused)
                .lineLimit(1...4)

            Button {
                let text = draft
                draft = ""
                Task { await store.send(text) }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title)
                    .foregroundStyle(draft.trimmingCharacters(in: .whitespaces).isEmpty ? .gray : .accentColor)
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    private func setup() async {
        guard store == nil else { return }
        let s = ChatStore(backend: app.backend, channel: channel)
        store = s
        await s.load()
    }
}
