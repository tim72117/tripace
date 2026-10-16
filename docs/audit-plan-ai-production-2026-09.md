# /app/plan-ai 正式功能程式碼審閱記錄（2026-09）

2026-10-16 複核：對照 main @ 4f14828 逐項檢查，已移除 2 項已過時的項目（原第 6、8 項；其餘項目編號沿用原記錄，不重新編號）。

審閱範圍：`web/src/trip-plan/TripPlanPage.tsx`（正式 `/app/plan-ai` 功能頁面），以及它依賴的共用資料層（原記錄於審閱當時的 `web/src/plan-ai/planTimeline.ts`、`web/src/plan-ai/attractionTools.ts`，2026-09 底已搬到 `web/src/plan-core/planTimeline.ts`、`web/src/plan-core/attractionTools.ts`——獨立於正式功能目錄之外，因為展示原型移除後這層已不需要再考慮跨目錄依賴方向，`plan-core` 純粹是目前唯一呼叫端 `TripPlanPage.tsx` 的資料層）。以下內文引用的 `fetchPublicGeoPlaceDetailsAny`/`fetchPublicGeoTransitEstimate` 等函式名，2026-09 底也隨查詢端點改需登入一併改名為 `fetchPlanAiPlaceDetailsAny`/`fetchPlanAiTransitEstimate` 等 `fetchPlanAi*` 系列，下文未逐一更新舊名，讀到時請對照 `web/src/api.ts` 目前的實際函式名。

以下第 1、2 項已修正，其餘為待處理事項。

**現況（2026-10-16 複核）**：2026-10 起 `/app/plan-ai` 面板已移除，正式功能搬到 `/trip-plan` 獨立路由（`web/src/trip-plan/TripPlanRoute.tsx` 外殼 + `TripPlanPage.tsx`，舊網址 `/app/plan-ai` 在 `web/src/App.tsx:346` 轉址到 `/trip-plan`）。`TripPlanPage.tsx` 與 `plan-core/` 的檔案位置仍與上述相同；`TripPlanPage` 目前另被 `PhoneContent.tsx:608`、`DesktopLayout.tsx:1009`、`home/plan-ai-sim/LivePlanLayer.tsx:134` 掛載。下文行號為審閱當時的數字，有位移的項目會在該項的「現況」中註明目前位置。

## 已修正

### 1. WS URL 環境變數未設定時靜默退回 localhost

`TripPlanPage.tsx` 的 `PLAN_AI_ONAGENT_WS_URL` 原本在 URL 環境變數未設定時靜默 fallback 成 `ws://localhost:8090/ws`。正式環境若漏設這個環境變數，對話框看起來一切正常（狀態顯示已就緒、輸入框可用），但每次送出的訊息都連到一個正式環境上根本不存在的本機位址，永遠沒有回應，使用者無從得知是設定錯誤。

已修正：拿掉 fallback，改成 `undefined`；新增 `urlMissing` 旗標，`usePlanAiChatBridge` 據此不建立注定連不上的連線；UI 顯示「對話功能調整中，請稍後再試」並鎖定輸入框（不暴露「URL 未設定」這類技術性字眼）。（2026-09 底這個 URL 變數本身也整合掉了：獨立的 `VITE_PLAN_AI_ONAGENT_URL` 已移除，改與 tripace app 共用同一個 `VITE_ONAGENT_URL`，見下方第 2 項。）

**現況（2026-10-16 複核）**：修復仍在。`web/src/trip-plan/TripPlanPage.tsx:607-608` 目前為 `PLAN_AI_ONAGENT_HTTP_URL = import.meta.env.VITE_ONAGENT_URL`、`PLAN_AI_ONAGENT_WS_URL = HTTP_URL ? ... + '/ws' : undefined`（無 localhost fallback）；`:697` `if (!apiKey || !PLAN_AI_ONAGENT_WS_URL) return` 不建立連線；`:851` 回傳 `urlMissing`；`:1624-1643` 輸入框顯示「對話功能調整中，請稍後再試」並 disabled。

### 2. 正式功能與未受保護的展示原型共用 onagent app 與 apiKey【安全/成本風險】

原記錄：`TripPlanPage.tsx` 的 `PLAN_AI_ONAGENT_APP_ID = 'plan-ai-timeline'`，與展示原型 `web/src/plan-ai/AIPlanTimelinePage.tsx` 用的是完全相同的 app id 跟同一個環境變數 `VITE_PLAN_AI_ONAGENT_APP_KEY`。展示原型的路由 `/plan-ai`（`App.tsx`）沒有任何 feature flag 或登入保護即可訪問，任何人造訪即可用跟登入使用者相同的 onagent app/apiKey 開啟對話，消耗相同的用量額度。

已修正（2026-09 底）：展示原型 `AIPlanTimelinePage.tsx` 與獨立路由 `/plan-ai` 已整個移除（含依賴的 `attractionPool.ts` 假資料池），不是收進試作區延後處理，而是直接消除曝險面——正式功能不再與任何免登入路徑共用 onagent app/apiKey。同一批改動也把正式功能依賴的五支查詢端點（`place-search`/`attraction-search`/`place-details-any`/`attraction/{id}`/`transit-estimate`）從免登入的 `/public/geo/*` 搬到需登入的 `/internal/geo/plan-ai/*`。

**現況（2026-10-16 複核）**：部分仍成立，描述需要更新。
- 仍成立：原 `web/src/plan-ai/` 目錄與 `AIPlanTimelinePage.tsx`（舊 `/plan-ai` 路由）已不存在；`/internal/geo/plan-ai/*` 五支端點仍在 `server/internal/api/api.go:861-865` 的 `internalMux`（需登入）。
- 已變動（2026-10）：(a) 後端 `place-search`/`attraction-search` 兩支又重新開放為公開端點 `GET /public/geo/plan-ai/place-search`、`/attraction-search`（`api.go:782-783`，以 `withGeoQueryIPThrottle` 做以 IP 為 key 的節流，註解見 `api.go:762-781`）；`place-details-any`/`attraction/{id}`/`transit-estimate` 仍只在 internal。(b) 新增公開展示頁 `/ai-plan`（`web/src/App.tsx:235`，`web/src/home/plan-ai-sim/AIPlanTimelinePage.tsx`），訪客按「讓我試看看」後由 `LivePlanLayer.tsx:134` 直接掛載 `TripPlanPage`，連到同一個 onagent app（`plan-ai-timeline`，`TripPlanPage.tsx:588`）與同一個 `VITE_PLAN_AI_ONAGENT_APP_KEY`（`TripPlanPage.tsx:639`）。因此「正式功能不再與任何免登入路徑共用 onagent app/apiKey」這句話在目前已不再完全成立。減輕因素：訪客送出訊息時 `sendPrompt` 先呼叫 `postPlanAiChat`（`POST /internal/plan-ai/chat`，需登入，`api.go:866`），訪客會被拒絕，不會走到 `bridge.prompt`；`LivePlanLayer.tsx` 檔頭註解也承認訪客的工具呼叫會因 internal 端點 401 而排不出站點。這是否仍構成用量曝險，本次複核未能進一步驗證 onagent 端行為。
### 3. `isThinking` 卡死無恢復機制

`TripPlanPage.tsx:421`（`onAssistantMessage`/`onError`，目前在 `TripPlanPage.tsx:739-741`、`:764-766`；另 `sendPrompt` 的 catch 在 `:831` 也會重設）是唯一會把 `isThinking` 重設為 `false` 的地方，沒有任何逾時機制。若 onagent 連線中斷或漏回應（WebSocket 掉包、後端 hang 住），狀態列會永久卡在「正在安排行程…」。原型原有的「終止」按鈕已被移除，且沒有提供替代的逾時/取消機制——使用者唯一的復原方式是重新整理整個頁面。

**現況（2026-10-16 複核）**：仍成立。`usePlanAiChatBridge` 內 `setIsThinking(true)`（`TripPlanPage.tsx:822`）後，只有 `onAssistantMessage`（`:741`）、`onError`（`:766`）與 `sendPrompt` 失敗的 catch（`:831`）會設回 `false`；整個 hook 內沒有逾時計時器（唯一的 `setTimeout` 在 `:782`，只用於把 status 設成 ready）。送出鈕在 `isThinking` 時 disabled（`:1643`），`:1632` 註解確認「終止」按鈕仍未恢復。

**建議**：新增送出 prompt 後的逾時計時器（例如 30 秒），逾時未收到 `onAssistantMessage`/`onError` 就自動把 `isThinking` 設回 `false`，並在畫面上顯示連線異常提示。

### 4. `add_attraction` 佔位卡可能永久卡住

`attractionTools.ts:395`（目前為 `web/src/plan-core/attractionTools.ts:413-424`）的 `add_attraction` 插入一個 `loading:true` 的佔位卡後，背景查詢 `fetchPublicGeoPlaceDetailsAny` 若掛起（網路卡住、不報錯也不 resolve），沒有任何 client 端逾時保護。且唯一能移除卡片的 `removeStep` 在正式功能完全沒有接上任何 UI 或工具，使用者無法移除或重試這張永遠顯示「查詢地點中…」的卡片。

**建議**：`fetchPublicGeoPlaceDetailsAny` 呼叫加上逾時（例如用 `AbortController`），逾時後把該節點標記為查詢失敗並允許重試；同時考慮把 `removeStep` 接上某種使用者可觸發的移除入口。

**現況（2026-10-16 複核）**：部分仍成立。(a) 已改善的部分：`removeStep` 已接上使用者可觸發的入口——時間軸卡片刪除按鈕（`web/src/trip-plan/TripPlanPage.tsx:1465`、`:1494` 傳入 `onRemoveStop={removeStep}`，`web/src/plan-core/PlanTimelineView.tsx:931-941` 渲染按鈕）與 AI 工具 `remove_attraction`（`plan-core/attractionTools.ts:530-541`、`TripPlanPage.tsx:720-727`），所以使用者已能手動移除卡在「查詢地點中…」的卡片（`PlanTimelineView.tsx:919`）。(b) 仍成立的部分：`resolveAttractionForStep`（目前在 `TripPlanPage.tsx:130-210`）的 `fetchPlaceDetails(placeId)` 仍沒有 client 端逾時/`AbortController`；若請求永遠不 resolve，卡片仍會一直停在 `loading:true`（只有 reject 時 `.catch` 才會把 `loading` 設為 false）。

### 5. `list_itinerary` 對話節點回傳全 undefined 雜訊

`attractionTools.ts:515`（目前為 `web/src/plan-core/attractionTools.ts:572-588`）的 `listItinerary` 對每個節點統一輸出 `{id, type, time, name, label, note}`，但 `message` 型別節點（對話訊息，見 `TripPlanPage.tsx:413-426`（目前為 `:739-770`）的 `onAssistantMessage`/`onError`）真正的內容欄位是 `text`，沒有被納入這份映射。對話進行幾輪後，LLM 呼叫 `list_itinerary` 查詢現況時，會在清單裡混雜多筆 `{type:'message', time:undefined, name:undefined, label:undefined, note:undefined}` 的空殼項目，看不到訊息實際內容，可能誤導 LLM 判斷時間軸現況。

**建議**：`listItinerary` 應該直接過濾掉 `type === 'message'` 的節點，或者為 message 節點單獨映射出 `text` 欄位，不要讓它以一堆 `undefined` 欄位的形式出現。

**現況（2026-10-16 複核）**：仍成立。`listItinerary`（`plan-core/attractionTools.ts:575-587`）仍對每個節點輸出 `{id, type, time, name, label, note}`，沒有過濾 `type === 'message'`，也沒有映射 `text`；其資料來源 `getStepsForBridge`（`TripPlanPage.tsx:1128`）為 `toRenderList(timelineRef.current)`，包含 message 節點。

### 7. 429 限流重試邏輯是治標而非治本

`TripPlanPage.tsx:104-151`（目前為 `:81-210`，`RATE_LIMIT_RETRY_DELAY_MS` 在 `:88`、`isRateLimitedError` 在 `:95`、重試分支在 `:200-209`）的 `resolveAttractionForStep` 針對 429（限流拒絕）自行實作了一套一次性重試狀態機（`isRateLimitedError`/`RATE_LIMIT_RETRY_DELAY_MS`），綁死在這一個呼叫點、這一種錯誤格式，而不是在共用的 HTTP 請求層（`web/src/api.ts` 的 `request()`，所有端點呼叫的唯一入口）統一處理重試/退避。

這個限流器（`server/internal/geo/places.go` 的 `defaultRateLimiter`）是後端共用機制，服務多個端點；目前只有這一個呼叫點做了重試防護。

**風險**：之後任何其他呼叫點（例如 `fetchPublicGeoTransitEstimate`——目前函式名為 `fetchPlanAiTransitEstimate`，`web/src/api.ts:970`——或未來新增的查詢）撞上同一個限流器時，需要重新複製貼上這整套重試/取消邏輯，而不是自動受惠於一個集中處理的機制。

**建議**：評估把 429/`rate_limited` 的重試邏輯上移到 `api.ts` 的 `request()` 內（例如可選的 retry policy 參數），讓所有呼叫端統一受益，不需要各自發明一套。

**現況（2026-10-16 複核）**：仍成立。`web/src/api.ts:139` 的 `request()` 仍沒有任何 429/重試處理（429 只以 `ApiError` 往上拋，見 `api.ts:1003` 註解），重試仍只存在於 `TripPlanPage.tsx` 的 `resolveAttractionForStep`；後端限流器 `defaultRateLimiter` 仍在 `server/internal/geo/places.go:47`。

### 9. attraction 命中分支付出 4～5 次循序 DB 往返，其中一次大致可省略

`handlePublicGeoPlaceDetailsAny`（目前在 `server/internal/api/geo_plan_ai.go:668`）的 attraction 命中分支，每次請求依序執行：`SetCachedPlaceDetails`（寫入）→ `GetCachedPlaceDetails`（讀取，只為了拿 `FetchedAt` 判斷 7 天時間觸發條件）→ `IncrementPlaceClickCount`（UPDATE + SELECT）→ `ListFreshPhotoAssetURLsForPlace`（讀取，組 `googlePhotoUrls`）。這條分支在 2026-10 加入漸進補圖前是零寫入、只有一次讀取。

`GetCachedPlaceDetails` 這次讀取大致是多餘的：`SetCachedPlaceDetails` 的 `OnConflict` 路徑已經證明該列存在，`click_count`/`new_photo_count`/`google_photo_target_count` 都已經由 `IncrementPlaceClickCount` 的回傳值取得——真正需要額外讀的只有 `FetchedAt` 這一個欄位。

**建議**：讓 `IncrementPlaceClickCount`（或改用 `UPDATE ... RETURNING`）一併把 `fetched_at` 帶出來，省掉這一次往返。這個改動會牽動 `store` 層的函式簽名與既有呼叫端（地圖版 `handleGeoPlaceDetails` 可能也呼叫同一個函式），優先順序屬於效能優化而非正確性問題，是否動手取決於這條路徑的實際呼叫頻率是否已構成瓶頸。

**現況（2026-10-16 複核）**：部分仍成立，描述需要更新。仍成立：該分支（`geo_plan_ai.go:715-751`）依序呼叫 `SetCachedPlaceDetails`（`:715`）→ `GetCachedPlaceDetails`（`:720`）→ `IncrementPlaceClickCount`（`:721`，`server/internal/store/geocache.go:175` 為 UPDATE 再 SELECT 兩次往返）→ `ListFreshPhotoAssetURLsForPlace`（`:748`），多餘的那次讀取仍在；`IncrementPlaceClickCount` 也仍被地圖版呼叫（`geo_outline.go:1362`、`:1618`），簽名變動仍會牽動它們。需更新的細節：(a) `GetCachedPlaceDetails` 的回傳列現在被 `_` 丟棄，只拿 `ok` 當「該列存在」的判斷（`:720`），已不是為了取 `FetchedAt` 判斷「7 天時間觸發」——舊的點擊/時間觸發機制（`shouldAddGooglePlacePhoto`、`google_photo_target_count`/`new_photo_count` 欄位）已被移除，改由 `freshPhotoIndexStates`（`geo_outline.go:1056`，逐張查 `photo_assets` 新鮮度）搭配 `decidePlacePhotoRefreshIndex` 決定補圖，因此「只需多讀 `FetchedAt` 一個欄位」不再準確；這次存在性檢查仍大致可省略（`SetCachedPlaceDetails` 剛 upsert 過），但分支內現在多了 `freshPhotoIndexStates` 的逐張 `GetPhotoAsset` 讀取。(b) 該端點目前僅在 `internalMux`（需登入，`api.go:863`），函式名稱中的 `Public` 是歷史遺留。

## 已確認排除、不需處理的項目

以下項目經過交叉驗證，確認是既有設計的合理取捨或已有註解說明理由，不建議修改：

- `planTimeline.ts`/`attractionTools.ts` 的 `insertAfter` 單一寫入口設計——是正確的架構，不是問題。
  **現況（2026-10-16 複核）**：仍成立，`web/src/plan-core/planTimeline.ts:550` 的 `insertAfter` 仍是插入的唯一寫入口（另有 `:671` `removeNode`）。
- `useMemo(toRenderList(timeline))` 穩定化——正確的 React 寫法，已修過相關的捲動誤觸發問題。
  **現況（2026-10-16 複核）**：仍成立，`web/src/trip-plan/TripPlanPage.tsx:559` `const steps = useMemo(() => toRenderList(timeline), [timeline])`。
- `resolveAttractionForStep` 的 `isCancelled` 回呼（`mountedRef`/`timelineRef` 雙重檢查）——已有註解記錄這是修過的真實 race condition，設計合理。
  **現況（2026-10-16 複核）**：仍成立，`TripPlanPage.tsx:406-409` 的 `mountedRef` 與 `:436` 的 `() => !mountedRef.current || !timelineRef.current.nodes.has(newId)` 仍在（`isCancelled` 參數在 `:135`）。
- `cfg` 的登入態保證——由上層 `PhoneContent.tsx` 在到達 `TripPlanPage` 之前把關，不是這個元件自己的漏洞。
  **現況（2026-10-16 複核）**：部分仍成立，描述需要更新。`PhoneContent.tsx:608`、`DesktopLayout.tsx:1009` 仍在 `/app` 登入後面板內掛載；`/trip-plan` 由 `web/src/trip-plan/TripPlanRoute.tsx:35-43` 的 `isGuest` 分支顯示登入表單後才渲染 `TripPlanPage`。但 `/ai-plan` 公開展示頁的 `LivePlanLayer.tsx:120-134` 會以可能沒有 token 的 `cfg`（訪客）掛載 `TripPlanPage`，因此「`TripPlanPage` 一定拿到登入態 `cfg`」已不再是普遍保證，該元件在這條路徑下會遇到 internal 端點 401。

（原記錄的 `attractionPool.ts` 死碼、展示原型 `AIPlanTimelinePage.tsx` 的簡化版 `resolveAttractionForStep` 兩項，隨第 2 項展示原型整個移除已一併消失，不再適用。）

## 附註（歷史）：展示原型與正式功能的重複程式碼

2026-09 底展示原型 `AIPlanTimelinePage.tsx` 已整個移除（見上方第 2 項），本節記錄的「`TripPlanPage.tsx` 與展示原型捲動跟隨狀態機重複」問題已隨之消失，不再需要處理。保留此節僅作歷史記錄。

**現況（2026-10-16 複核）**：部分仍成立，描述需要更新。原 `web/src/plan-ai/AIPlanTimelinePage.tsx` 確實已不存在（`web/src/plan-ai/` 目錄已不在），但 2026-10 新增了另一份同檔名的 `web/src/home/plan-ai-sim/AIPlanTimelinePage.tsx`（`/ai-plan` 公開展示頁，`App.tsx:235`），其真實 AI 層直接複用 `TripPlanPage`（`LivePlanLayer.tsx:134`）而非複製一份，捲動跟隨狀態機是否又出現重複，本次複核未能驗證。
