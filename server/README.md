# Tripace 後端服務(Golang + SQLite 原型)

Tripace App 的後端。原型階段用 **SQLite** 持久化,訊息發送時經 LLM 整理/分類/標注後存入資料庫;
提供語意查詢(RAG)端點。對齊 [../docs/API.md](../docs/API.md)。

## 技術

- 純標準庫 `net/http`(Go 1.22+ 路由樣式),無 web 框架
- `modernc.org/sqlite` — 純 Go SQLite driver,**免 CGO**,直接 `go build` 即可
- LLM 能力抽象成 `llm.Analyzer` 介面;唯一實作是接 want 引擎的 `WantPool`(真實 LLM)。
  不再有規則式(非 LLM)分析器——server 啟動即初始化 want,失敗則 fatal。

## 執行

```bash
cd server
go run ./cmd/server                  # 預設 :8080,DB=tripace.db,自動寫入示範頻道
go run ./cmd/server -addr :8090 -db /tmp/c.db -seed=false
```

### 資料庫:本機 SQLite vs 雲端 Postgres(Cloud SQL)

啟動時會自動載入 `server/.env`(若存在)。DB 的選擇由 `DATABASE_URL` 環境變數決定:

- **設了 `DATABASE_URL=postgresql://…`** → 用 Postgres(正式環境為 Cloud SQL)。啟動 log 顯示 `DB=postgres`。
- **沒設(或註解掉)** → 退回 `-db` 指定的 SQLite 檔。啟動 log 顯示 `DB=sqlite:…`。

```bash
# 連雲端 Postgres:把連線字串放進 server/.env,然後照常啟動即可
#   DATABASE_URL=postgresql://USER:PASS@HOST/DB?sslmode=require
go run ./cmd/server                  # 自動讀 .env → DB=postgres

# 切回本機 SQLite:註解掉 .env 裡的 DATABASE_URL 即可
```

> `.env` 含密碼,已被 `.gitignore` 排除,不會進版控。
> 兩種 DB 共用同一份 GORM 程式碼;schema 由啟動時的 `AutoMigrate` 自動建立。

## 目錄結構

```
server/
├── cmd/server/        main:flag、seed、啟動 HTTP
└── internal/
    ├── model/         共用資料結構(JSON 對齊 App Codable)
    ├── store/         持久層(schema/migrate、channels、entries、members);原話不存後端,改裝置端
    ├── llm/           Analyzer 介面 + want LLM 引擎(WantPool);entry 查詢 RAG
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
