# 構想:把後端端點推廣成「訪客可用版」+ 使用次數限制

> **狀態:1b 盤點出的第一輪候選已實作,使用次數限制(配額)仍是構想與
> 方案比較,尚未定案。**
> 2026-10-17:`handleGeoAttractionsOnlyNearby`/`handleGeoAttractionsNearby`
> 兩支已新增公開版本(見 1b 各自條目下的「已實作」說明),`handleGeoAttractions`
> 因路徑衝突決定不開放公開版、沿用既有白名單版本。其餘端點(1b 其餘項目、
> 第 3 節的使用次數限制)仍只是構想與方案比較,**不是已核准的實作計畫**,
> 沒有時間表或優先順序。繼續推進前,應該先回來更新這份文件補上決策結果,
> 或另開一份 `refactor-*` 規劃文件承接定案後的執行細節。

## 背景

2026-10 已經有一個先例:`/internal/plan-ai/chat`(AI 規劃對話)新增了對應
的公開版本 `/public/plan-ai/chat`、`/public/plan-ai/chat/reply`,讓
`/ai-plan` 展示頁的訪客不登入就能用。同一批改動也把兩支地圖查詢端點
(`/internal/geo/plan-ai/place-search`、`attraction-search`)開放成
`/public/geo/plan-ai/*`。這兩組訪客化的端點都遵循同一套模式:

1. `userOrGuestFor`(見 `server/internal/api/plan_ai_chat.go`)——先嘗試
   `s.userFor(r)` 解析已登入身分;若回退成固定的 `guestUser`(代表沒有
   合法 JWT),改讀 `X-Guest-Id` header,驗證格式是 `guest_` 前綴且不是
   空字串,格式通過就用這個字串當這次請求的 userID。**這支函式刻意不
   查資料庫、純格式檢查**——它不驗證這個 guest id 是否「真的存在」或
   「真的屬於同一個瀏覽器」,只確保不會跟真實帳號的 `usr_` 命名空間
   衝突(否則惡意呼叫端可以偽造 `X-Guest-Id: usr_xxx` 冒充真實使用者)。
2. 路由層疊加一層以來源 IP 為 key 的節流(`planAiChatIPRateLimiter`/
   `geoQueryIPRateLimiter`,60 秒視窗、30~300 次上限,依端點而定),理由
   是 `X-Guest-Id` 存在前端 localStorage,使用者清快取或換瀏覽器就能拿
   到全新 id,單靠 per-guest-id 節流不可靠,見下方「訪客 id 不可信任」
   一節的完整討論。
3. 新增的 `/public/*` 路徑必須手動在 `server/cmd/server/main.go` 的
   `mux.Handle(...)` 補一行轉發,否則會落入 SPA fallback(`mux.Handle("/",
   staticHandler(st))`)——這是本專案已經連續踩過三次的陷阱(`/onagent/`、
   `/public/blog/`、`/public/plan-ai/` 都各自留了一段「忘記補這行會怎樣」
   的註解),回應會是 200 + 前端 `index.html`,不是顯眼的 404,前端把
   HTML 當 JSON 解析失敗,錯誤訊息完全不會指向「路由沒接上」這個根因。

這次的構想是把這個模式推廣到「所有端點」,並在之後(不是這次)做真正的
使用次數限制(不只是 IP 節流,而是 per-guest-id 的配額,例如「每個訪客
一天能用幾次」)。

## 1. 現狀盤點:哪些端點適合開放訪客版

完整路由清單見 `server/internal/api/api.go` 的 `Routes()`(`/v1/*`、
`/public/*`)與其中註冊的 `internalMux`(`/internal/*`)。依「是否已經是
公開讀取」「是否寫入資料」「濫用後的具體代價」三個維度分類如下。

### 1a. 已經是公開/免登入的端點(不需要任何改動)

這些本來就不需要登入,`X-Guest-Id`/配額機制對它們沒有意義:

- `GET /v1/content-pages/{slug}`、`GET /v1/blog/{handle}/{slug}`——主題
  介紹頁、部落格文章,只回 `status=published` 內容。
- `GET /v1/itinerary-pages`、`GET /v1/itinerary-pages/{slug}`——範例行程
  展示。
- `GET /public/blog/photos`——批次查已發布文章的圖片網址。
- `GET /v1/demo/pace-route`——展示頁固定路線資料。
- `GET /public/geo/place-details`、`GET /public/geo/place-photo-assets`、
  `GET /public/geo/attractions`、`GET /public/geo/attraction/{id}`——有
  城市/placeID 白名單限制查詢範圍(`publicAttractionsCityAllowlist` 等),
  刻意收斂過的公開查詢端點。
- `GET /public/geo/plan-ai/place-search`、`attraction-search`——已套用
  `withGeoQueryIPThrottle` 疊加 IP 節流的既有先例。
- `POST /public/plan-ai/chat`、`/reply`——本次要推廣的對照範本本身。

### 1b. 唯讀查詢類,風險相對低、是「複製訪客版」的合理候選

這些目前掛在 `internalAuth` 底下(需要登入 JWT),但 handler 本身只讀,
而且**沒有**像 1a 那組一樣的白名單/範圍限制,開放訪客版前要先補上限流,
不能只是複製路由:

- `GET /internal/geo/plan-ai/place-details-any`——可查任意 placeID 的
  地點細節,2026-09 稽核記錄裡明確寫過「這批原本在公開路由上,因為
  沒有白名單只靠拒絕型限流擋,等於讓訪客消耗 Google Places 計費配額」
  才搬進需登入。**開放訪客版等於重新引入那個已經移除過的風險**,需要
  同等級的 IP 節流或更嚴格的配額才能考慮重新開放。
- `GET /internal/geo/plan-ai/attraction/{id}`——同上,可查任意 placeID。
- `GET /internal/geo/plan-ai/transit-estimate`——純本地計算(haversine
  距離 + 固定速度換算表),不打外部 API,相對安全,但仍佔用伺服器
  CPU/連線數,建議至少保留 IP 節流。
- `GET /internal/geo/geocode`、`GET /internal/geo/place-details`——會觸發
  Google Geocoding/Places API,屬於計費端點,目前靠
  `throttleGeoQueryByUser`(per-user,200ms 一次)+ 全站拒絕型限流
  (`geo.RateLimitConfig`)雙重保護。開放訪客版前必須先確認拒絕型限流
  覆蓋這些 endpoint(見 `cmd/server/main.go` 的
  `geoRateLimitPlaceGetWindowSec` 等參數),且疊加 IP 節流——否則等於
  繞過「2026-09 搬進需登入」這個決策的原始理由。
- `GET /internal/geo/attractions/nearby-only`(`handleGeoAttractionsOnlyNearby`)
  ——**唯一**真正純查資料庫(`listAttractionResponses`)、完全不觸發外部
  API 的候選,是這批裡風險最低的一支。**2026-10-17 已實作**:公開版
  `GET /public/geo/attractions/nearby-only`,沿用既有
  `withGeoQueryIPThrottle`(300 次/60 秒)。
- `GET /internal/geo/attractions/nearby`(`handleGeoAttractionsNearby`)
  ——2026-10-17 核對程式碼後更正:這支**不是**純資料庫查詢,內部會呼叫
  `fetchNearbyHotels` 即時查 Google Places 回傳飯店資料(計費)。
  **2026-10-17 已實作**:公開版 `GET /public/geo/attractions/nearby`,
  新增獨立節流池 `geoAttractionsIPRateLimiter`(30 次/60 秒,比照
  `planAiChatIPThrottleMaxCalls` 的既有先例,理由是會觸發計費 API)。
- `GET /internal/geo/attractions`(`handleGeoAttractions`)——同樣核對後
  更正:資料庫查無人工建檔資料時會 fallback 呼叫
  `geo.SearchCityAttractions` 即時查 Google Places(計費),且同樣會呼叫
  `fetchNearbyHotels` 查飯店,city 參數任意、無白名單限制。風險跟
  `geocode`/`place-details` 那組計費端點同等級。**2026-10-17 決定不
  開放這支的公開版**——嘗試實作時發現 `/public/geo/attractions` 這個
  路徑已經被另一支語意完全不同的 `handlePublicGeoAttractions`(見 1a,
  `geo_outline_public.go`,城市白名單限制查詢範圍)佔用,兩者安全模型
  不同不能合併或覆蓋;確認後**選擇沿用既有的白名單版本**滿足訪客查詢
  需求,不另外為「任意城市、無範圍限制、會觸發付費 API」的版本新增
  公開路由,避免擴大攻擊面。這支維持只在 `/internal/geo/attractions`
  (需登入)可用。
- `GET /v1/trips/{id}/entries`、`GET /v1/trips/{id}/members`——**不適合**
  直接開放訪客版,理由見 1c(涉及其他使用者的隱私資料,不是訪客自己
  的資料)。

### 1c. 不適合、或需要特別小心的端點

**會寫入資料、可能被濫用刷資料庫、或涉及隱私/他人資料**:

- `POST /v1/trips`、`POST /v1/trips/{id}/entries`、
  `PUT /v1/trips/{id}/entries/{entryID}`、`PATCH /v1/entries/{id}`、
  `DELETE /v1/trips/{id}/entries*`——這些是多人協作行程的核心寫入端點,
  且有 `requireOwner`/`requireEditor`/`requireMember` 這套依據**資料庫
  實際成員關係**判斷的權限模型。訪客沒有可靠身分(guest id 是前端自
  己生成、換瀏覽器就能偽造新的),如果開放訪客版寫入,任何人都能用
  一個隨機 guest id 建立無限筆行程/條目,刷爆資料庫,且無法追蹤是誰
  做的(沒有真實帳號可供事後究責/清理)。
- `POST /v1/trips/{id}/members`、`PATCH .../members/{userID}`——牽涉到
  把別人加入行程、改變別人的權限,訪客身分完全不該碰這類操作。
- `POST /v1/trips/{id}/public-link`、`DELETE .../public-link`——建立/
  撤銷分享連結,影響的是行程擁有者的資料,不該讓訪客操作。
- `GET /v1/trips/{id}/members`、`GET /v1/trips/{id}/entries`——即使是
  讀取,內容是其他真實使用者的行程資料(姓名、行程細節),訪客沒有
  `requireMember` 會通過的身分,本來就應該被現有權限檢查擋下,不是
  這次推廣的對象。
- `POST /v1/blog/photos/upload-url` 及其餘 `/v1/blog/photos/*`——使用者
  上傳圖片到 GCS 會產生實際儲存與頻寬成本,且簽發 pre-signed URL 本身
  要綁定使用者身分管理生命週期(草稿/刪除),訪客版等於讓任何人無限
  制上傳佔用 bucket 容量,是明確的濫用風險。
- `POST /v1/auth/*`、`/v1/cli-auth/*`——身分驗證相關端點,語意上就是
  給未登入者用的「取得身分」流程,不適用「訪客版」這個框架(它們本身
  已經是訪客能呼叫的入口)。
- `/internal/maintenance/*`(景點/主題介紹頁/範例行程管理、同步機制)——
  純維運端點,只給 `tripace-cli` 用,開放訪客版沒有任何產品需求,反而
  擴大攻擊面(任何這類端點一旦被訪客碰到都能直接竄改官方內容/地標
  資料)。
- `/onagent/*`——伺服器對伺服器的呼叫,不是給使用者端用的端點,不在
  「訪客化」的討論範圍內。

**結論**:只有「唯讀、查資料庫或純計算、不涉及他人隱私資料」這類端點
值得考慮訪客化;凡是寫入資料庫、涉及他人資料、或會觸發計費外部 API
而原本就靠「需要登入」擋住濫用的端點,都不該無差別複製。

## 2.「把所有端點複製一套」這個做法本身的風險

### 2a. 路由數量增加後的維護成本

目前 `/internal/*` 已經有約 50 支端點(`Routes()` + `internalMux`)。若
每一支都機械式複製成 `/public/*` 版本:

- `server/cmd/server/main.go` 的 `mux.Handle` 轉發陷阱會被放大——目前
  已經踩過三次「忘記補轉發行,端點靜默落入 SPA fallback」的事故,端點
  數量越多,漏補的機率線性上升,而且這種故障**不會在測試環境輕易被
  發現**(本機开發用 Vite dev server,API 走不同 port,不會有 SPA
  fallback 這個問題;只有正式環境靜態檔案與 API 同服務時才會踩到)。
- 每多一組 `/public/*` 路由,就多一份「這支端點的訪客版到底開放到
  什麼範圍」的文件債——如同 `handlePublicGeoAttractionByID` 的既有
  註解提到的「命名與實際掛載路徑不符的文件債」案例,訪客版一多,日後
  很容易出現「以為某個端點公開了,其實只掛在 internal」或反過來的
  混淆。
- 兩倍的路由意味著兩倍的 CORS/節流/日誌組合需要測試覆蓋,`handler`
  本身雖然共用(像 `handlePlanAiChat` 那樣),但路由層的節流/中介層
  配置是分開寫的,等於每支端點都多一份要同步維護的路由層邏輯。

### 2b. 是否該用中介層統一轉換身分,而非每個 handler 各自判斷

目前的模式是 **handler 層級**判斷(`userOrGuestFor` 只在
`plan_ai_chat.go` 這兩支 handler 內呼叫),`plan_ai_chat.go` 開頭的註解
明確解釋了為什麼不把這個邏輯放進 `internalAuth`/`userFor` 這類全站
中介層:

> 若在 `internalAuth` 那一層放行帶 `X-Guest-Id` header 的請求,會讓
> 所有掛在 `internalAuth` 底下、原本假設「通過這層就代表已登入」的
> 端點都意外被訪客繞過,是嚴重的權限範圍擴大。

這個理由在「只有兩支端點訪客化」時成本很低(多兩行呼叫),但如果要把
這個模式推廣到十幾、二十支端點,繼續讓每支 handler 各自呼叫
`userOrGuestFor` 有兩個問題需要先決定:

- **一致性風險**:如果靠人工在每支要訪客化的 handler 開頭加一行
  `userOrGuestFor`,很容易漏改、或改了但忘記同時處理「這支端點要不要
  擋掉寫入操作」這類差異化邏輯。
- **替代方案**:可以考慮一個獨立的、只掛在刻意列出的 `/public/*` 路由
  上的 middleware(例如 `withGuestAuth(s, next)`),比照現有
  `withGeoQueryIPThrottle`/`withPlanAiChatIPThrottle` 的路由層 wrapper
  寫法——**不是**改 `internalAuth` 本身,而是在 `/public/*` 這組路由
  各自的註冊行外面包一層,內部呼叫跟 `userOrGuestFor` 相同的邏輯,把
  解析出的身分放進 `context`,handler 內改用 `userFromContext(r)` 取代
  目前 handler 自己呼叫 `userOrGuestFor`。這樣可以：
  - 保留「只在明確列出的 `/public/*` 路由生效」這個安全邊界(不動
    `internalAuth`/`userFor`,維持 `plan_ai_chat.go` 開頭強調的理由)。
  - 把「訪客 id 格式驗證」這段邏輯集中成一份,不用每支 handler 重複
    呼叫/重複判斷 `ok` 是否為 false。
  - 之後要新增使用次數限制時,配額檢查也可以放進同一個 middleware,
    不需要再去每支 handler 裡插入。

是否要做這個中介層抽換,取決於最終要訪客化的端點數量——只有 1b 盤點
出的那幾支候選(個位數),維持現有的 handler 內呼叫模式成本尚可接受；
若之後範圍擴大到兩位數以上,建議優先做這個中介層抽換,否則一致性會
難以維護。

### 2c. 現有 `userOrGuestFor` 模式是否能直接套用

`userOrGuestFor` 目前的設計假設是「這支端點的資料記錄本來就是以
userID 為擁有者維度」(`plan_ai_chat_messages` 表用 `user_id` 欄位記
歸屬)。這個假設**不是對所有端點都成立**:

- 對 1b 盤點出的唯讀查詢端點(`attractions/nearby`、`geocode` 等),
  它們根本不寫入任何以 userID 為擁有者的記錄,`userOrGuestFor` 用在
  這裡其實只是「要不要讓這次請求通過」的身分檢查,不需要真正關心
  訪客 id 的值是什麼——這種情況下,其實比照 `throttleGeoQueryByIP`
  的做法(直接用 IP 當節流 key,不要求訪客帶 `X-Guest-Id`)可能更
  簡單,不是每支端點都需要引入 `X-Guest-Id` 這個額外的前端狀態。
- 只有「這支端點的回應/記錄需要跟『同一個訪客的後續請求』關聯」時
  (例如 AI 對話需要同一個訪客能回報對話結果、避免跨訪客污染),才
  真正需要 `userOrGuestFor` 這種「給訪客一個穩定 id」的設計。純查詢
  端點不需要這個穩定性。

**結論**:`userOrGuestFor` 模式不應該無差別套用到所有端點——它是為
「需要跨請求關聯同一訪客」的場景設計的,對純查詢端點,沿用
`clientIP(r)` 當 key 的現有 IP 節流模式反而更貼合需求、不需要新增
`X-Guest-Id` 這個前端狀態。

## 3. 使用次數限制的設計選項

這是這份文件的重點。目前 `planAiChatIPRateLimiter` 等既有機制是**節流**
(rate limit,控制「多快」),不是**配額**(quota,控制「總共多少」)——
`plan_ai_chat.go` 開頭的註解明確寫過「這次先不做配額限制」。以下是把
節流升級成真正配額限制時的方案比較。

### 3a. 儲存方案比較

| 方案 | 做法 | 優點 | 缺點 | 適用情境 |
|---|---|---|---|---|
| **純記憶體計數器**(沿用現有 `apigateway.RateLimiter` 模式) | 比照 `planAiChatIPRateLimiter`,用 `sync.Map` 存 key → 視窗內計數,靠 `maybeSweepLocked` 惰性過期 | 實作成本最低(複用既有元件);沒有額外的資料庫寫入延遲/負載 | **重啟後配額清零**(Cloud Run 常態性重啟/多實例部署會重置);**多實例間不共享狀態**——目前專案部署在 Cloud Run,若有多個 instance,每個 instance 各自一份計數,訪客打中不同 instance 等於拿到數倍配額,見 `docs/research-multi-instance-limitations-2026-09.md` 提到的既有限制類別 | 只需要「短時間窗口內別被打爆」的節流情境(現有 IP rate limiter 就是這個定位),**不適合**拿來做「每日用量上限」這種需要跨重啟/跨 instance 持久的配額 |
| **持久化配額**(存資料庫,例如新增 `guest_usage_quota` 表,或用 Redis) | 每次請求前查詢/寫入一筆「guest_id + 日期 + 計數」記錄,超過上限拒絕 | 重啟/多 instance 都能拿到一致的配額視圖;可以做真正的「每日 N 次」這種語意;可以後台查詢/人工調整(比照 `geo_rate_limits` 表已經有的後台可調整模式) | 每次請求多一次 DB 讀寫(延遲、負載);若用現有 Postgres/SQLite(`internal/store`)需要處理並發寫入的 race(兩個請求同時讀到「還有 1 次額度」各自扣減,可能超賣)——需要用 `UPDATE ... WHERE count < limit RETURNING` 這類原子操作,或資料庫層的唯一約束/樂觀鎖;若改用 Redis,專案目前完全沒有 Redis 依賴,屬於新增基礎設施的決定,需要額外評估維運成本 | 需要真正的「每日/每使用者配額」語意時的首選,但要先決定資料庫原子操作怎麼寫,避免並發超賣 |
| **混合式**(記憶體節流擋短時間爆量 + 資料庫配額管長期總量) | 兩層疊加:先用現有 `apigateway.RateLimiter` 的 IP/guest-id 節流擋掉短時間內的灌爆(像現在 `planAiChatIPRateLimiter` 做的事),通過節流的請求才去檢查/扣減資料庫配額 | 短時間爆量不會每次都打資料庫(省掉大部分 DB 負載);長期配額仍有持久保證;符合現有「節流管速度、配額管總量」分工清楚的既有架構慣例(對照 `geo.RateLimitConfig` 的拒絕型限流 vs. `geoRateLimitPhotoMediaDailyMax` 每日總額度這兩層已經並存的既有設計) | 比單一方案多一層邏輯要維護,但沿用的是專案已經存在的既有分層慣例(`places.photoMedia` 端點本來就同時有「60 秒視窗 60 次」與「每日總額度上限」兩層,見 `cmd/server/main.go` 的 `geoRateLimitPhotoMediaDailyMax`),不是新發明的架構 | 建議的預設方向——不需要引入 Redis,複用既有 `geo_rate_limits`/`geoRateLimitPhotoMediaDailyMax` 那種「DB 存配額設定與每日計數,記憶體限流擋瞬間爆量」的既有模式,只是把對象從「Google API endpoint」換成「guest id/IP」 |

### 3b. 配額的維度選擇

- **以 guest id 為單位**:語意上最貼近「每個訪客」,但如 2c 與下方 3e
  所述,guest id 是前端 localStorage 自己生成的值,清快取/換瀏覽器/
  無痕視窗都能拿到全新 id,**單獨用 guest id 做配額,防濫用效果非常
  有限**——只能擋住「同一個瀏覽器分頁內不清快取、短時間內用超過配額」
  這種最基本的情境。
- **以 IP 為單位**:比 guest id 更難繞過(換 IP 的成本遠高於清
  localStorage),但有 NAT/公司網路/校園網路多人共用同一對外 IP 的
  誤傷風險——`geoQueryIPThrottleMaxCalls`/`planAiChatIPThrottleMaxCalls`
  的既有註解已經討論過這個取捨,並選擇「維持跟 per-user 相同或略寬鬆
  的數字」來降低誤傷。
- **兩者疊加**(建議方向):guest id 配額負責「這個訪客自己用了多少」
  的體驗性限制(例如前端可以告知使用者「今天的免費次數用完了,登入
  可以看到更高額度」),IP 配額負責「這個來源總共消耗了多少」的防
  濫用兜底——疊加的理由與現有 `throttleGeoQueryByIP` 疊加
  `throttleGeoQueryByUser` 完全一致(見該函式開頭註解:「不同層保護
  不同範圍,不能互相取代」)。

### 3c. 配額重置週期

- **每日重置**:符合「免費體驗額度」的直覺(使用者心理模型是「明天
  再來」),但要注意時區定義(UTC 零點 vs. 使用者本地時間零點)——
  建議固定用 UTC,避免為了處理使用者時區位置而新增一個目前專案完全
  沒有的「訪客所在時區」判斷邏輯,增加不必要的複雜度。
- **每小時重置**:適合節流性質更重的情境(例如想更快地讓訪客能
  重新嘗試),但額度設計上要避免「每小時上限 x 24 小時」累積起來反而
  比每日配額更寬鬆,失去「配額」原本要限制的總量意義。
- **固定次數用完不重置**(例如「終身限 10 次」):最嚴格,適合「只是
  想讓訪客試用」而非「長期免登入可用」的產品定位,但要考慮這個固定
  次數要跟 guest id 綁定(存進資料庫),一旦訪客清快取拿到新 id 就
  等於重新獲得額度,等同沒有真正做到「終身」限制——這進一步印證下方
  3e 要談的「不能只靠 guest id 當防濫用手段」。

這三種週期不是互斥的,可以用「guest id 終身限 N 次 + IP 每日限 M 次」
這種組合:guest id 這層給誠實使用者一個清楚的「免費試用額度用完了」
體驗提示,IP 這層防止真正想繞過限制的使用者無限刷新 id。

### 3d. 超過限制後的行為

- **直接拒絕 429**:現有 IP rate limiter 的既有行為(`writeErr(w,
  http.StatusTooManyRequests, ...)`)。適合節流情境(「你太快了,等一下
  再試」),但用在配額用完的情境會讓使用者誤以為是暫時性問題,過一下
  重試可能還是失敗,體驗不佳。
- **提示登入**:回應內容明確告知「訪客額度已用完,登入後可以繼續
  使用」,前端可以據此跳出登入提示——這比單純 429 更符合配額（而非
  速度限制）被觸發時該有的使用者體驗,也更貼合推廣登入轉換率的產品
  目的。建議新增一個獨立的錯誤碼(例如 `guest_quota_exceeded`,跟現有
  `rate_limited` 區分),讓前端能分流處理這兩種情境的 UI(節流 vs.
  配額用盡)。
- **降級成唯讀模式**:比照 `throttleGeoQueryByUser` 的既有分工模式——
  某些端點被配額擋下時,不是整個請求失敗,而是降級成「只回傳資料庫
  已有的資料,不再觸發需要配額保護的那一小段邏輯」(對應
  `handlePublicGeoAttractionSearch` 內部「被擋下時跳過 Google API 呼叫,
  但仍正常回傳資料庫候選」的既有降級慣例)。這個選項只適用於「配額
  保護的是端點內部一小段成本較高的邏輯,其餘部分仍可正常服務」的
  場景,不是所有端點都有「降級」這個選項可用(例如 AI 對話本身被配額
  擋下時沒有「降級」版本可以回,只能選前兩種)。

建議:配額用盡時優先選「提示登入」而非單純 429——這對訪客體驗更友善,
也更符合「訪客功能是為了降低使用門檻、最終導向註冊」的產品目的;
429 繼續保留給既有的「節流」情境(速度太快),不要跟配額用盡混用同一個
錯誤碼,否則前端無法分流處理。

### 3e. guest id 不是可靠的防濫用手段——必須搭配 IP 限制

這點要明確寫清楚,因為容易被誤判為「guest id 已經是 per-user 等級的
身分隔離,應該就夠用」:

- guest id 由前端(`web/src/guestId.ts`)在瀏覽器端生成、存
  localStorage,**沒有任何伺服器端驗證它「真的對應同一個使用者」**——
  `userOrGuestFor` 的格式檢查只確認前綴正確,不查資料庫,不驗證這個
  id 是否之前出現過。
- 清除 localStorage、切換到無痕視窗、換一台裝置、甚至只是切換瀏覽器,
  都能讓前端生成一個全新的 guest id,從伺服器的角度看就是「一個全新
  的訪客」,配額重新計算。
- 這正是 `planAiChatIPRateLimiter`/`geoQueryIPRateLimiter` 現有設計
  **已經承認並處理過**的限制——這兩個既有欄位的註解都明確寫著
  「X-Guest-Id 是前端存在 localStorage 的值,清掉 localStorage 或換一個
  瀏覽器/無痕視窗就能拿到全新的 id、繞過 per-user 節流」,因此才疊加
  IP 節流作為兜底。
- 使用次數限制(配額)要延續同樣的設計原則:**guest id 配額只能當
  「誠實使用者的體驗提示層」,IP 配額才是真正的防濫用兜底**。單靠
  guest id 做配額限制,等於把防濫用的責任完全交給「使用者不會主動
  繞過限制」這個不能成立的假設——任何想繞過限制的人都能在幾秒內
  清掉 localStorage 拿到新額度,配額形同虛設。
- IP 限制本身也不是毫無懈可擊(前面提過的 NAT/多人共用 IP 誤傷問題,
  以及想繞過限制的人一樣可以換行動網路、用 VPN 換 IP),但比起
  guest id,成本/便利性門檻高得多,足以擋住「大多數」隨手繞過的情況,
  是目前在不引入更複雜的裝置指紋/驗證碼等機制前,相對務實的折衷。
- 若未來濫用情況仍然嚴重,下一步可以考慮的加強手段(超出這次構想
  範圍,先記錄方向供參考):裝置指紋(fingerprinting,涉及隱私權衡,
  需要額外評估合規性)、要求訪客完成驗證碼(CAPTCHA)才能繼續使用、
  或把某些高成本端點的訪客版直接下線,只留一般節流、不提供「配額用完
  才擋」這種更寬鬆的模式。

## 4. 下一步建議(非定案,僅供討論方向)

1. ~~若要繼續推進,建議先從 1b 盤點出的個位數候選端點做第一輪訪客化~~
   ——**2026-10-17 已完成第一輪**:`attractions/nearby-only`、
   `attractions/nearby` 兩支已新增公開版(見 1b 各自條目),驗證了「新增
   獨立節流池」(`geoAttractionsIPRateLimiter`,比照既有 `geoQueryIPRateLimiter`
   寫法)與「路徑衝突時停下來问人決定、不擅自覆蓋既有端點」這兩個實作
   判斷都可行。尚未做「中介層抽換」(2b)——目前仍是逐條路由各自疊加
   `withXxxThrottle` wrapper,沒有到需要統一中介層的端點數量規模。
2. 配額機制(3a 的「混合式」方向)**尚未實作**,仍是構想——這次只做了
   既有節流模式(短時間窗口限流)的擴充,沒有新增配額(每日/總量限制)
   這個維度,繼續推進前仍需要先決定儲存方案(見 3a)。
3. 任何新增 `/public/*` 路由,務必同步檢查
   `server/cmd/server/main.go` 的 `mux.Handle` 轉發——這是已經連續踩過
   三次的已知陷阱,**2026-10-17 這次確認 `/public/geo/` 已有前綴轉發
   (`mux.Handle("/public/geo/", srv.Routes())`)**,新增路由不需要額外
   修改 main.go,但下次若新增的路徑不在既有前綴底下,仍要重新檢查一次,
   不能假設「這次不用改就永遠不用改」。
