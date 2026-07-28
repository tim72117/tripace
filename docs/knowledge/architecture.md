# 架構設計

## 整體分層

```
┌─────────────────────────────────────────────┐
│                 SwiftUI Views                │  畫面層
│  ChannelList / ChatView / MembersView /      │
│  SemanticSearchView                          │
├─────────────────────────────────────────────┤
│              ViewModels (@Observable)        │  狀態與互動邏輯
│  AppState / ChannelStore / ChatViewModel /   │
│  SearchViewModel                             │
├─────────────────────────────────────────────┤
│           BackendService (protocol)          │  服務抽象介面
│   ┌──────────────────┬────────────────────┐  │
│   │ MockBackend      │ HTTPBackend        │  │
│   │ (本地模擬,現用)  │ (Golang 服務,待接)│  │
│   └──────────────────┴────────────────────┘  │
├─────────────────────────────────────────────┤
│                   Models                     │  純資料模型(Codable)
│  User / Channel / Message / Tag /            │
│  SearchQuery / SearchAnswer                  │
└─────────────────────────────────────────────┘
```

關鍵設計:**Views/ViewModels 只依賴 `BackendService` protocol**,不知道背後是 Mock 還是真實
HTTP。切換後端只需在 App 啟動時注入不同實作,UI 程式碼零修改。

## 資料流

### 發送訊息
```
使用者輸入 → ChatViewModel.send(text)
           → backend.postMessage(channelID, text)
           → [後端 LLM 整理/分類/標注]
           → 回傳 Message(含 tags, category, summary)
           → 更新 ChannelStore → UI 自動刷新
```

訊息送出後先以「pending」狀態樂觀顯示,收到後端帶標籤的版本後就地更新。

### 加入朋友
```
ChannelDetail → MembersView → inviteFriend(userID)
             → backend.addMember(channelID, userID)
             → 成員清單更新
```

### 語意查詢(RAG)
```
成員輸入自然語言問句 → SearchViewModel.ask(question)
                    → backend.semanticQuery(channelID, question)
                    → [後端: embedding 檢索相關訊息 → LLM 生成回答]
                    → 回傳 SearchAnswer(answer, citedMessages)
                    → UI 顯示回答 + 引用來源訊息
```

## RAG 規劃(後端職責,App 不實作)

語意查詢的檢索由 Golang 後端負責,App 端只送問題、收答案。後端建議流程:

1. 訊息寫入時:對訊息文字做 embedding,存入向量庫(pgvector / Qdrant / 自建)
2. 查詢時:對問句做 embedding → 向量相似度檢索 Top-K 相關訊息
3. 把 Top-K 訊息 + 問句組成 prompt 交給 LLM → 生成回答
4. 回傳回答與被引用的訊息 ID(供 App 顯示來源)

App 端的 `SearchAnswer.citedMessageIDs` 對應這些被引用的訊息。

## 後端切換點

唯一需要改的地方在 `App` 入口的依賴注入:

```swift
// 現在(假後端)
let backend: BackendService = MockBackendService()

// 之後(真實 Golang 服務)
let backend: BackendService = HTTPBackendService(baseURL: URL(string: "https://...")!)
```

## 目錄結構

```
Channel/
├── App/                 App 入口、依賴注入
├── Models/              純資料模型
├── Services/            BackendService protocol + Mock/HTTP 實作
├── Stores/              @Observable 狀態容器
├── Features/
│   ├── Channels/        頻道列表
│   ├── Chat/            聊天/發訊息畫面
│   ├── Members/         成員管理
│   └── Search/          語意查詢畫面
└── Resources/           Assets、Mock 假資料 JSON
```
