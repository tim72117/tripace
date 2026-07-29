# 配速表 + 地圖：寫死 vs. 真實資料 盤點

範圍：`web/src/PaceChartDemo.tsx`、`web/src/PaceRouteMap.tsx`（及掛載這兩者的 `PacePhoneSwipe.tsx`/`App.tsx`/`DesktopLayout.tsx`/`PhoneScreens.tsx`）。

## 1. PaceChartDemo.tsx — checkpoints/meta

**完全寫死（無 props、無 API、無真實資料源）**
- `LEG1_CHECKPOINTS` … `LEG4_CHECKPOINTS` — `Checkpoint` 物件的字面陣列，`PaceChartDemo.tsx:52-114`
- `LEG1_META` … `LEG4_META` — `RouteMeta` 字面物件，`PaceChartDemo.tsx:66-71, 80-85, 95-100, 109-114`
- `ROUTES` —組合上述的字面陣列，`PaceChartDemo.tsx:116-121`
- `PaceChartDemo()` 不吃任何參數（`PaceChartDemo.tsx:236`），只讀模組層級的 `ROUTES` 常數。註解（`PaceChartDemo.tsx:281-284`）明確標示這是 `?demo`/`/demo/pace` 專用的固定示範資料，不對應真實使用者頻道。

**運算出來的部分（但輸入資料仍是上面那份寫死陣列）**
- `nowMark`（「目前站」高亮）：拿 `Date.now()` 跟 `route.meta.date`/checkpoint 時刻比對算出，`PaceChartDemo.tsx:249-257`，邏輯在 `computeNowMark`（`PaceChartDemo.tsx:147-164`）。時間來源（裝置時鐘）是活的，比對對象（checkpoint 資料）是寫死的。
- 路線分頁切換（`routeIdx` state）只是索引進寫死的 `ROUTES` 陣列，是 UI 狀態，不是新資料。
- 分享連結按鈕用 `window.location.origin`（瀏覽器即時值），跟路線內容無關。

## 2. PaceRouteMap.tsx

**寫死**
- `ORIGIN`、`WAYPOINTS`、`DESTINATION` — 字面地址字串，`PaceRouteMap.tsx:61-63`
- `STOP_NAMES` — 字面顯示名稱陣列，`PaceRouteMap.tsx:68`
- `INITIAL_CENTER`/`INITIAL_ZOOM` — 地圖預設視角，`PaceRouteMap.tsx:72-73`
- `MINIMAL_MAP_STYLE` — 地圖樣式，`PaceRouteMap.tsx:35-45`
- **地圖上疊的 3 張示範卡片**（光復橋 0.0km/09:00、大農大富平地森林園區 10.5km/10:55、大富火車站 17.0km/12:00）——這是**另外在 JSX 裡手動打一次的獨立字面值**，不是從 `PaceChartDemo.tsx` 的 checkpoint 陣列算出來的。`PaceRouteMap.tsx:399-404` 的註解明講「里程/時刻皆為示範用固定值,非即時資料」。

  ⚠️ **潛在風險**：這代表如果手寫紀錄之後有更新，`PaceChartDemo.tsx` 的清單跟地圖上這 3 張卡片要**分別手動改兩次**，兩邊目前沒有共用同一份資料源，容易改一邊忘了改另一邊。

**真的即時運算**
- 路線本身的線段跟 5 個節點座標：起訖點地址字串寫死，但實際路線幾何（`encodedPolyline`、解碼後路徑、每段 leg 的起訖經緯度）是真的打 Google Routes API（`computeRoutes`）拿回來的，`PaceRouteMap.tsx:206-297`，非寫死座標，有存 `localStorage`（`ROUTE_CACHE_KEY`）快取避免重複計費呼叫。
- Marker 點擊彈出的 InfoWindow 內容用 `STOP_NAMES[i]`（寫死名稱），但 marker 位置是真實 API 回傳的座標。

## 3. 目前位置 / 定位 / 模擬移動

**活的（真實 GPS）**
- `navigator.geolocation.watchPosition(...)` — 標準瀏覽器 Geolocation API，持續回報真實裝置位置與方向，`PaceRouteMap.tsx:336-358`。跟 Google 無關，任何地圖庫都能配。

**模擬，但沿著真實路線走**
- 「模擬移動」（`simulating` state）沿著 `routePathRef.current`（即時 API 算出的真實解碼路徑座標）逐步位移，每 800ms 一步，來回折返，`PaceRouteMap.tsx:364-384`。位置移動本身是假的，但路徑幾何是真的。
- `bearingBetween`：用相鄰真實路徑點算出的真實大圓航向公式，`PaceRouteMap.tsx:106-113`，供模擬移動的朝向使用；真實 GPS 則直接讀 `GeolocationCoordinates.heading`（`PaceRouteMap.tsx:346`）。
- 真實 GPS 與模擬移動最終都透過同一個 `updateMePosition` 函式更新 marker（`PaceRouteMap.tsx:304-328`）。

## 4. 真實後端/資料庫資料 vs. 純示範內容

**`PaceChartDemo.tsx`/`PaceRouteMap.tsx` 完全沒有讀取 tripace 自己的後端/資料庫。** 沒有對自家 API 的 `fetch`、沒有頻道/entries context、沒有使用者 props。兩者都明確標註為純示範：

- `PaceChartDemo.tsx:281-284` — 「?demo 才會出現的固定示範資料...不是真實使用者頻道」
- `PaceRouteMap.tsx:7-10` — 「配速表路線地圖(UI 試做用):用固定寫死的 5 個花蓮地點...元件不接受 props」
- `PhoneScreens.tsx:68-72` — `/demo/pace` 公開頁明確獨立於真實的 `/public/{token}` 頻道分享機制之外，不需登入，不涉及任何真實資料權限

唯二真正對外部服務發出的呼叫：
1. Google Maps JS SDK 初始化（`setOptions`/`importLibrary`），`PaceRouteMap.tsx:159-184`
2. Google `computeRoutes` REST 呼叫，`PaceRouteMap.tsx:206-297`
3. 瀏覽器 Geolocation API，`PaceRouteMap.tsx:336-358`

三者都是真實的第三方/瀏覽器 API，但都沒有碰到 tripace 自己的後端或真實使用者資料庫——路線的**內容**（檢查站、時刻、地址）100% 是從手寫 pace note 轉錄的作者自訂常數（`PaceChartDemo.tsx:42-50`）。

## 掛載關係

- `App.tsx` import `PaceChartDemo`/`PaceRouteMap`/`PacePhoneSwipe`
- `/demo/pace` 路由 → `PublicPaceDemoPage`（定義在 `PhoneScreens.tsx:96-117`）：桌面版側欄放 `PaceChartDemo`、主區放 `PaceRouteMap`；非桌面版用 `PacePhoneSwipe`
- 登入版桌面 `DesktopLayout.tsx:152-156`（側欄）與 `:160-167`（主區，直接掛 `PaceRouteMap`，不吃 props，印證完全自包含/寫死）
- `PacePhoneSwipe.tsx:56, 78`：手機版把 `PaceRouteMap` 當固定底層、`PaceChartDemo` 當可滑出的抽屜面板疊在上面，兩者都不吃 props

## 結論

`PaceChartDemo`/`PaceRouteMap` 的路線/檢查站**內容**是 100% 寫死的字面資料，沒有任何元件吃 props/API/context。真正即時/資料驅動的部分只有：(a) Google Routes API 算出的路線幾何與節點座標、(b) 用來判斷「目前站」的裝置真實時間、(c) 真實 GPS 定位、(d) 沿著真實路線幾何跑的模擬移動假位置。地圖上的 3 張疊卡是另外獨立手打的一份子集資料，不是從 checkpoint 資料衍生出來的。
