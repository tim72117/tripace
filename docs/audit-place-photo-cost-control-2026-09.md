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
