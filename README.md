# Tripace — 智慧頻道 App

一個 iOS App。使用者可以在頻道中輸入訊息,後端 LLM 服務會整理、分類、標注訊息內容;
可以邀請朋友加入頻道;頻道成員可以用「語意輸入」的方式查詢頻道中的訊息,後端 LLM
會根據頻道內容回傳相關資訊。

## 目前狀態(階段一)

- ✅ 可編譯執行的 SwiftUI Xcode 專案骨架
- ✅ 完整 iOS 介面與導航流程
- ✅ Mock 假後端(本地模擬分類、標注、語意查詢回應)
- ⏳ 真實後端(使用者的 Golang LLM 服務)— 之後依 `docs/API.md` 規格接入

## 核心流程

1. **發訊息** → App 送訊息到後端 → 後端 LLM 整理/分類/標注 → 回傳帶標籤的訊息
2. **加朋友** → 邀請使用者加入頻道 → 成員可讀寫與查詢
3. **語意查詢** → 成員用自然語言提問 → 後端對頻道訊息做 RAG 檢索 → LLM 回答

## 技術選型

| 層 | 技術 |
|----|------|
| UI | SwiftUI (iOS 17+) |
| 狀態管理 | `@Observable` (Observation framework) |
| 網路 | `URLSession` + `async/await`,抽象成 `BackendService` protocol |
| 後端(規劃) | Golang LLM 服務,REST/JSON,RAG 向量檢索 |
| 假後端 | `MockBackendService` 實作同一 protocol |

## 開啟方式

```bash
open ios/Tripace.xcodeproj
```

選擇 iOS 模擬器後直接 ⌘R 執行。目前預設使用 `MockBackendService`,無需後端即可操作。

## 文件

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 整體架構、模組分層、資料流
- [docs/API.md](docs/API.md) — 後端 REST API 規格(給 Golang 服務實作)
- [docs/ROADMAP.md](docs/ROADMAP.md) — 開發里程碑
