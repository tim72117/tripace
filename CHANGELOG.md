# Changelog

本專案先前未維護 CHANGELOG，此檔案從 v0.2.0 開始記錄——之前版本（v0.0.1、v0.1.0、v0.1.1）的異動請直接查對應 tag 的 commit 歷史，不回溯補寫。

## v0.26.0 — 2026-10-08

### 新增

- **地圖規劃的對話小匡改用 AI 規劃時間軸**，取代原本走 `trip_entry_*` 工具的 ChatScreen（舊對話框移到 demo 分頁保留）。`/app` 的對話小匡與 `/app/plan-ai` 全頁版共用同一份規劃內容。
- **時間軸持久化**（`web/src/plan-core/planTimelineStorage.ts`）：寫進 localStorage，重整後規劃內容與 AI 已排的站點都還在。`PlanTimeline.nodes` 是 `Map`，而 `JSON.stringify` 對 Map 會輸出 `{}` 並靜默丟失全部內容，故自訂序列化；刻意不跟 trip 綁定（跨行程的單一草稿）。
- **地圖顯示 AI 規劃的站點小圓點**（`web/src/geo-planning/usePlanStopMarkers.ts`）：與 `tripEntry` 的旗子刻意區分——旗子是已寫進資料庫的正式行程項目，圓點是還沒落進任何旅程的規劃草稿，尺寸也更小。強調態（選取／hover）用靶心＋光暈＋一次性漣漪，兩者再以外環墨濃度與光暈擴散區分「錨定 vs 掃過」。
- **時間軸卡片與地圖雙向連動**：點卡片把地圖平移到該站並高亮圓點、滑鼠移到卡片時圓點加強顯示、點地圖圓點回頭高亮對應卡片。

### 修正

- **onagent WebSocket 反覆重建**：`useAppState` 的 `cfg` 每次 render 都是新物件，而下游 `usePlanAiChatBridge` 用它當 effect 依賴——任何一次 state 更新都會 cleanup 再開一條新連線，實際觀察到單一頁面累積出 9 條。連帶造成規劃結果寫不進時間軸（agent 還在推論，連線就被下一次 render 關閉）。改用 `useMemo` 只在 `token` 變動時換 identity。
- **兩份時間軸實例互相覆蓋**：`TripPlanPage` 會同時掛載兩份（常駐的對話小匡 + 切到 `/app/plan-ai` 的全頁版），共用同一個 localStorage key 卻各自只在掛載時讀一次。在全頁版規劃完切回地圖，小匡那份舊內容（常是空的）下一次寫入就把剛規劃好的全部蓋掉。加入版次（`rev`）機制：寫入前先追上磁碟內容再計算；存檔失敗回傳 `null` 且不推進 state——若讓記憶體套用而磁碟沒有，版次會謊稱一致，之後會被另一實例靜默抹掉，且 `revRef` 一旦高於磁碟版次，「我是否過期」的判斷將永遠為 false，機制等同失效。
- **選取狀態回不去**：`selectedStopId` 原本在 `TripPlanPage` 與 `DesktopLayout` 各存一份、只有子→父單向上報，而點地圖圓點是直接寫父層那份。「點卡片 A → 點地圖圓點 B → 再點卡片 A」時，`setSelectedStopId('A')` 因值未變而被 React bail out、上報 effect 不重跑，地圖永遠停在 B。改為受控的單一事實來源，並把上報從 effect 改成事件驅動（每次點擊都通知，不看值變不變）。
- **景點縮圖載入失敗顯示破圖**：`photo_assets` 有 7 天過期，而時間軸是持久化的、可以存在更久，舊節點的 URL 失效是預期中的事。縮圖 `<img>` 補上 `onError`，整組失敗時退回 `thumbIcon` + 底色佔位，Lightbox 也不會翻到破圖。
- **地圖圓點被蓋住**：marker 建立時未帶 `zIndex`，而同步 effect 在狀態未變時會提早 return，導致重建後強調中的圓點 `zIndex` 停在預設值。
- **連點同一個目標地圖不動**：`panTarget` 的消費端依賴拆開的純量（lat/lng/…），同一座標連續設定兩次時所有依賴都沒變。加入選填的 `nonce`，讓「使用者又點了一次」這個事件語意能被表達。

### 變更

- **SEO 產品定位更新**（首頁與 `/product`）：不再描述已經不是主線操作的「候選籃 → 日層架」流程，改以 AI 編排行程為主軸。前後端兩份（`web/index.html` 與 `cmd/server/seo_meta.go`）必須逐字一致——SSR 的 `applySEOMeta` 是用 `strings.Replace` 原文比對後替換，差一個字就會靜默失效、爬蟲拿到首頁預設文案。
- 移除 `TripPlanPage` 的 header 工具列：最後只剩一顆狀態藥丸，而站數在時間軸上一目了然、「正在安排」由底部骨架卡在生成的位置本身表達，比固定在頂端的一行字更精準。

## v0.25.2 — 2026-10-07

### 變更

- 舊網域 `tripace.shuttle.tools` 改為整站 301 永久轉址到現在的正式網域 `tripace.io`（`cmd/server/main.go` 的 `withLegacyDomainRedirect`，沿用原本處理 `app.shuttle.tools` → `tripace.shuttle.tools` 的同一套機制，只是轉址目標換成這一輪的網域遷移）——不再是過渡期並存，透過舊網域存取的使用者/搜尋引擎索引會被導到新網域。
- 移除更早期處理 `app.shuttle.tools` 舊網域轉址用的獨立服務：`server/cmd/redirectserver`、`Dockerfile.redirect`、`.github/workflows/deploy-redirect.yml` 一併刪除；正式環境對應的 Cloud Run 服務 `tripace-redirect` 與 `app.shuttle.tools` 的 domain-mapping 經確認皆已不存在，不需額外清理。

## v0.25.1 — 2026-10-07

### 新增

- 新網域 `tripace.io` 上線，過渡期與既有 `tripace.shuttle.tools` 並存運作，兩者皆指向同一個 Cloud Run 服務（DNS ALIAS 記錄、domain-mapping、SSL 憑證皆已設定完成）。
- SEO 網域（canonical/og:url/og:image/twitter:image 與四個城市頁面的 JSON-LD breadcrumb）改用環境變數驅動，不再分散寫死在多個檔案：後端新增 `SITE_BASE_URL`（`cmd/server/seo_meta.go`），前端新增 `VITE_SITE_BASE_URL`（`AppCommon.tsx` 匯出 `SITE_SEO_BASE_URL`），兩者預設 fallback 皆為 `https://tripace.io`。`SITE_BASE_URL` 只透過 CD 部署流程（Cloud Run 系統環境變數）設定，不支援本機 `.env` 檔案（套件層級變數初始化早於 `.env` 載入，寫在 `.env` 不會生效，故 `server/.env.example` 不再列出這個變數）；`Dockerfile`/`deploy-cloudrun.yml` 已補上對應的 `--build-arg`/`--update-env-vars`。
- `web/public/sitemap.xml`、`robots.txt` 改指向 `tripace.io`（維持手寫，不走環境變數）。

## v0.25.0 — 2026-10-07

### 破壞性變更

- **候選籃「候選中清單」與「從候選加入」候選匡整個移除**：`web/src/geo-planning/AddFromCandidateSidebar.tsx`（含 `.module.css`）整個刪除，桌面版/手機版候選籃（`GeoCandidateSidebar.tsx`、`GeoOutlinePhoneCandidateDrawer.tsx`）都只保留「已排入行程」顯示與拖放改期；加入行程改成「選地點 → 直接選日期 → 加入時間軸」單一流程，不再有「加到候選 → 再從候選加入」兩段式操作。`onReturnToCandidate`/`handleReturnToCandidate`/`pickingDayKey`/`onlyCandidates`/`handlePickFromCandidate` 等相關 state/callback 一併移除，呼叫端需同步更新。
- **`GeoListItemCard` 移除，改為全專案通用的 `components/ListItemCard.tsx`**：原本耦合 `ClientConfig`/`fetchGeoPlacePhoto` 的查詢邏輯下放到各呼叫端自行維護，改以 `leading`/`trailing`/`badge` 插槽組裝；`web/src/geo-planning/GeoListItemCard.tsx` 已刪除，任何直接匯入這個檔案的程式碼需要改用新元件。

### 新增

- 手機版底部功能列重組：「探索」「行程」搬到底部常駐列，AI 規劃改名「規劃」；旅程清單（`PhoneTripsDrawer`）與行程抽屜（`GeoOutlinePhoneCandidateDrawer`）合併成一組雙向連動的 bottom sheet（選清單自動開行程、行程關閉視情境回彈清單、點行程項目收合不關閉、關地點資訊卡後行程自動復原展開）。
- 行程/清單項目圖示從灰色佔位或 `MapPin` 換成語意化圖示（`entryKindIcon`/`Luggage`），統一所有手機版 bottom sheet 的關閉按鈕視覺樣式。
- `PhoneTripsDrawer` 文案「新增旅程」→「新增清單」，補上關閉按鈕。

### 修正

- `docs/audit-trip-list-merge-2026-10.md` 審查文件列出的 3 項延後問題全數補完並刪除該文件：`GeoOutlinePhoneView.tsx` 的 `onCandidateDrawerActiveChange` 補上穩定參照提醒註解；`useGeoPlanningState.ts` 頂部過時的平台差異說明（仍提及已移除的 `pickingDayKey`/`onlyGeoCandidate`）更新為目前實際狀態；全專案多處殘留的已刪除檔名（`AddFromCandidateSidebar`/`GeoListItemCard`）註解改指向現存元件，`PhoneTripsDrawer` 殘留的「旅程」舊用語統一為「清單」。純文件/註解修正，不含邏輯變動。

## v0.24.2 — 2026-10-06

### 修正

- Dockerfile 的 `web-build` 階段在 `npm ci` 之前新增 `npm install -g npm@12.2.0`，修正 node:22-alpine 內建 npm 版本在 `npm ci` 時的依賴解析 bug 導致 web-build 階段失敗的問題。

## v0.24.1 — 2026-10-06

### 修正

- 重新產生 `package-lock.json`（以 npm 12.2.0、在 linux/amd64 平台），修正 Docker build 內 `npm ci` 失敗的問題。

## v0.24.0 — 2026-10-06

### 新增

- 新增 `ScrollTimeline` compound component（`<ScrollTimeline>`/`<ScrollTimeline.Anchor>`）：文案隨捲動、左側時間軸漸進顯示錨點、右側可展開嵌入式小地圖的互動機制，取代原本單純的資料驅動寫法，讓呼叫端可以自由排版文案、只在想標記的地方插入錨點。`<ScrollTimeline.Anchor>` 支援 `theme`（指向資料庫主題點，取得開卡/附近景點揭露等完整效果）或 `center`（直接指定任意座標，單純移動地圖視角）兩種定位方式。
- `InteractiveExploreMap` 新增一組 opt-in prop（`focusedTheme`/`focusedCenter`/`openCardOnFocus`/`themeCardNearbyOnly`/`disableThemeCardOnMapClick`/`revealNearbyOnFocus`/`themePhotoOnlyWhenFocused`/`restrictRadiusKm`/`showZoomControl`），讓嵌入式地圖情境可以受控切換聚焦點、控制主題卡是否顯示/以精簡模式顯示、調整可拖曳範圍——皆為新增且預設關閉，九份/京都/台南等既有城市頁呼叫方式與行為完全不變。
- 地圖上的精選點標記新增獨立的 `focused` 視覺狀態（深紅色淚滴圖釘，與既有的候選景點 `selected` 狀態完全獨立、互不干擾），供 `ScrollTimeline` 聚焦到某個精選點時套用；主題點新增可選的「只有被聚焦時才顯示圓形照片、其餘時候退化成小圓點」行為（`themePhotoOnlyWhenFocused`），照片收起時有淡出轉場。
- `/demo/scroll-timeline` 新增 ScrollTimeline 互動示範頁（假資料）。
- `/tainan-chikan`（赤崁・府城介紹頁）套用 `ScrollTimeline`，取代原本「獨立進度點 nav + 分站列表 + 頁尾固定地圖區塊」三段各自獨立的結構。

### 修正

- `geoQueryUserRateLimiter` 的預設節流規則改以「每分鐘次數」表示（`200ms/1次` → `60秒/300次`，換算等效，實際速率不變），對齊同一輪 `places.get`/`photoMedia` 兩個 endpoint 的分鐘表示法；補上連續請求放行/拒絕邊界與多使用者配額互不影響的測試。
- 新增路由層級的 `ScrollRestoration`：修正主題介紹頁捲到最底部後切換到另一頁，新頁面仍停留在底部（未捲回頂部）的問題。

### 已知問題（詳見 `docs/audit-functional.md` F42-F49）

- 🟠 `ScrollTimeline` 面板停留在「附近景點」模式時捲動到沒有 `theme` 的錨點，舊主題卡不會收掉（目前因「附近景點」按鈕被暫時隱藏而休眠，尚未修復）。
- 🟠 套用 `ScrollTimeline` 後，`/tainan-chikan` 手機版地圖從「點了才載入」退化成「進頁面就無條件載入」，尚未修復。
- 🟡 `/tainan-chikan` 原本的進度點跳轉導覽（跳到任一站/跳回地圖）被移除、未提供替代方案。

## v0.23.0 — 2026-10-06

### 破壞性變更

- **`attractions.photo_url` 資料庫欄位本身已實際 `DROP COLUMN`**（連同 `place_details_cache.new_photo_count`/`google_photo_target_count`），不只是 v0.22.0 移除的 API 回應相容欄位——這是兩個不同層級的東西：v0.22.0 移除的是 `GET /internal/geo/place-details` 等 API 回應裡的 `photoUrl` 複寫欄位，這次移除的是 `model.Attraction.PhotoURL` 這個 Go struct 欄位與對應的 DB column 本身。新增一次性維運工具 `cmd/migrate-drop-photo-url`（搭配 `Dockerfile.migrate-drop-photo-url`、Cloud Run Job 部署流程）執行這個不可逆的 schema 變更。
- `store.Store.IncrementPlaceClickCount` 回傳值簡化為 `(clickCount int64, err error)`（原本還回傳 `newPhotoCount`/`googlePhotoTargetCount`，隨兩個欄位一併移除）；`store.Store.CreateAppleUser`/`CreateGoogleUser` 新增必填的 `email` 參數——呼叫端需要同步更新,舊呼叫碼無法編譯通過。
- `POST /internal/maintenance/attractions/{id}/update-photo` 不再支援 `source: "pexels"`，改以查詢到的 Google Place 照片寫入 `photo_assets` 表（不再寫回已移除的 `photo_url` 欄位）；`POST /internal/maintenance/attractions` 建檔不再接受任何照片相關輸入，不再自動查 Pexels 補圖。
- **CLI（`server/cmd/cli`）指令語法整體改成「資源 動詞」兩段式**，所有舊指令字串全部失效（例如 `list-trips` → `trip list`、`attraction-add` → `attraction add`、`attraction-update-photo` → `attraction photo-update` 且移除 `-source` 旗標、改用 `-place-id`）。完整對照見 `tripace-cli` skill 文件。
- 後台管理介面移除「Photo target zero check」整頁功能（`GET`/`POST /admin/api/photo-target-zero-check*`、對應前端 Tab 與 API client 方法），改用新的 CLI 查詢指令 `attraction query -status no-google-photo` 取代。

### 新增

- CLI 新增 `attraction query -status no-google-photo [-city]`，查詢「有 place_id 但還沒有 Google 照片」的景點清單，對應新路由 `GET /internal/maintenance/attractions/query`。
- 修正 Apple/Google 登入建立的使用者 `email` 欄位永遠是 `NULL` 的既存問題：建立帳號時補寫入 `email`，既有帳號重新登入時自動 backfill（`store.BackfillUserEmailIfMissing`）。
- `attraction photo-update` 新增 `place_id` 來源優先序（請求帶的 `-place-id` > 該地標既有登記的 place_id > 查詢命中的結果），讓「補照片」與「補 place_id」兩件事脫鉤，不再互相耦合。

### 修正

- `server/.env.example` 的 `GCS_PHOTO_BUCKET` 本機開發預設值改成獨立的 `-dev` bucket，避免本機測試寫入正式環境的 `photo_assets`。

## v0.22.0 — 2026-10-05

### 破壞性變更

- `GET /internal(或 public)/geo/place-details`（一般模式）與 `GET /internal(或 public)/geo/place-photo-assets` 兩支 API 回應，移除 `photoUrl` 相容欄位——這個欄位原本是 `googlePhotoUrls` 清單第一張的複寫，供還沒改用多圖 UI 的舊呼叫端使用，前端已全面改讀 `googlePhotoUrls`，故不再序列化進回應。`photoOnly=1`/`textOnly=1` 這兩種查詢模式的回應形狀不受影響。任何外部直接呼叫這兩支 API 並讀取 `photoUrl` 欄位的呼叫端，需要改讀 `googlePhotoUrls[0]`。

### 新增

- `/product` 功能介紹頁補上專屬 SEO meta（title/description/canonical），修正原本 canonical 沿用首頁預設值、導致無法被 Google 獨立索引的問題。
- 地圖上主題點（isTheme）的照片查詢新增主動重試機制：查無照片時每隔 2 秒重查一次、最多 3 次，跟點開詳情卡時的既有重試邏輯一致；精選點維持單次查詢、失敗靜默，避免一次揭露大量精選點時疊加過多背景重試。
- Google Places/Geocoding API 的拒絕型限流（RateLimiter）新增涵蓋 `places.searchText`、`places.searchNearby`、`geocode` 三個先前只靠排隊節流保護的 endpoint；後台管理介面「Google API rate limits」頁面同步可管理。

### 變更

- Google Places/Geocoding API 的排隊型節流（Gateway 的 `MaxConcurrency`/`MinInterval`）預設改為不限制——短時間一批查詢在舊的排隊機制下容易讓排在後面的請求等待逾時，總量防護責任改由拒絕型 RateLimiter 統一負責。

### 修正

- 修正地圖上主題點/精選點的縮圖判斷「有沒有圖」改用 `googlePhotoUrls` 陣列長度，不再依賴即將移除的 `photoUrl` 欄位。
- 修正主題點照片重試查到新照片後，共用快取（`placeDetailsCache`）沒有同步更新的問題——先前查到新照片只會更新地圖縮圖，使用者點開詳情卡時仍會看到查詢剛觸發時的舊快取（無照片），且沒有任何機制會自動修正。
- 修正 AI 規劃版行程時間軸的照片重試機制：因為 `place-photo-assets` 回應不再帶 `photoUrl`，重試邏輯改成從 `googlePhotoUrls` 第一張衍生，避免即使背景補圖完成、縮圖仍永遠卡在沒有照片的狀態。
- 修正 Geocoding API（`geo.Client.Geocode`，供地址轉座標使用）在上述排隊節流解除後完全沒有任何節流保護的缺口——先前排隊節流解除時只把四個 Places endpoint 納入新的拒絕型限流，遺漏了共用同一個 Gateway 的 geocode 呼叫路徑。

## v0.21.5 — 2026-10-04

### 修正

- 修正子頁面（九份/京都・清水寺/台南・安平/赤崁・府城）在 Google 等搜尋引擎索引時，`<title>`/`canonical`/`description`/OG 與 Twitter 分享卡片標籤全部錯誤指向首頁的問題——本站是純前端渲染的 SPA，所有路由原本共用同一份 `index.html`，搜尋引擎第一次抓取、JS 尚未執行時讀到的都是首頁內容，很可能是這些子頁面始終沒有被獨立收錄的根因之一。
- 修正前端 `react-helmet-async` 動態改寫 `<head>` 時，不會移除 `index.html` 原有的靜態標籤、只會在旁邊追加一份，導致 JS 執行完成後同時存在兩個互相矛盾的 `canonical`（一個指向首頁、一個指向正確頁面）的問題——Google 官方文件記載多個互相矛盾的 canonical 會被直接忽略。改由 server 端統一輸出 `title`/`description`/`canonical`/`og:*`/`twitter:*`，作為唯一事實來源；四個子頁面的 React 元件僅保留 `<title>`（覆寫 `document.title` 不會重複/衝突）與 JSON-LD structured data，其餘重複宣告已移除。
- 更新 `sitemap.xml` 中受影響四個子頁面的 `lastmod`。

### 內部

- `Dockerfile` 新增建置階段測試，驗證真實前端建置產物的 `index.html` 仍包含預期的 SEO 標籤片段；若比對目標找不到、或測試因拼字錯誤等原因沒有真正執行，建置會直接失敗，不會讓壞掉的 SEO 設定悄悄上線。

## v0.21.4 — 2026-10-04

### 新增

- 城市介紹頁（九份/京都/台南安平/赤崁・府城）手機版主題點卡片的「附近景點」清單改為左右滑動瀏覽，滑動時地圖上對應的精選點會即時放大顯示縮圖、並在該點不在目前可視範圍內時自動將地圖移動過去。
- 地圖上景點標籤/縮圖新增自動避讓機制：多個景點座標距離過近、視覺上互相重疊時，依優先序（使用者正在互動的 > 主題點 > 一般精選點）自動隱藏較低優先序的標籤文字，避免文字互相蓋住看不清楚。
- 手機版主題點卡片收合到最小高度時，過濾標籤列固定顯示在標頭、不隨卡片收合而消失。

### 變更

- 手機版主題點卡片開啟期間，地圖上對應主題點原本顯示的縮圖會暫時隱藏，避免卡片內容與地圖縮圖同時重複呈現。
- CLI 工具（`tripace-cli`）登入憑證改依 API 位址分開存放，本機開發環境與正式環境的登入狀態不再互相覆蓋。

### 修正

- 修正手機版主題點卡片在地圖容器尚未展開（手機版「點一下探索地圖」縮圖尚未點開）時，底部收合高度計算錯誤導致卡片被固定在錯誤高度、內容空白且無法拖曳展開的問題。
- 修正地圖上同一批景點座標彼此接近時，縮圖/圓點/標籤的疊放順序不穩定（有時被蓋住、有時正常）的問題——根因是每個景點疊層各自建立獨立的視覺堆疊層級，子層的顯示優先序設定從未真正套用生效；改為统一由景點本身的疊層容器決定優先序。
- 修正台南赤崁・府城介紹頁地圖預設開啟的主題點名稱寫錯，導致進入頁面時沒有任何主題卡片自動展開。
- 修正資料庫中「赤崁樓」同時存在重複記錄（一筆誤標為主題點）的問題，已清理本機與正式環境資料。
- 修正「附近景點」清單文字間距過大、左右滑動時定位邏輯錯誤導致地圖畫面跳動的問題。

## v0.21.3 — 2026-10-04

### 新增

- 後端新增以使用者為單位的查詢節流（預設 200 毫秒一次），套用在所有會呼叫 Google API 的查詢端點，避免單一使用者短時間內大量操作造成計費異常。
- 正式地圖「直接點擊 Google 原生 POI 圖標」與「點擊非主題點地標」這兩種操作，補上查無照片時自動重試的機制（與主題卡、附近景點、AI 規劃卡片等既有入口一致），避免剛好遇到背景補圖還沒完成時，卡片永遠沒有照片可看。

### 變更

- Google API 查詢節流改以「每分鐘」為單位計算：地點資訊查詢放寬為每分鐘 300 次，地點照片下載為每分鐘 60 次，避免原本以秒為單位的限制太嚴格，在連續查詢時容易被誤擋。
- 後台管理介面的 API 節流設定頁面，改用「每分鐘次數」直接輸入，取代原本「視窗秒數＋次數」兩欄位分開設定的方式，操作更直覺。

## v0.21.2 — 2026-10-02

### 新增

- AI 規劃功能（正式頁 /app 與展示頁 /ai-plan）的景點查詢改套用跟地圖功能一致的漸進補圖機制，查詢結果若有多張 Google 照片，時間軸卡片縮圖現在支援點擊開啟全螢幕瀏覽（1 張或多張皆可放大檢視，多張時可左右切換）。

### 變更

- 正式頁 /app 與展示頁 /ai-plan 的時間軸畫面（景點卡片、交通估算、備註、對話訊息等）改為共用同一份元件實作，不再各自獨立維護容易脫節的複製版本。
- 移除時間軸頁面右上角固定小地圖功能（原本預設關閉，未對外曝光）。

### 修正

- 修正展示頁 /ai-plan 的對話輸入框缺少堆疊順序設定，導致生成過程中偶爾被時間軸卡片內容遮蔽的問題。

## v0.21.1 — 2026-10-02

### 修正

- 修正 GA4「瀏覽量（劃分依據：網頁標題與畫面名稱）」報表看不出各頁面差異的問題：全站是 React Router 的用戶端路由（SPA），站內導覽換頁不會重新整理瀏覽器，GTM 容器預設的頁面瀏覽偵測只在最初的文件載入觸發一次，之後完全沒有任何事件告訴 GA4「使用者換頁了」。新增路由變化監聽，每次切換頁面手動推送 page_view 事件（含 page_path/page_title/page_location）。

## v0.21.0 — 2026-10-02

### 新增

- 新增正式公開頁面 /tainan-chikan：赤崁・府城「老地方的前世今生」兩日遊介紹頁，從內部試做頁 /tainan-chikan-draft 轉正，外殼架構對齊九份頁/京都頁/台南安平頁的既有模式（互動地圖、進度導覽點、分段長頁、SEO meta/JSON-LD）。
- 首頁目的地清單新增「赤崁・府城」項目，連到新頁面，並補上點擊追蹤事件。
- 赤崁・府城頁面的頂部「立即開始」按鈕補上點擊追蹤事件（先前只有頁尾按鈕有追蹤，對齊其餘城市頁的既有涵蓋範圍）。

### 變更

- 互動地圖（九份/京都/台南安平/赤崁等頁面共用）的可拖曳範圍限制從 2km 半徑放大一倍為 4km。

## v0.20.3 — 2026-10-01

### 新增

- 功能介紹頁「核心功能」區塊新增「觀看展示」按鈕，從 AI 編排行程卡片直接連到 AI 規劃展示頁。
- 首頁、功能介紹頁、九份頁、台南安平頁的轉換按鈕（頂部「立即開始」、頁尾主要按鈕）新增點擊追蹤，用於衡量各主題介紹頁的轉換情形。

### 變更

- 功能介紹頁「自動編排行程」卡片改名為「AI編排行程」並移到第一個位置，拿掉「即將推出」提示——已不是未上線的試做功能。
- 全站「免費開始使用」按鈕文字統一改為「開始使用」。

## v0.20.2 — 2026-10-01

### 變更

- 「AI 規劃」展示頁網址從 /plan-ai 改為 /ai-plan。

## v0.20.1 — 2026-10-01

### 修正

- 修正 v0.20.0 新增的 /plan-ai 展示頁在正式環境直接訪問（或重新整理）時會收到 404 的問題：後端判斷「合法路徑」的白名單沒有同步加入這個新路由，導致伺服器端把它當成未知路徑處理。

## v0.20.0 — 2026-10-01

### 新增

- 新增獨立公開展示頁面 /plan-ai：固定播放一段兩日台南行程的腳本，用來展示「AI 規劃」功能的排程時間軸長什麼樣子；不需要登入，也不會呼叫正式功能共用的地圖查詢或 AI 對話後端，純前端固定假資料。
- 排程時間軸元件支援「多天行程」概念：同一份行程可以標示不同天，畫面會在跨天的地方自動插入分隔線，不需要再手動插入分段標記。

### 變更（含破壞性）

- 「AI 規劃」頁面不再顯示行程名稱（原本會顯示旅程名稱或「未命名行程」），因為外層桌面版/手機版已經各自有行程情境，重複顯示沒有必要——連動的 tripName 傳入方式已移除，若有其他呼叫端仍在傳遞行程名稱給這個頁面，需要一併移除。
- 手機版底部導覽列原本的「對話」分頁改為「AI 規劃」，並加上 BETA 標示。

### 修正

- 修正排程時間軸在「跨天分隔線」邏輯中，若某一站的天數比前一站更早（而非更晚）時，該站會被誤併入前一天、完全不顯示分隔線的問題。
- 修正共用的頂部漂浮品牌按鈕元件在未提供頁面標籤文字時，會忽略呼叫端額外傳入內容的問題。

### 測試

- 補齊多天行程分隔線在「天數非遞增」情境下的回歸測試覆蓋。

## v0.19.0 — 2026-09-30

### 新增

- 「AI 規劃」功能（/app/plan-ai）不再需要部署時另外開關，成為正式核心功能，與規劃地圖看齊。

### 變更（含破壞性）

- 「AI 規劃」查詢景點、地點詳情、交通時間等後端功能，改為需要登入才能使用——先前任何人都能直接呼叫，改動後未登入會收到需要登入的回應。
- 移除未受保護、任何人都能直接訪問的獨立展示頁面（/plan-ai），避免有心人士藉此大量消耗與正式功能共用的地圖查詢與 AI 對話額度。
- 「AI 規劃」對話功能改用與既有對話功能共用的平台網址設定，部署設定簡化為單一組來源。

### 修正

- 修正桌面版從「AI 規劃」頁面切回規劃地圖時，地圖偶爾維持空白、需要重新整理頁面才會顯示的問題。

## v0.18.4 — 2026-09-28

### 新增

- 規劃地圖在開新旅程（尚無任何已排定地點）時，會嘗試取得使用者目前位置當作地圖初始畫面，並在地圖上顯示一個藍點標示所在位置；使用者拒絕定位權限或裝置不支援時，維持原本的預設畫面。

### 測試

- 補齊上述定位功能成功／失敗／不支援／既有地點優先四種情境的測試覆蓋。

## v0.18.3 — 2026-09-28

### 新增

- 登入 token 失效時，網站會自動登出並回到登入畫面，不再需要使用者自己發現操作一直悄悄失敗才手動登出。

### 修正

- 修正登入狀態在特定情況下（例如登入紀錄只被部分清除）畫面仍顯示已登入、但實際上所有需要登入的功能都會失敗的問題。
- 修正 CLI／裝置登入核准流程中，若登入過期導致核准失敗，畫面會直接跳回登入畫面而看不到任何錯誤訊息的問題。

### 測試

- 補齊上述登入狀態一致性檢查與自動登出行為的測試覆蓋。

## v0.18.2 — 2026-09-28

### 新增

- 管理後台新增「Attractions missing place_id」核對清單，列出所有沒有對應 Google Place ID 的景點區域，並提供一鍵重查按鈕，自動搜尋並寫回正確的 Place ID。
- 附近景點清單拿掉顯示筆數上限，改成完整列出，與地圖上的顯示範圍一致。

### 修正

- 一般使用者登入過期時，先前的錯誤訊息誤導使用者去執行開發者用的指令；同時修正這則錯誤訊息的資料格式與其他錯誤訊息不一致、導致前端顯示不出正確內容的問題。

## v0.18.1 — 2026-09-28

### 新增

- **管理後台可查看並手動重置「Google 照片 target=0」名單裡的個別地點**：既有的核對清單新增直接顯示照片目標數量的欄位；核對確認某一列是舊資料而非合法的「已確認沒照片」後，可以直接在後台把它重置回「尚未確認」狀態，讓下次查詢時重新跟 Google 確認。
- **正式環境部署補上 GCS 照片儲存桶的授權掛載**：先前主服務的部署設定漏掉這項授權，導致漸進補圖下載到的新照片完全無法真正落地儲存——只有透過先前的一次性遷移工具搬進來的舊照片能顯示，之後所有需要「補圖」的地點永久補不上。這是正式環境「無法補圖成功」問題的根因，現已修復並於正式環境部署驗證。
- 首頁地圖入口縮圖新增周邊光暈的呼吸動畫，強化「這裡可以點」的視覺引導。

### 修正

- 背景補圖流程原本多處失敗會完全靜默、不留下任何紀錄，難以排查——現在會留下紀錄，方便後續追蹤補圖失敗的實際原因。
- 管理後台重置某個不存在的地點時，先前會誤報成功；現在會明確回報找不到對應紀錄。
- 修正一處可能讓外部服務金鑰意外流入紀錄的風險：某些網路層級的錯誤內容原本可能包含完整的請求位址，現在會先過濾掉不必要的細節再留下紀錄。

### 測試

- 補齊上述管理後台重置功能、找不到對應地點兩種情境的測試覆蓋。

## v0.18.0 — 2026-09-27

### 破壞性變更

- **公開展示頁的地點查詢授權改變**：不再用手動維護的固定景點清單，改成「只要是已建檔的景點就能查」；公開版與登入版的取圖行為（含漸進補圖）從此完全一致。
- **主題卡／景點介紹卡不再回傳舊版照片欄位**：改成一律以新的統一圖片紀錄為準，不回退任何舊資料。
- **完全移除 Pexels 作為照片來源**（僅限主題卡／景點介紹卡這條路徑），同時補上一個安全缺口：先前有個輕量查詢模式會繞過授權，讓未登入者能觸發 Pexels 查詢。

### 新增

- **圖片改用統一的落地紀錄機制**，取代原本兩張各自存完整圖片內容的舊表，資料庫不再背負儲存圖片位元組的負擔。
- **沒圖時前端會自動重試**：查完地點詳情若還沒有照片，每隔 2 秒原地重新確認一次、最多 3 次；卡片文字內容第一次查完就立即顯示，重試只補照片、不拖慢卡片出現；查詢中的佔位圖疊加載入動畫。
- **新增一次性圖片遷移工具**：把舊表的圖片內容遷移落地到雲端儲存，分兩階段執行（可重複執行的遷移階段、需人工確認後才執行的刪除階段），支援乾跑模式與範圍過濾。

### 修正

- 圖片紀錄重複寫入同一筆資料時會失敗的問題（影響遷移工具的可重跑性）。
- 「沒圖時自動重試」功能先前因為後端路由遺漏，在正式環境完全無法運作，現已修復並實測確認生效。

### 測試

- 補齊圖片落地紀錄的讀寫邏輯、遷移工具兩階段流程、地圖圖示照片查詢的測試覆蓋，先前皆為零。

## v0.16.0 — 2026-09-22

### 新增

- **台南・安平介紹頁補齊景點與 SEO**：STOPS 新增「億載金城」（純敘事，未建檔於資料庫）、「海山館」取代地理上不屬於安平的「神農街」；新增河岸咖啡、德記洋行、安平航海城三筆景點區域資料（已關閉的「0343選物店」同步從後端 allowlist 與資料庫移除）；補齊 `og:image`／`twitter:image`／JSON-LD `image` 等社群分享用 meta（之前缺漏，分享連結不會顯示縮圖）。
- **手機版城市介紹頁地圖新增不顯示餐飲/旅宿樣式**：`NativeMapBase` 新增可選 `mapId` prop（不傳時沿用既有 `VITE_GOOGLE_MAPS_MAP_ID`，正式規劃功能不受影響），`InteractiveExploreMap` 改用專屬的 `VITE_GOOGLE_MAPS_LANDING_MAP_ID` Cloud Style（`docs/map-style/*-no-food-lodging.json` 為對應樣式快照：`pointOfInterest` 父層整批關閉標籤、只重新開啟 landmark／recreation／entertainment 三個子分類）。
- 首頁「目的地」列表補上台南入口（修正此前的孤兒頁面問題），三個入口新增 `landing_destination_click` GA 事件。
- 本機開發環境（`VITE_DISABLE_ANALYTICS=1`）現在會完全不載入 GTM 容器腳本，而不只是排除 `trackEvent` 自訂事件——原本 GTM 容器本身在任何 React 程式碼執行前就已載入，即使排除自訂事件仍會觸發預設 pageview，本機測試流量被誤計入正式站統計。

### 重構

- 抽出 `useThemeToggle`／`useScrollProgress` 共用 hook 與 `CityPageFooter` 共用元件，京都／九份／台南三個城市頁移除約 130 行重複邏輯；footer 精簡對齊首頁既有結構（移除「產品功能」「更多景點」sitemap 區塊），改用 `--footer-accent` 中性 CSS 變數統一 hover 顏色（各頁在自己作用域指向各自的強調色 token）。

### 其他

- `ProductPage.tsx` 功能清單以「主題景點」（主題點／精選點分級揭露機制）取代已移除的「拖曳排入日程」項目。
- 京都／九份／台南三頁「立即開始」CTA 按鈕背景由完全透明改為低透明度頁面背景色，避免捲動內容穿透影響可讀性。

## v0.15.0 — 2026-09-21

### 新增

- **台南・安平介紹頁**（`/tainan-anping`）：比照九份、京都介紹頁模式，港口地形→貿易→淤積轉型→人文重生因果鏈的分段長頁，嵌入互動地圖並支援日夜切換、進度導覽點；後端補上對應的路由白名單、景點/地點詳情 allowlist（安平古堡、安平樹屋等 7 個地點），`sitemap.xml` 補上路由條目。
- **手機版城市介紹頁地圖改為「圓形縮圖 → 點擊展開滿版地圖」**（新元件 `MobileMapReveal`）：手機版一進頁面先顯示圓形地點縮圖，不立即建立 Google Maps（避免一進頁面就付出建圖成本），點擊縮圖後才掛載 `InteractiveExploreMap` 並以 `clip-path` 圓形展開動畫過渡到滿版（`100dvh`）地圖；展開後鎖住 `body` 捲動，避免地圖上彈出的 bottom sheet 捲動觸底時，觸控手勢穿透拉動底層頁面造成破版。京都、九份介紹頁套用此元件；地圖邊緣淡化效果同時改為只在桌面版套用，手機版維持清晰直角邊界。

### 已知缺口（待後續處理）

- 手機版地圖展開機制導入後，原本 hero 區塊對所有使用者、所有狀態都可見的「SCROLL」捲動提示已移除，改成只在 `MobileMapReveal` 的圓形縮圖畫面顯示——桌面版使用者、以及手機版已展開地圖的使用者，目前沒有任何往下捲動的視覺引導。
- `useIsDesktop`（768px）與地圖邊緣淡化 CSS 的手機斷點（900px）不一致，768–900px 寬度區間會出現桌面版地圖版面卻套用了手機版淡化歸零規則的不一致外觀。
- 首頁「目的地」列表、京都／九份頁尾「更多景點」清單尚未加入台南頁連結，僅能透過 sitemap／搜尋／直接網址進入該頁。

## v0.14.0 — 2026-09-21

### 新增

- **京都獨立介紹頁**（`/kyoto-kiyomizu`）：比照九份介紹頁模式，把原本內嵌在首頁的京都東山捲動視差敘事獨立成一個頁面，敘事文案照搬首頁既有內容，圖片搬遷到 GCS（`landing/kyoto/`），嵌入互動地圖並支援日夜切換即時換色、進度導覽點、開頭自動聚焦。
- 九份、京都介紹頁各自加上專屬的 SEO meta（`<title>`／`<meta description>`／OG／Twitter card／canonical，透過新引入的 `react-helmet-async`），取代原本整站共用首頁預設值的狀況；`sitemap.xml` 補上這兩條路由。
- 首頁新增「目的地」文字列表區塊，取代原本的完整京都捲動敘事與互動地圖，改為列出九份、京都兩個城市介紹頁的連結入口。

### 修正

- **`/jiufen`、`/kyoto-kiyomizu` 直接訪問或重新整理回傳 404**：`server/cmd/server/static.go` 的 `knownRoutePatterns` 白名單未同步新路由。
- **管理後台（`/admin`）被 PWA service worker 攔截成 404**：主應用的 `navigateFallback` 未排除 `/admin` 路徑，導致對它的導航請求被誤導回主應用的 `index.html`；`navigateFallbackDenylist` 補上 `/admin` 排除規則。
- **九份頁面公開展示頁「加入行程」按鈕靜默失效**：訪客身份下按鈕會展開日期選單，選定後卻沒有任何動作（沒有候選籃/行程可寫入，也沒有提示登入）；`PlacePanel`／`GeoOutlinePhoneInfoSheet` 新增 `requireAuth` optional prop，公開展示頁改為點擊後直接導向登入頁。
- `JiufenPage.tsx` 頁尾「更多景點」連結指向首頁而非京都介紹頁的錯字修正。

### 重構

- **`KiyomizuDemoPage` 更名為 `InteractiveExploreMap`**：這個元件已從最初的京都限定 demo，演變成首頁／九份頁／京都頁三個正式頁面共用的互動地圖元件，新名稱不再暗示綁定單一城市或暫時性質；新增 `initialZoom`／`centerNorthOffsetKm` 兩個 optional prop，讓呼叫端依景點分布密度覆寫地圖初始縮放與中心點偏移。
- 首頁移除舊版京都捲動視差敘事（SVG 手繪路徑動畫、逐站文字、bloom 展開照片）與內嵌互動地圖的全部程式碼與樣式（`HomePage.css` 約 426 行死碼一併清除）。
- `KyotoPage.css` 選擇器統一補上 `.kyoto-page` scope 前綴，避免與 `HomePage.css` 的 `.kyoto-bloom` scope 下同名 class 混淆。

## v0.13.1 — 2026-09-20

### 新增

- 首頁 hero 區塊「開始探索」按鈕旁新增「體驗探索地圖」按鈕，點擊直接捲動到下方互動地圖展示區塊，讓想直接摸真實產品的訪客不需要先看完整段手繪路徑敘事動畫。

### 修正

- `sitemap.xml` 的 `lastmod` 更新為各頁面實際最後修改日期（原本停留在 `2026-08-12`，未隨後續改動更新）。

## v0.13.0 — 2026-09-20

### 新增

- **主題點/精選點兩級揭露機制**（`attractions.is_theme` 欄位）：地圖預設只顯示主題點，點開後才揭露該主題點周邊的精選點；精選點可對應 Google `place_id`，接上既有的漸進補圖機制。
- **散策羅盤展示頁**（`KiyomizuDemoPage`）：嵌入首頁 `HomePage` 的互動地圖區塊，手機版支援點擊或滾動觸發全螢幕展開、右上角關閉按鈕退出；小卡片狀態下在地圖上滑動會正確轉為頁面捲動，不再被地圖手勢吃掉。
- **`geo_rate_limits` 資料表與後台管理介面**：地點查詢／照片下載的限流視窗、上限次數、每日額度改為可透過後台即時調整，不需重新部署。
- 手機版地點資訊卡新增「附近景點」清單，分類篩選改為點擊已選中的分類即取消（移除原本的「全部」按鈕）。

### 修正

- **`place_details_cache.google_photo_target_count` 預設值死鎖 bug**：`0` 同時代表「未確認」與「已確認且真的是 0 張」，導致某些地點永遠卡住、不再重新確認 Google 端照片張數。欄位預設值改為 `-1`（未確認 sentinel），並在 `store.Open()` 加入一次性資料修復，每次啟動自動修正符合條件的既有卡住資料列。

### 重構

- `GeoOutlineMap.tsx` 拆分為 `ExploreMap.tsx` + `NativeMapBase.tsx`，地圖建置與 overlay/marker 邏輯分離；抽出 `useAttractionOverlays`／`useInfoCardStack`／`useThemeAttractionSelection` 等共用 hook，供桌面版、手機版、展示頁三處共用同一套邏輯。
- 移除獨立的 `/demo/kiyomizu` 展示路由，保留 `HomePage` 首頁內嵌入的版本。

## v0.12.2 — 2026-09-10

### 修正

- **`/product` 頁面請求誤回 404**：`server/cmd/server/static.go` 的 `knownRoutePatterns` 白名單漏了同步 `web/src/App.tsx` 已存在的 `/product`（`ProductPage`）路由，導致伺服器誤判成未知路徑、故意回真正的 404 狀態碼——回應內容仍是可正常渲染的 `index.html`，故畫面顯示正常，但瀏覽器開發者工具的 document 請求會顯示 404，可能影響 SEO 收錄判斷。

## v0.12.1 — 2026-09-02

### 修正

- **Pexels 照片缺圖時永久不會補查**：`handleGeoPlaceDetails` 快取命中／降級回應分支新增 `ensurePexelsPhotos`，只要 Pexels 沒圖且 Google 也沒圖（`cached.NewPhotoCount == 0`）就嘗試補查一次，取代原本「Pexels 只在地點第一次被查詢時查一次、之後永遠不再嘗試」的行為——已實測重現：手動清空某地點的照片快取後，卡片會永久顯示空白，直到這次修正。
- **CI 部署腳本明確帶上地點速率限制參數**：`GOOGLE_PLACES_GET_RATE_LIMIT_*`／`GOOGLE_PLACES_PHOTO_MEDIA_RATE_LIMIT_*` 加進 `deploy-cloudrun.yml` 的 `--update-env-vars`，讓正式環境實際生效的限流參數在部署設定裡可見，之後調整不需要改程式碼重新編譯（行為與原本的程式碼預設值等價，純粹讓設定顯性化）。

### 文件

- `docs/audit-place-photo-cost-control-2026-09.md` 補上三項後續稽核發現：R4（第一次查詢撞上限流會整體降級成空白卡片）、R5（已修正，見上）、R6（`GetPlaceDetails` 與 `ListPlacePhotoRefs` 共用同一個 `places.get` 限流 key，兩者同時觸發時後者必然被前者用光的額度擋下，已查證修法方向為合併成同一次查詢）。

## v0.12.0 — 2026-09-02

### 新增

- **地點照片改為 Google／Pexels 雙來源並列，Google 端漸進補圖**（`handleGeoPlaceDetails`）：點擊地圖上 Google 原生 POI 圖標查詢地點詳情時，照片不再是「Pexels 優先、查無才 fallback Google」互斥擇一，改成兩種來源同時並列顯示（`googlePhotoUrls`／`pexelsPhotoUrls`）。Google 端因 Photos 欄位屬 Enterprise 級計費，改成依「點擊節奏 OR 距上次查詢逾 7 天」雙觸發條件才重新確認該地點實際照片張數，每次至多補下載一張，不再一次查詢就下載到上限，大幅降低單次查詢成本。
- **拒絕型速率限制元件 `apigateway.RateLimiter`**：對「地點資訊查詢」（10 秒視窗最多 1 次）與「地點照片下載」（10 分鐘視窗最多 1 次）分別設定獨立上限，超過視窗上限直接拒絕、不排隊等待，取代原本 `apigateway.Gateway` 純排隊型節流在長時間持續請求下總量無上限的缺口。
- **同一地點併發請求改為搶佔丟棄**：原本用 `singleflight.Group` 合併同一 placeID 的併發查詢（後續請求等待、共享結果），改用 `sync.Map` 搶佔機制——同一 placeID 若已有請求在處理，後續並發請求立即丟棄（不等待），降級改讀現有快取回應，使用者體驗上仍能看到內容，只是這次沒有觸發新查詢。
- 單點地點介紹查詢路徑新增 `PhotoDataURIUnrestricted`，不再受 `GOOGLE_PLACES_FETCH_PHOTOS` 全域開關控制（改由上述新機制控管成本），飯店照片／附近景點候選卡片縮圖等其餘照片查詢路徑維持原樣受此開關控制。
- 手機版地點介紹卡（`GeoOutlinePhoneInfoSheet.tsx`）補上 `PhotoCarousel` 元件（原本只有桌面版有）：多張照片時可自由橫向捲動瀏覽（不用 scroll-snap 吸附），每張照片各自帶圓角與間距，首尾張顯示時對應側留白、其餘情況貼齊卡片外緣；新增左右滑動時鎖住卡片上下拖曳手勢的方向鎖定，避免瀏覽照片時誤觸卡片收合/展開。
- 新增 `docs/audit-place-photo-cost-control-2026-09.md`，記錄這次改動前後對 Google API 呼叫成本控制的稽核結果與風險處理狀態。

## v0.11.1 — 2026-09-01

### 新增

- **安裝 Google Tag Manager**（容器 `GTM-563D8TXG`，`web/index.html`）：容器代碼放在 `<head>` 開頭、`<noscript>` 備援放在 `<body>` 開頭，符合官方安裝規範。容器內已設定「GA4 設定」代碼（測量 ID `G-ZSPVT49BNE`，觸發條件 All Pages）並發布，之後新增 Google Ads 轉換等追蹤只需在 GTM 後台調整，不需再改動程式碼。

### 修正

- **登出未清除殘留旅程**（FE21）：`onLogout` 補上 `setActiveTrip(null)` 並清除 `LS_DEFAULT_TRIP`，避免換帳號後沿用舊 `tripID`。
- **切換旅程時意外彈出鍵盤**（FE23）：`ChatScreen` 輸入框移除 `autoFocus`，改由 `open` prop 轉為 `true` 時的 effect 手動聚焦。
- **地圖類別標籤連點造成查詢結果亂序覆蓋**（FE24）：`runPlacesQuery` 加入 `requestId` 防護，只採最新一筆回應。
- **快速切換候選卡片時舊查詢覆蓋新卡片內容**：`patchGeocodeCandidateText`／`patchGeocodeCandidatePhoto` 加入 `placeId` 二次確認。
- 移除已退化成死碼的 `geoListDrawerState` reducer，`GeoOutlinePhoneView.tsx` 改用單純的 `listLoading` state（FE8）。
- 補上日期選擇／日曆 sheet 缺少的退場動畫。
- 新增 `--ios-sand` 深色模式 token，修正 attraction 地圖光暈、地標佔位圖、地名標籤底色在夜間模式下不正確或不可讀的問題；修正 `tripEntry` marker 誤用 attraction 色而非 accent 色。
- 補上 Google 帳號登入（GSI 模式，v0.11.0 之前已隨 commit `b8c1d2f` 加入）正式環境所需的部署配置：`GOOGLE_OAUTH_CLIENT_ID` 納入 Secret Manager 管理腳本，並補上兩份 Cloud Run 部署 workflow 缺少的 build-time `--build-arg` 與執行期 `--update-secrets`——先前功能程式碼已存在，但未部署到正式站即無法運作。

## v0.11.0 — 2026-08-30

### 新增

- **手機版規劃地圖的地點清單／地點介紹卡／日期選擇改由統一堆疊管理**（`GeoOutlinePhoneView.tsx` 新增 `sheetStack`，`components/useSheetStack.ts`）：原本清單開關（`listDrawerState.open`）與資訊卡開關（`geo.infoContent`）是兩條獨立真相來源，任何新增的「打開資訊卡」入口（點地圖 marker、城市搜尋唯一解、候選籃選取）都繞過堆疊直接操作，導致堆疊記錄與畫面實際顯示不同步。改為所有入口統一透過 `push`／`replace`／`pop`／`closeAll` 操作同一個堆疊，任何時刻該顯示哪些 sheet 只需要看堆疊本身即可確定。非頂層的 sheet 仍掛載但套用退縮視覺、停用手勢。
- **搜尋結果只有一筆時（唯一解）不再顯示地點清單**，直接開啟地點介紹卡（`geoListDrawerState.ts` 的 `results-arrived` 事件依 `resultCount` 決定）。
- **「加入行程」的日期選擇改為兩層獨立 bottom sheet**：日期清單 sheet（`GeoOutlinePhoneDatePickerSheet.tsx`，既有排定日期改為縱向可捲動清單，取代原本橫向 chips）、日曆 sheet（`GeoOutlinePhoneDateCalendarSheet.tsx`，改用跟桌面版一致的 `DatePickerPopover` 月曆格線，取代原生 `<input type="date">`）；行程完全沒有排定日期時直接跳過清單、開日曆 sheet。加入成功後「加入行程」按鈕短暫變成打勾圖示提示（`geoAddCandidateState.ts`）。
- **地點介紹卡往下拖曳或收合到最小段時，下層地點清單連動縮到最小段**（`components/PhoneBottomSheet.tsx` 新增 `onDraggingDownChange`／`onSnapIndexChange`／`isTopmost`／`stackOffsetPx`），鬆手/展開後清單恢復原本段落。
- 地圖上方類別標籤列新增獨立狀態機控制隱藏/顯示（`geoCategoryTagsState.ts`），搜尋開始時立即隱藏（不等結果回來），取代原本手機版/桌面版各自一套判斷式。
- `geocodeCandidates`／`selectedCandidate` 資料擁有權從 `GeoOutlinePanel.tsx` 遷移到共用的 `useGeoPlanningState.ts`，讓上層能在關閉清單時一併清空地圖上的搜尋結果 marker；`searchResults` 改為 `geocodeCandidates` 的衍生值，不再是獨立手動同步的 state。

### 修正

- 地點清單/旅程列表的 loading 轉圈動畫尺寸過大、置中於整個容器高度：改為靠頂顯示的較小圖示。
- 「搜尋這個區域」按鈕位置改為對齊城市搜尋框下緣（原本對齊類別標籤列，在小螢幕下容易讓人誤以為兩者有關聯）。
- 移除搜尋標籤（景點/飯店/餐廳/探索）的選取態視覺高亮，底層查詢/開關邏輯不受影響。
- 修正日期選擇 sheet 選定日期後誤用 `sheetStack.closeAll()` 導致地點介紹卡本身也被一併關閉的問題（新增 `popDateSheets()`，只收掉堆疊頂端連續的日期選擇層）。
- 修正 `docs/routing-architecture.md`、`docs/terminology.md` 記載已過時的路由/元件路徑（`server/internal/api/maintenance.go` 的 `update-photo` 路由改名、`FloatingPanel`/`PanelHead` 元件搬移後路徑未同步更新）。

## v0.10.0 — 2026-08-28

### 破壞性變更

- **`api.New()` 新增 `googleClientID` 參數**（`server/internal/api/api.go`）：簽章從 `New(st, signer, devMode)` 改為 `New(st, signer, devMode, googleClientID)`，任何呼叫這個函式的程式碼需要同步更新。
- **`base-ui.css`/`desktop-layout-shell.css` 移除大量全域字串 CSS class**：`.navbar`、`.btn`/`.icon-btn`、`.new-trip-composer`、`.screen-body`、`.list`/`.row`、`.btn-primary`/`.btn-secondary`/`.btn-danger`、`.field`、`.banner`、`.desktop-layout`、`.desktop-rail`、`.desktop-sidepanel`、`.desktop-main` 等已改用型別安全的共用 React 元件（`components/Navbar.tsx`、`components/IconButton.tsx`、`trip/NewTripComposer.tsx`、`components/ScrollArea.tsx`、`components/ListRow.tsx`、`components/Button.tsx`、`components/FormField.tsx`、`components/Banner.tsx`、`DesktopLayoutShell.tsx`、`DesktopRail.tsx`、`DesktopSidepanel.tsx`、`DesktopMain.tsx`）取代，這批全域 class 名稱已從樣式表中移除，任何依賴這些字串選擇器的外部程式碼（樣式表、E2E 測試腳本等）會失效。
- **`web/src/hooks/useDragToClose.ts` 移除**：唯一呼叫端（`GeoOutlinePhoneCandidateDrawer.tsx`）已改用共用元件 `components/PhoneBottomSheet.tsx`，這個 hook 沒有其他消費者。
- **`components/PhoneBottomSheet.tsx` 的 `.body`/`.bodyScrollable` 捲動機制內部實作改變**（`touch-action` 統一改為更嚴格的 `none`，取代先前實測發現在部分裝置上無法可靠擋住雙指縮放的 `pan-y`）：不影響對外 props 介面，但依賴內部 CSS class 結構的外部程式碼（若有）會受影響。

### 新增

- **Google 登入**（GSI 模式）：前端用 Google Identity Services 官方按鈕取得 ID Token，送至新端點 `POST /v1/auth/google`；後端用 `idtoken.Validate` 驗證簽章/audience/issuer 後，比照既有 Apple 登入模式查詢/建立使用者（`google_sub` 欄位）並簽發同一套 JWT。email 已驗證（`email_verified`）且對應既有帳號時自動關聯，避免重複帳號；未驗證則拒絕，防止帳號接管。環境變數新增 `GOOGLE_OAUTH_CLIENT_ID`（後端）、`VITE_GOOGLE_OAUTH_CLIENT_ID`（前端建置期）；兩者留空時 Google 登入功能整體停用，不影響既有登入方式。
- **候選籃抽屜改用共用 bottom sheet 容器**（`geo-planning/GeoOutlinePhoneCandidateDrawer.tsx`）：原本從右側滑入的獨立實作，改成跟地點清單等其餘手機版抽屜一致的由下往上滑入語言，單段開關（比照原本開/關兩態，不含多段吸附）。
- **`components/PhoneBottomSheet.tsx` 的 `.bodyScrollable` 內容捲動改用瀏覽器原生捲動**：取代先前用 JS 手動模擬 `scrollTop` 的做法（該做法在部分裝置上會與拖曳手勢互搶事件，導致「sheet 拖曳跟清單捲動同時被觸發」），改為在已展開到最頂段時，用 CSS `overflow-y: auto` 讓瀏覽器原生接手，中途才透過 `preventDefault()` 精確交接回拖曳手勢。
- 新增基礎 UI 元件：`components/Banner.tsx`、`components/Button.tsx`（`variant="primary"|"secondary"|"danger"`）、`components/FormField.tsx`、`components/IconButton.tsx`、`components/ListRow.tsx`（含 `List`）、`components/Navbar.tsx`、`components/ScrollArea.tsx`；`components/FloatingPanel.tsx`、`components/PanelHead.tsx` 從 `web/src/` 根目錄搬入 `components/`；`trip/NewTripComposer.tsx`（旅程列表領域專屬）。
- 新增桌面版版面骨架元件：`DesktopLayoutShell.tsx`、`DesktopSidepanel.tsx`、`DesktopMain.tsx`（`unbounded`/`unboundedScroll` prop 取代原本的 CSS `:has()` 被動偵測）；`DesktopRail.tsx` 內部合併原骨架 class，新增把 `expanded` 狀態當 prop 傳給 `DesktopUserMenu` 的機制，取代原本 `:global(.desktop-rail)` CSS 選擇器偵測。

### 修正

- **手機版主畫面可以捲動到底部功能列下方**（`App.module.css`）：`.webApp` 的 `overflow: hidden` 屬性在先前多輪修改 `touch-action` 過程中被意外刪除（僅剩解釋用的註解），導致靠 `transform` 位移到畫面外的抽屜/面板在捲動時被帶進可視範圍。
- **手機版部分 bottom sheet（對話疊加層、旅程清單、候選籃抽屜）雙指縮放未被正確擋住**：`touch-action: pan-y` 在實機測試（含真實手機，非僅 DevTools 模擬）中證實無法可靠排除縮放手勢，全面改用更嚴格的 `touch-action: none`，捲動需求改在真正需要的內層元素上局部放行 `pan-y`。
- **手機版整頁一度可以左右拖動**：修正 `.webApp` 誤設為 `touch-action: pan-x pan-y`（應只放行垂直方向）的問題。
- **地點清單捲到頂端後往下拉，內容會先被瀏覽器原生 overscroll 效果拉開一段間隙**：`.bodyScrollable` 新增 `overscroll-behavior-y: contain`。

## v0.9.1 — 2026-08-27

### 新增

- **手機版地點清單改為三段式拖曳吸附**（`geo-planning/GeoOutlinePhoneListDrawer.tsx`）：原本收合（標頭）＋一個展開段共兩層，新增中間段，對齊地點資訊卡既有的三段式段落結構。
- **`components/PhoneBottomSheet.tsx` 新增 `keepMounted` prop**：`true` 時 `children` 即使 `open` 為 `false` 也不卸載，只用 `translateY` 位移隱藏。取代對話疊加層原本透過 React Portal（`mainChatSlotNode`/`chatParkingNode`/`chatPortalTarget`/`chatSheetSettled`/`createPortal`）投影 `ChatScreen` 的機制——投影內容在 React 樹上是平行兄弟節點，觸控事件無法冒泡到 `PhoneBottomSheet` 的拖曳手勢處理，導致「對話疊加層只有標頭能拖，內容區完全拖不動」。

### 修正

- **對話疊加層拖曳手勢只有標頭能拖，內容區完全無法拖動**（根因見上方 `keepMounted` 說明）：改為 `ChatScreen` 直接放進 `children`，移除整套投影機制。
- **時間軸抽屜**（`timeline/PhoneTimelineDrawer.tsx`）新增可拖曳收合到標頭的功能（原為排查上述投影問題新增的對照組，驗證完成後保留）。

## v0.9.0 — 2026-08-27

### 破壞性變更

- **手機版底部常駐列拿掉「規劃」「時間軸」入口，改為「旅程」「對話」兩項**（`PhoneTabBar.tsx`、`PhoneContent.tsx`）：規劃地圖（`GeoOutlinePhoneView`）已是唯一常駐主畫面，不再是可切換的分頁之一，故底部列不再需要額外的「規劃」入口；「時間軸」改為規劃地圖左下角專屬按鈕（此前已是如此，這次移除的是舊有殘留的底部列位置）。使用者原本能從底部列直接切到規劃地圖/時間軸的操作方式已不存在，改為規劃地圖預設可見、時間軸從地圖內按鈕開啟。
- **手機版對話、配速表從「主畫面分頁切換」改為「滿版疊加層」**（`PhoneContent.tsx`）：原本切換底部列分頁會取代整個主顯示區內容，現在對話／配速表各自透過獨立按鈕開啟一個蓋在規劃地圖之上的 `PhoneBottomSheet` 疊加層，關閉後回到規劃地圖；不再有可以「切換到對話分頁」這個操作路徑本身（改成「開啟對話」）。
- **手機版設定頁移除「API Token」「後端連線 Base URL」「健康檢查」三個區塊**（`user/SettingsScreen.tsx`）：這些是開發除錯用的資訊，非一般使用者需要的設定項目，移除後這幾項操作/資訊在畫面上不再可見（桌面版 `SettingsDialog` 不受影響）。
- **`components/PhoneBottomSheet.tsx` 移除 `mode: 'slide-close' | 'snap'` 這個 prop**，改用 `snapPoints`（由大到小排序的「離螢幕頂部距離」陣列，單位 px，取代原本以 `vh` 高度百分比表達的 `snapPoints`/`maxHeightVh`）搭配選填的 `minHeightPx`（收合段的固定高度）決定拖曳吸附的段數與位置——只給一個 `snapPoints` 值時退化為固定高度＋只能拖到底關閉的語意。這是本應用程式內部共用元件的 props 變動，不影響任何使用者可感知的行為（各呼叫端已在同一次異動中同步更新），依專案慣例（見 `.claude/skills/version-tagging/override.md`）不計入本次破壞性項目，僅記錄於此供日後檢索。
- **地理輪廓底圖（規劃地圖）移除獨立 feature flag**（`DesktopShared.tsx` 的 `GEO_OUTLINE_ENABLED`、環境變數 `VITE_FEATURE_GEO_OUTLINE` 一併移除）：已是核心功能，`PANEL_REGISTRY` 的 `geo-outline` 項目固定 `enabled: true`，不再能透過部署環境變數關閉——若有部署環境依賴這個變數關閉規劃地圖，該環境會發現規劃地圖無法再被關閉。

### 新增

- **手機版對話不再要求先選定旅程**（`PhoneContent.tsx`）：`ChatScreen` 的 `trip` prop 改為允許 `undefined`，對齊桌面版 chat-popover 既有行為，未選旅程時仍可開啟對話並直接發送訊息。
- **搜尋觸發時立即開啟地點清單並顯示載入中動畫**（`GeoOutlinePhoneView.tsx`、`GeoOutlinePhoneListDrawer.tsx`、`components/PhoneBottomSheet.tsx`）：`PhoneBottomSheet` 新增 `loading` prop（true 時 body 顯示置中轉圈動畫取代 children），搜尋一觸發就開啟清單抽屜並進入載入中狀態，不用等查詢結果回來才看到清單出現。
- **`components/PhoneBottomSheet.tsx` 新增共用進場滑入動畫**：`'slide-close'` 語意（現為單段 `snapPoints`）此前只有滑出動畫、沒有滑入動畫，現在跟多段模式共用同一套「掛載時先在畫面外、下一幀才滑入」邏輯。
- **`components/PhoneBottomSheet.tsx` 新增共用標頭元件 `SheetHead`**（標題文字＋關閉鈕），收斂原本 `GeoOutlinePhoneListDrawer.tsx`、`timeline/PhoneTimelineDrawer.tsx`、手機版設定頁各自重複刻一份的標頭 JSX/CSS。
- **桌面版對話小匡改為永遠掛載**（`DesktopLayout.tsx`、`DesktopLayout.module.css` 新增 `.chatPopoverHidden`）：關閉小匡時不再卸載 `ChatScreen`，改用 `display: none` 隱藏，避免每次開關對話都重新連線 WebSocket——對齊手機版對話疊加層的常駐掛載設計。

### 修正

- **對話疊加層滑出關閉時，規劃地圖畫面會跟著抽動偏移**（`PhoneContent.tsx`）：投影目標容器（`mainChatSlotNode`）原本隨 `chatSheetOpen` 一起提前卸載，觸發的 DOM 搬移剛好跟 sheet 滑出動畫的同一幀重疊，造成一次性版面重排波及地圖。改為投影目標的卸載延後到 `PhoneBottomSheet` 本身的退場動畫（`exitDurationMs`）播完之後。
- **對話疊加層開啟時滑入動畫看不到、直接出現在最終位置**（`PhoneContent.tsx`）：投影目標容器掛載時觸發的 `ref` callback 會連帶一次額外的 state 更新，這次更新與 `PhoneBottomSheet` 內部進場動畫的 `requestAnimationFrame` 排程在同一個瀏覽器繪製週期內互相競爭，導致「畫面外」的中間態被跳過，只看到 `transform` 的收尾動畫。改為投影目標延後掛載，確保排在進場動畫確定播完之後。
- **`PhoneBottomSheet` 內部量測容器高度的邏輯每次 render 都重新讀取 DOM**（`components/PhoneBottomSheet.tsx`）：`useEffect` 原本沒有依賴陣列，含拖曳中每一幀都會強制瀏覽器同步重新計算一次版面（layout thrashing），這個同步重排恰好跟 sheet 自身的 CSS transition 動畫同時發生，連帶讓地圖跟著抽動。改為只在 `open` 變 `true` 時量測一次。
- **`PhoneBottomSheet` 多段拖曳吸附的離頂部距離計算方向寫反**（`components/PhoneBottomSheet.tsx`）：手指往上拖曳時計算出的面板位置反而往下移動，跟預期方向相反；修正拖曳位移量的加減號。

## v0.8.2 — 2026-08-26

### 變更

- **桌面版右緣浮動卡片寬度統一為 340px**（`GeoInfoPanel.module.css`、`AttractionInfoPanel.module.css`、`DesktopLayout.tsx` 的 `GeoHotelSidebar` 容器寬度）：地點介紹卡（原 300px）、搜尋結果側欄（原 280px）改成跟既有的城市搜尋框/對話小匡一致的 340px，不再是三種混用的寬度；連帶更新 `.shiftedHotel`/`.shiftedChat`/`.chatPopoverShifted` 的偏移量換算，含補上前一版遺漏未更新的 `.chatPopoverShifted`（原本仍沿用 280px 換算出的舊偏移量）。
- **手機版地點資訊卡（`GeoOutlinePhoneInfoSheet.tsx`）版面順序調整**：改成把手 → 標頭（名稱/副標/badges）→ 圖片（左右留 16px 間距，不再滿版貼齊卡片邊緣）→ 簡介/日期選擇區，原本是圖片滿版置頂、關閉按鈕疊在圖片右上角。
- **手機版「加入行程」按鈕改為標頭區純 icon 按鈕**（`GeoOutlinePhoneInfoSheet.tsx`）：從圖片下方帶文字的按鈕，改成放在標頭關閉按鈕左邊、只有圖示的按鈕；點擊展開的既有日期 chips/日期輸入區塊維持顯示在下方內容區，不隨按鈕搬移到標頭。

### 修正

- **手機版地點資訊卡拖曳把手拉到最大高度後，繼續往上滑完全沒有反應**（`GeoOutlinePhoneInfoSheet.tsx`）：把手區域設有 `touch-action: none` 完全關閉瀏覽器原生觸控手勢處理，卡片高度到達上限（90vh）後，JS 端的展開邏輯也不再處理後續拖曳，導致使用者無法在把手上繼續往上滑動查看卡片下方被截斷的內容（簡介、加入行程按鈕等）。改為到達高度上限後，把後續的拖曳增量手動轉發成卡片內容的捲動量，讓使用者不需要放開把手、改摸內容區域即可無縫接續往上滑動。

## v0.8.1 — 2026-08-26

### 新增

- **候選籃「已排入行程」日層架，連續多天無安排時收攏成單一摘要列**（`GeoCandidateSidebar.tsx`）：長天數旅程中間若有連續多天完全沒有安排，原本會逐天各自渲染一個空白日期區塊，長天數旅程會佔用大量版面卻沒有內容；改為收攏顯示「{起日} ~ {迄日}（共 N 天）無安排」單一列，點擊可展開查看/操作區段內每一天（含拖放候選卡片），僅單一天的空白（前後皆非空白）不收攏，維持原樣顯示。

### 修正

- **正式環境部署從未設定 `PEXELS_API_KEY`，Pexels-first 照片查詢完全不會生效**（`.github/workflows/deploy-cloudrun.yml`、`deploy-with-migration.yml`、`server/scripts/update-secret-manager.sh`）：兩份部署 workflow 的 `--update-secrets` 清單一直漏了這把 key（只有本機 `server/.env` 有設定），導致正式站的地圖照片查詢直接跳過 v0.8.0 新增的 Pexels 管道，一律 fallback 到按張計費的 Google Photo Media 或完全沒有照片。`update-secret-manager.sh` 新增 `-pexels` 旗標寫入 Secret Manager，兩份 workflow 的 `--update-secrets` 補上 `PEXELS_API_KEY=PEXELS_API_KEY:latest`。
- **選日期加入行程、但尚未選定旅程時，沒有確實引導使用者切到旅程列表**（`DesktopLayout.tsx`）：`onSchedule` 分支呼叫 `setPanelMode('trips')` 帶有「再點一次同個 mode 會收合」的 toggle 邏輯，若使用者當下已經在旅程列表畫面（例如先前操作留下的狀態），會被誤判成「收合」而不是「確保開啟」。改為直接呼叫 `navigate('/app/trips')`，不受目前面板狀態影響。
- **選定旅程後，先前待補寫的候選沒有自動展開「行程」欄讓使用者確認**（`DesktopLayout.tsx`）：`DesktopTripList` 的 `onOpen` 原本選定旅程後一律收合浮動卡回到預設畫面；現在若是因為 `pendingSchedule`（選日期加入行程時尚未選定旅程）才被導來選旅程，選定後改為導向 `/app/geo-outline` 並觸發短暫 highlight，讓使用者立即看到剛補寫進去的候選是否成功。

### 變更

- **「加入行程」按鈕文字不再串接旅程名稱**（`GeoInfoPanel.tsx`、`GeoOutlinePhoneInfoSheet.tsx`）：原本顯示「加入 {旅程名稱}」，改為固定文字「加入行程」，兩元件的 `tripName` prop 一併移除（呼叫端 `DesktopLayout.tsx`／`GeoOutlinePhoneView.tsx` 同步更新）。
- **統一「行程」與「旅程」两個中文用語的定義，修正過去混用造成的混淆**（跨 `web/src` 約 40 個檔案的畫面文字與註解，`docs/terminology.md` 同步更新）：「旅程」專指 `Trip` 實體本身（選哪一趟旅行，如旅程列表、旅程設定彈窗），「行程」專指旅程裡的日層架排程內容（如候選籃「行程」欄、「加入行程」按鈕、「已排入行程」文案）。前端變數/型別名稱（`Trip`／`activeTrip`／`tripID`／`TripRole` 等）維持英文不變，只調整畫面顯示的中文字與註解用詞。

## v0.8.0 — 2026-08-26

### 破壞性變更

- **地理規劃地圖飯店/地點/搜尋結果三種來源統一為單一資料流 `GeoSearchResult`**（`GeoOutlineMap.tsx`、`GeoOutlinePanel.tsx`、`GeoHotelSidebar.tsx`、`GeoOutlinePhoneListDrawer.tsx`、`geoInfoContent.ts`）：原本各自獨立的 `onVisibleHotelsChange`/`onPlacesNearby`/`onHotelSelect`/`onPlaceSelect`/`onGeocodeCandidateSelect` 等 callback 全部移除，合併為 `onSearchResultsChange`/`onSearchResultSelect`；`GeoHotelSidebar.tsx` 匯出的 `Tab` 型別與雙分頁切換（`onSelectHotel`/`onSelectPlace`）一併移除，改為單一合併清單搭配 `onSelect`；`geoInfoContent.ts` 的 `hotelInfoContent`/`placeInfoContent` 改為 `searchResultInfoContent`/`candidateInfoContent`。手機版 `GeoOutlinePhoneListDrawer.tsx` 的 `hotels`/`places`/`geocodeCandidates`/`onTabChange` 一併改為單一 `results`/`onSelect`。
- **`GeoOutlinePhoneView` 新增必填 prop `onOpenTrips`**：修正沒有選定行程時點日期選擇加入行程會靜默失敗的問題（見下方「修正」），呼叫端（`PhoneContent.tsx`）需額外傳入切到行程列表的導覽函式。
- **後端 `geo.SearchDistricts` 改名為 `SearchCityAttractions`，`geo.SearchKnownDistricts`/`DistrictAlias` 型別整個移除**（`server/internal/geo/places.go`，原 `district_aliases.go` 已刪除）：`SearchKnownDistricts` 呼叫前已確認恆為空 map，屬安全的死碼清除。`fetchNearbyHotels` 從套件層級函式改為 `(s *Server)` 方法，因落地 GCS 需要存取 `s.photoUploader`。以上均為套件內部符號，本次範圍內呼叫端已同步更新。

### 新增

- **地圖照片查詢改為 Pexels-first + GCS 落地**（`server/internal/geo/places.go`、新增 `server/internal/photostorage`）：查詢地點照片時優先查詢 Pexels 免費圖庫並落地存進自家 GCS bucket，查無結果或未設定 Pexels API key 才 fallback 回 Google Places 真實照片；`GET /internal/geo/place-details` 新增 `photoOnly=1`/`textOnly=1` 兩種輕量查詢模式供搜尋結果清單延遲載入使用，`GET /internal/geo/geocode` 新增可選的 `biasLat`/`biasLng` 位置偏向參數。
- **日期選擇 UI 改用 `react-day-picker` 月曆浮動匡**（新增 `web/src/geo-planning/DatePickerPopover.tsx`）：取代原本「加入行程」流程裡的原生 `<input type="date">`，改成疊加在按鈕組正下方（或視剩餘空間自動往上翻轉）的月曆格線浮動匡，點選日期格子即視為確定，不再需要額外的「確定」按鈕；配色沿用專案既有暖色系 CSS token，不使用套件預設的藍色主題。
- **浮動卡片外殼收斂為共用元件 `FloatingPanel`/`PanelHead`**（新增 `web/src/FloatingPanel.tsx`、`web/src/PanelHead.tsx`）：取代原本六處各自重複的「絕對定位疊在地圖上方 + 右上角關閉按鈕 + 標題列」樣板程式碼與 CSS，`styles-desktop.css` 拆分歸位到各元件的 module.css 後整份刪除。

### 修正

- **地圖搜尋結果 marker 連續點擊時，資訊卡照片/評分/「加入行程」按鈕會消失且不會補回來**（`GeoOutlinePanel.tsx`、`geoSelection.ts`）：地圖 marker 的點擊事件在建立當下就把候選物件封進 closure，同一顆 marker 被連續點擊時傳入的是同一個物件參照，導致負責補查照片/文字的 `useEffect` 依賴比對判定「沒有變化」而不重新查詢；同時 `geoSelection` reducer 對同一個地點的重複選取，原本會無條件用輕量版內容覆蓋已經補齊的完整內容。改為 `useEffect` 依賴穩定的 `placeId` 字串，`geoSelection` 對同一個 key 的重複選取保留既有內容不覆蓋。
- **對話浮動小匡與搜尋結果側欄同時開啟時位置重疊、高度不一致**（`DesktopLayout.module.css`）：兩者原本都固定貼右緣、互不避讓；改為對話小匡在搜尋結果側欄同時顯示時自動往左推開，且改用與搜尋結果側欄一致的高度計算方式，不再各自獨立換算。
- **候選籃「×」刪除時，同一個地點若已排入行程多次會被一併誤刪**（`useGeoPlanningState.ts` 的 `removeCandidate`）：原本用「名稱+座標」比對要移除的候選，同一地點多次排入行程時會產生多筆座標相同、但各自獨立的 entry，刪除其中一筆會誤判成全部符合刪除條件而一起消失。改為 entry 類型改用穩定的 `id` 精確比對，其餘沒有 `id` 的候選類型維持原本比對方式。
- **沒有選定行程時點日期選擇加入行程會靜默失敗**（`DesktopLayout.tsx`、`GeoOutlinePhoneView.tsx`）：原本 `handleScheduleCandidate` 內部因缺少 `tripID` 直接 no-op，使用者點了日期、浮動匡正常關閉卻毫無提示。改為記住候選與選定日期，導向行程列表引導使用者先選定行程，選定後自動補寫入剛才的候選。
- **加入行程成功後，已經展開的行程欄反而被收合**（`DesktopLayout.tsx`）：誤用了帶有「再次呼叫同一個 mode 會 toggle 收合」邏輯的 `setPanelMode`，改為直接呼叫 `navigate` 導向目標路徑，不受 toggle 邏輯影響。
- **候選籃某天「從候選加入」卡片外殼樣式全部失效、畫面版面錯亂**（`DesktopLayout.tsx`）：先前浮動卡片外殼重構時漏改這個分支，仍引用已經搬移、不存在的 CSS class 名稱，導致這張卡片變成沒有任何定位/樣式的裸元素。改用共用的 `FloatingPanel` 元件，並依需求調整為與行程欄並排顯示（不再互斥取代）。
- **Google Places 地點詳細資訊查詢缺少語系參數，回應內容為英文**（`server/internal/geo/places.go`）：`GetPlaceDetails` 補上 `languageCode=zh-TW`。
- **正式環境部署從未設定 `PEXELS_API_KEY`，Pexels-first 照片查詢完全不會生效**（`.github/workflows/deploy-cloudrun.yml`、`deploy-with-migration.yml`、`server/scripts/update-secret-manager.sh`）：兩份部署 workflow 的 `--update-secrets` 清單一直漏了這把 key（只有本機 `server/.env` 有設定），導致正式站的地圖照片查詢直接跳過本次新增的 Pexels 管道，一律 fallback 到按張計費的 Google Photo Media 或完全沒有照片。`update-secret-manager.sh` 新增 `-pexels` 旗標寫入 Secret Manager，兩份 workflow 的 `--update-secrets` 補上 `PEXELS_API_KEY=PEXELS_API_KEY:latest`。
- **`web/package-lock.json` 版本解析無效，Docker build 內 `npm ci` 失敗**：lockfile 在本機 npm 11 環境下產生，`vitest` v4 巢狀相依的 `vite@8.x` 要求 `esbuild@^0.27||^0.28`，被本機 npm 11 錯誤去重成跟頂層 `vite@5.x` 共用不相容的 `esbuild@0.21.5`，本機較新版 npm 容忍此無效狀態繼續運作，但 `Dockerfile` 用的 `node:22-alpine`（內建 npm 10.9.8）執行 `npm ci` 時嚴格拒絕。改在與 `Dockerfile` 完全一致的容器環境內重新產生 lockfile，讓兩份巢狀 `esbuild` 各自獨立鎖定相容版本。

### 清理

- **地理規劃地圖標記邏輯拆分為多個獨立 hook**（`GeoOutlineMap.tsx` 拆出 `useAttractionOverlays`/`useTripEntryMarkers`/`useSearchResultMarkers` 等，新增 `geoMarkerSelection.ts`/`mapMarkers.ts`）：取代原本集中在單一元件裡的多份圖層邏輯，各圖層獨立成純函式/hook，方便個別測試與維護。
- **後端 Places API 請求組裝統一**（`server/internal/geo/places.go`）：`Search`/`GetPlaceDetails` 改用共用的 `newPlacesSearchRequest`/`newPlaceDetailsRequest` helper 組裝請求，消除各端點各自手寫 `languageCode` 導致容易遺漏的問題。
- **移除試做功能「推薦景點卡片」「推薦景點橫滑」**（`DesktopShared.tsx`、`DesktopRail.tsx`、`demo/DemoPanelContent.tsx`、`recommended-places/RecommendedPlaces.tsx`）：含入口按鈕、`PanelMode`/feature flag、對應死碼（`RecommendedPlacesRow`/`FAKE_RECOMMENDED_PLACES`）與 CSS 一併移除；`RecommendedPlacesList`/`RecommendedPlaceCard` 仍被 `MessageBubble.tsx` 使用，予以保留。
- **手機版側滑/彈出抽屜的拖曳關閉手勢收斂為共用 hook `useDragToClose`**（新增 `web/src/hooks/useDragToClose.ts`）：取代原本 `PhoneTripsDrawer.tsx`/`GeoOutlinePhoneListDrawer.tsx`/`PhoneTimelineDrawer.tsx`/`GeoOutlinePhoneCandidateDrawer.tsx` 四份檔案各自複製貼上的 `dragOffset`/touch handler 邏輯。
- **候選籃側欄標題「候選籃」改為「行程」，行程列表改稱「旅程列表」**（`GeoCandidateSidebar.tsx`、`DesktopTripList.tsx`、`DesktopRail.tsx`、`PhoneTabBar.tsx`）：兩者原本都稱作「行程」容易混淆，明確區分「旅程」（挑選哪一趟旅行）與「行程」（該趟旅程裡排定的地點清單）。

## v0.7.0 — 2026-08-17

### 新增

- **手機版導覽再簡化，時間軸改為規劃地圖專屬的彈出面板**（`web/src/timeline/PhoneTimelineDrawer.tsx`）：底部常駐列（`PhoneTabBar.tsx`）不再含「時間軸」項目，改成規劃地圖畫面左下角的專屬入口，由下往上彈出（bottom sheet），只顯示唯讀清單，不含對話輸入列；選擇行程後不再自動跳轉到時間軸/路徑分頁，留在使用者原本所在的畫面（已與使用者確認）。分享連結/成員管理/開啟時自動進入三個功能，從精簡版側滑抽屜 `PhoneNavDrawer.tsx`（本次整個移除）搬到 `PhoneTripsDrawer.tsx` 每筆行程項目的「管理」按鈕，改用共用的 `TripManageModal`，對齊桌面版 `DesktopTripList.tsx` 的 `onManage` 心智模型；使用者頭像改為直接開啟設定畫面，不再先進中介選單。
- **地圖分類標籤旁新增城市搜尋框**（`GeoOutlineMap.tsx`）：不需要先開候選籃側欄，可直接在地圖上方輸入目的地城市觸發搜尋，樣式/行為對齊候選籃既有的搜尋框。
- **手機版鎖住整站手動縮放**（`web/index.html` 的 `maximum-scale=1, user-scalable=no`）：修正 iOS Safari 對小字級 `<input>`（規劃地圖城市搜尋框，13px）focus 時自動放大整頁面的不一致體感，取捨是使用者同時失去手動縮放頁面的能力（使用者明確選擇此做法）。

### 變更

- **搜尋結果清單（`GeoHotelSidebar.tsx`）取消飯店/附近推薦分頁，合併成單一清單**：不再需要切換分頁才能看到另一類別的查詢結果，飯店排在清單最前面，附近推薦（景點/餐廳）依查詢類別加小標題；兩者皆無資料時顯示統一空狀態提示。手機版 `GeoOutlinePhoneListDrawer.tsx` 維持原本雙分頁呈現，不受影響。
- **修正搜尋清單顯示條件錯誤**（`DesktopLayout.tsx` 的 `geoHotelSidebarVisible`）：原本額外檢查 `panelMode === 'geo-outline'`，導致在其他 `panelMode` 下用地圖上方類別標籤查詢時，即使已查到資料，清單也不會跳出來；改為只要有查詢結果就顯示，不受目前 `panelMode` 影響。

### 移除

- **移除地圖上景點區域間的距離估算連線示意功能**（`GeoOutlineMap.tsx`/`.module.css`）：兩兩相距較遠的景點區域之間原本會畫虛線並標示距離、伴隨文字圖例，使用者確認此功能整個移除，含 `farPairs`/`distanceKm` 計算邏輯與對應 CSS。

## v0.6.0 — 2026-08-16

### 新增

- **手機版新增「規劃地圖」畫面，分三階段完成**（`web/src/geo-planning/GeoOutlinePhoneView.tsx` 及相關檔案）：
  - 第一階段：地圖瀏覽 + 唯讀資訊卡（`GeoOutlinePhoneInfoSheet.tsx`），複用桌面版的地圖引擎（`GeoOutlineMap.tsx`/`GeoOutlinePanel.tsx`）與資料轉換邏輯（新增 `geo-planning/geoInfoContent.ts` 供桌面/手機共用），並設為手機版進 App 後的預設起始畫面（不再自動彈出行程列表）。
  - 第二階段：候選籃抽屜（`GeoOutlinePhoneCandidateDrawer.tsx`，右側滑入），資訊卡加回「加入候選」「排入行程某一天」互動，純邏輯複用既有的 `geo-planning/geoCandidateHelpers.ts`。
  - 第三階段：飯店/推薦地點清單抽屜（`GeoOutlinePhoneListDrawer.tsx`，左側滑入，雙分頁），補上手機版原本缺漏的飯店/地點資料流串接。
  - 全程未修改任何桌面版檔案的行為，僅原封不動複用其匯出的元件與純函式。
- **手機版導覽從側滑抽屜改為底部常駐 tab bar**（新增 `web/src/PhoneTabBar.tsx`：行程/時間軸/規劃三項常駐顯示；新增 `web/src/PhoneSideTools.tsx`：路徑（配速表）與 demo-* 試做功能收成畫面右下角小圖示）：不再需要先點開抽屜才能切換分頁。`PhoneNavDrawer.tsx` 精簡為只剩分享/成員/頭像的操作抽屜。`web/index.html` 補上 `viewport-fit=cover`，讓 `env(safe-area-inset-*)` 在 iOS 上正確生效，底部導覽列與浮動卡片才能正確避開 home indicator。

### 清理

- **前端 `web/src/` 依功能領域重新整理目錄結構**，消除多個身兼多職的共用檔案：
  - 新增 `pace/`、`home/`、`chat/`、`timeline/`、`recommended-places/`、`demo/`、`user/`、`trip/` 等功能子目錄，搬入對應元件（含多個歷史遺留檔名的更新，例如 `PublicPaceDemoPage.tsx`→`pace/PacePage.tsx`、`PhoneScreens.tsx`→`trip/PublicViewScreen.tsx`），並移除確認無人引用的死碼 `landing.css`。
  - `AppCommon.tsx` 的 `useIsDesktop`/`useAppState`/`useTripsState` 三個 hook 拆到新增的 `web/src/hooks/` 目錄，各自獨立成檔案，對應測試同步搬到 `hooks/useTripsState.test.tsx`。
  - `types.ts` 依領域拆分為 `trip/types.ts`、`user/types.ts`、`chat/types.ts`，只保留跨領域共用的 `Entry`；未使用的 `SearchAnswer` 型別移除；純 API 層格式 `APIErrorBody` 併入 `api.ts`。
  - `DrawerMode` 型別與桌面版既有的 `PanelMode` 收斂到同一份定義（`DesktopShared.tsx`），避免兩份值域各自維護。
  - `docs/` 底下建立 `doc-file-format` skill 規範文件命名（`audit-*`/`research-*`/`refactor-*` 三種字首），現有全大寫底線檔名文件統一改為小寫橫線，並新增 `docs/audit-security.md`、`docs/audit-functional.md` 彙整多代理掃描結果。

### 文件

- `docs/terminology.md` 修正對手機版導覽結構的過時描述（`PhoneNavDrawer` 不再含分頁列、`SettingsScreen`/`SettingsDialog` 已搬到 `user/`），反映本次重構後的實際檔案位置。

## v0.5.0 — 2026-08-16

### 破壞性變更

- **CLI `attraction-update` 移除 `-name` 選項，改為通用的 `-field`/`-value`**（`server/cmd/cli/main.go`、`server/internal/store/attractions.go` 的 `UpdateAttractionName`→`UpdateAttractionField`）：上一版（v0.4.5）才新增的 `-name` 選項改成 `-field name -value "新名稱"`，`-field` 目前開放 `name`、`summary` 兩個欄位（白名單機制，見 `attractionUpdatableFields`），日後新增可更新欄位只需要在白名單加一行，不必再各自新增一支 store method + API handler + CLI flag。呼叫端一律改用 `-field`/`-value`，舊的 `-name` 用法不再支援。
- **維運端點路徑改名**：`POST /internal/maintenance/landmarks/{id}/update-photo` 改為 `POST /internal/maintenance/attractions/{id}/update-photo`，對齊同一資源底下其餘 `/internal/maintenance/attractions/*` 端點命名（這條路徑先前漏改，是唯一還留著 `landmarks` 命名的維運端點）。CLI 呼叫端（`attractionUpdatePhoto`）已同步更新，子命令名稱 `attraction-update-photo` 本身不受影響。

### 新增

- **景點照片改存 Google Cloud Storage**（新增 `server/internal/photostorage` 套件，`GCS_PHOTO_BUCKET` 環境變數）：景點建檔（`attraction-add`）、換圖（`attraction-update-photo`）時，不論圖片來源是使用者手動指定的連結或後端自動查詢的 Pexels 示意圖，都會下載後上傳到 GCS，資料庫欄位存我方 GCS 網址，不再直接引用外部圖床連結（避免外部連結失效或變更導致照片消失）。刪除景點（`attraction-delete`）或換圖覆蓋舊照片時，會連帶清理舊的 GCS 物件；非本 bucket 的外部連結（例如尚未遷移前既有的 Pexels 直連）安全 no-op，不受影響。GCS 客戶端初始化失敗時（例如未設定憑證）降級為不落地、僅記警示 log，不阻擋 server 啟動。
- **桌面版對話小匡支援無行程狀態**（`ChatScreen.tsx`、`DesktopLayout.tsx`）：`trip` prop 改為選填，使用者不需要先選定/建立行程就能開啟對話小匡並開始對話；未帶 `trip` 時，所有綁定行程 ID 的資料流（歷史訊息、entries、WebSocket、批次持久化）與行程專屬功能（分享／成員／`TripMenu`）一律跳過，只保留即時對話本身可用，尚無訊息時顯示簡短通用引導文字。
- **新增行程設定彈窗 `TripManageModal`**（`web/src/trip/TripManageModal.tsx`）：合併原本分散在對話小匡 navbar 上的分享連結（`ShareModal`）、成員管理（`MembersScreen`）、開啟時自動進入（`TripMenu` 下拉選單）三個入口，改為行程列表每筆項目的單一「行程設定」按鈕觸發同一個置中彈窗，三個功能以區塊分隔呈現。手機版仍使用原本的 `ShareModal`/`MembersScreen`/`TripMenu`，不受影響。
- **`DesktopUserMenu` 改用 Portal 動態定位**：左下角使用者選單改用 `createPortal` 投影到 `document.body` + `position: fixed`（依觸發按鈕即時量測的座標定位），修正原本 `position: absolute` 相對 `.desktop-rail` 定位、被該容器的 `overflow: hidden`（寬度收合/展開過渡動畫用）裁切邊緣、以及展開方向計算錯誤導致選單蓋住觸發按鈕本身的問題。

### 修正

- **`NeedsSync` 相關 API 一致性修復**（`server/internal/api/attraction_sync.go`/`geo_outline.go`）：抽出 `resolveCoords`／`prepareSyncRun` 共用函式，消除 CLI 與 API 端重複的座標解析、同步前置檢查邏輯；`geo_outline.go` 整合原本兩處重複宣告的查詢半徑上限常數為套件層級 `maxNearbyRadiusMeters`；維運端點錯誤訊息用詞統一（「地標」→「景點」、`no_match`→`not_found` 語意修正）。

### 清理

- 前端全域樣式依歸屬重新拆分：原本單一巨大的 `styles.css` 拆為 `base-ui.css`（跨檔案共用基礎樣式，如 `.navbar`/`.btn`/`.row`/`.rp-modal*`）與多個元件專屬 CSS Module（`App.module.css`、`AppCommon.module.css`、`SettingsDialog.module.css`、`AskSheets.module.css`、`DesktopShared.module.css`、`DesktopLayout.module.css`、`DesktopRail.module.css`、`DesktopTripList.module.css`、`DesktopUserMenu.module.css`、`trip/TripManageModal.module.css`）；`styles-desktop.css` 依「版面骨架」（新增 `desktop-layout-shell.css`）與「單一元件專屬」（併入對應元件的 module）進一步拆分，只保留真正跨多檔案共用的部分。所有拆出的 CSS 檔案改由實際使用的元件各自 `import`，不再於 `main.tsx` 全域載入，手機版使用者不再連帶下載桌面版專屬樣式。過程中發現並修正一起 CSS 註解內 `*/` 字元序列提前結束整段區塊註解、導致後續規則（含 `:root` 變數定義）解析失敗的 bug。

### 文件

- `docs/TERMINOLOGY.md` 修正過時內容：對話小匡條目更新為反映無行程狀態下的通用引導文字（原文件仍描述「未選行程時顯示空狀態提示」的舊行為），新增「行程設定彈窗」條目說明 `TripManageModal` 取代原本分散的分享/成員入口。
- `.claude/skills/tripace-cli/SKILL.md` 修正 `attraction-update` 範例改用新的 `-field`/`-value` 語法，修正已改名的 `landmarks/{id}/update-photo` 舊路徑引用，新增景點照片落地 GCS 的行為說明。

## v0.4.5 — 2026-08-15

### 新增

- **景點資料同步機制**（`server/internal/attractionsync/`、`server/internal/api/attraction_sync.go`/`synctoken.go`、CLI `attraction-sync-setup`/`attraction-sync` 子命令，見 `docs/ATTRACTION_SYNC_DESIGN.md`）：本機開發站與正式站之間的景點資料單向同步，三層比對（新鮮度探測→輕量清單 diff→欄位級 diff）+ 交握式傳輸，依同步方向由來源方負責比對決策，sync-token 由本機 server 自行保管，CLI 只負責觸發。

  **⚠️ 已知安全風險，尚未修復完成，不應部署到正式站**：上線前複查（`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`）發現 `target` 參數未驗證、既有 `internalAuth` 中介層無角色檢查，任何在正式站註冊的一般使用者都能觸發 SSRF，並經由偽造的同步對象竊取/竄改/清空正式站景點資料（Critical）；錯誤訊息會把同步對象的回應內容原樣回吐，構成內網探測/資料外洩管道（High）；`-retry` 旗標目前是空殼，設計文件裡的續傳邏輯（`Transfer`/`ResumeFrom`/`PushTo`）在正式路徑上未被呼叫、是死碼（High）。這三項風險（複查編號 #1/#2/#4）皆未修復。詳見風險文件的完整清單、攻擊鏈說明與處理建議。
  - **本次已修正**：`NeedsSync`（`diff.go`）原本只看目的方最新一筆記錄的時間，忽略雙方記錄筆數差異，導致目的方有人手動新增一筆較新的資料時，即使來源方還有大量更早的資料未同步，也會被誤判為「不需要同步」而靜默漏同步（複查編號 #3）。已改為筆數不同即視為需要同步，並補上回歸測試 `TestNeedsSync_CountDiffersDespiteOlderTimestamp`。
  - 因為 CLI 介面純新增、未變更既有子命令、未刪除任何正式功能、未變更資料庫 schema（`attractionRow` 與 `AutoMigrate` 清單皆未變動），依 `.claude/skills/version-tagging/override.md` 三條判準本身不構成破壞性變更；但上述資安風險是獨立於破壞性判準之外、必須在對外部署前處理的問題。
- **CLI `attraction-update` 新增 `-name` 選項**（`server/cmd/cli/main.go`/`http.go`、`server/internal/api/maintenance.go`、`server/internal/store/attractions.go`）：新增 `PATCH /internal/maintenance/attractions/{id}/name` 端點，修正建檔時輸入錯誤/需要調整的景點名稱。`-name` 與既有的座標修正（`-lat/-lng` 或 `-place`）互不排斥，可同時帶入或只改其中一種，只要至少帶了一項即動作；既有的「必須帶 `-lat/-lng` 或 `-place`」規則放寬為「三者擇一」，舊呼叫方式不受影響，非破壞性。
- `docs/PLAYWRIGHT_WALKTHROUGH_FEEDBACK_2026-08-13.md`：Playwright 走查回饋文件。

### 文件

- `.claude/skills/tripace-cli/SKILL.md` 補上 `attraction-update` 子命令的說明與範例（原本完全沒有提及，本次連同 `-name` 選項一併補齊）；景點資料同步機制刻意不列入，避免在已知安全風險未修復前間接鼓勵在正式站使用。

## v0.4.4 — 2026-08-15

### 變更

- **桌面版側欄改為常駐對話欄 + 浮動卡片**（`DesktopLayout.tsx`/`DesktopRail.tsx`/`DesktopShared.tsx`/`styles-desktop.css`）：`ChatScreen` 移入常駐左側欄（可收合，`chatCollapsed`），主顯示區固定為規劃地圖，`trips`/`timeline`/`pace`/`geo-outline` 改為疊加在地圖上的浮動卡片（右上角有共用關閉按鈕），不再擠壓地圖寬度；`demo-*` 系列維持原本整頁取代主顯示的行為。桌面版 `pace` 模式不再掛載 `PaceRouteMap`（與「主顯示固定為地圖」的新版面衝突），該元件保留供 `/demo/pace` 公開分享頁與手機版使用。
- **新增 `PANEL_REGISTRY` 設定表**（`DesktopShared.tsx`）：取代原本散落在 `isSidepanelMode`／`.wide` 字串拼接／側欄與主區各自 ternary 等處的 `panelMode` 字串比對，新增或調整面板行為（浮動卡片 vs. 整頁取代、寬度、是否需要已選行程）現在只需要改這張表一處。
- **浮動卡片視覺語言統一為 `.floating-panel`**（`styles-desktop.css`）：取代原本各自獨立定義的 `.add-from-candidate-sidebar`/`.geo-hotel-sidebar-wrap`，四種 `panelMode` 浮動卡片與候選籃第二側欄、飯店/附近推薦清單共用同一套定位/樣式。
- **地圖上方新增城市搜尋框**（`GeoOutlineMap.tsx`/`GeoOutlinePanel.tsx`）：類別標籤列旁新增城市搜尋輸入框，與候選籃側欄共用同一份搜尋狀態，不需要先展開候選籃就能在地圖上直接搜尋城市。

### 修正

- **正式環境地圖標記無法顯示**（`Dockerfile`/`deploy-cloudrun.yml`/`deploy-with-migration.yml`/`update-secret-manager.sh`）：`GeoOutlineMap.tsx` 改用 `AdvancedMarkerElement` 後要求地圖必須帶有效的 `mapId` 才能運作，但部署設定先前只設定了 `VITE_GOOGLE_MAPS_API_KEY`，`VITE_GOOGLE_MAPS_MAP_ID` 在正式環境建置時是 `undefined`，導致所有地圖標記（飯店/景點/推薦地點/搜尋候選點等）靜默失效。新增 `GOOGLE_MAPS_MAP_ID` secret（GCP Console 手動建立的 Map Style ID，非機密資料但集中管理），`update-secret-manager.sh` 新增 `-map-id` 選項維護，兩個部署 workflow 比照既有 `GOOGLE_MAPS_API_KEY` 的讀取模式，build 時當 `--build-arg` 傳入。

### 文件

- `.claude/skills/version-tagging/override.md` 新增第三條破壞性判準：資料表變更若無法只靠 `AutoMigrate` 無痛套用（需要 backfill 既有資料、刪除表/欄位、或手寫 migration/人工介入資料庫），即算破壞性，不論是否對外公開、有沒有動到 CLI 介面。
- `docs/TERMINOLOGY.md` 修正過時內容：桌面版三段式版面段落更新為「常駐對話欄 + 固定地圖主顯示 + 四種 panelMode 浮動卡片」的現況（原文件仍描述舊版「side panel 依分頁切換」的版面），一併修正多處指向 `web/src/` 根目錄、實際已搬到 `web/src/geo-planning/` 子目錄的檔案路徑（`AddFromCandidateSidebar.tsx`/`GeoHotelSidebar.tsx`/`GeoOutlineMap.tsx`/`AttractionInfoPanel.tsx`），與已改名的 CSS class（`.add-from-candidate-sidebar`/`.geo-hotel-sidebar-wrap` → `.floating-panel`/`.floating-panel-left`/`.floating-panel-right`）。

## v0.4.3 — 2026-08-15

### 新增

- **CLI `attraction-update` 子命令**（`server/cmd/cli/main.go`/`http.go`）：修正建檔時輸入錯誤的景點座標，走新增的 `PATCH /internal/maintenance/attractions/{id}/coords` 端點（`server/internal/api/maintenance.go`、`store.UpdateAttractionCoords`）。支援 `-lat/-lng` 直接指定，或 `-place/-region` 改查該地名座標取第一筆候選結果，不需要自己先查好經緯度。
- **地理輪廓底圖搜尋框改為多候選**：`GET /internal/geo/geocode`（`handleGeoGeocode`）改用 Places API (New) Text Search 取代原本的 Geocoding API，回應形狀從單一最佳匹配 `{query, address, lat, lng}` 改為候選陣列 `{query, candidates: [...]}`，最多回傳 20 筆（`geo.Client.Search` 的 `MaxResults` 官方硬性上限，原本受限於本專案自訂的 5 筆節流已一併拉高）。原因：Geocoding API 對城市/觀光區/商圈這類口語化地名常查無結果或答非所問，且沒有候選清單可退。前端（`GeoOutlineMap.tsx`/`GeoOutlinePanel.tsx`）新增候選 marker 圖層：地圖 `fitBounds` 到能同時看見所有候選的範圍，點擊任一個確認選定、其餘候選仍留在地圖上可隨時回頭改選，選定後開啟 `GeoInfoPanel` 顯示該候選的名稱/地址。此端點僅供自家前端/CLI 呼叫（`/internal/*` 命名空間、需 JWT 登入），呼叫端已在同一次異動中同步更新，不構成對外相容性影響。
- **路徑編輯器試做**（`web/src/RouteEditor.tsx`/`.module.css`）：旅程分享/路徑編輯功能的雜誌式編輯介面試做，`contentEditable` 行內編輯（標題/段落/地點卡）、拖拉排序、圖片文繞圖。純前端假資料，不呼叫任何後端 API。透過 `DEMO_ROUTE_EDITOR_ENABLED` feature flag 控制（`DesktopShared.tsx`，環境變數 `VITE_FEATURE_DEMO_ROUTE_EDITOR`），預設關閉，桌面版限定入口收在 `DesktopRail.tsx` 分隔線之後、與其餘 demo-* 試做項目同組。

### 修正

- **新增行程後未自動選中**：`AppCommon.tsx` 的 `submitCreate` 建立行程成功後，明確標記 `hasAutoNavigatedRef` 避免緊接著的行程列表刷新觸發「自動導向 localStorage 預設行程」的既有 effect，把使用者剛選中的新行程蓋掉。
- **新增行程按鈕溢出側欄邊框**：`.new-trip-composer input`（`styles.css`）補上 `min-width: 0`，修正 flex 子元素預設 `min-width: auto` 導致無法縮小、把固定寬度的「建立」按鈕擠出側欄邊界的問題。
- **404 頁面風格與首頁不一致**：`NotFoundPage.tsx` 改用 `LegalPage.css` 既有的 `.legal-bloom` 京都和風視覺語言（暖紙底色、日夜間切換），取代原本沿用的舊版 `landing.css` 藍綠度假風格。

### 其他

- `web/index.html` 補上標準版 `mobile-web-app-capable` meta tag（`apple-mobile-web-app-capable` 前綴版本保留供 iOS Safari 相容），修正瀏覽器主控台的 deprecation 警告。

## v0.4.2 — 2026-08-14

### 清理

- **移除私有依賴 `github.com/tim72117/want`**：`server/internal/wanttools/`（9 個檔案）對 `want/types` 的引用改為本地定義（新增 `wanttypes.go`，型別/函式簽章照抄 `want@v0.0.2/types` 原始碼，非重新設計），`want` 已從 `server/go.mod`/`go.sum` 完全移除。`internal/wanttools/` 套件本身未被刪除、內容不變——它是保留下來的舊 want 對話系統工具實作，經 `go list -deps` 驗證未被 `cmd/server`/`cmd/adminserver`/`cmd/cli` 任一 binary import，純粹是先前依賴仍列在 `go.mod` 裡、拖著 `go mod download` 需要私有模組認證的技術債。
- **4 支 Dockerfile 移除 `GH_PAT`/`GOPRIVATE`**（`Dockerfile`、`Dockerfile.admin`、`Dockerfile.migrate`、`Dockerfile.redirect`）：`go mod download` 不再需要私有模組認證，本機 `docker build` 不用再另外提供 GitHub PAT。`Dockerfile.migrate` 順便修正一段描述已移除的 `cmd/cli -db` 模式的過時說明。
- **5 個 GitHub Actions workflow 移除 `--build-arg GH_PAT`**（`deploy-admin.yml`、`deploy-cloudrun.yml`、`deploy-migrate.yml`、`deploy-redirect.yml`、`deploy-with-migration.yml`，`deploy-with-migration.yml` 有 2 處）。
- `server/scripts/setup.sh` 移除「簽發 GH_PAT 設成 GitHub repo secret」的部署後續步驟指示（原本兩步，現在一步）。
- 修正 `docs/PROJECT_HEALTH_REVIEW.md` 對 `want` 依賴風險的過時描述（原文稱其「被 26 個檔案 import」，現已完全移除）。

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
