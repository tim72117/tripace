# 配速表 + 地圖：寫死 vs. 真實資料 盤點

範圍：`web/src/PaceChartDemo.tsx`、`web/src/PaceRouteMap.tsx`、共同父層 `web/src/PublicPaceDemoPage.tsx`（及掛載這兩者的 `PacePhoneSwipe.tsx`/`App.tsx`/`DesktopLayout.tsx`/`PhoneScreens.tsx`）。

## 1. PaceChartDemo.tsx — checkpoints（逐站資料）

**真的呼叫後端 API**
- 掛載時對 `GET ${BASE_URL}/v1/public/{token}` 發一次 fetch（`PaceChartDemo.tsx:324-345`），token 是寫死常數 `PACE_PUBLIC_LINK_TOKEN = 'lnk_77f2aa2b14c6'`（`PaceChartDemo.tsx:136`，對應 `ch_a5632424` 頻道，涵蓋 leg1~leg4 全部 4 段、28 筆 checkpoint）。這是這支公開分享連結端點的正常公開呼叫，不需登入。
- 回應的 `entries: PublicEntry[]`（型別定義見 `PaceChartDemo.tsx:45-71`，對應後端 `model.Entry`；`detail` 是塞進 Entry 的配速表專屬 JSON，欄位包含 `km`/`isStart`/`isFinish`/`dwellMin`/`isLongRest`/`tag`/`departTime`/`arriveTime`/`order`/`segment`）經 `groupBySegment`（`PaceChartDemo.tsx:96-105`）依 `detail.segment`（`leg1`~`leg4`）分組、組内再依 `detail.order` 排序，再經 `entryToCheckpoint`（`PaceChartDemo.tsx:75-91`）轉成既有的 `Checkpoint` 形狀。
- 載入中/失敗都有明確畫面（`PaceChartDemo.tsx:377-393`），不會用假資料頂著掩蓋失敗狀態。
- `Checkpoint.id`/`lat`/`lng`（`PaceChartDemo.tsx:16-34`）直接來自後端 Entry 的 `id`/`lat`/`lng` 欄位——沒有 `LEG1_CHECKPOINTS`…`LEG4_CHECKPOINTS` 這種寫死字面陣列了，四段 checkpoint 資料**全部**改讀後端，`buildRoutes`（`PaceChartDemo.tsx:169-178`）只是把 fetch 回來、分組排序好的資料跟下面的 `RouteMeta` 常數組在一起。

**仍然完全寫死**
- `LEG1_META`…`LEG4_META`（`RouteMeta` 字面物件：`title`/`subtitle`/`eyebrow`/`totalKm`/`startTime`/`finishTime`/`avgSpeedKmh`/`footer`/`date`）——`PaceChartDemo.tsx:142-165`。原因見 `PaceChartDemo.tsx:138-141` 的註解：後端 Entry/Detail 沒有對應的「整段路線摘要」資料結構可以承載，跟逐站 checkpoint 資料是分開的兩件事。
- `PACE_PUBLIC_LINK_TOKEN` 本身寫死在程式碼裡（`PaceChartDemo.tsx:132-136`），註解明講這是暫時接法，正式上線應改由頻道設定或環境變數決定。

**運算出來的部分**
- `nowMark`（「目前站」高亮）：拿 `Date.now()` 跟 `route.meta.date`/checkpoint 的 `depart`/`arrive` 時刻比對算出，`PaceChartDemo.tsx:358-366`，邏輯在 `computeNowMark`（`PaceChartDemo.tsx:204-221`）。時間來源（裝置時鐘）是活的，比對基準（`RouteMeta.date`/checkpoint 時刻）分別來自寫死常數與後端資料。
- 路線分頁切換（`routeIdx` state）只是索引進 `buildRoutes` 產生的陣列，是 UI 狀態。
- 分享連結按鈕用 `window.location.origin`（`PaceChartDemo.tsx:418`，瀏覽器即時值），跟路線內容無關。

**新增的 props：往上通知父層選取哪個檢查站**
- `PaceChartDemo({ onCheckpointClick })`（`PaceChartDemo.tsx:300-308`）——可選 prop，型別為 `(entry: { id: string; lat: number | null; lng: number | null }) => void`。
- `CheckpointCard` 的 `onClick`（`PaceChartDemo.tsx:472-479`）：只有 `onCheckpointClick` 存在時才掛，點擊時把該筆 checkpoint 的 `{ id, lat, lng }` 往上丟。`lat`/`lng` 為 `null` 代表這筆 entry 還沒 geocode，呼叫端（`PaceRouteMap`）看到 `null` 就不觸發地圖平移。

## 2. PaceRouteMap.tsx — 路線幾何與沿路節點

**真的呼叫後端 API（新端點，取代舊的花蓮示範地址）**
- 目前打 `POST ${BASE_URL}/internal/entries/compute-route`（`PaceRouteMap.tsx:253-260`），對應後端 `server/internal/api/entry_geocode.go` 的 `handleComputeRouteFromEntries`（註冊在 `server/internal/api/api.go:174`）。此端點掛在 `/internal/*` 之下，需要帶有效的自家 JWT（`internalAuth` 中介層，`api.go:189`），故前端呼叫要帶 `Authorization: Bearer <token>`（token 讀自 `localStorage['tripace.auth.token']`，`PaceRouteMap.tsx:249`）。
- Body 是 `{ entryIDs: COMPUTE_ROUTE_ENTRY_IDS }`，`COMPUTE_ROUTE_ENTRY_IDS`（`PaceRouteMap.tsx:79`）是**寫死的 entryID 陣列**：`['ent_2a895ee67c5a', 'ent_82ebeadd8b36', 'ent_34d26e76a2a4', 'ent_84c38044ce40']`，對應 `ch_a5632424` 頻道底下四筆真實 entry（光復糖廠 → 民治街 → R轉193 → 大農大富平地森林園區停車場），依它們在後端 `Detail.order` 的順序排列。這已經不是「花蓮示範地址字串完全寫死」（舊狀態），而是「寫死要拿哪幾筆真實 entry 來算路線」——entry 本身的座標/title 是真實資料，只有「選哪幾筆」這個決策是寫死的。註解明講這是暫時接法，entryID 之後應改由呼叫端動態決定。
- 後端行為（`entry_geocode.go:87-119`）：origin（陣列第一筆）與 destination（最後一筆）優先用 entry 已存的 `Lat`/`Lng`，沒有座標時 fallback 用 `Title` 當地址字串查詢；**中間點**（intermediates）沒有座標時直接跳過、不送進 `computeRoutes`、也不 fallback 用 title（避免一個解析失敗的中繼點拖垮整條路線），被跳過的 entryID 列在回應的 `skipped` 欄位。`COMPUTE_ROUTE_ENTRY_IDS` 裡的「R轉193」（`ent_34d26e76a2a4`，純轉彎指示、目前無座標）就是用來測試這個跳過邏輯的案例。
- 回應形狀 `{ entryIDs, titles, skipped, result: { encoded, legs } }`，前端只取用 `result`，經 `importLibrary('geometry')` 的 `decodePath` 解碼成路徑座標畫 Polyline，並用 `legs[].startLocation`/`endLocation` 算出沿路節點座標（`PaceRouteMap.tsx:280-324`）。結果快取進 `localStorage`（`ROUTE_CACHE_KEY = 'tripace.paceRouteMap.route.v3'`，`PaceRouteMap.tsx:98`），避免重複呼叫這支按次計費的 API；`COMPUTE_ROUTE_ENTRY_IDS` 每次更動點位組合，cache key 版本號需跟著往上加一。
- `STOP_NAMES`（`PaceRouteMap.tsx:84`：`['光復糖廠', '民治街', 'R轉193', '大農大富平地森林園區停車場']`）是配合 `COMPUTE_ROUTE_ENTRY_IDS` 順序寫死的顯示名稱，用於沿路節點 marker 的 InfoWindow 標題；marker **位置**是後端回傳的真實座標，**名稱**是寫死字串。

**仍然完全寫死**
- `INITIAL_CENTER`/`INITIAL_ZOOM`（`PaceRouteMap.tsx:89-90`）——地圖初始視角，花蓮光復鄉附近的預設值,路線算出來後會 `fitBounds` 到實際範圍。
- `MINIMAL_MAP_STYLE`（`PaceRouteMap.tsx:46-56`）——地圖樣式。
- **地圖上疊的 3 張示範卡片**（光復橋 0.0km/09:00、大農大富平地森林園區 10.5km/10:55、大富火車站 17.0km/12:00，`PaceRouteMap.tsx:516-558`）——這批卡片**維持原樣、完全沒被這次改動觸及**，仍是另外在 JSX 裡手動打一次的獨立字面值，不是從 `PaceChartDemo.tsx` 的 checkpoint 資料或 `compute-route` 回應算出來的。`PaceRouteMap.tsx:510-515` 的註解明講「里程/時刻皆為示範用固定值，非即時資料」。

  ⚠️ **潛在風險（依然存在）**：這 3 張卡片跟 `COMPUTE_ROUTE_ENTRY_IDS`/`STOP_NAMES` 所指的真實資料（光復糖廠/民治街/R轉193/大農大富平地森林園區停車場）**地點與名稱都對不上**（卡片上寫的是光復橋/大農大富平地森林園區/大富火車站），兩邊目前沒有共用同一份資料源，容易讓人誤以為卡片內容反映的是目前地圖上實際畫出的路線。

**真的即時運算**
- 路線本身的線段跟沿路節點座標：來源是後端 `compute-route` 回應（如上），並非前端寫死座標；有 `localStorage` 快取。
- Marker 點擊彈出的 InfoWindow 內容用 `STOP_NAMES[i]`（寫死名稱），但 marker 位置是真實 API 回傳的座標。

## 3. PaceRouteMap.tsx 新增功能：選點校正座標（PATCH latlng）

這是文件先前版本完全沒提到的全新資料流,由 `selectedEntry`/`onSelectedEntryDone` 兩個 prop 驅動(`PaceRouteMap.tsx:121-131`)。「元件不接受 props」這句舊描述已經不成立。

**資料流向：PaceChartDemo → PublicPaceDemoPage(state) → PaceRouteMap**
- `PublicPaceDemoPage.tsx` 定義 `SelectedEntry`（`{ id, lat, lng }`，`PublicPaceDemoPage.tsx:11-15`）與對應的 `selectedEntry` state（`PublicPaceDemoPage.tsx:30`），只存在桌面版分支（手機版 `PacePhoneSwipe` 不接這套互動）。
- 桌面版把 `setSelectedEntry` 當 `onCheckpointClick` 傳給 `PaceChartDemo`（`PublicPaceDemoPage.tsx:39`）；使用者點某張檢查站卡片 → `PaceChartDemo` 呼叫 `onCheckpointClick({ id, lat, lng })` → 更新 `PublicPaceDemoPage` 的 `selectedEntry` state。
- `selectedEntry` 與 `() => setSelectedEntry(null)`（即 `onSelectedEntryDone`）一起傳給 `PaceRouteMap`（`PublicPaceDemoPage.tsx:45`）。

**PaceRouteMap 內的行為**
- `selectedEntry` 變動時，若 `lat`/`lng` 皆非 `null`，地圖 `panTo` 過去（`PaceRouteMap.tsx:341-348`）；座標為 `null`（entry 尚未 geocode）時地圖中心不動。
- 選點圖釘（`.centerPin`，`PaceRouteMap.tsx:597-609`）是純 CSS 疊在地圖容器正中央的固定元素（非 `google.maps.Marker`），只在 `selectedEntry` 非 null 時顯示；使用者拖曳地圖時圖釘本身不動、地圖在底下移動。
- 地圖 `idle` 事件（平移/縮放結束）持續把目前地圖中心點寫進 `pendingLatLng` state（`PaceRouteMap.tsx:367-376`），供選點圖釘與「儲存座標」按鈕使用。
- 按下「儲存座標」按鈕呼叫 `saveLatLng()`（`PaceRouteMap.tsx:383-408`）：`PATCH ${BASE_URL}/internal/entries/{selectedEntry.id}/latlng`，body 為 `{ lat: pendingLatLng.lat, lng: pendingLatLng.lng }`，同樣需要帶 `Authorization: Bearer <token>`（同一把 `internalAuth`，對應後端 `handleInternalSetLatLng`，註冊於 `api.go:172`）。成功後呼叫 `onSelectedEntryDone?.()` 通知父層把 `selectedEntry` 收回 `null`，圖釘與按鈕跟著收起；失敗顯示 `saveErr` 訊息，不影響其他功能。
- 這套互動讓使用者可以「點側欄卡片 → 地圖平移到大略位置 → 手動拖地圖微調中心點 → 儲存」的方式，逐一校正 checkpoint entry 的 `Lat`/`Lng`——跟第 2 節 `compute-route` 的資料流是分開但相關的兩件事：先靠這套互動把 entry 校正出座標，`compute-route` 再拿校正過座標的 entryID 去算真實路線幾何。

## 4. 目前位置 / 定位 / 模擬移動（未變動）

**活的（真實 GPS）**
- `navigator.geolocation.watchPosition(...)` — 標準瀏覽器 Geolocation API，持續回報真實裝置位置與方向，`PaceRouteMap.tsx:447-469`。跟 Google 無關，任何地圖庫都能配。

**模擬，但沿著真實路線走**
- 「模擬移動」（`simulating` state）沿著 `routePathRef.current`（即時 API 算出的真實解碼路徑座標）逐步位移，每 800ms 一步，來回折返，`PaceRouteMap.tsx:475-495`。位置移動本身是假的，但路徑幾何是真的（來自 `compute-route`）。
- `bearingBetween`：用相鄰真實路徑點算出的真實大圓航向公式，`PaceRouteMap.tsx:112-119`，供模擬移動的朝向使用；真實 GPS 則直接讀 `GeolocationCoordinates.heading`（`PaceRouteMap.tsx:456-458`）。
- 真實 GPS 與模擬移動最終都透過同一個 `updateMePosition` 函式更新 marker（`PaceRouteMap.tsx:415-439`）。

## 5. 真實後端/資料庫資料 vs. 純示範內容 — 現況總覽

**跟先前版本（純示範、完全不打自家後端）不同，`PaceChartDemo.tsx`/`PaceRouteMap.tsx` 現在都會呼叫 tripace 自己的後端 API：**

1. `GET /v1/public/{token}`（`PaceChartDemo.tsx`）——公開分享連結端點，讀取真實 Entry 資料當 checkpoint 逐站內容，token 寫死。
2. `POST /internal/entries/compute-route`（`PaceRouteMap.tsx`）——需帶 JWT，用寫死的 entryID 陣列取真實 Entry 座標算路線幾何。
3. `PATCH /internal/entries/{id}/latlng`（`PaceRouteMap.tsx`）——需帶 JWT，使用者透過地圖選點互動寫回真實 Entry 座標。

**仍然是純示範/寫死、沒有對應後端資料結構的部分：**
- `RouteMeta` 系列常數（`LEG1_META`…`LEG4_META`）：整段路線的摘要資訊（標題/副標/總里程/出發抵達時間/footer/日期）。
- `PACE_PUBLIC_LINK_TOKEN`、`COMPUTE_ROUTE_ENTRY_IDS`：分別決定「讀哪個頻道的分享連結」「用哪幾筆 entry 算路線」的寫死設定值——這兩者寫死的是「要用哪份真實資料」，不是資料內容本身。
- `STOP_NAMES`：配合 `COMPUTE_ROUTE_ENTRY_IDS` 順序的顯示名稱。
- 地圖上疊的 3 張示範卡片（光復橋/大農大富平地森林園區/大富火車站）：內容與目前 `COMPUTE_ROUTE_ENTRY_IDS` 所指的真實地點不一致，純視覺效果試做。

**其他對外部服務的呼叫（跟 tripace 後端無關，維持原狀）：**
- Google Maps JS SDK 初始化（`setOptions`/`importLibrary`），`PaceRouteMap.tsx:189-222`。
- 瀏覽器 Geolocation API，`PaceRouteMap.tsx:447-469`。
- Google Routes API 的實際計算已搬到後端（`compute-route`），前端不再直接呼叫 Google 的路線計算 REST API；前端的 `VITE_GOOGLE_MAPS_API_KEY` 現在只負責 Maps JavaScript API 的地圖渲染。

## 掛載關係

- `App.tsx` import `PaceChartDemo`/`PaceRouteMap`/`PacePhoneSwipe`
- `/demo/pace` 路由 → `PublicPaceDemoPage`（定義在 `web/src/PublicPaceDemoPage.tsx`）：桌面版側欄放 `PaceChartDemo`（接 `onCheckpointClick`）、主區放 `PaceRouteMap`（接 `selectedEntry`/`onSelectedEntryDone`），兩者透過 `PublicPaceDemoPage` 的 `selectedEntry` state 互相通訊；非桌面版用 `PacePhoneSwipe`（不接這套互動）
- 登入版桌面 `DesktopLayout.tsx:155,167`：側欄與主區直接掛 `<PaceChartDemo />`/`<PaceRouteMap />`，**不傳任何 props**（註解仍寫著「`PaceRouteMap` 本身不吃 props，直接掛載即可」）——選點校正這套互動只在 `/demo/pace`（`PublicPaceDemoPage`）串起來，登入版桌面沒有接這條資料流
- `PacePhoneSwipe.tsx`：手機版把 `PaceRouteMap` 當固定底層、`PaceChartDemo` 當可滑出的抽屜面板疊在上面

## 結論

`PaceChartDemo`/`PaceRouteMap` 目前的逐站 checkpoint 資料與路線幾何**已經是真實後端資料**：checkpoint 來自 `GET /v1/public/{token}` 讀取的真實 Entry，路線幾何來自 `POST /internal/entries/compute-route` 用真實 Entry 座標算出的結果，兩者都不再是文件先前版本描述的寫死字面陣列/花蓮示範地址字串。

仍然寫死的是「用哪份資料」的**選擇本身**（`PACE_PUBLIC_LINK_TOKEN`、`COMPUTE_ROUTE_ENTRY_IDS`）與「後端沒有資料結構可承載」的部分（`RouteMeta` 路線摘要、`STOP_NAMES`、地圖上疊的 3 張示範卡片）。另外新增了一套完整的「點檢查站卡片 → 地圖平移 → 手動拖曳微調 → PATCH 儲存座標」互動，讓使用者可以透過這個 demo 頁面本身，逐步把真實 Entry 校正出可用座標，供 `compute-route` 使用。
