# Tripace Web

套 iPhone 外框的 web app,是 Tripace 的主要應用介面(寬螢幕會自動切換成
桌面版佈局)。左側是操作介面,右側是可展開的 debug panel,即時顯示每次
API 的原始 request/response JSON、HTTP 狀態碼與耗時,方便排查問題。

## 快速開始

```bash
# 1. 先啟動後端(在 server/ 目錄)
cd ../server
go run ./cmd/server -addr :8080 -llm rule    # 或 -llm want 接 want 引擎

# 2. 啟動開發伺服器(本目錄)
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

對齊 `server/internal/api`(實際呼叫見 `src/api.ts`):

| 操作 | 端點 |
|------|------|
| 健康檢查 | `GET /health` |
| 登入 / 註冊 / Apple 登入 | `POST /v1/auth/login`、`/v1/auth/register`、`/v1/auth/apple` |
| 自己的身分 | `GET /v1/me` |
| 頻道列表 / 建立 | `GET/POST /v1/channels` |
| 成員列表 / 邀請 / 改權限 | `GET/POST /v1/channels/{id}/members`、`PATCH .../members/{userID}` |
| 條目列表 / 清空頻道資料 | `GET /v1/channels/{id}/entries`、`DELETE /v1/channels/{id}` |
| 行程列表 / 行程內條目 | `GET /v1/channels/{id}/trips`、`.../trips/{tripID}/entries` |
| 即時更新(entry 更新中/完成、ask_user、task_plan 進度) | `WS /v1/channels/{id}/ws` |
| 公開分享連結:建立 / 查詢 / 撤銷 | `POST/GET/DELETE /v1/channels/{id}/public-link` |
| 公開分享頁(免登入):讀取 | `GET /v1/public/{token}` |

> 注:此表其餘「channels」路徑命名与 `docs/ROUTING_ARCHITECTURE.md` 現行的
> 「trips」命名不一致,屬於這份 README 較舊、獨立於本次變更的既有落差,
> 不在本次修正範圍——這裡只移除了已隨 want LLM 對話系統整套刪除的
> `assist`/`query`/`public/{token}/assist` 三個端點(2026-08-11,見
> `docs/ROUTING_ARCHITECTURE.md`「三之一、`/onagent/*`」一節)。

## 注意

- 後端目前的 CORS middleware(`server/internal/api/middleware.go` 的 `cors`)
  放行所有來源,方便本機開發時前端獨立跑在 5173。**正式環境應收斂
  `Allow-Origin` 為白名單**,這是已知待處理項目。
- 型別定義在 `src/types.ts`,與後端 `model.go` 嚴格對齊;後端改欄位時要同步這裡。
- Sign in with Apple 在純 web 無法走原生流程,改用「手貼 token / 訪客」登入。

## 結構

```
src/
├── main.tsx         # 進入點,依 ?debug query 決定渲染 App 或 DebugApp
├── App.tsx          # 路由分派(/、/public/{token}、其餘走主應用畫面)+ iPhone 殼
│                     # + 頻道列表/設定/登入頁 + 共用工具(Avatar/ErrorBanner/errMsg 等)
├── ChatScreen.tsx    # 聊天頁(owner 發訊息、成員以自然語言查詢)+ 成員管理 + 分享彈窗
├── Timeline.tsx      # 多軌時間軸渲染,ChatScreen 與公開分享頁共用
├── LandingPage.tsx   # 產品介紹頁(根路徑 /)
├── DebugApp.tsx      # ?debug 模式的替代進入點
├── DebugPanel.tsx    # 右側 debug panel,即時顯示每次 API 的原始 request/response
├── api.ts            # API client(攔截每次交易,計時、擷取原始 JSON)
├── deviceDB.ts       # 裝置端訊息儲存(sql.js),與後端隔離
├── types.ts          # 與後端對齊的 TS 型別
└── styles.css        # iOS 風格樣式
```
