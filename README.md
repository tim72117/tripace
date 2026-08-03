# Tripace

用自然語言記錄行程,AI 自動整理成事項、時間與地點,排上時間軸,還能和同行的人一起編輯、免登入分享。

正式站:https://tripace.shuttle.tools

## 專案結構

| 目錄 | 內容 |
|------|------|
| `web/` | 主要前端(React + TypeScript + Vite),桌面/手機共用同一份程式碼 |
| `web/admin/` | 管理後台 SPA(獨立的 Vite 專案) |
| `server/` | Go 後端(`net/http` + GORM),含 API、LLM 工具、CLI |
| `ios/` | iOS App(SwiftUI) |
| `docs/` | 設計文件與維運筆記 |

## 核心概念

- **頻道(Channel)**:一趟行程的容器,可以邀請成員共同編輯
- **條目(Entry)**:行程裡的單一事項(時間、地點、備註),是整個系統的核心資料
- **AI 記事**:使用者用自然語言輸入,LLM 透過 tool calling 直接操作條目
- **公開分享**:產生連結讓沒有帳號的人也能瀏覽(可選擇開放編輯)

## 開發環境

### 後端

```bash
cd server
go run ./cmd/server
```

預設監聽 `127.0.0.1:8080`。資料庫由 `DATABASE_URL` 環境變數決定:設定為 `postgres://...` 走 Postgres,未設定則用 `-db` 指定的 SQLite 檔案(預設 `tripace.db`)。啟動 log 會顯示實際使用哪一種。

常用旗標:

| 旗標 | 預設 | 說明 |
|------|------|------|
| `-addr` | `127.0.0.1:8080` | HTTP 監聽位址 |
| `-db` | `tripace.db` | SQLite 檔案路徑(`DATABASE_URL` 未設時的後備) |
| `-llm` | `want` | 分析器:`want`(真實 LLM)或 `mock`(假 LLM,供前端操作測試) |
| `-seed` | `true` | 資料庫為空時寫入示範資料 |
| `-dev` | `true` | 開發模式,Apple token 不驗簽章 |

本機用 Docker 起 Postgres:

```bash
cd server
docker compose up -d
```

### 前端

```bash
cd web
npm install
npm run dev
```

預設在 `http://localhost:5173`。後端位址由 `VITE_API_BASE` 決定(見 `web/.env.development`);金鑰類的設定放 `.env.development.local`(不進版控)。

### CLI

`server/cmd/cli` 是操作條目/頻道的命令列工具,走 `/internal/*` API,需要先登入:

```bash
cd server
go run ./cmd/cli login --web      # 開瀏覽器核准
go run ./cmd/cli login --device   # 或用 device code(無瀏覽器環境)
go run ./cmd/cli list-channels
```

詳見 [docs/ENTRY_CLI_GUIDE.md](docs/ENTRY_CLI_GUIDE.md)。

## 技術選型

| 層 | 技術 |
|----|------|
| 前端 | React 18 + TypeScript + Vite,`react-router-dom` v7 |
| 地圖 | Google Maps JavaScript API(渲染)、Routes / Places / Geocoding API(後端呼叫) |
| 後端 | Go + `net/http` + GORM |
| 資料庫 | Postgres(正式)/ SQLite(本機),同一套 GORM 查詢 |
| LLM | want 引擎(agent + tool calling),抽象成 `llm.Analyzer` |
| 即時通訊 | WebSocket(條目變更廣播、LLM 呼叫前端 tool) |
| 部署 | Cloud Run(主服務 + 管理後台 + 一次性維運 Job),GitHub Actions |

## 文件

架構與 API 規格文件正在重寫中。目前可參考:

- [docs/ROUTING_ARCHITECTURE.md](docs/ROUTING_ARCHITECTURE.md) — 後端路由與認證架構(`/v1/*` 與 `/internal/*` 的分界)
- [docs/TERMINOLOGY.md](docs/TERMINOLOGY.md) — 術語表(正式用語 / 介面用語 / 程式碼符號的對應)
- [docs/ENTRY_CLI_GUIDE.md](docs/ENTRY_CLI_GUIDE.md) — CLI 操作指南
- [docs/PUBLIC_LINK_DESIGN.md](docs/PUBLIC_LINK_DESIGN.md) — 公開分享連結的設計與安全考量
- [docs/PROJECT_HEALTH_REVIEW.md](docs/PROJECT_HEALTH_REVIEW.md) — 專案健康度檢視
