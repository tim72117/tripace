import SwiftUI

/// 頻道聊天畫面:Entry 條目 + 訊息流 + 底部輸入列。
/// owner 輸入=統一輸入(assist,LLM 自主記事或回答);成員輸入=語意查詢(RAG 回答)。
struct ChatView: View {
    let channel: Channel
    @Environment(AppState.self) private var app
    @State private var store: ChatStore?
    @State private var draft = ""
    @State private var showingMembers = false
    @State private var showingTimeline = false
    @FocusState private var inputFocused: Bool

    /// 目前使用者是否為頻道擁有者。
    private var isOwner: Bool { channel.ownerID == app.currentUser.id }

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
                Button { showingMembers = true } label: { Image(systemName: "person.2") }
            }
            // 時間軸:依時間排列頻道條目。
            ToolbarItem(placement: .primaryAction) {
                Button { showingTimeline = true } label: {
                    Image(systemName: "clock")
                }
            }
        }
        .sheet(isPresented: $showingMembers) {
            NavigationStack { MembersView(channel: channel) }
        }
        .sheet(isPresented: $showingTimeline) {
            NavigationStack {
                TimelineView(entries: store?.entries ?? [])
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("完成") { showingTimeline = false }
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private func content(_ store: ChatStore) -> some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        // 以 entry 為主體:頻道的事件/條目列在最上方。
                        if !store.entries.isEmpty {
                            EntryListView(entries: store.entries)
                        }
                        ForEach(store.messages) { msg in
                            MessageRow(message: msg,
                                       isMe: msg.authorID == store.currentUserID,
                                       presented: store.presentedByMessage[msg.id] ?? [])
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
            TextField(isOwner ? "記事或提問…" : "用自然語言查詢這個頻道…",
                      text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: Capsule())
                .focused($inputFocused)
                .lineLimit(1...4)

            Button {
                let text = draft
                draft = ""
                Task {
                    if isOwner {
                        await store.send(text)
                    } else {
                        await store.ask(text)
                    }
                }
            } label: {
                Image(systemName: isOwner ? "arrow.up.circle.fill" : "sparkle.magnifyingglass")
                    .font(.title)
                    .foregroundStyle(draft.trimmingCharacters(in: .whitespaces).isEmpty
                                     ? .gray : (isOwner ? .accentColor : .purple))
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
