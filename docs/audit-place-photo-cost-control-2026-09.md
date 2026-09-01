# 地點照片漸進補圖機制成本稽核 — tripace（2026-09 快照）

本文件是針對「地點照片漸進補圖機制」（`server/internal/api/geo_outline.go` 的
`handleGeoPlaceDetails` 一般模式，2026-09 隨 `feature/place-photo-progressive-loading`
分支新增）所做的一次性成本控制稽核，聚焦「有沒有路徑能讓這套節流機制失效或被
繞過，導致短時間內對 Google Photo Media API（依張數計費，Enterprise 級，每月
1,000 次免費額度，超過 $20/1000 起）觸發大量呼叫」。

依 `doc-file-format` skill 慣例，`audit-*` 字首本應是持續追蹤、不帶日期的活文件；
這份文件例外帶日期（`-2026-09`）視為一次性快照，理由是這次稽核的主題（單一
機制的成本推演）範圍明確、不預期像 `audit-security.md`/`audit-functional.md`/
`audit-stability.md` 那樣需要跨多次複核持續追蹤同一批項目。若之後對這套機制
再次稽核，建議直接更新本檔案（比照 audit-* 的「現況（日期複核）」慣例），不要
另開新日期檔案。

**與既有稽核文件的關係**：`docs/audit-security.md` 的 **S9「完全沒有 rate
limiting」** 已經記錄「內部端點完全沒有任何請求頻率限制」這個既有發現，本文件
問題 1 的結論是 S9 在這支特定端點（`GET /internal/geo/place-details`）上的
具體成本後果延伸，不重複計入 S9 的嚴重度分級，僅在此交叉引用。

嚴重度標記：🔴 高｜🟡 中｜⚪ 低（比照 audit-* 既有慣例，這裡不用 critical，因為
最終防線 `GOOGLE_PLACES_FETCH_PHOTOS` 目前預設關閉，正式環境尚未真正暴露成本
風險）。

---

## 現況更新（2026-09，稽核後修補完成）

下方「逐項結論」與「風險嚴重度分級」維持原文不回頭改寫。修補隨
`feat: 地點照片查詢加上拒絕型速率限制與併發丟棄機制`（commit `f86480c`）
落地：

- **R1（全域無總量上限）：✅ 已解決**——新增拒絕型 `apigateway.RateLimiter`，
  `places.get` 10 秒/1 次、`places.photoMedia` 10 分鐘/1 次，超過直接拒絕
  不排隊。
- **同一 placeID 併發丟棄：已加強**——`singleflight`（等待共享結果）
  改為 `sync.Map` 搶佔丟棄（未搶到立即降級讀現有快取，不等待）。
- **`GOOGLE_PLACES_FETCH_PHOTOS` 全域開關：單點地點介紹路徑已改為不受
  控制**——該路徑改由上述兩層機制頂住成本，其餘 `PhotoDataURI` 呼叫端
  維持受開關控制。
- **R2（click_count 可被繞過）：🟡 部分緩解**——節流本身未變，但
  `places.photoMedia` 限流大幅拉長榨乾單一地點所需時間（約 50 秒 → 至少
  50 分鐘）。
- **R3（多 instance 放大攻擊面）：⚪ 未處理**——新機制同樣只在單一
  process 內生效，維持原文結論。

### 🟡 新發現（R4）：第一次查詢的地點若撞上 `places.get` 限流，會整體降級成空白卡片，Pexels 也不會顯示

**這是本次修補新引入的問題，原始稽核未涵蓋**（因為當時 Pexels/Google 查詢
還沒有這種耦合關係）。`fetchAndCachePlaceDetails`（`geo_outline.go`）目前
把「查 Google 文字資訊」（`GetPlaceDetails`，受 `places.get` 拒絕型限流
保護）與「查 Pexels 照片」（免費、不受任何限流保護）寫成同一支函式裡的
循序步驟——`GetPlaceDetails` 若被限流拒絕（`ErrRateLimited`），函式立即
`return error`，**Pexels 查詢完全沒有機會執行**。

對「這個地點從未被查詢過」（`place_details_cache` 沒有這一列）的情況，
後續走 `buildDegradedPlaceDetailsResponse` 降級時，因為快取列不存在，
只能回傳完全空殼的 `placeDetailsResponse{}`——使用者會看到一張沒有名稱、
地址、照片（連 Pexels 這種免費、理應總是能查到的資料也沒有）的空白卡片。
`places.get` 限流視窗只有 10 秒/1 次，代表**只要 10 秒內有其他人也在
查詢任一個新地點，這次查詢就會落空**，體驗不算好但不算罕見。

修法方向（未實作，供之後決策）：讓 Pexels 查詢獨立於 `GetPlaceDetails`
是否成功之外執行（例如就算 Google 文字查詢被限流，仍嘗試查一次 Pexels
並寫入快取），這樣至少能在沒有名稱/地址的情況下先顯示照片，之後使用者
重新點擊（觸發新的 `GetPlaceDetails` 嘗試）就能補上文字。

### 🟡 新發現（R5）：快取命中分支完全沒有「Pexels 缺圖時補查」機制，跟 Google 端的持續補圖節奏不對稱　✅ 已解決（commit `5055c5d`）

**已解決**：新增 `ensurePexelsPhotos`，快取命中/降級回應分支都會在
「Pexels 沒圖且 Google 也沒圖（`cached.NewPhotoCount == 0`）」時嘗試
補查一次，獨立於 Google 端節流之外——只有兩個來源都沒圖、卡片真的會
顯示空白時才觸發，Google 已有圖時不多打這次外部呼叫。

**已實測重現（修復前）**：手動清空某地點的 `google_place_photos`/`place_pexels_photos`
兩張表（保留 `place_details_cache` 本身這一列），重新點擊該地點，卡片
確實顯示為空白（無 Google 圖、無 Pexels 圖）。

根因：`handleGeoPlaceDetails` 快取命中分支（`geo_outline.go` 第 1263 行
附近）裡，Pexels 照片只是單純的 `ListPlacePexelsPhotos(placeID)` 讀取
（第 1380 行），**不論讀出來是不是空陣列都直接使用，沒有任何「發現是空的
就補查一次」的邏輯**——跟同一個分支裡 Google 端「點擊節奏 OR 7 天時間」
雙觸發、持續嘗試重新確認/補圖的機制形成明顯不對稱。Pexels 查詢只會在
`fetchAndCachePlaceDetails`（初次查詢，資料庫完全沒有這個 placeID 時）
發生恰好一次；之後不論這次查詢成功、失敗、或像本次實測一樣資料被清空，
快取命中分支都不會再嘗試。

觸發情境不只是本次刻意清空資料庫這種人為操作——初次查詢時 Pexels 查無
結果（`pExels.Search` 回傳 `ok=false`，例如地點名稱在 Pexels 圖庫沒有
匹配的示意圖）是完全合理、會實際發生的情況，一旦發生，這個地點就永久
沒有 Pexels 照片可顯示，沒有任何重試機制。

修法方向（未實作，供之後決策）：在快取命中分支比照 Google 端的節奏，
加上「`PexelsPhotoURLs` 為空且符合觸發條件（例如點擊節奏或時間視窗）時
補查一次 Pexels」的邏輯——Pexels API 免費，不需要跟 Google 端一樣嚴格
的節流保護，可以用比 Google 端更寬鬆的觸發頻率（甚至「只要目前是空的
就每次點擊都嘗試」也是可接受的成本，因為沒有計費風險，只是要避免真的
查無結果時每次點擊都重複打 Pexels API 造成不必要的外部呼叫）。

### 🔴 新發現（R6）：`textStale` 與照片補圖判斷共用同一個限流 key，兩者同時觸發時照片補圖必然被自家限流器擋下

**這是這次新增速率限制機制自己造成的自我矛盾，嚴重度高於 R4/R5——不是
邊界情況才發生，是「兩個判斷式同時成立」時 100% 必然發生，不是機率性
問題。**

根因（已逐行追查程式碼與 endpoint 字串確認）：

- `GetPlaceDetails`（`textStale` 分支使用，`geo_outline.go` 第 1220 行）
  與 `ListPlacePhotoRefs`（照片補圖判斷使用，第 1320 行）在
  `server/internal/geo/places.go` 底層都呼叫
  `c.gateway.Do(ctx, req, "places.get", ...)`——**共用完全相同的 endpoint
  字串 `"places.get"`**。
- 兩者都透過 `s.newPlaceDetailsClient(apiKey)`（預設即 `geo.New`）取得
  client，而 `geo.New` 內部使用的是 process 唯一的單例
  `defaultGateway()`——這代表兩者**共用同一個 `apigateway.Gateway`
  實例，也共用同一個掛在其上的 `RateLimiter` 實例**。
- 這次修補設定 `places.get` 的拒絕型限流視窗是 **10 秒最多 1 次**
  （`geo.RateLimitConfig`／`main.go` 預設值）。
- 「逐項結論」問題 4 已經記錄過：`textStale`（第 1206 行）與
  `clickTriggered || timeTriggered`（第 1305 行）是兩個獨立求值的判斷式，
  程式碼**允許兩者在同一次請求中都成立**（這是原始設計刻意如此，且有
  詳細註解解釋為什麼不能綁在一起）。

當兩者確實在同一次請求中都成立時，執行順序是：

1. 第 1206 行 `textStale` 分支先執行，呼叫 `GetPlaceDetails`（`places.get`）
   ——**用掉這 10 秒視窗僅有的 1 次額度**。
2. 第 1305 行照片補圖分支接著執行，呼叫 `ListPlacePhotoRefs`（同樣是
   `places.get`）——**此時同一個 `RateLimiter` 已經沒有額度可放行**，
   必然回傳 `apigateway.ErrRateLimited`。
3. 第 1321 行 `if refsErr == nil` 為假，整段照片補圖邏輯被**吞掉錯誤、
   略過**——不是因為判斷「這次不該補圖」，而是被同一次請求裡稍早那次
   `GetPlaceDetails` 用光了限流額度，屬於誤傷。

**影響範圍**：任何「熱門地點 24 小時窗口重新打開後第一次被點擊、且剛好
命中補圖節奏」的情境（問題 4 描述的既有案例），這次修補之後都會讓照片
補圖判斷必然失敗，不會真的去確認/更新 Google 照片——這條路徑等於被這次
新加的限流機制**意外關閉**了，且沒有任何錯誤訊息或日誌能區分「這次是
真的不該補圖」還是「被自己人擋下來」。

**已查證關鍵事實（推薦修法，見選項 2）**：`GetPlaceDetails` 目前使用的
`placeDetailsFieldMask`（`server/internal/geo/places.go` 第 257 行）內容
是 `"displayName,formattedAddress,location,rating,photos,editorialSummary"`
——**本來就包含 `photos`**，回應天生就帶有完整的 `photos[]` 陣列，跟
`ListPlacePhotoRefs`（`photoRefsFieldMask = "photos"` 窄遮罩版）能拿到的
是同一份資料。而 Google Places API (New) 是依 field mask 分級整批計費
（Essentials/Pro/Enterprise），不是按欄位數量計費，只要遮罩含 `photos`
就整批算 Enterprise 級——故「只查 photos」跟「查完整欄位+photos」**費用
完全相同**，沒有理由分開查兩次。

修法方向（未實作，供之後決策）：

1. **（推薦）`textStale` 觸發時直接把 `GetPlaceDetails` 回應的
   `details.PhotoRefs` 交給照片補圖判斷使用，不再另外呼叫
   `ListPlacePhotoRefs`**——两個判斷式改成共用同一次 API 呼叫的結果：
   若 `textStale` 這次已經觸發，`currentGoogleTarget` 直接用
   `len(details.PhotoRefs)`（跟 `fetchAndCachePlaceDetails` 初次查詢的
   既有寫法一致，見該函式第 1651 行），完全不需要再打
   `ListPlacePhotoRefs`；只有當 `textStale` 沒觸發、但照片補圖判斷觸發
   時，才需要單獨打一次（這時反正沒有 `textStale` 用掉額度，不會撞
   限流）。這個修法不只解決 R6 的額度衝突，還能在兩者剛好同時觸發時
   省下一次外呼（原本兩次變一次），是目前評估下最乾淨的方案，且已確認
   技術上完全可行（field mask 本來就含 photos，不需要改動任何請求
   參數）。
2. **`ListPlacePhotoRefs` 改用獨立的 endpoint 字串**（例如
   `"places.photoRefs"`），讓它跟 `GetPlaceDetails` 的 `"places.get"`
   分開計算限流額度——次要方案：不解決「兩次查詢重複」的浪費，只是讓
   兩者不再互相排擠，且需要重新評估這支查詢該歸類為「地點資訊」還是
   「地點照片」分組。
3. **接受現狀，僅記錄**：這個情境的實際發生頻率取決於「文字 24 小時
   窗口」與「照片點擊/7 天窗口」剛好重疊的機率，可能不算高頻，但一旦
   發生就是必然失敗，建議至少加一筆日誌記錄這種「被限流跳過」的情況，
   方便之後觀察實際發生頻率再決定要不要修。

---

## 稽核方法

完整讀過以下檔案的相關函式與註解：

- `server/internal/api/geo_outline.go`：`handleGeoPlaceDetails`、
  `fetchAndCachePlaceDetails`、`decidePlacePhotoAction`、
  `shouldAddGooglePlacePhoto`、`resetPhotoProgressOnTargetChange`
- `server/internal/store/geocache.go`：`IncrementPlaceClickCount`、
  `UpdatePlacePhotoProgress`
- `server/internal/apigateway/apigateway.go`：全域 Gateway 節流實作
- `server/cmd/server/main.go`：`GOOGLE_PLACES_FETCH_PHOTOS`/`geo.SetPhotosEnabled`
  開關邏輯、`apigateway.Config` 預設值
- `server/internal/api/middleware.go`：確認掛載的 middleware 清單
- `server/internal/api/geo_outline_place_photo_progress_test.go`：既有測試涵蓋範圍
- `web/src/geo-planning/GeoListItemCard.tsx`（`photoOnly` 模式實際呼叫端，
  即任務描述中的 `GeoHotelSidebar.tsx` 延遲載入邏輯所在檔案）

---

## 逐項結論

### 問題 1：端點本身有沒有速率限制　✅ 已解決，見上方「現況更新」

**摘要**：沒有 per-user/per-IP rate limit，只有全域 `Gateway` 排隊節流
（`MaxConcurrency=1`、`MinInterval=2s`，不分 endpoint 共用一份額度）——
排隊等待，不是拒絕，故只要攻擊持續夠久，累積呼叫量沒有上限（推演：1000
個不同 place_id 各發一次請求，約 67 分鐘後全數送出，足以吃光月免費額度）。
現已疊加拒絕型 `RateLimiter` 解決，細節見上方「現況更新」。

### 問題 2：`click_count` 節流本身能不能被繞過　🟡 部分緩解，見上方「現況更新」

**摘要**：`shouldAddGooglePlacePhoto` 是「持續觸發」而非「觸發一次就停」
的機制——`IncrementPlaceClickCount` 純粹原子遞增、不檢查來源真實性，
連續高頻請求會依 `click_count % (newPhotoCount+1)²==0` 的遞減節奏持續
觸發，直到補到追平該地點 Google 實際照片張數為止（例如 target=5 的地點，
約 25 次請求、50 秒內即可被榨乾）。最大暴露量等於該地點實際照片數，
相對有界，但非「至多觸發 1 次」。現已疊加 `places.photoMedia` 拒絕型
限流大幅拉長榨乾所需時間，細節見上方「現況更新」。

### 問題 3：`singleflight` 的合併範圍是否足夠　✅ 已解決，見上方「現況更新」

**摘要**：`singleflight` 只合併同一 placeID 的併發請求，對「大量不同
地點」攻擊模式完全無防禦力（這本非其設計目標）；且只在單一 process 內
生效，多 instance 部署下每個 instance 各自一份節流狀態，攻擊面隨
instance 數量等比放大。同一 placeID 併發丟棄機制已改用 `sync.Map` 搶佔
式丟棄取代，細節見上方「現況更新」；多 instance 放大問題（R3）維持
未處理。

### 問題 4：`textStale` 分支是否有意外放大成本

**結論：`textStale`（24 小時文字新鮮度）與「照片 target 重查」（點擊節奏 OR
7 天時間）兩個判斷式在程式碼裡確實是相互獨立、可能在同一次請求中都成立
並疊加觸發，但兩者各自呼叫的都是「有限合理」頻率的 API（textStale 每個地點
最多 24 小時 1 次；照片 target 重查則依問題 2 的節奏遞減），疊加後單次請求
最多觸發：1 次 GetPlaceDetails（文字）+ 1 次 ListPlacePhotoRefs（target 確認）
+ 至多 1 次 PhotoDataURI（實際補圖）= 最多 3 次外呼。這不是「無界放大」，
但確實比原本設計者可能預期的「一次點擊、一次判斷」要多——熱門地點在 24 小時
窗口重新打開後第一次被點擊時，成本是三個獨立判斷式加總，而非其中一個。

具體情境：首頁固定展示的熱門景點，若同時符合「24 小時未刷新文字」與「點擊
節奏剛好命中」，一次使用者點擊會依序觸發：

1. `textStale` 分支：`GetPlaceDetails`（Enterprise 級，`geo_outline.go:1204`）
2. `clickTriggered` 分支：`ListPlacePhotoRefs`（Enterprise 級同等計費，
   `geo_outline.go:1304`）
3. 若 `decidePlacePhotoAction` 判定 `shouldFetch=true`：`PhotoDataURI`
   （依張數計費，`geo_outline.go:1328`）

三者獨立判斷式、各自求值，程式碼確實允許三者在同一次請求中全部成立
（`geo_outline.go:1195` 的 `textStale` 判斷式與 `geo_outline.go:1289` 的
`clickTriggered || timeTriggered` 判斷式之間沒有互斥關係，且執行順序上
`textStale` 分支先跑完才會進入照片判斷）。這是**設計者在註解中已經明確
承認並解釋過的取捨**（見 `geo_outline.go:1181-1194` 的完整說明：「故意不
綁死在同一個 24 小時開關上」），不是疏漏——但註解本身沒有量化過「疊加後
最多 3 次外呼、對熱門地點 24 小時窗口首次點擊而言是合理成本」這件事，值得
在此明確記錄為一個已知、可接受、但沒有正式量化過上限的設計决策。

**風險評估**：熱門地點數量有限（首頁固定展示），且疊加只發生在「該地點 24
小時內第一次被點擊」這個時間窗口，之後 24 小時內的其他點擊不會重複觸發
`textStale`（`fetched_at` 已被兩個分支各自刷新）。故此路徑不構成「大量觸發」
風險，但仍建議在文件中記錄清楚，避免未來誤判為 bug 而在不了解設計取捨的情況
下把兩個判斷式合併，反而導致問題 1191-1194 註解描述過的「7 天時間觸發條件
永遠打不到」的舊 bug 復發。

### 問題 5：`photoOnly=1` 模式有沒有獨立的成本風險

**結論：程式碼確認 `photoOnly=1` 模式完全不會觸發 Google Photo Media 下載，
與註解宣稱的行為一致；前端捲動觸發機制也有適當的一次性去重，無法繞道觸發
大量 Google 請求。**

已逐行核對 `handleGeoPlaceDetails` 的兩處 `photoOnly` 分支：

- **快取命中分支**（`geo_outline.go:1230-1245`）：只讀
  `ListPlacePexelsPhotos`，未命中才呼叫 `pexelsClient.Search`
  （純 Pexels API，免費），完全沒有任何 `client.GetPlaceDetails`/
  `ListPlacePhotoRefs`/`PhotoDataURI` 呼叫。
- **快取未命中分支**（`geo_outline.go:1391-1406`）：只呼叫
  `pexelsClient.Search`，查無結果直接回空 `photoOnlyResponse{}`，**沒有
  fallback 到任何 Google API**——與註解宣稱「查無結果就回空，不 fallback
  Google GetPlaceDetails/Photo Media」完全一致，程式碼行為與註解沒有落差。

前端呼叫端 `web/src/geo-planning/GeoListItemCard.tsx`（對應任務描述提到的
`GeoHotelSidebar.tsx` 延遲載入邏輯，實際程式碼收斂在這支共用元件裡）：

- `IntersectionObserver` 一旦 `isIntersecting` 為 true，**立刻呼叫
  `observer.disconnect()` 才發送查詢**（`GeoListItemCard.tsx:93-94`），
  避免同一元素反覆進出視窗時重複查詢。
- `useEffect` 的依賴陣列 `[placeId, photoUrl]`（`GeoListItemCard.tsx:106`）：
  `photoUrl !== undefined` 時整段 effect 直接 return（第 83 行），即「已經
  查過（不論有沒有查到）就不再 observe」，符合「查一次就不再查」的預期。
  查詢結果透過 `onPhotoLoaded` 回寫到呼叫端集中管理的 `photoCache`
  （見元件註解），同一個 placeId 在清單中重新渲染也不會重複觸發。

清單本身筆數上限已經在候選查詢階段被截斷（`maxGeoGeocodeCandidates=20`，
`geo_outline.go:517`），即使使用者瘋狂捲動，最多也只有 20 個獨立元素各自
觸發一次 `IntersectionObserver` 回呼，且每個回呼都只查 Pexels（免費）。
**這條路徑在現有程式碼下,不論怎麼操作都不會產生任何 Google Photo Media
計費呼叫**，唯一的成本是 Pexels API 呼叫次數（免費層級），風險等級低。

### 問題 6：`GOOGLE_PLACES_FETCH_PHOTOS` 全域開關的防護邊界　✅ 已解決，見上方「現況更新」

**摘要**：`geo.SetPhotosEnabled`（process 級唯一全域開關，關閉時直接擋下
所有 Photo Media 下載，零成本）確認是當時唯一的「總量硬上限」防線——一旦
打開，沒有任何每日/每月配額計數器，只剩「限速非限量」的 `Gateway` 與
「有界但非零」的 `click_count` 節流，是核心設計缺口。單點地點介紹路徑
現已改為繞過此開關、改由拒絕型限流機制頂住成本，細節見上方「現況更新」；
其餘呼叫端維持受此開關控制不變。

---

## 風險嚴重度分級與修法建議

**以下是原始稽核當下的發現與建議，不回頭修改——已處理項目見上方「現況
更新」章節的狀態標記，此處保留完整原文供對照。**

### 🔴 高風險（建議在正式開啟 `GOOGLE_PLACES_FETCH_PHOTOS` 之前處理）

**R1：全域無總量上限,`GOOGLE_PLACES_FETCH_PHOTOS` 開啟後理論上可被無上限
耗用（對應問題 1、3、6）　✅ 已解決，見上方「現況更新」**

當時列出三種修法選項（配額計數器／per-user rate limit middleware／僅加
監控告警），最終採用等價於選項 1 精神、但更輕量的拒絕型視窗限流器實作，
細節見上方「現況更新」。

### 🟡 中風險

**R2：`click_count` 節流可被腳本繞過真實使用者互動,單一地點最大暴露量
等於該地點 Google 實際照片張數(對應問題 2)　🟡 部分緩解，見上方「現況更新」**

當時列出三種修法選項（rate limit middleware／同 placeID 短時間去重／
接受現狀），最終未直接處理 `click_count` 本身，而是透過 `places.photoMedia`
拒絕型限流間接大幅拉長榨乾單一地點所需時間，等價於選項 1 的精神，細節
見上方「現況更新」。

**R3：多 instance 部署下,全域 Gateway 節流與 singleflight 合併範圍都是
process 內生效,實際攻擊面隨 instance 數量等比放大(對應問題 3)　⚪ 未處理，見上方「現況更新」**

- 現況:`docs/research-multi-instance-limitations-2026-09.md` 已記錄此
  既有限制,本文件延伸指出這對「成本控制」的具體後果——攻擊者若能讓
  請求分散打到不同 Cloud Run instance,每個 instance 各自的 2 秒節流
  間隔會疊加成「instance 數量 × 每 2 秒 1 次」的實際總速率。
- 修法選項:需要跨 instance 共享狀態(例如改用 Redis 實作分散式節流器/
  singleflight),屬於較大的架構改動,建議與 R1 的配額機制一併規劃(配額
  計數器天然需要跨 instance 共享的儲存層,若要做,建議兩者一起設計)。

### ⚪ 低風險 / 已確認無問題

**問題 4(textStale 疊加):設計者已知取捨,非疏漏**

- 疊加後單次請求最多 3 次外呼(GetPlaceDetails + ListPlacePhotoRefs +
  PhotoDataURI),且只發生在熱門地點 24 小時窗口內首次點擊,範圍有界。
  建議:無需修改程式碼,但建議在 `geo_outline.go` 現有註解基礎上,補充
  一句量化說明(「疊加後最多 3 次外呼」),避免未來被誤判為 bug。

**問題 5(photoOnly 模式):已逐行驗證程式碼與註解一致,無風險**

- 快取命中/未命中兩個分支都已確認完全不呼叫任何 Google Photo Media
  API,前端 `IntersectionObserver` 一次性去重機制正常運作,清單筆數上限
  (20 筆)在候選查詢階段已截斷。此路徑不需要任何修法動作。

---

## 附錄:關鍵程式碼位置索引

| 主題 | 檔案:行號 |
|---|---|
| `handleGeoPlaceDetails` 一般模式主流程 | `server/internal/api/geo_outline.go:1115-1433` |
| 快取命中分支(textStale/clickTriggered/timeTriggered) | `server/internal/api/geo_outline.go:1169-1366` |
| `fetchAndCachePlaceDetails`(初次查詢) | `server/internal/api/geo_outline.go:1439-1569` |
| `shouldAddGooglePlacePhoto` | `server/internal/api/geo_outline.go:1591-1605` |
| `decidePlacePhotoAction` | `server/internal/api/geo_outline.go:1639-1655` |
| `resetPhotoProgressOnTargetChange` | `server/internal/api/geo_outline.go:1612-1614` |
| `photoOnly` 快取命中分支 | `server/internal/api/geo_outline.go:1230-1245` |
| `photoOnly` 快取未命中分支 | `server/internal/api/geo_outline.go:1391-1406` |
| `IncrementPlaceClickCount` | `server/internal/store/geocache.go:164-182` |
| `UpdatePlacePhotoProgress` | `server/internal/store/geocache.go:205-216` |
| `apigateway.Gateway.Do` / `waitForSlot` | `server/internal/apigateway/apigateway.go:114-170` |
| `apigateway.DefaultConfig`(併發 1、間隔 2 秒) | `server/internal/apigateway/apigateway.go:64-66` |
| `GOOGLE_PLACES_FETCH_PHOTOS` 開關 | `server/cmd/server/main.go:97-99,121-126` |
| `internalAuth`(僅 JWT 驗證,無 rate limit) | `server/internal/api/middleware.go:94-107` |
| `middleware.go` 掛載清單確認無 rate limit | `server/internal/api/middleware.go`(全文) |
| `singleflight.Do` 合併範圍 | `server/internal/api/geo_outline.go:1408-1422` |
| photoOnly 前端捲動觸發(一次性去重) | `web/src/geo-planning/GeoListItemCard.tsx:79-106` |
| 既有測試涵蓋情境 | `server/internal/api/geo_outline_place_photo_progress_test.go`(全文,見下方說明) |

**既有測試涵蓋範圍**:`geo_outline_place_photo_progress_test.go` 目前涵蓋
四種情境——快取未命中初次查詢(只下載 1 張)、快取命中無觸發(零成本)、
點擊節奏觸發、時間觸發、target 變動重置。**完全沒有涵蓋**本文件推演的
「連續高頻請求下單一地點被榨乾多次補圖」(問題 2)、「大量不同 place_id
各自觸發一次補圖」(問題 1)、「textStale 與照片 target 重查同時觸發疊加
成本」(問題 4)這幾種情境——這些是成本推演層級的問題,不是功能正確性
問題,現有測試套件設計目標本來就是驗證「決策邏輯有沒有被正確串接」而非
「壓力/濫用情境下的行為」,故未涵蓋不代表既有測試有缺陷,但若日後要落地
R1/R2 的修法,建議一併補上對應的迴歸測試。
