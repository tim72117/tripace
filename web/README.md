# Channel Web — 後端開發測試台

套 iPhone 外框的 web app,**用途是開發時方便測試 Go 後端**(不是正式產品)。
左側是像 app 的操作介面,右側是 debug panel,即時顯示每次 API 的原始
request/response JSON、HTTP 狀態碼與耗時。

## 快速開始

```bash
# 1. 先啟動後端(在 server/ 目錄)
cd ../server
go run ./cmd/server -addr :8080 -llm rule    # 或 -llm want 接 want 引擎

# 2. 啟動測試台(本目錄)
npm install      # 第一次
npm run dev      # → http://localhost:5173
```

開瀏覽器到 http://localhost:5173,左側操作、右側看 API 交易。

## 設定

進「設定」分頁可改:

- **Base URL** — 後端位址,預設 `http://localhost:8080`
- **Bearer Token** — 貼上 JWT 走登入身分;留空走訪客 `usr_me`

兩者存在瀏覽器 localStorage,重整不會掉。設定頁也有 `GET /health` 一鍵測試。

## 涵蓋的端點

對齊 `server/internal/api` 與 `docs/API.md` 全部路由:

| 操作 | 端點 |
|------|------|
| 頻道列表 / 建立 | `GET/POST /v1/channels` |
| 訊息列表 / 發送(LLM 標注) | `GET/POST /v1/channels/{id}/messages` |
| 成員列表 / 邀請 | `GET/POST /v1/channels/{id}/members` |
| 找使用者 | `GET /v1/users/search?q=` |
| 語意查詢(RAG) | `POST /v1/channels/{id}/query` |
| 健康檢查 | `GET /health` |

## 注意

- 後端已加開發用 CORS middleware(`server/internal/api/middleware.go` 的 `cors`),
  放行所有來源,所以前端可獨立跑在 5173。正式環境應收斂 `Allow-Origin`。
- 型別定義在 `src/types.ts`,與後端 `model.go` 嚴格對齊;後端改欄位時要同步這裡。
- Sign in with Apple 在純 web 無法走原生流程;此測試台改用「手貼 token / 訪客」測認證。

## 結構

```
src/
├── types.ts       # 與後端對齊的 TS 型別
├── api.ts         # API client(攔截每次交易,計時、擷取原始 JSON)
├── App.tsx        # iPhone 殼 + 各頁面(頻道/聊天/成員/查詢/設定)
├── DebugPanel.tsx # 右側 debug panel
└── styles.css     # iOS 風格樣式
```
