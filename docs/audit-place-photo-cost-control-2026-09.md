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

嚴重度標記：🔴 高｜🟡 中｜⚪ 低（比照 audit-* 既有慣例，這裡不用 critical，因為
最終防線 `GOOGLE_PLACES_FETCH_PHOTOS` 目前預設關閉，正式環境尚未真正暴露成本
風險）。

2026-10-16 複核：對照 main @ 4f14828 逐項檢查，已移除 5 項已修復/已過時的發現
（R1、R5、問題 1、問題 3、問題 6）。保留項目底下的「**現況（2026-10-16 複核）**」
是本次複核補上的說明，其餘文字維持 2026-09 原文；原文中提到的 `geo_outline.go`
行號、函式名（`ListPlacePhotoRefs`、`shouldAddGooglePlacePhoto` 等）在
2026-10 補圖節奏改版後多半已位移或不存在，請以各項的現況說明與附錄索引為準。

---

## 現況更新（2026-09，稽核後修補完成）

下方「逐項結論」與「風險嚴重度分級」保留 2026-09 原文，已解決的項目已於
2026-10-16 複核時移除。修補隨 `feat: 地點照片查詢加上拒絕型速率限制與併發丟棄機制`
落地（文中記載的 commit `f86480c` 在此 repo 內存在，但不在 main 的歷史上；
main 上對應的是 `a072cde`「地點照片漸進補圖機制，附拒絕型速率限制與併發丟棄」）：

- **R2（click_count 可被繞過）：🟡 部分緩解**——節流本身未變，但
  `places.photoMedia` 限流大幅拉長榨乾單一地點所需時間（約 50 秒 → 至少
  50 分鐘）。
  **現況（2026-10-16 複核）**：上述數字是 2026-09 初版參數（`places.photoMedia`
  10 分鐘/1 次）。目前預設已改為 `places.photoMedia` 60 秒/60 次、`places.get`
  60 秒/300 次，另有每日額度 `--geo-rate-limit-photo-media-daily-max`（預設
  100），且可由後台管理介面執行期調整（`server/cmd/server/main.go:100-104`、
  `server/cmd/server/geo_rate_limit.go:78-96`、`147-170`）；「約 50 分鐘」的
  推演不再成立，改由「60 次/分」與「每日 100」界定上限。
- **R3（多 instance 放大攻擊面）：⚪ 未處理**——新機制同樣只在單一
  process 內生效，維持原文結論。

### ⚪ 新發現（R4，2026-10-16 複核由 🟡 降為 ⚪）：第一次查詢的地點若撞上 `places.get` 限流，會整體降級成空白卡片，Pexels 也不會顯示

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

**現況（2026-10-16 複核）**：🟡 部分仍在。(1) 「Pexels 也不會顯示」的部分已
不適用——2026-09 起 Pexels 讀圖來源已整個移除（`geo_outline.go:1371-1373`、
`1637-1641` 的註解；`fetchAndCachePlaceDetails` 已無 Pexels 查詢），照片欄位
一律由 `applyPhotoAssetsAsSource`（`geo_outline.go:1042-1049`）讀 `photo_assets`。
(2) 「第一次查詢的地點撞上限流／同 placeID 併發被丟棄 → 空殼卡片」仍在：
`fetchAndCachePlaceDetails` 的 `GetPlaceDetails` 失敗即回傳錯誤
（`geo_outline.go:1567-1570`），handler 遇 `ErrRateLimited` 走
`buildDegradedPlaceDetailsResponse`，無快取列時回傳 `placeDetailsResponse{}`
空殼（`geo_outline.go:1439-1441`、`1523-1527`）；沒搶到 in-flight 的併發請求同樣
降級（`1457`）。(3) 「10 秒內有其他人查詢就會落空」不再成立：`places.get`
預設已放寬為 60 秒/300 次（`server/cmd/server/main.go:100-101`），故嚴重度降為
⚪。降級回應的註解自己也承認這個行為（`geo_outline.go:1504-1513`）。

### 🟡 新發現（R6，2026-10-16 複核由 🔴 降為 🟡）：`textStale` 與照片補圖判斷共用同一個限流 key，兩者同時觸發時照片補圖必然被自家限流器擋下

**這是這次新增速率限制機制自己造成的自我矛盾，嚴重度高於 R4——不是
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

**現況（2026-10-16 複核）**：🟡 部分仍在，機制已換形。(1) 原文描述的
`ListPlacePhotoRefs` 補圖判斷（`clickTriggered || timeTriggered`、
`shouldAddGooglePlacePhoto`）已被 2026-10 新補圖節奏取代：`handleGeoPlaceDetails`
快取命中分支現在以 `photoCapForClickCount`/`decidePlacePhotoRefreshIndex`
（`geo_outline.go:1656-1689`）決定，觸發時改呼叫 `backgroundFillPlacePhoto`
（`geo_outline.go:1094-1148`），該函式內部用 `client.GetPlaceDetails` 取得
`PhotoRefs`（`1105`），不再呼叫 `ListPlacePhotoRefs`（handler 內已無呼叫；僅剩
`geo/photo_sync.go:63` 的 `SyncPlacePhotos` 使用）。(2) 同樣的「兩次 `places.get`」
結構依舊存在：`textStale` 分支同步呼叫 `GetPlaceDetails`（`geo_outline.go:1312`），
同一次請求稍後觸發的背景補圖又呼叫一次 `GetPlaceDetails`（`1105`），兩者共用
`"places.get"`（`geo/places.go:1212`）同一個限流 key；推薦修法 1（把 `textStale`
已取得的 `details.PhotoRefs` 傳給 `backgroundFillPlacePhoto` 的
`knownPhotoRefs` 參數，該參數已存在，快取未命中路徑就是這樣用，見
`geo_outline.go:1633`）仍未套用到快取命中的 `textStale` 分支。(3) 「必然被擋」
不再成立：`places.get` 預設為 60 秒/300 次（`server/cmd/server/main.go:100-101`），
僅在後台把視窗調到極小時才會自我衝突，故降為 🟡（主要剩下重複外呼的浪費）。
(4) 「沒有任何日誌」已改善：背景補圖失敗會 `log.Printf`（`geo_outline.go:1107`）。

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

### 問題 2：`click_count` 節流本身能不能被繞過　🟡 部分緩解，見上方「現況更新」

**摘要**：`shouldAddGooglePlacePhoto` 是「持續觸發」而非「觸發一次就停」
的機制——`IncrementPlaceClickCount` 純粹原子遞增、不檢查來源真實性，
連續高頻請求會依 `click_count % (newPhotoCount+1)²==0` 的遞減節奏持續
觸發，直到補到追平該地點 Google 實際照片張數為止（例如 target=5 的地點，
約 25 次請求、50 秒內即可被榨乾）。最大暴露量等於該地點實際照片數，
相對有界，但非「至多觸發 1 次」。現已疊加 `places.photoMedia` 拒絕型
限流大幅拉長榨乾所需時間，細節見上方「現況更新」。

**現況（2026-10-16 複核）**：🟡 部分緩解，但機制已改版。原文的
`shouldAddGooglePlacePhoto` 遞減節奏公式（`click_count % (newPhotoCount+1)²==0`）
已不存在，改為 `photoCapForClickCount`：clickCount<10 上限 1 張、10~99 為 2 張、
之後每 100 次 +1（`geo_outline.go:1656-1661`），`decidePlacePhotoRefreshIndex`
（`1680-1689`）找 cap 範圍內第一個缺或過期的 index 補圖。`IncrementPlaceClickCount`
仍是不檢查來源真實性的原子遞增（`server/internal/store/geocache.go:175-193`），
腳本仍可靠灌 click_count 墊高 cap，故「可被繞過」的核心仍在；但新增了
per-user 200ms 節流（`throttleGeoQueryByUser`，`server/internal/api/api.go:402`，
handler 入口 `geo_outline.go:1236`）、`places.photoMedia` 60 次/分與每日額度
（見上方現況更新），最大暴露量仍以 Google 實際照片張數與上述限流為界。
另外新機制有一個原文沒有的副作用：cap 範圍內只要有一個 index「永遠補不到」
（例如該地點在 Google 端只有 1 張或 0 張照片，但 cap 已是 2 以上；或 0 張照片
的地點 cap=1、index 0 永遠不新鮮），每次點擊都會判定需要補圖並啟動背景任務
（`geo_outline.go:1365-1368`），而背景任務會先打一次 `GetPlaceDetails`
（`1105`）才發現 `indexToFetch >= len(refs)` 而靜默結束（`1117-1121`）——即
這類地點每次點擊都多一次 Enterprise 級 `places.get`，沒有任何「已確認沒有更多
照片」的記憶。


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

**現況（2026-10-16 複核）**：🟡 部分仍在，內容已改版。兩個獨立判斷式的結構
仍在，但具體呼叫已變：`textStale` 分支（`geo_outline.go:1298-1322`）仍同步呼叫
`GetPlaceDetails`；補圖判斷改為 `decidePlacePhotoRefreshIndex`（`1362-1369`），
觸發時由背景任務 `backgroundFillPlacePhoto` 再呼叫一次 `GetPlaceDetails`
（`1105`）加 `PhotoDataURIUnrestricted`（`1123`）——不再有 `ListPlacePhotoRefs`。
因此單次請求的上限仍是 3 次外呼，但組成變成「`GetPlaceDetails` ×2 + 1 次
Photo Media」，其中兩次 `GetPlaceDetails` 取得的是同一份資料（見 R6）。原文引用
的行號（1181-1194、1195、1204、1289、1304、1328）已全部位移，說明「故意不綁死」
的註解現在在 `geo_outline.go:1292-1297`。

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

**現況（2026-10-16 複核）**：🟡 部分仍在，且有一處與原結論不符。(1) Pexels 已
整個移除：快取命中分支現在只呼叫 `applyPhotoAssetsAsSource` 讀 `photo_assets`
（`geo_outline.go:1336-1340`），未命中分支直接回空 `photoOnlyResponse{}`
（`1407-1415`），兩處仍都不會觸發 Photo Media 下載，也不再有 Pexels 呼叫。
(2) **與原結論不符**：快取命中分支裡，`textStale` 判斷（`1298-1322`）排在
`photoOnly` 提前返回（`1336`）**之前**，所以 `photoOnly=1` 命中一筆超過 24 小時
的快取列時，仍會同步呼叫一次 `GetPlaceDetails`（Enterprise 級 `places.get`）。
原文說「完全沒有任何 `client.GetPlaceDetails` 呼叫」對快取命中分支已不成立；
`handleGeoPlacePhotoAssets` 的註解（`geo_outline.go:1166-1169`）也承認 photoOnly
並非零副作用。成本仍受 `places.get` 限流與每個列 24 小時一次的上限約束，且清單
上限仍是 20 筆（`maxGeoGeocodeCandidates`，現在在 `geo_outline.go:508`）。
(3) 前端 `GeoListItemCard.tsx` 已不存在，延遲載入邏輯抽成
`web/src/components/ListItemCard.tsx` 的 `useLazyPhotoObserver`（`84-118`）：
`isIntersecting` 後立即 `observer.disconnect()` 再觸發 `onLoadPhoto`
（`108-113`），`photoUrl !== undefined` 時不啟動 observer（`102`），一次性去重
機制仍在。

---

## 風險嚴重度分級與修法建議

**以下是原始稽核當下的發現與建議，保留 2026-09 原文；已修復的項目（原 R1）
已於 2026-10-16 複核時移除，其餘各項底下的「現況（2026-10-16 複核）」為本次
補上的說明。**

### 🟡 中風險

**R2：`click_count` 節流可被腳本繞過真實使用者互動,單一地點最大暴露量
等於該地點 Google 實際照片張數(對應問題 2)　🟡 部分緩解，見上方「現況更新」**

當時列出三種修法選項（rate limit middleware／同 placeID 短時間去重／
接受現狀），最終未直接處理 `click_count` 本身，而是透過 `places.photoMedia`
拒絕型限流間接大幅拉長榨乾單一地點所需時間，等價於選項 1 的精神，細節
見上方「現況更新」。

**現況（2026-10-16 複核）**：🟡 部分仍在，見問題 2 底下的現況說明（機制已改為
`photoCapForClickCount`，click_count 仍可被腳本灌高；限流參數已與原文不同）。

**R3：多 instance 部署下,全域 Gateway 節流與 singleflight 合併範圍都是
process 內生效,實際攻擊面隨 instance 數量等比放大　⚪ 未處理，見上方「現況更新」**

- 現況:`docs/research-multi-instance-limitations-2026-09.md` 已記錄此
  既有限制,本文件延伸指出這對「成本控制」的具體後果——攻擊者若能讓
  請求分散打到不同 Cloud Run instance,每個 instance 各自的 2 秒節流
  間隔會疊加成「instance 數量 × 每 2 秒 1 次」的實際總速率。
- 修法選項:需要跨 instance 共享狀態(例如改用 Redis 實作分散式節流器/
  singleflight),屬於較大的架構改動,建議與拒絕型限流／每日額度機制一併規劃(配額
  計數器天然需要跨 instance 共享的儲存層,若要做,建議兩者一起設計)。

**現況（2026-10-16 複核）**：⚪ 仍成立，但內容有變。(1) 拒絕型 `RateLimiter` 的
視窗計數仍是 process 內記憶體（`server/internal/apigateway/ratelimiter.go:104-132`
的 `windows` map），每個 instance 各算各的，總速率仍隨 instance 數量等比放大；
同 placeID 併發丟棄的 `placeDetailsInFlight` 也是 process 內 `sync.Map`
（`server/internal/api/api.go:146`）。(2) 原文「每 instance 每 2 秒 1 次」的
Gateway 排隊節流已不存在：`apigateway.DefaultConfig()` 現在是不限併發、不限間隔
（`server/internal/apigateway/apigateway.go:144-146`），總量保護完全依賴上述
拒絕型限流。(3) `docs/research-multi-instance-limitations-2026-09.md` 仍存在。

### ⚪ 低風險 / 已確認無問題

**問題 4(textStale 疊加):設計者已知取捨,非疏漏**

- 疊加後單次請求最多 3 次外呼(GetPlaceDetails + ListPlacePhotoRefs +
  PhotoDataURI),且只發生在熱門地點 24 小時窗口內首次點擊,範圍有界。
  建議:無需修改程式碼,但建議在 `geo_outline.go` 現有註解基礎上,補充
  一句量化說明(「疊加後最多 3 次外呼」),避免未來被誤判為 bug。

**現況（2026-10-16 複核）**：🟡 與原結論不同，見問題 4 底下的現況說明——外呼
組成已變為 `GetPlaceDetails` ×2 + Photo Media，其中兩次 `GetPlaceDetails` 重複
（見 R6），已不只是「設計者已知、可接受」的取捨。

**問題 5(photoOnly 模式):已逐行驗證程式碼與註解一致,無風險**

- 快取命中/未命中兩個分支都已確認完全不呼叫任何 Google Photo Media
  API,前端 `IntersectionObserver` 一次性去重機制正常運作,清單筆數上限
  (20 筆)在候選查詢階段已截斷。此路徑不需要任何修法動作。

**現況（2026-10-16 複核）**：🟡 結論需修正，見問題 5 底下的現況說明——快取命中
且文字超過 24 小時的 `photoOnly=1` 請求仍會呼叫一次 `GetPlaceDetails`，並非
「完全不呼叫任何 Google API」；Photo Media 部分的結論仍成立。

---

## 附錄:關鍵程式碼位置索引

（2026-10-16 複核：行號已更新為 main @ 4f14828 的位置；原有的
`shouldAddGooglePlacePhoto`／`decidePlacePhotoAction`／
`resetPhotoProgressOnTargetChange`／`UpdatePlacePhotoProgress`／`singleflight.Do`
已不存在，對應的列改為取代它們的新函式。）

| 主題 | 檔案:行號 |
|---|---|
| `handleGeoPlaceDetails` 一般模式主流程 | `server/internal/api/geo_outline.go:1235-1458` |
| 快取命中分支(textStale、補圖判斷) | `server/internal/api/geo_outline.go:1280-1376` |
| `fetchAndCachePlaceDetails`(初次查詢) | `server/internal/api/geo_outline.go:1558-1645` |
| `photoCapForClickCount`(取代 `shouldAddGooglePlacePhoto`) | `server/internal/api/geo_outline.go:1656-1661` |
| `decidePlacePhotoRefreshIndex`(取代 `decidePlacePhotoAction`/`resetPhotoProgressOnTargetChange`) | `server/internal/api/geo_outline.go:1680-1689` |
| `backgroundFillPlacePhoto`(背景補圖,內部呼叫 `GetPlaceDetails`) | `server/internal/api/geo_outline.go:1094-1148` |
| `photoOnly` 快取命中分支 | `server/internal/api/geo_outline.go:1336-1340`(其前的 textStale 在 `1298-1322`) |
| `photoOnly` 快取未命中分支 | `server/internal/api/geo_outline.go:1407-1415` |
| `IncrementPlaceClickCount` | `server/internal/store/geocache.go:175-193` |
| `apigateway.Gateway.Do` / `waitForSlot` | `server/internal/apigateway/apigateway.go:206-255`、`261-287` |
| `apigateway.DefaultConfig`(現為不限併發、不限間隔) | `server/internal/apigateway/apigateway.go:144-146` |
| 拒絕型 `RateLimiter`(`NewRateLimiter`/`SetLimitForKey`/`Allow`) | `server/internal/apigateway/ratelimiter.go:104-208` |
| `places.get` / `places.photoMedia` 限流預設值與每日額度 flag | `server/cmd/server/main.go:100-104` |
| `GOOGLE_PLACES_FETCH_PHOTOS` 開關 | `server/cmd/server/main.go:168-170,315-320` |
| `internalAuth`(僅 JWT 驗證,無 rate limit) | `server/internal/api/middleware.go:138-167` |
| per-user 200ms 節流 `throttleGeoQueryByUser`(各 handler 入口顯式呼叫,不是 middleware) | `server/internal/api/api.go:402-409` |
| `middleware.go` 掛載清單確認無 rate limit | `server/internal/api/middleware.go`(全文,2026-10-16 複核仍無 rate limit middleware;節流改在各 handler 內呼叫) |
| 同 placeID 併發丟棄(取代 `singleflight.Do`) | `server/internal/api/geo_outline.go:1430-1457`、`1477-1489`(`tryClaimPlaceDetailsInFlight`/`releasePlaceDetailsInFlight`),欄位 `server/internal/api/api.go:146` |
| photoOnly 前端捲動觸發(一次性去重) | `web/src/components/ListItemCard.tsx:84-118`(`useLazyPhotoObserver`;原 `GeoListItemCard.tsx` 已不存在) |
| 既有測試涵蓋情境 | `server/internal/api/geo_outline_place_photo_progress_test.go`、`geo_place_photo_refresh_test.go`、`place_details_in_flight_test.go`(見下方說明) |

**既有測試涵蓋範圍**:2026-10-16 複核時,`geo_outline_place_photo_progress_test.go`
涵蓋四種 handler 層情境——快取未命中初次查詢(回應 pending 並下載第一張)、
快取命中且 cap 範圍內皆新鮮(零 Google 呼叫)、cap 隨點擊數增長開出新名額、
cap 範圍內有過期照片觸發換新;`geo_place_photo_refresh_test.go` 涵蓋
`photoCapForClickCount`/`decidePlacePhotoRefreshIndex` 純函式;
`place_details_in_flight_test.go` 涵蓋併發搶佔。**完全沒有涵蓋**本文件推演的
「連續高頻請求下單一地點被榨乾多次補圖」(問題 2)、「textStale 與補圖判斷
同時觸發疊加成本」(問題 4)、以及「地點 Google 端照片數少於 cap、導致每次
點擊都重打 `GetPlaceDetails`」(問題 2 現況說明)這幾種情境——這些是成本推演
層級的問題,不是功能正確性問題,現有測試套件設計目標本來就是驗證「決策邏輯
有沒有被正確串接」而非「壓力/濫用情境下的行為」,故未涵蓋不代表既有測試有
缺陷,但若日後要落地相關修法,建議一併補上對應的迴歸測試。
