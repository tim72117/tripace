# 工作交接：散策羅盤地圖疊加試做

2026-08-31。承接自 `research-curated-attraction-relationships-2026-08.md` 第 9 節「介面呈現試想」的「散策羅盤」方向,記錄從研究文件到地圖實作之間的討論脈絡與目前進度,供下一次接續。

## 背景

`research-curated-attraction-relationships-2026-08.md` 提出三個視覺化試做方向,作者推薦「散策羅盤」(同心圓鄰近雷達 + 衛星卡片雙向連動)。原始試做是一個獨立網頁 Artifact(純 SVG,不是疊加在真實地圖上):
`https://claude.ai/code/artifact/b014e8ac-98e3-4f8c-bf07-48fd12eb5797`

這次討論的目標是把這個構想落地到 tripace 正式的 Google Maps 地圖上(`web/src/geo-planning/GeoOutlineMap.tsx`),取代/補強現有的景點呈現方式。

## 討論脈絡(依時間順序)

### 1. 資料模型初步討論

先確認了現有 `model.Attraction`(`server/internal/model/model.go`)是純扁平表——只有 `id/name/cityName/lat/lng/level/radiusMeters/summary/photoUrl`,完全沒有「關聯」欄位,走 GORM AutoMigrate,無獨立 migration 檔。前端對應型別是 `GeoAttraction`(`web/src/api.ts`)。

原本規劃了一張 `attraction_relations` 關聯表的方案(有向邊、`criteria` 結構化判準、CLI 手動建檔),但使用者選擇了更保守的起手式:

- **不做關聯表**,先用既有 `lat`/`lng` 算距離/方位角,看視覺表現如何
- **不做結構化 criteria 欄位**,先做簡單結構
- 若真的要建檔,才走 CLI 手動建檔(延續現有 `Attraction` 慣例)

結論:**第一階段完全不動資料模型/後端**,純前端幾何計算(Haversine 距離、方位角、直線距離換算徒步分鐘)。

### 2. fable 視覺發散(地圖疊加方式)

請 fable 針對「同心圓 + 方位角疊加在真實 Google Maps 地圖上」做視覺發散,基於的技術現實:
- 地圖上已有 `google.maps.Circle`(範圍圈用法)、自訂 `OverlayView` 子類(景點光暈,見 `geoAttractionOverlay.ts`)
- 尚未用過 `Polyline`
- 沒有真實路網資料,徒步分鐘只能用直線距離粗估
- 地圖會被自由縮放/平移,同心圓必須在各 zoom level 下合理
- 桌面版/手機版都要能用

fable 提出五個方向:

1. **墨圈等時環**——三圈半透明 `Circle` 常駐虛線描邊,hover 才拉單條連接線
2. **描圖紙聚光**——mask 挖洞蓋暗周邊,只亮錨點方圓 15 分鐘內
3. **步數潮汐**——不畫靜態環,用一圈波紋以真實步速(80m/分)擴散掃過候選點,依「點亮順序」當敘事
4. **坂道絲線**——`Polyline` 手繪弧線連錨點到候選點,線寬依動線角色分級,為未來接 Directions API 預留同一套視覺骨架
5. **紙上羅盤盤面**——固定像素 SVG 儀表釘在錨點旁,免疫縮放問題,hover 才拉引導線連回真實 marker

fable 推薦組合「三→一→四」:平常靠光暈呼吸當發現入口;點選錨點時播一次步數潮汐當顯影儀式;波紋落定後留下墨圈等時環當常駐骨架;切換候選卡片時才畫單條坂道絲線。

### 3. 獨立 Artifact 原型(已發佈,未接落地)

使用者要求「先看」,做了一個獨立 Artifact 展示「坂道絲線」的核心互動(點擊即畫線,不含波紋/墨圈環):

`https://claude.ai/code/artifact/6e86caa0-4f3b-42fc-af45-67d517f5490f`

內容:模擬街區 Canvas 底圖,清水寺為錨點,點擊候選景點時從錨點拉出一條手繪弧度虛線 + 分鐘標籤,再點一次收起。**這個 artifact 是純展示原型,不是最終要接進 tripace 的程式碼**,已驗證互動邏輯本身可行。

### 4. 決定直接在真實地圖上試做

使用者跳過剩餘的獨立原型迭代,直接要求在 `GeoOutlineMap.tsx` 上實作最小行為:**只做「點擊景點時畫線」,不做波紋、不做常駐墨圈環**(fable 方向四的核心互動,範圍縮小)。

關鍵設計決策(逐一問過使用者確認):

- **錨點來源**:`AttractionInfoPanel` 目前開啟中的那個景點(不是「上一個被選取的」,也不是地圖中心)
- **互動觸發點**:**不在地圖上點擊**候選景點,而是在 `AttractionInfoPanel` 內新增一段「附近景點」清單,使用者從清單裡選
- **附近候選來源**:目前地圖可視範圍內、距離錨點最近的 N 個(不另發 API,直接用已查到的 `GeoAttraction[]`)
- **清單項目內容**:名稱 + 距離分鐘(不含縮圖)

## 目前實作進度

### 已完成

1. **`web/src/geo-planning/geoDistance.ts`(新檔)**——`haversineMeters()` 球面距離、`walkMinutesEstimate()` 直線距離換算徒步分鐘(80m/分鐘,日本不動產業界慣例,取整數且下限 1 分鐘)。

2. **`web/src/geo-planning/AttractionInfoPanel.tsx`**——新增三個 prop:
   - `nearby?: { attraction: GeoAttraction; minutes: number }[]`——附近景點清單,由呼叫端算好排序傳入,這個元件不自己查詢/排序
   - `ribbonKey?: string | null`——目前選中要畫連線的候選景點名稱(attraction 沒有像 hotel/place 那樣穩定的 id,即時查詢結果沒有 id,暫用名稱當 key)
   - `onSelectNearby?: (attraction: GeoAttraction) => void`——點擊清單項目觸發,呼叫端負責判斷「再點一次視為取消」的邏輯

   JSX 已補上「附近景點」清單區塊(位於「探索周邊」按鈕下方,`nearby.length > 0` 才顯示)。

3. **`web/src/geo-planning/AttractionInfoPanel.module.css`**——新增 `.nearbySection/.nearbyTitle/.nearbyList/.nearbyItem/.nearbyItemSelected/.nearbyName/.nearbyMinutes` 樣式,沿用既有 `--ios-bg/--ios-gray/--ios-sand/--color-dark` token,無縮圖的細分隔線列表(非卡片形式)。

### 尚未進行(下一步)

這是目前整個改動鏈中**唯一真正產生使用者可見效果的最後一段**,還沒開始:

4. **`web/src/DesktopLayout.tsx`**——需要新增:
   - 接住 `onAttractionsChange`(目前只轉傳給 `GeoOutlinePanel`,沒有真的存成 state)存成 `geoAttractions` state
   - 用 `geoDistance.ts` 算出「離 `geoAttractionContent`(目前錨點)最近的 N 個候選」,傳給 `AttractionInfoPanel` 的 `nearby` prop
   - 新增一個 state(例如 `ribbonTarget: GeoAttraction | null`)接住 `AttractionInfoPanel` 的 `onSelectNearby`,再點一次同一個候選視為取消(設回 `null`)
   - 把 `ribbonTarget` 與錨點(`geoAttractionContent`)一併傳給 `GeoOutlineMap`

5. **`web/src/geo-planning/GeoOutlineMap.tsx`**——需要新增:
   - 新 prop(例如 `ribbonAnchor: GeoAttraction | null`、`ribbonTarget: GeoAttraction | null`)
   - 新的 `useAttractionRibbon` hook(仿 `useAttractionOverlays.ts` 的結構,只讀 `mapRef`/`mapReady`/錨點/目標,不寫入其他共享狀態):兩點皆存在時用 `google.maps.Polyline` 畫一條連線(手繪弧度效果——Polyline 原生不支援貝茲曲線,需要用多個內插點模擬弧形路徑,或先用直線示意,弧度效果留待之後再加),中點掛一個 `OverlayView` 顯示「約 X 分」標籤(可參考獨立 Artifact 原型 `radar-lines-proto.html` 的貼紙式標籤畫法,已存在 scratchpad,但那份是 Canvas 手繪,這裡要換成真正的 DOM/CSS 疊層)

## 待確認的細節(下次接續時可能需要重新跟使用者對齊)

- Polyline 手繪弧度在 Google Maps 上的實作方式(內插點模擬 vs 直接用直線)使用者尚未看過,可能需要先做出來給使用者確認效果
- 「再點一次候選項目視為取消」這個互動目前只在 `AttractionInfoPanel.tsx` 的型別註解裡寫了設計意圖,`DesktopLayout.tsx` 實際的 toggle 邏輯還沒寫
- 手機版(`GeoOutlinePhoneInfoSheet.tsx`)是否也要接上同一套附近景點清單/絲線,這次討論僅涵蓋桌面版,尚未討論

## 相關連結

- 研究文件:`docs/research-curated-attraction-relationships-2026-08.md`
- 散策羅盤原始獨立 Artifact:`https://claude.ai/code/artifact/b014e8ac-98e3-4f8c-bf07-48fd12eb5797`
- 坂道絲線互動驗證 Artifact:`https://claude.ai/code/artifact/6e86caa0-4f3b-42fc-af45-67d517f5490f`
