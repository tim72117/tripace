# /app/plan-ai 正式功能程式碼審閱記錄（2026-09）

審閱範圍：`web/src/trip-plan/TripPlanPage.tsx`（正式 `/app/plan-ai` 功能頁面），以及它依賴的共用資料層（原記錄於審閱當時的 `web/src/plan-ai/planTimeline.ts`、`web/src/plan-ai/attractionTools.ts`，2026-09 底已搬到 `web/src/plan-core/planTimeline.ts`、`web/src/plan-core/attractionTools.ts`——獨立於正式功能目錄之外，因為展示原型移除後這層已不需要再考慮跨目錄依賴方向，`plan-core` 純粹是目前唯一呼叫端 `TripPlanPage.tsx` 的資料層）。以下內文引用的 `fetchPublicGeoPlaceDetailsAny`/`fetchPublicGeoTransitEstimate` 等函式名，2026-09 底也隨查詢端點改需登入一併改名為 `fetchPlanAiPlaceDetailsAny`/`fetchPlanAiTransitEstimate` 等 `fetchPlanAi*` 系列，下文未逐一更新舊名，讀到時請對照 `web/src/api.ts` 目前的實際函式名。

以下第 1、2 項已修正，其餘為待處理事項。

## 已修正

### 1. WS URL 環境變數未設定時靜默退回 localhost

`TripPlanPage.tsx` 的 `PLAN_AI_ONAGENT_WS_URL` 原本在 URL 環境變數未設定時靜默 fallback 成 `ws://localhost:8090/ws`。正式環境若漏設這個環境變數，對話框看起來一切正常（狀態顯示已就緒、輸入框可用），但每次送出的訊息都連到一個正式環境上根本不存在的本機位址，永遠沒有回應，使用者無從得知是設定錯誤。

已修正：拿掉 fallback，改成 `undefined`；新增 `urlMissing` 旗標，`usePlanAiChatBridge` 據此不建立注定連不上的連線；UI 顯示「對話功能調整中，請稍後再試」並鎖定輸入框（不暴露「URL 未設定」這類技術性字眼）。（2026-09 底這個 URL 變數本身也整合掉了：獨立的 `VITE_PLAN_AI_ONAGENT_URL` 已移除，改與 tripace app 共用同一個 `VITE_ONAGENT_URL`，見下方第 2 項。）

### 2. 正式功能與未受保護的展示原型共用 onagent app 與 apiKey【安全/成本風險】

原記錄：`TripPlanPage.tsx` 的 `PLAN_AI_ONAGENT_APP_ID = 'plan-ai-timeline'`，與展示原型 `web/src/plan-ai/AIPlanTimelinePage.tsx` 用的是完全相同的 app id 跟同一個環境變數 `VITE_PLAN_AI_ONAGENT_APP_KEY`。展示原型的路由 `/plan-ai`（`App.tsx`）沒有任何 feature flag 或登入保護即可訪問，任何人造訪即可用跟登入使用者相同的 onagent app/apiKey 開啟對話，消耗相同的用量額度。

已修正（2026-09 底）：展示原型 `AIPlanTimelinePage.tsx` 與獨立路由 `/plan-ai` 已整個移除（含依賴的 `attractionPool.ts` 假資料池），不是收進試作區延後處理，而是直接消除曝險面——正式功能不再與任何免登入路徑共用 onagent app/apiKey。同一批改動也把正式功能依賴的五支查詢端點（`place-search`/`attraction-search`/`place-details-any`/`attraction/{id}`/`transit-estimate`）從免登入的 `/public/geo/*` 搬到需登入的 `/internal/geo/plan-ai/*`。

### 3. `isThinking` 卡死無恢復機制

`TripPlanPage.tsx:421`（`onAssistantMessage`/`onError`）是唯一會把 `isThinking` 重設為 `false` 的地方，沒有任何逾時機制。若 onagent 連線中斷或漏回應（WebSocket 掉包、後端 hang 住），狀態列會永久卡在「正在安排行程…」。原型原有的「終止」按鈕已被移除，且沒有提供替代的逾時/取消機制——使用者唯一的復原方式是重新整理整個頁面。

**建議**：新增送出 prompt 後的逾時計時器（例如 30 秒），逾時未收到 `onAssistantMessage`/`onError` 就自動把 `isThinking` 設回 `false`，並在畫面上顯示連線異常提示。

### 4. `add_attraction` 佔位卡可能永久卡住

`attractionTools.ts:395` 的 `add_attraction` 插入一個 `loading:true` 的佔位卡後，背景查詢 `fetchPublicGeoPlaceDetailsAny` 若掛起（網路卡住、不報錯也不 resolve），沒有任何 client 端逾時保護。且唯一能移除卡片的 `removeStep`（見下方第 6 項）在正式功能完全沒有接上任何 UI 或工具，使用者無法移除或重試這張永遠顯示「查詢地點中…」的卡片。

**建議**：`fetchPublicGeoPlaceDetailsAny` 呼叫加上逾時（例如用 `AbortController`），逾時後把該節點標記為查詢失敗並允許重試；同時考慮把 `removeStep` 接上某種使用者可觸發的移除入口。

### 5. `list_itinerary` 對話節點回傳全 undefined 雜訊

`attractionTools.ts:515` 的 `listItinerary` 對每個節點統一輸出 `{id, type, time, name, label, note}`，但 `message` 型別節點（對話訊息，見 `TripPlanPage.tsx:413-426` 的 `onAssistantMessage`/`onError`）真正的內容欄位是 `text`，沒有被納入這份映射。對話進行幾輪後，LLM 呼叫 `list_itinerary` 查詢現況時，會在清單裡混雜多筆 `{type:'message', time:undefined, name:undefined, label:undefined, note:undefined}` 的空殼項目，看不到訊息實際內容，可能誤導 LLM 判斷時間軸現況。

**建議**：`listItinerary` 應該直接過濾掉 `type === 'message'` 的節點，或者為 message 節點單獨映射出 `text` 欄位，不要讓它以一堆 `undefined` 欄位的形式出現。

### 6. `removeStep` 完全無法觸發（死碼）

`TripPlanPage.tsx:298`（`useTripPlanTimeline` 內定義的 `removeStep`，含真實的 `setTimeout` 淡出動畫、鏈結摘除、交通卡重算邏輯）從未在 `TripPlanPage` 主體（第 480 行解構）被取用，也沒有接進 onagent 工具的 `ctx`——是正式功能路徑上完全無法觸達的死碼，且沒有任何測試覆蓋。註解稱「先保留給 onagent 之後若要加上『移除某一站』的工具時使用」。

**風險**：這段含狀態變更與非同步排程的邏輯完全沒有被驗證過；若之後 `planTimeline.ts` 的介面調整，這段程式碼的正確性不會被任何呼叫點捕捉出回歸；也可能被誤以為「這個能力已經生效」而忘記真的接上。

**建議**：若短期內沒有確切排期要加上「移除站點」的 onagent 工具，考慮整段移除（可從 git 歷史撈回），或者現在就把它接上一個最小可用的入口（哪怕只是暫時給某個測試用途），讓它有機會被實際驗證。

### 7. 429 限流重試邏輯是治標而非治本

`TripPlanPage.tsx:104-151` 的 `resolveAttractionForStep` 針對 429（限流拒絕）自行實作了一套一次性重試狀態機（`isRateLimitedError`/`RATE_LIMIT_RETRY_DELAY_MS`），綁死在這一個呼叫點、這一種錯誤格式，而不是在共用的 HTTP 請求層（`web/src/api.ts` 的 `request()`，所有端點呼叫的唯一入口）統一處理重試/退避。

這個限流器（`server/internal/geo/places.go` 的 `defaultRateLimiter`）是後端共用機制，服務多個端點；目前只有這一個呼叫點做了重試防護。

**風險**：之後任何其他呼叫點（例如 `fetchPublicGeoTransitEstimate`，或未來新增的查詢）撞上同一個限流器時，需要重新複製貼上這整套重試/取消邏輯，而不是自動受惠於一個集中處理的機制。

**建議**：評估把 429/`rate_limited` 的重試邏輯上移到 `api.ts` 的 `request()` 內（例如可選的 retry policy 參數），讓所有呼叫端統一受益，不需要各自發明一套。

### 8. 公開端點 `handlePublicGeoPlaceDetailsAny` 可被用來消耗 Google API 全域配額【已知取捨，列為風險提醒】

`server/internal/api/geo_plan_ai.go`（`handlePublicGeoPlaceDetailsAny`，2026-10 加入漸進補圖機制）免登入即可呼叫。attraction 命中分支現在無條件寫入 `place_details_cache`：對任何「第一次被這個端點查到」的 placeId，`google_photo_target_count` 的 DB 預設值是 sentinel `-1`，`shouldAddGooglePlacePhoto` 對 target<0 無條件觸發，於是每個新 placeId 都會觸發一次背景 `refreshGooglePlacePhotoInBackground` 下載，跟已登入的地圖功能（`handleGeoPlaceDetails`）共用同一份全域每日 Google Photo Media 配額（`cmd/server/main.go` 的 `defaultRateLimiter`）。

AI 規劃對話一次提議多個新景點，或有心人直接對這支公開端點打不同 placeId，都能連續觸發多次背景 Google API 呼叫，跟地圖功能搶配額。

**現況**：這是使用者 2026-10 明確決策接受的取捨（「跟地圖版共用同一份全域 API 限流額度，不分開」），不是遺漏。記錄於此純粹是風險提醒——若未來觀測到地圖功能補圖變慢/配額提前用盡，這是第一個該查的嫌疑對象。目前不需要採取行動。

### 9. attraction 命中分支付出 4～5 次循序 DB 往返，其中一次大致可省略

`handlePublicGeoPlaceDetailsAny` 的 attraction 命中分支，每次請求依序執行：`SetCachedPlaceDetails`（寫入）→ `GetCachedPlaceDetails`（讀取，只為了拿 `FetchedAt` 判斷 7 天時間觸發條件）→ `IncrementPlaceClickCount`（UPDATE + SELECT）→ `ListFreshPhotoAssetURLsForPlace`（讀取，組 `googlePhotoUrls`）。這條分支在 2026-10 加入漸進補圖前是零寫入、只有一次讀取。

`GetCachedPlaceDetails` 這次讀取大致是多餘的：`SetCachedPlaceDetails` 的 `OnConflict` 路徑已經證明該列存在，`click_count`/`new_photo_count`/`google_photo_target_count` 都已經由 `IncrementPlaceClickCount` 的回傳值取得——真正需要額外讀的只有 `FetchedAt` 這一個欄位。

**建議**：讓 `IncrementPlaceClickCount`（或改用 `UPDATE ... RETURNING`）一併把 `fetched_at` 帶出來，省掉這一次往返。這個改動會牽動 `store` 層的函式簽名與既有呼叫端（地圖版 `handleGeoPlaceDetails` 可能也呼叫同一個函式），優先順序屬於效能優化而非正確性問題，是否動手取決於這條路徑的實際呼叫頻率是否已構成瓶頸。

## 已確認排除、不需處理的項目

以下項目經過交叉驗證，確認是既有設計的合理取捨或已有註解說明理由，不建議修改：

- `planTimeline.ts`/`attractionTools.ts` 的 `insertAfter` 單一寫入口設計——是正確的架構，不是問題。
- `useMemo(toRenderList(timeline))` 穩定化——正確的 React 寫法，已修過相關的捲動誤觸發問題。
- `resolveAttractionForStep` 的 `isCancelled` 回呼（`mountedRef`/`timelineRef` 雙重檢查）——已有註解記錄這是修過的真實 race condition，設計合理。
- `cfg` 的登入態保證——由上層 `PhoneContent.tsx` 在到達 `TripPlanPage` 之前把關，不是這個元件自己的漏洞。

（原記錄的 `attractionPool.ts` 死碼、展示原型 `AIPlanTimelinePage.tsx` 的簡化版 `resolveAttractionForStep` 兩項，隨第 2 項展示原型整個移除已一併消失，不再適用。）

## 附註（歷史）：展示原型與正式功能的重複程式碼

2026-09 底展示原型 `AIPlanTimelinePage.tsx` 已整個移除（見上方第 2 項），本節記錄的「`TripPlanPage.tsx` 與展示原型捲動跟隨狀態機重複」問題已隨之消失，不再需要處理。保留此節僅作歷史記錄。
