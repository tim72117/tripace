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

// SampleStop——行程中的一站,欄位對應時間軸元件(plan-core/PlanTimelineView)
// 能顯示的內容,但寫法比內部節點格式單純(沒有 id/prevId/nextId),由
// toPlanTimeline 轉成真正的時間軸。
export interface SampleStop {
  // day——第幾天,1-based,省略視為第 1 天。
  day?: number
  // time——該站開始時間,24 小時制 "HH:MM"。同一天內必須由早到晚遞增
  // (時間軸資料層的規則,見 plan-core/planTimeline.ts insertAfter)。
  time: string
  name: string
  // kind——站點性質的短標籤,顯示在卡片上(如「景點」「美食」「展館」「購物」
  // 「住宿」)。必填:時間軸卡片固定把這一行組成「停留時間 · 類型」,少了任何一個
  // 會顯示成孤零零的「·」。
  kind: string
  // duration——建議停留時間,如 "1h"、"1.5h";住宿這類沒有停留概念的寫「過夜」。
  // 必填,理由同 kind。
  duration: string
  desc?: string
  // photos——照片網址(依序,第一張是縮圖),靜態寫死的情境用(例如 tainan-chikan-2day 現有的真實遊記照片)。
  // 有 placeId(下方)且資料存取層查到照片時,以查到的為準。
  photos?: string[]
  // placeId——選填:這一站的 Google Place ID。有值時,頁面經資料存取層(PlanAiDataSource.placeDetails)查地點資料,
  // 把座標與照片寫回這一站的時間軸節點——與 /ai-plan、登入後「站點由 placeId 解析出座標與照片」同一條路徑
  // (plan-core/resolveAttractionForStep)。名稱與說明維持行程作者寫的 name/desc,不被查詢結果覆蓋。
  // 已建檔地標(tripace-cli attraction add)的 place_id 可直接沿用;地點資料與照片因此只有一份來源。
  placeId?: string
  // lat/lng——座標,要嘛兩個都給、要嘛都不給。placeId 有值時仍需要
  // 在這裡重複填一次(不是從 attraction 查詢結果自動帶入)——這兩個欄位
  // 驅動的是時間軸/地圖站點本身的定位(toPlanTimeline 轉換、地圖 marker
  // 位置),在查詢完成前(甚至查詢失敗時)就需要有值,不能依賴一個可能
  // 還沒回來的非同步查詢結果。
  lat?: number
  lng?: number
  // transit——選填:從「上一站」到這一站的交通方式。時間軸會在兩站之間畫交通膠囊(與 /ai-plan、登入後同一個元件)。
  // 精選行程是人工撰寫的靜態資料,沒有 Routes 查詢結果,所以 minutes、distance 都可以省略,膠囊只顯示有值的部分;
  // note 是班次、轉乘之類的文字備註,顯示在膠囊下方。mode 對應圖示:步行、公車、捷運、開車、電車、巴士(其他當步行)。
  // 第一站沒有上一站,填了也不會顯示。
  transit?: {
    mode: string
    minutes?: number
    distance?: string
    note?: string
  }
  // checkOutDay——選填,2026-10 新增(使用者明確要求「住宿通常是錨點,
  // 會有開始結束日」「住宿用特別的卡片來表示天數,不要開很多張卡片」):
  // 只有 kind === '住宿' 的站才有意義。這一筆住宿從 day(入住日)連續
  // 住到 checkOutDay(退房日,含),資料本身只需要寫這一筆——不需要像
  // 過去那樣每晚各自重複一筆幾乎一樣的「住宿」站(同一間旅館連住多晚
  // 會重複出現好幾張幾乎一樣的卡片)。
  //
  // 渲染端(renderItineraryStopCard.tsx)偵測 kind === '住宿' 時,改走
  // 跟一般景點卡完全不同的樣式(錨點橫幅,不是縮圖+文字的景點卡版式)
  // ——使用者明確要求「把樣式跟景點分開」,不是沿用同一套卡片外觀只是
  // 換個文字。這一筆仍然只插入时間軸一次(在 day 當天,見
  // catalog.ts toPlanTimeline 的完整說明),checkOutDay 只是多帶一個
  // 「這段住宿橫跨到哪一天」的資訊,不代表還要在中間每一天各自插入
  // 節點。
  //
  // 省略(undefined)時,這一站若是住宿類型,視為只住這一天(day 本身),
  // 不橫跨——向下相容既有只住一晚的住宿站寫法。
  checkOutDay?: number
}

// SampleFoodSpot——行程旁的「美食清單」一筆資料(2026-10 新增,使用者
// 明確要求「ai-itineraries/tainan-chikan-2day 左邊加入美食清單圖卡」)。
// 跟 SampleStop 是兩種不同性質的資料:SampleStop 是時間軸上「排進行程
// 動線裡」的一站(有 time/day,佔據一個時間點),美食清單是「這個區域
// 推薦、但不一定排進動線」的候選店家清單(沒有 time/day,純粹並列展示
// 供訪客參考,不強制要去)——兩者欄位故意不共用同一個 interface,硬要
// 共用會讓 SampleStop 的 time/day/duration 變得像是「美食清單也要填」,
// 但美食清單的本質就是不佔時間軸的候選清單。
//
// photoPlaceId(而非 photoUrl)——使用者明確要求「圖片用 map 取特定
// POI 取得」:不在資料裡存死的圖片網址,而是存 Google Place ID,渲染時
// 透過 geo-planning/placeDetailsCache.ts 的 fetchPlaceDetailsCached 查出
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
  // days——總天數,必須 >= stops 裡最大的 day。
  days: number
  // categories——旅遊類型標籤,如「美食」「文青」,可多個,用於篩選。
  categories: string[]
  summary: string
  // addedAt——上架日期 "YYYY-MM-DD",清單依此由新到舊排序(新加的排最前面)。
  addedAt: string
  // coverPhoto——清單卡片封面;省略時用第一站的第一張照片,仍然沒有就顯示預設圖示。
  coverPhoto?: string
  stops: SampleStop[]
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
  //     目前沒有 photos 欄位,主題靠配色/質感/圖樣撐起識別度;真的有
  //     照片時縮圖區仍會正常顯示照片,只是圖樣改為不渲染。
  //   未設定(undefined)的行程走原本的 createRenderItineraryStopCard(isPlayfulUI)
  //   (tainan-chikan-2day/erziping-1day 等既有行程都沒設定),行為跟
  //   新增欄位前完全一樣。
  cardTheme?: 'onsen-autumn'
}
