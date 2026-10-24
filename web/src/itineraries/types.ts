// types.ts — 「精選行程」展示功能的資料型別(2026-10 頁面文案從「AI
// 排好的範例行程」改名,型別/檔案命名維持不變)。
//
// 設計目標:範例行程「未來會持續增加」(使用者明確說明),所以:
//   - 一份行程一個檔案(itineraries/*.ts),default export 一個 SampleItinerary,
//     由 registry.ts 用 import.meta.glob 自動收進來——新增行程只要加一個檔案,
//     清單頁、篩選、路由完全不用改。
//   - categories/region 刻意是普通字串,不是寫死的 union 型別:新增分類(例如
//     「溫泉」)不應該需要同時修改型別定義;篩選用的清單由資料自己算出來(見
//     catalog.ts 的 deriveFilters)。
//   - 資料格式有檢查(見 itineraries.test.ts 對 registry 的驗證),加錯格式會
//     在測試階段就失敗,不會到畫面才壞掉。

import type { PlanTimeline } from '../planning/timeline/model'

// 行程裡的站點與天數直接使用時間軸的資料結構(planning/timeline/model.ts 的 PlanTimeline / PlanDay / PlanNode / PlanNodeData),
// 不再有自己的站點型別與轉換層:範例檔案寫的就是時間軸本身,載入時不需要轉換。寫法規則(欄位語意見 PlanNodeData):
//   - 每個節點必須有穩定唯一的 id 與 type:'stop';time("HH:MM",同一天內由早到晚遞增)、name、kind(景點/美食/展館/購物/住宿…,
//     卡片固定把一行組成「停留時間 · 類型」,少了會顯示孤零零的「·」)、duration("1h"、"1.5h";住宿寫「過夜」)必填。
//   - 節點屬於哪一天由它所在的 PlanDay 決定,不寫 day 欄位。
//   - googlePhotoUrls:照片網址(第一張是縮圖),靜態寫死用;有 placeId 且資料存取層查到照片時以查到的為準。
//   - placeId:Google Place ID。有值時頁面經資料存取層(PlanAiDataSource.placeDetails)查地點資料,把座標與照片寫回該節點
//     (planning/timeline/resolveAttractionForStep,與 /ai-plan、登入後同一條路徑);名稱與說明維持作者寫的 name/desc。
//   - lat/lng:要嘛兩個都給、要嘛都不給;有 placeId 時仍要寫(查詢完成前與查詢失敗時地圖/時間軸定位靠它)。
//   - transitFromPrev:選填,同一天裡上一站到這一站的交通(靜態資料沒有 Routes 查詢結果,minutes/distance 可省略,note 是班次
//     轉乘之類的備註);沒寫時由 catalog.ts 依相鄰兩站座標用直線距離粗估。mode 對應圖示:步行、公車、捷運、開車、電車、巴士。
//   - 住宿不寫在天的節點裡:寫在 timeline.lodgings(見 PlanLodging,每筆旅館記錄停留的天 id),視圖在入住日最上面畫橫幅。
//   - note、children(主題點的子景點)等其餘欄位同 PlanNodeData。

// SampleFoodSpot——行程旁的「美食清單」一筆資料(2026-10 新增,使用者
// 明確要求「ai-itineraries/tainan-chikan-2day 左邊加入美食清單圖卡」)。
// 跟時間軸節點(PlanNode)是兩種不同性質的資料:節點是時間軸上「排進行程
// 動線裡」的一站(有 time/day,佔據一個時間點),美食清單是「這個區域
// 推薦、但不一定排進動線」的候選店家清單(沒有 time/day,純粹並列展示
// 供訪客參考,不強制要去)——兩者欄位故意不共用同一個 interface,硬要
// 共用會讓節點的 time/duration 變得像是「美食清單也要填」,
// 但美食清單的本質就是不佔時間軸的候選清單。
//
// photoPlaceId(而非 photoUrl)——使用者明確要求「圖片用 map 取特定
// POI 取得」:不在資料裡存死的圖片網址,而是存 Google Place ID,渲染時
// 透過 planning/data/cache.ts 的 fetchPlaceDetailsCached 查出
// 對應相片(對齊 docs/research-route-path-planning-2026-10.md 已經確認
// 過的合規結論:Places Photo 取得的照片沒有限定一定要搭地圖顯示,但
// photo name 不能快取、要嘛現查現用),見 useFoodSpotDetails.ts 的完整
// 說明。沒有 photoPlaceId 的候選店家,渲染端用占位圖示代替。
//
// 這個欄位是 SampleItinerary 的選填欄位而非獨立資料表/獨立 API——
// tainan-chikan-2day 目前已經是透過 itinerary_pages 資料庫 content JSON
// 驅動的行程(見 AiItineraryDetailPage.tsx useApiBackedItinerary 的
// 完整說明,行程泛化改版後每份行程都會先嘗試打 API、查無才退回靜態
// registry,不再是白名單判斷),已用 CLI(itinerary-page set)把真實的
// foodSpots 陣列寫進這份行程既有的 content JSON——跟部落格
// content_pages 的 blocks 機制同一種「同一份 content JSON 擴充欄位」的
// 設計哲學,不是另起爐灶。
export interface SampleFoodSpot {
  id: string
  name: string
  // category——短標籤,如「小吃」「甜點」「在地名店」,顯示在卡片上。
  category: string
  desc: string
  // photoPlaceId——見上方完整說明,Google Place ID,選填:還沒決定對應
  // 哪個真實 POI 的候選店家,渲染端退回占位圖示,不強制每筆都要有。
  photoPlaceId?: string
  // priceRange——選填,簡短價位標示,如「$」「$$」,不做成數字區間
  // (那種精確度對這個清單的使用情境而言是過度設計)。
  priceRange?: string
}

export interface SampleItinerary {
  // id——網址用的識別碼(/itineraries/:id),小寫英數與連字號,全部行程不可重複。
  id: string
  title: string
  // region——地區,如「台灣・台南」,用於篩選。
  region: string
  // categories——旅遊類型標籤,如「美食」「文青」,可多個,用於篩選。
  categories: string[]
  summary: string
  // addedAt——上架日期 "YYYY-MM-DD",清單依此由新到舊排序(新加的排最前面)。
  addedAt: string
  // coverPhoto——清單卡片封面;省略時顯示預設圖示(節點不存照片網址,清單頁不會從站點補圖)。
  coverPhoto?: string
  // timeline——這份行程的時間軸,直接就是 planning/timeline/model.ts 的 PlanTimeline(依天分組:days[0] 是 Day 1,每天有穩定 id 與依序的節點)。
  // 總天數是 timeline.days.length(見 catalog.ts dayCountOf),不另外存。寫法規則見檔案開頭的說明。
  timeline: PlanTimeline
  // foodSpots——選填,見 SampleFoodSpot 的完整說明。只有少數行程(目前
  // 是 tainan-chikan-2day)會有這個欄位,渲染端(AiItineraryDetailPageMapView.tsx)
  // 在陣列為空/未定義時完全不顯示這個區塊,不是顯示一個空清單。
  foodSpots?: SampleFoodSpot[]
  // mapStyle——選填,2026-10 新增(使用者明確要求「將 tainan-chikan-2day
  // 整體的模板做成獨立通用的元件」):這份行程是否要走地圖基底展示版面
  // (AiItineraryDetailPageMapView.tsx),以及走哪一種地圖樣式——取代原本
  // AiItineraryDetailPage.tsx/AiItineraryDetailPageMapView.tsx 裡寫死的
  // MAP_VIEW_ITINERARY_IDS/HAND_DRAWN_ITINERARY_IDS 這兩組前端 id 白名單。
  // 未設定(undefined)的行程維持原本的唯讀卡片牆唱讀展示,不受影響。
  //   - 'hand-drawn':走 itineraries/handDrawnMapStyle.ts 的暖色調
  //     手繪可愛風 inline styles(見該檔案的完整說明)
  //   - 'simple':走 VITE_GOOGLE_MAPS_LANDING_MAP_ID 的簡化 Cloud Style
  //     (關閉 Google 原生 POI 標籤,見 AiItineraryDetailPageMapView.tsx
  //     SIMPLE_MAP_ID 的完整說明)
  mapStyle?: 'hand-drawn' | 'simple'
  // playfulUI——選填,2026-10 新增(使用者明確要求「地點卡圖卡加入一些
  // 手繪卡通樣式,活潑一點」「外框做得像古城風格的遊戲地圖邊框」,後續
  // 明確拍板「tainan-chikan-2day 要套用,但地圖底圖配色仍維持簡化版」):
  // 控制卡片手繪卡通樣式(renderItineraryStopCard.tsx/FoodSpotPanel.tsx
  // 的 .xxxPlayful 系列)跟地圖外框的古城風格裝飾(AiItineraryDetailPageMapView.module.css
  // 的 .mapBackdropCastle),跟 mapStyle(控制地圖底圖本身的配色)是兩個
  // 獨立的維度——一份行程可以是「簡化 Google 地圖配色 + 活潑卡片/邊框」
  // (tainan-chikan-2day 目前的組合),也可以是「手繪地圖配色 + 活潑卡片/
  // 邊框」(erziping-1day,預設兩者同時為真但各自獨立宣告)。未設定
  // (undefined)視為 false,走標準樣式。
  playfulUI?: boolean
  // borderStyle——選填,2026-10 新增(使用者要求定山溪紅葉散策行程的
  // 地圖外框換成「楓葉相框」,不要再用尋寶地圖的指北針/羊皮紙):控制
  // playfulUI 為真時,地圖外框裝飾(AiItineraryDetailPageMapView.tsx 的
  // 邊框容器 + 暈影這一對)走哪一種主題——跟 playfulUI(是否要有裝飾)
  // 是不同維度:playfulUI 決定「要不要裝飾」,borderStyle 決定「裝飾長
  // 什麼樣」;playfulUI 為 false 的行程不論 borderStyle 設什麼都不會
  // 畫任何外框。
  //   - 'treasure-map':寶藏地圖風(TreasureScrollBorder 指北針 +
  //     MapVignette 羊皮紙米黃左右暈影),未設定(undefined)時的預設值
  //     ——tainan-chikan-2day/erziping-1day 等既有行程都沒設定這個欄位,
  //     行為跟新增欄位前完全一樣。
  //   - 'maple-leaf':紅葉楓葉相框(MapleLeafBorder 四角楓葉叢 +
  //     MapleVignette 暖橘左右暈影),目前只有 jozankei-1day 透過
  //     itinerary_pages content JSON 設定(用 CLI itinerary-page set 寫入,
  //     做法同 foodSpots/mapStyle,見 SampleFoodSpot 的完整說明)。
  borderStyle?: 'treasure-map' | 'maple-leaf'
  // cardTheme——選填,2026-10 新增(使用者要求定山溪紅葉散策行程的地點
  // 卡做成「秋日泡湯風格」的專屬卡片樣式):控制時間軸地點卡
  // (PlanTimelineView 的 renderStopCard 插槽)走哪一套主題卡片,由
  // AiItineraryDetailPageMapView.tsx 讀取。跟 playfulUI 的關係是「覆蓋」
  // 而非「疊加」:有設定 cardTheme 的行程,卡片完全改走該主題的渲染器,
  // playfulUI 只剩下控制地圖外框裝飾(借 borderStyle 決定主題)的作用,
  // 不會再套 renderItineraryStopCard.tsx 的 .stopCardPlayful 蠟筆描邊
  // ——主題卡自己已經有一整套配色/邊框/質感,再疊一層會打架。
  //   - 'onsen-autumn':秋日泡湯風(renderOnsenAutumnStopCard.tsx,暖色
  //     和紙底、楓紅/鏽橘/深褐配色、縮圖區蒸氣動畫 + 依 kind 切換的
  //     楓葉/溫泉饅頭/溫泉記號圖樣),目前只有 jozankei-1day 透過
  //     itinerary_pages content JSON 設定(用 CLI itinerary-page set 寫入,
  //     做法同 borderStyle)。這套不依賴站點照片——jozankei-1day 的站點
  //     目前沒有 googlePhotoUrls 欄位,主題靠配色/質感/圖樣撐起識別度;真的有
  //     照片時縮圖區仍會正常顯示照片,只是圖樣改為不渲染。
  //   未設定(undefined)的行程走原本的 createRenderItineraryStopCard(isPlayfulUI)
  //   (tainan-chikan-2day/erziping-1day 等既有行程都沒設定),行為跟
  //   新增欄位前完全一樣。
  cardTheme?: 'onsen-autumn'
}
