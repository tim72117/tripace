# Changelog

本專案先前未維護 CHANGELOG，此檔案從 v0.2.0 開始記錄——之前版本（v0.0.1、v0.1.0、v0.1.1）的異動請直接查對應 tag 的 commit 歷史，不回溯補寫。

## v0.4.1 — 2026-08-13

### 修正

- **首頁 Googlebot 渲染空白問題**：`HomePage.tsx` 組出地圖/敘事內容的 `useEffect` 內，`new IntersectionObserver(...)` 原本沒有任何存在性檢查——若渲染環境不支援此 API（例如部分受限的無頭渲染器）會直接拋出 `ReferenceError`，中斷整個 effect，導致 hero 以下所有內容（地圖、敘事文字、bloom 圖層）永遠不會掛載出來，且因專案先前完全沒有 React Error Boundary，React 會把失敗點之後的畫面整個留白，只剩下 mount 時已 commit 的頁首。實際症狀：Google Search Console 的 URL 檢查截圖只顯示頁首，下方全為空白。修正為偵測不到 `IntersectionObserver` 時直接將所有敘事文字設為可見（降級而非空白）。
- **地圖節點縮圖缺少替代文字**：`HomePage.tsx` 動態產生的 SVG `<image>` 縮圖（7 個景點節點）補上 `role="img" aria-label`，先前對輔助工具/爬蟲形同空白圖片。

### 新增

- **全站 React Error Boundary**（`web/src/ErrorBoundary.tsx`）：包在 `App.tsx` 的路由樹最外層。此前任何路由元件在 render/effect 階段拋出未捕捉例外，都會讓 React 把畫面整個留白且無法恢復；現在會落地成一個可重新整理的畫面。這是最後一道安全網，不是特定錯誤的修法（`IntersectionObserver` 那個已在 `HomePage.tsx` 個別處理）。
- `sitemap.xml` 補上所有既有條目的 `<lastmod>`，並新增先前遺漏的 `/product` 頁面條目（該頁面在 v0.4.0 從 `"/"` 遷出後，`sitemap.xml` 一直沒有同步更新）。

### 其他

- 首頁 `<title>`/`<meta description>`/Open Graph/Twitter Card 文案調整：內容改為聚焦「協助使用者深入體驗一個想去的地方」的產品定位，不描述京都東山這類具體示範內容的細節（避免文案與首頁實際展示的範例路線強耦合，日後更換展示城市不需要連動改文案）；Twitter Card 型別由 `summary` 改為 `summary_large_image`。

  **⚠️ 待補**：新增的 `og:image`/`twitter:image` 目前指向 `https://tripace.shuttle.tools/og-image.png`，此檔案尚未建立（`web/public/` 底下沒有對應圖檔）——社群分享預覽圖目前會是失效連結，需另外提供一張 1200×630px 的分享預覽圖並放到 `web/public/og-image.png`。

## v0.4.0 — 2026-08-12

### 破壞性變更

- **首頁改版**：`"/"` 路由改渲染 `HomePage.tsx`（原 `KyotoExploreBloom.tsx`，京都東山探索路線捲動視差敘事），取代原本掛在該路徑的功能介紹頁；原功能介紹頁重新命名為 `ProductPage.tsx`（原 `LandingPage.tsx`），改掛到新路由 `/product`。暫時性的 `/kyoto-bloom-preview` 預覽路由已移除（首頁本身即是該內容，不再需要獨立預覽路徑）。曾經連到 `/kyoto-bloom-preview` 的書籤/分享連結會變成 404。
- **`LoginCard`/`LoginForm` 從 `AppCommon.tsx` 搬到新檔案 `LoginForm.tsx`**：兩者是 React 元件的具名匯出，原本跟 `useIsDesktop`/`useTripsState` 等不相關工具擠在同一個檔案，現已獨立。任何 `import { LoginCard, LoginForm } from './AppCommon'` 的呼叫端需改成 `from './LoginForm'`（本次一併更新了全部既有呼叫端：`CliAuthPage.tsx`、`DesktopUserMenu.tsx`、`PhoneContent.tsx`、`DeviceAuthPage.tsx`、`SettingsScreen.tsx`）。
- **移除全域樣式檔 `styles-login.css`/`styles-demo.css`**：`main.tsx` 不再 import 這兩個檔案。`styles-login.css` 的內容改為 `LoginForm.tsx` 自己 import 的 `LoginForm.css`（元件自帶樣式，不再依賴 `main.tsx` 的全域載入順序）；`styles-demo.css` 本身早已無實際規則（只剩解釋性註解），一併移除，不影響任何畫面。

### 新增

- **登入頁視覺改版**：`LoginCard` 的品牌 logo/標題/副標從卡片內部移到卡片外的獨立歡迎區塊（`.login-welcome`），卡片本身只保留表單——避免迎賓文字與操作型表單擠在同一個帶陰影方框裡。配色/字體對齊 `HomePage.css` 的紙感和風 token（`--paper`/`--ink`/`--vermilion`、`ShipporiSerif` 標題字），取代原本沿用舊版 `LandingPage` 度假配色（海青→暖沙漸層文字）的做法。卡片與輸入框改用純框線（背景透明，不帶實色底），陰影從戲劇化的大範圍柔焦陰影改成克制的雙層淺陰影；歡迎標題上方、卡片外框都加入低調的磚紅色點綴（`--line`/`--vermilion` 混色或純磚紅細線）。表單底部冗長的服務條款免責聲明改成一行短文字＋連到 `/terms` 的連結。以上改動僅套用在 `LoginCard` 的全螢幕迎賓情境（`.login-form.pill`），不影響 `login-dropdown`/`SettingsScreen`/`DesktopUserMenu` popover 共用同一顆 `LoginForm` 元件、走 App 自身 iOS 設計系統的情境。
- `HomePage.tsx` 右上角新增「登入」按鈕（`.app-cta`，透明底框線款），直接連到 `/app`，不需捲到頁尾或結尾 CTA 才找得到入口；首頁結尾 CTA「規劃我的探索路線」與頁尾新增的「產品功能」連結也一併補上（原本分別是佔位 `href="#"` 與缺漏）。
- `web/scripts/kyoto-bloom-generate-path.mjs`：路徑生成腳本正式收進 repo（原本是暫存目錄裡的一次性腳本），一次執行同時算出 `COORDS`/路徑 `d` 屬性/`nodeLenFractions` 三份資料，取代先前「跑兩支分開的腳本、中間手動複製貼上」的流程，避免手動搬運造成兩者不一致。

### 修正/清理

- 移除 `HomePage.tsx`（原 `KyotoExploreBloom.tsx`）的開發用「校準模式」面板（`⚙ 校準模式` 按鈕與對應調參邏輯）——`START_FRAC`/`END_FRAC` 校準已完成，不再需要即時調參工具。
- `HomePage.tsx`/`.css` 一系列耦合/結構修正：`viewBox` 的 y 偏移與高度改由 SVG 元素自身的 `viewBox` 屬性讀取（不再三處各自寫死同一組數字）；地圖節點縮圖半徑收成具名常數 `NODE_THUMB_RADIUS`；手機/桌面版行為分支（文字淡出時機、bloom 照片定位公式）收斂成 `LAYOUT_BEHAVIOR` 查表；z-index 裸數字收成 `--z-fixed-ui`/`--z-progress`/`--z-bloom`/`--z-mobile-map`/`--z-base` 五個具名 token；`update()` 拆成 `computeFrameState()`（純計算）+ `applyMapVisuals`/`applyTextEmphasis`/`applyBloomPhoto`（純 DOM 寫入）；補上 `cancelAnimationFrame`，避免 unmount 後仍有排程中的動畫幀執行；`.map-col` 手機版媒體查詢移除與桌面版重複的宣告。
- 修正 `ProductPage.css` 的一處 CSS specificity 陷阱：`.product-page a { color: inherit }` 的 specificity 高於多個單一 class 的按鈕/連結顏色規則，導致這些規則即使寫在檔案後面也會被蓋掉（按鈕文字顏色因此顯示錯誤）——受影響的選擇器補上 `.product-page` 前綴拉高權重。
- 修正 `LoginForm.css` 的 `.login-screen` 缺少 `flex-direction: column`，導致歡迎區塊與登入卡片在所有螢幕尺寸下都變成左右並排而非垂直堆疊。
- 修正 `ProductPage.tsx` 四處連到不存在路由 `/register`/`/login` 的連結（本專案沒有獨立的登入/註冊頁面，`/app` 本身已內建 `LoginForm`）；移除因此變得多餘的 `.product-btn-secondary`/`.product-nav-link` 死 CSS 規則。
- 校正 `ProductPage.css` 的配色 token 數值——原本與 `HomePage.css` 同名 token（`--paper`/`--vermilion` 等）數值不同（尤其 `--vermilion` 是明顯不同的飽和橙紅 vs 對照組偏暗磚紅），改成逐位元相符；深色模式下 `--vermilion`/`--vermilion-soft` 語意互換的錯誤一併修正。
- 修正 `ProductPage.tsx` footer 的 `onagent` 連結誤植為不存在的 `onagent.ai`（應為全站實際使用的 `https://onagent.shuttle.tools`），並將整個 footer 結構/文案對齊 `HomePage.tsx`。
- 修正並更新多處指向已改名/已刪除檔案（`LandingPage.tsx`、`KyotoExploreBloom.tsx`/`.css`、`web/public/kyoto-demo-pages/kyoto-explore-bloom.html`）的過時註解與文件（`web/README.md`、`docs/FRONTEND_CLICK_ACTIONS.md`）。

## v0.3.0 — 2026-08-12

### 破壞性變更

- **`tripace-cli` 移除 `-db` 直連 PostgreSQL 模式**：`cmd/cli/db.go`（`dbClient` 及其 `listTrips`/`createTrip`/`record`/`updateEntry`/`deleteEntry`/`reset`/`attractionAdd`/`attractionList`/`attractionCities`/`attractionDelete`/`dropTripGrouping`/`renameChannelToTrip`/`fixPhotoCacheSchema` 等方法）已整個刪除，`main.go` 移除 `-db` 全域旗標；曾經只在 `-db` 模式下可用的一次性維運指令 `drop-trip-grouping`/`rename-channel-to-trip`/`fix-photo-cache-schema` 一併移除（已在正式站執行完畢，見移除前 `store/maintenance.go` 開頭的說明）。所有操作現在一律經過 server 的 HTTP API，不再有任何路徑繞過認證/節流/請求記錄。曾以 `-db` 旗標呼叫本工具的腳本/流程需改為先 `tripace-cli login --web` 登入後直接呼叫（不帶 `-db`）。
- 連帶移除 `server/docker-compose.yml`（本地直連 PostgreSQL 開發用，隨 `-db` 模式一起失去用途）。

### 新增

- **`internal/pexels`**：新增 Pexels Search API 封裝（`Client.Search`），作為 `POST /internal/maintenance/attractions` 建檔時未帶 `photoUrl` 的自動補圖來源（查無結果或未設定 `PEXELS_API_KEY` 時靜默略過，不阻擋建檔）。同時新增 `pexels_photo_cache` 表與 `store.GetCachedPexelsPhoto`/`SetCachedPexelsPhoto`（鍵為 `search_query`）供日後「使用者瀏覽景點時即時查詢示意圖」功能共用，`attraction-add` 本身目前不經過這層快取。需設定 `PEXELS_API_KEY`（見 `server/.env.example`）。
- `POST /internal/maintenance/landmarks/{id}/update-photo` 新增 `source` 欄位（`"google"`｜`"pexels"`，未帶預設 `"google"`，向下相容既有呼叫端），可指定改走 Pexels 查詢示意圖而非 Google Places 真實照片。
- `cmd/cli` 的 `attraction-add`/`attraction-list`/`attraction-cities`/`attraction-delete` 改走新的 `/internal/maintenance/attractions*` HTTP 端點（`handleMaintenanceAttractionAdd`/`List`/`Cities`/`Delete`），取代原本只能在 `-db` 模式下使用的 `dbClient` 實作；`attraction-add` 未帶 `photoUrl` 時由後端自動查 Pexels 補上。
- 新增京都東山探索路線互動原型：`web/public/kyoto-demo-pages/`（classic 版：sticky 地圖 + clip-path 相片顯影；bloom 版：接近節點時圓點展開成大圖，靜態 HTML/CSS/JS demo）與正式 React 元件 `web/src/KyotoExploreBloom.tsx`/`.css`（掛在暫定路由 `/kyoto-bloom-preview`，尚未取代 `LandingPage`）。桌面版地圖左、文字右並排，隨捲動位置展開/收合節點縮圖為大圖；手機版改為地圖 sticky 釘在畫面上方、文字在下方捲動，套用與桌面版相同的圓點展開機制（只是方向由左右改為上下）。
- `LegalPage.tsx`/`LegalPage.css`：隱私權政策/服務條款頁面視覺改對齊 `KyotoExploreBloom` 的紙感和風風格（配色 token、`ShipporiSerif` 標題字體、footer 結構、日夜間切換機制），取代原本沿用 `landing.css` 的藍綠度假風。`PrivacyPage.tsx`/`TermsPage.tsx` 文字內容未變動。
- `App.tsx` 全部 11 條路由改用 `React.lazy()` 動態載入，取代原本的靜態 import——避免瀏覽器造訪任一頁面時，連帶下載其餘不相關頁面元件的程式碼。

### 其他

- `geo.PhotosEnabled()`：新增匯出函式，供 `internal/pexels` 判斷 Google Photo 下載是否已開啟（避免各自重複讀一次 `GOOGLE_PLACES_FETCH_PHOTOS` 環境變數）。

## v0.2.1 — 2026-08-11

### 新增

- Cloud Run 部署新增 `VITE_ONAGENT_APP_KEY`/`VITE_ONAGENT_URL` build-arg 串接（`Dockerfile`、`.github/workflows/deploy-cloudrun.yml`）——正式站前端 build 現在會正確讀到 onagent 平台的 apiKey/URL，不再 fallback 到 `localhost:8081`（此前完全沒有任何部署流程處理這兩個變數，onagent 對話功能在正式站原本會整個失效）。
- `Dockerfile` 補齊 `web/admin` 合併編譯 stage（`admin-build`），依循 onagent 專案 `Dockerfile` 的多前端合併模式：build 兩個前端、`rm -rf` 清掉 checked-in placeholder、分別 COPY 進各自的 `go:embed` 路徑。`cmd/server` 的 `-admin`/`ADMIN_ENABLED` 合併掛載開關本已支援，但先前實際 embed 進去的一直是 placeholder；目前僅補齊「合併編譯」能力，`deploy-cloudrun.yml` 未設定 `ADMIN_ENABLED`，不影響現有部署行為。
- `server/scripts/update-secret-manager.sh` 新增 `-onagent`（貼上既有 `VITE_ONAGENT_APP_KEY` 值寫入 Secret Manager——onagent apiKey 只能靠 `onagent issue-key` 另外核發，此腳本不提供現場申請）、`-cleanup-legacy-provider`（互動確認後刪除已無用的 `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY` secret 容器）、`-h`/`--help`。

### 清理

- 移除 `internal/adminconsole/health.go` 的 LLM provider 健檢項目（`llmCheckName`/`checkLLM`/`probeGET`，三者皆為套件私有符號）：這組健檢依賴的 `AI_PROVIDER`/`VLLM_BASE_URL`/`GOOGLE_API_KEY` 環境變數原本是給 v0.2.0 已移除的 want 對話系統用的，移除後已無任何 tripace 側程式碼路徑讀取，繼續探測「這個環境變數所指的服務是否可連通」已無實際功能意義。保留 DB、Google Places API 兩項健檢。
- `.github/workflows/deploy-cloudrun.yml`、`server/.env`、`server/.env.example`、`server/scripts/update-secret-manager.sh` 一併清除對應的 `AI_PROVIDER`/`AI_MODEL`/`VLLM_BASE_URL`/`OLLAMA_URL`/`GOOGLE_API_KEY`/`ANTHROPIC_API_KEY`/`LLM_KIND` 殘留設定與互動流程。

### 其他

- `server/tools/onagent-tools.yaml` 的 `recommend_nearby`/`geocode` BackendDispatch endpoint 從本機開發位址改指向正式站 `https://tripace.shuttle.tools`（已同步推送至正式 onagent 平台）。
- `ChatScreen.tsx` 輸入框 placeholder 由「onagent 推論路徑(本機測試)…」改為面向使用者的引導文字。

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
