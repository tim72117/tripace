# Channel 後端服務(Golang + SQLite 原型)

Channel App 的後端。原型階段用 **SQLite** 持久化,訊息發送時經 LLM 整理/分類/標注後存入資料庫;
提供語意查詢(RAG)端點。對齊 [../docs/API.md](../docs/API.md)。

## 技術

- 純標準庫 `net/http`(Go 1.22+ 路由樣式),無 web 框架
- `modernc.org/sqlite` — 純 Go SQLite driver,**免 CGO**,直接 `go build` 即可
- LLM 能力抽象成 `llm.Analyzer` 介面;原型用關鍵字規則(`RuleBasedAnalyzer`),
  之後換成呼叫你的真實 LLM 服務的實作即可,handler 不需更動。

## 執行

```bash
cd server
go run ./cmd/server                  # 預設 :8080,DB=channel.db,自動寫入示範頻道
go run ./cmd/server -addr :8090 -db /tmp/c.db -seed=false
```

## 目錄結構

```
server/
├── cmd/server/        main:flag、seed、啟動 HTTP
└── internal/
    ├── model/         共用資料結構(JSON 對齊 App Codable)
    ├── store/         SQLite 持久層(schema/migrate、channels、messages、members)
    ├── llm/           Analyzer 介面 + 規則式分類/標注/RAG(原型)
    └── api/           HTTP handlers + middleware
```

## 端點

| Method | Path | 說明 |
|--------|------|------|
| GET  | `/health` | 健康檢查 |
| GET  | `/v1/channels` | 列出頻道 |
| POST | `/v1/channels` | 建立頻道 `{name}` |
| GET  | `/v1/channels/{id}/messages` | 列出訊息(舊→新) |
| POST | `/v1/channels/{id}/messages` | 發訊息 `{text}` → LLM 分類標注 → **存入 SQLite** |
| GET  | `/v1/channels/{id}/members` | 列出成員 |
| POST | `/v1/channels/{id}/members` | 加成員 `{userID,name,avatarColor}` |
| POST | `/v1/channels/{id}/query` | 語意查詢 `{question}` → RAG 回答 + 引用來源 |

## 快速測試

```bash
curl localhost:8080/v1/channels
curl -X POST localhost:8080/v1/channels/ch_001/messages \
  -H 'Content-Type: application/json' -d '{"text":"明天下午開會討論 Q4 預算"}'
curl -X POST localhost:8080/v1/channels/ch_001/query \
  -H 'Content-Type: application/json' -d '{"question":"有討論到預算嗎?"}'
```

## 資料表

- `channels(id, name, created_at, updated_at)`
- `messages(id, channel_id, author_id, author_name, text, category, tags, summary, created_at)` — `tags` 為 JSON 陣列字串
- `members(channel_id, user_id, user_name, avatar_color)`

## 下一步

- [ ] 接真實 LLM:實作 `llm.Analyzer` 的 HTTP 版本,呼叫你的 LLM 服務
- [ ] RAG 升級:訊息寫入時做 embedding,改用 Postgres + pgvector 做向量檢索
- [ ] 認證(Bearer token),從 token 解析 currentUser
- [ ] iOS App 端實作 `HTTPBackendService` 接上此服務
