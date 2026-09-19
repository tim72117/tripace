# 工作交接：主題點/地點卡並存機制、isTheme 遷移（2026-09-07）

這份文件涵蓋本輪對話的完整改動——散策羅盤介紹卡並存機制、`level` 數字
分級改用獨立 `isTheme` 布林、以及一批景點資料的主題點規劃。改動已通過
`tsc --noEmit`/`vitest`/`go build`/`go test`，但尚未實際跑起來人工操作
驗證過（環境沒有瀏覽器自動化工具），commit 後建議找時間手動點過一輪。

## 這輪完成的功能

### 1. 主題卡/地點卡並存機制

`AttractionInfoPanel`（主題介紹卡，見 `docs/terminology.md`）永遠置右
最優先。點地圖上任何非主題點地標，一律開地點介紹卡（`PlacePanel`）：

- 有主題卡開著時：疊在主題卡**左側**並存顯示，不關閉主題卡。
- 沒有主題卡開著時：貼右緣顯示（互斥，行為同點擊一般 Google POI）。
- 非主題點地標若有 `placeId`：查 Google Place Details 當主要內容
  （評分/雙來源照片），並把 attraction 自己整理的 `summary` 附加到
  `PlaceInfoContent.attractionSummary` 並存顯示（見 `PlacePanel.tsx`）。
- 非主題點地標若沒有 `placeId`（或查詢失敗）：不查 Google，直接用
  attraction 自己的資料開地點卡——**不再有「退回開主題卡格式、取代
  目前主題卡」的例外**，這是本輪對話反覆修正的重點（見下方「除錯過程」）。
- 「附近景點」清單點擊（主題卡內建清單）走完全對稱的邏輯，跟地圖點擊
  共用同一套 `geoAttractionContent` 有無判斷。

關鍵檔案：`DesktopLayout.tsx`（`handleAttractionOpenPlaceDetails`/
`handleAttractionOpenPlaceWithoutGoogle`/`handleSelectNearbyAttraction`）、
`ExploreMap.tsx`（`handleAttractionClickRouted`）、
`useGeoPlanningState.ts`（新增 `selectPlaceContent`，`selectPoi` 改内部
呼叫它）。

### 2. `level` 數字分級 → 獨立 `isTheme` 布林

`model.Attraction`/`GeoAttraction` 新增 `IsTheme bool`，跟既有的
`Level int`（1~5 知名度分級）**並存，不取代**——`Level` 保留給地圖
zoom 顯示門檻用途，主題點/精選點判斷改用 `IsTheme`。

- 後端：`model.go`/`entity.go`/`attractions.go`/`geo_outline.go`/
  `maintenance.go`/`attractionsync/diff.go`（已納入同步比對欄位）。
- CLI：`attraction-add -theme`（未指定時依 `-level===1` 推斷，明確指定
  時以使用者輸入為準）、新增 `attraction-set-theme -id -theme=true|false`
  （更新既有資料）。
- 前端：`api.ts`（`GeoAttraction.isTheme`，後端固定回傳不用 omitempty）、
  `geoAttractionOverlay.ts`/`useAttractionOverlays.ts`（地圖顯示判斷改用
  `isTheme`，移除已死的 zoom 換算邏輯）、`ExploreMap.tsx`/
  `DesktopLayout.tsx`（點擊分岔/附近景點揭露邏輯）。

**已回填的既有資料**（透過 `attraction-set-theme`/`attraction-update`
CLI 完成，逐城市 `attraction-list` 驗證過）：

| 名稱 | 城市 | isTheme |
|---|---|---|
| 清水寺、八坂神社 | 京都 | true（既有，未變動） |
| 台北101 | 台北 | true（既有，未變動） |
| 國立西洋美術館、國立競技場 | 東京 | true（既有，未變動） |
| 東京晴空塔、淺草寺 | 東京 | true（新升級） |
| 清邁古城區 | 清邁 | true（新升級） |
| 尼曼區→改名「尼曼文青咖啡巷」 | 清邁 | true（新升級+改名） |
| 清邁大學周邊→改名「清邁學生美食街」 | 清邁 | true（新升級+改名） |
| 國立代代木競技場 | 東京 | **false（新降級**，原本 level=1） |

未動：素帖山雙龍寺、清邁夜間動物園，以及所有 level 2/3/4 精選點，維持
`isTheme=false`。

清水寺額外用 CLI 補上了一筆 `place_id`（`ChIJB_vchdMIAWARujTEUIZlr2I`）
純粹是測試 `attraction-set-place-id` 機制本身可用，跟這次功能邏輯無關
——清水寺是主題點，點擊行為不受地點卡邏輯影響。

### 3. 元件/型別重新命名

- `GeoInfoPanel` → `PlacePanel`
- `GeoOutlineMap` → `ExploreMap`
- `GeoInfoContent` → `PlaceInfoContent`

檔案改名用 `git mv`，全專案引用已同步替換（`git status` 顯示為 rename，
非刪除+新增）。

### 4. 新增共用外框元件 `DesktopInfoCard`

`web/src/geo-planning/DesktopInfoCard.tsx`/`.module.css`——桌面版右緣
資訊卡（`PlacePanel`/`AttractionInfoPanel`）共用的定位/避讓（`shiftBy`）
/關閉鍵/捲動容器，原本兩邊各自複製一份逐字相同的 CSS，現在收斂成一份。

### 5. `docs/attraction-theme-points-2026-09.md`（新增）

完整記錄京都/台北/東京/清邁/九份的主題點規劃決定與命名原則。**四個
新主題點尚未建檔**（谷中貓町、神楽坂小巴黎、表參道、九份聚落本身）
——只有名稱定案，缺座標/半徑/精選點素材，需要之後補上才能執行
`attraction-add`。

## 除錯過程中的重要教訓（避免重複繞路）

### 地圖疊層 z-index：第一輪修正不完整

`geoAttractionOverlay.ts`/`ExploreMap.module.css` 曾經因為
`.geo-attraction-overlay` 設定 `z-index:1` 導致每個景點各自形成獨立
stacking context，第一輪子代理拿掉了這個 `z-index`，**但沒有注意到
`transform: translate(-50%,-100%)` 本身（不論有沒有設 z-index）就會
建立獨立 stacking context**——這是 CSS 規範的既定行為，跟第一輪的
診斷（純粹歸咎於 z-index）不同。

**目前狀態：這個 bug 仍未真正修好**，使用者最後一次回報還是會被文字
標籤遮住。正確修法需要把「點」跟「標籤」拆成兩個獨立的 DOM 元素、各自
直接掛在 Google Maps 的同一個 pane 下（讓它們在 pane 這一層的共同
stacking context 內直接比較 z-index），而不是包在同一個會被 transform
隔離的容器裡——這是比較大的結構調整（需要重寫 `AttractionOverlay` 為
管理兩個同步定位的 div），而且牽涉到要保留目前「點在上、標籤在下、
緊貼座標點」的精確像素位置，**必須實際跑起來截圖驗證，不能只靠靜態
程式碼推理**（這正是第一輪失敗的原因）。下一次處理這個問題時，環境裡
需要有瀏覽器自動化工具（`chromium-cli` 或類似）才能真正驗證。

### 「還是會替換主題卡」的真正根因是資料缺 placeId，不是邏輯 bug

使用者多次回報「點地圖上非主題點/附近景點點下去還是會替換主題卡」，
反覆核對程式碼邏輯本身都是對的（並存機制正確寫成，`tsc`/`vitest` 也
驗證過），最後查資料才發現：**京都全部景點（含清水寺周邊那批精選點）
目前查出來全部沒有 `placeId`**，跟之前某次交接記錄提到「已經設過
place_id」的說法對不上（可能是資料庫在某個時間點被重置/清空過，或
那筆記錄本身就不準確，未深究）。因為程式碼原本對「非主題點但沒有
placeId」有一條防呆 fallback（退回開主題卡格式，取代目前主題卡），
在資料普遍缺 placeId 的情況下，這條 fallback 幾乎每次都會被觸發，
看起來就像並存機制整個沒作用。

**已修正**：拿掉這條 fallback，改成不管有沒有 placeId、查詢成不成功，
非主題點點擊一律開地點卡（見上方「並存機制」一節），不再有任何情況會
回頭取代主題卡。

## 待確認/待決定事項

- **地圖 z-index 疊層問題**——上面已詳述，優先度最高，尚未真正修好。
- **谷中貓町/神楽坂小巴黎/表參道/九份**四個新主題點缺座標/半徑/精選點
  素材，無法建檔，見 `docs/attraction-theme-points-2026-09.md`。
- **國立西洋美術館/國立競技場「建築巡禮」定位**——這兩者跟東京其餘
  主題點地理上不相鄰，散策羅盤「開主題點看周邊精選點」的體驗在這兩處
  目前沒有真正的周邊精選點可揭露，是否要重新考慮定位尚未討論定案。
- **`attraction-set-place-id` CLI 指令去留**——先前子代理主動新增，
  不在原始任務範圍，這輪測試證實有用（清水寺 place_id 補建就是靠它），
  建議保留。
- R6（`places.get` 限流互搶額度，見
  `docs/handoff-place-photo-pexels-attribution-2026-09.md`）仍未修復，
  跟這輪改動無關，順帶提醒還沒處理。

## 相關文件

- `docs/attraction-theme-points-2026-09.md`：主題點規劃決定。
- `docs/terminology.md`：主題介紹卡/地點介紹卡命名對照。
- `docs/handoff-place-photo-pexels-attribution-2026-09.md`：上一輪交接
  文件（R6 未修復問題）。
