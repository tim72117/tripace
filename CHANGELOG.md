# Changelog

本專案先前未維護 CHANGELOG，此檔案從 v0.2.0 開始記錄——之前版本（v0.0.1、v0.1.0、v0.1.1）的異動請直接查對應 tag 的 commit 歷史，不回溯補寫。

## v0.2.0 — 2026-08-11

### 破壞性變更

- **移除 tripace 自家 want LLM 對話系統**：前端對話（`ChatScreen.tsx`）改用 onagent 平台（`web/src/useOnagentChatBridge.ts`）。以下路由與符號已刪除：
  - `POST /v1/trips/{id}/assist`（`handleAssist`）
  - `POST /v1/trips/{id}/query`（`handleQuery`）
  - `POST /v1/public/{token}/assist`（`handlePublicAssist`）
  - `api.New(st, an llm.Analyzer, signer, devMode)` → `api.New(st, signer, devMode)`（移除 `llm.Analyzer` 參數）
  - `(*Server).EnableClientTools`
  - `GET /internal/clienttools/ws`、`POST /internal/clienttools/test-prompt`、`GET /internal/clienttools/info`
  - `internal/llm`、`internal/clienttools`、`internal/protocol`、`internal/toolschema` 四個套件整套移除；`server/tools/clienttools.yaml` 移除
  - `cmd/dumpthought`、`cmd/agentbench`、`cmd/mockllm` 三個除錯/測試用 binary 移除
  - `internal/wanttools`（`entry_query`/`geocode`/`ask_user`/`ask_choice`/`task_plan` 等工具實作）**保留原始碼**，供日後視情況遷移到 onagent，但目前無任何呼叫方
  - **已知副作用（尚未修復）**：公開分享連結的 `editable` 旗標（開啟後讓匿名訪客透過 AI 對話寫入行程）唯一的消費者就是 `handlePublicAssist`，隨其移除後**公開連結目前恆為唯讀**，不論 `editable` 開關切成什麼——欄位與 API/UI 開關仍保留，但功能上已失效。詳見 `docs/PUBLIC_LINK_DESIGN.md`「`editable` 開關」一節。

### 新增

- `recommend_nearby`、`geocode` 兩個查詢型、無副作用工具改以 onagent **BackendDispatch** 模式實作於 `internal/onagenttools`：onagent 平台的 LLM 決定呼叫時，onagent 伺服器直接 POST 到 tripace 後端執行，不經過瀏覽器分頁。對應新路由 `POST /onagent/recommend_nearby`、`POST /onagent/geocode`（見 `docs/ROUTING_ARCHITECTURE.md`「三之一、`/onagent/*`」）。搬移時修正了 want 舊版缺漏的空結果防呆（避免 index-out-of-range panic），並補上 `recommend_nearby` 的 `radius_meters` 範圍驗證。**目前刻意不做 HMAC 簽章驗證**，對齊 onagent 平台目前實際實作進度（PoC 階段已知風險）。
- `GeoInfoPanel`「加入 {tripName}」按鈕：行程本身已有排定日期時，先展開日期下拉選單（列出既有日期 + 「其他日期」），而非直接跳日曆；選單改為懸浮疊層，貼齊按鈕下方，不擠壓卡片版面，並支援視窗剩餘空間不足時自動往上翻轉、點選單外部自動收合。
- `DesktopLayout`/`GeoCandidateSidebar` 拆分重構：抽出 `DesktopRail`、`DesktopTripList`、`DesktopUserMenu`、`SettingsDialog` 四個獨立元件；`GeoCandidateSidebar` 抽出 `geoCandidateHelpers.ts` 純函式模組；地理輪廓底圖規劃頁相關 14 個元件搬進 `web/src/geo-planning/` 目錄。
- `GeoCandidateSidebar`「前一天」/「隔天」改成常駐顯示的「+ 新增」按鈕，取代原本拖曳時才浮現的臨時佔位區；已排日期之間的中間空白天自動常駐顯示。

### 修正

- `GeoOutlineMap`：點選 attraction 時不再意外觸發 `GeoHotelSidebar`（移除多餘的 `fetchGeoPlacesNearby` 呼叫）。

### 文件

- `docs/ROUTING_ARCHITECTURE.md`：移除已刪除路由的記錄，新增「三之一、`/onagent/*`」路由表，修正 `srv.Routes()` 呼叫次數（三次→四次）。
- `docs/PUBLIC_LINK_FLOW.md`、`docs/PUBLIC_LINK_DESIGN.md`：`editable` 旗標章節改寫為目前實際行為（恆為唯讀），移除已失效的 `handlePublicAssist` 流程描述。
- `docs/ENTRY_WRITE_ORDER.md` 移至 `docs/archive/ENTRY_WRITE_ORDER-obsolete-want-flow-2026-08-11.md`（描述的整套 want 工具鏈已不存在，僅供歷史參考）；`docs/ENTRY_CLI_GUIDE.md` 更新交叉引用。
- `assistant_agent.go` 完整內容備份於 `docs/archive/assistant_agent-go-backup-2026-08-11.md`。
