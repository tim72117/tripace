// planAiDataSource.ts — 膠合層:把 attractionTools.ts / AIPlanTimelinePage.tsx
// 實際會呼叫的四個地點查詢函式(search_attraction 用的地名查詢+鄰近候選、
// add_attraction 用的地點詳情反查、交通時間預估)收斂成一個介面
// PlanAiDataSource,呼叫端(這兩個檔案)只依賴這個介面,不直接 import
// api.ts 的 fetchPlanAi* 系列。
//
// 背景:這個目錄(home/plan-ai-sim/)是從 plan-ai-sim 分支原封不動搬過來
// 的模擬展示頁面,原始版本的 attractionTools.ts/AIPlanTimelinePage.tsx
// 直接呼叫需登入的後端端點(fetchPlanAiPlaceSearch 等,見 ../../api.ts)。
// 使用者明確要求:這個獨立公開頁(不需要登入)要固定接純前端假資料
// (attractionPool.ts 既有的 10 筆台南景點),不能打會因為沒有登入態
// 拿到 401 的後端端點;而分支裡原本那一頁固定接後端,兩者是各自固定
// 選定一種實作,不是同一頁可即時切換的開關。故意做成「介面 + 兩份
// 實作」而非直接把假資料寫死進 attractionTools.ts——這樣之後若要讓
// 分支那一頁復用同一份 attractionTools.ts/AIPlanTimelinePage.tsx 程式碼
// (只是注入不同的 PlanAiDataSource 實作),不需要再改一次呼叫端邏輯。
//
// 型別命名/欄位刻意對齊 api.ts 的 GeoPlanAiPlaceSearchResult/
// GeoPlanAiAttractionSearchResult/GeoPlanAiPlaceDetailsAnyResult/
// GeoPlanAiTransitEstimateResult(結構相容的獨立宣告,不 import api.ts,
// 這個目錄的檔案應該完全不依賴需要登入態 cfg 的 api.ts 呼叫路徑)。

export interface PlanAiPlaceDetailsResult {
  found: boolean
  name?: string
  address?: string
  lat?: number
  lng?: number
  summary?: string
  googlePhotoUrls?: string[]
  // attractionId——2026-10 新增(使用者明確要求「open_ask_page 要可以
  // 輸出 attraction id 與 place id」,見 AskPage.tsx 查詢候選完整資料
  // 處的完整說明)。對齊 api.ts GeoPlanAiPlaceDetailsAnyResult.attractionId
  // 的既有語意:只在這個 placeId 對應到資料庫已建檔景點時才有值。假資料
  // 實作(planAiFakeDataSource.ts)的展示景點池沒有對應的資料庫紀錄,
  // 固定不帶這個欄位,呼叫端(AskPage.tsx)應視為選填。
  attractionId?: string
}

export interface PlanAiTransitEstimateResult {
  mode: string
  icon: string
  minutes: number
  distance: string
}

// PlanAiNearbyCandidate/PlanAiSearchNearbyResult——2026-10 新增(使用者
// 明確要求 open_ask_page 支援「探查模式」:LLM 傳入目的地文字/地圖中心
// /使用者位置三選一,前端自動用這些資訊查出候選清單顯示,不需要 LLM
// 自己先呼叫 search_attraction)。欄位形狀對齊 attractionTools.ts
// search_attraction 回傳的 nearby 候選(placeId/name/summary/category,
// 見該函式的完整說明),讓 AskPage.tsx 可以直接把結果轉成
// AskPageCandidate[] 使用,不需要額外的欄位轉換。
export interface PlanAiNearbyCandidate {
  placeId: string
  name: string
  summary?: string
  category?: string
}

export interface PlanAiSearchNearbyResult {
  // found——地名查詢(query 模式)可能查無結果(見
  // GeoPlanAiPlaceSearchResult.found 的既有語意);座標模式(給 lat/lng)
  // 固定視為 found:true(座標本身就是確定的錨點,沒有「查無此地」這種
  // 情境)。
  found: boolean
  candidates: PlanAiNearbyCandidate[]
}

// PlanAiPhotoAssetsResult — 對齊 api.ts GeoPlacePhotoAssets(純讀目前
// 已經落地的照片,不觸發補圖——2026-09 使用者明確要求「重試時只能取圖,
// 不能觸發補圖」,見該處的完整說明)。
export interface PlanAiPhotoAssetsResult {
  googlePhotoUrls?: string[]
}

// PlanAiDataSource — attractionTools.ts(search_attraction)與
// AIPlanTimelinePage.tsx(add_attraction 背景反查、插入 stop 時的交通
// 時間預估)實際需要的最小介面。cfg(ClientConfig)不在這個介面裡——
// 真後端實作需要它,假資料實作完全不需要,由各自的實作函式自行決定要不
// 要收 cfg,呼叫端一律透過這個介面呼叫,不需要知道底下是哪一種。
export interface PlanAiDataSource {
  placeDetails(placeId: string): Promise<PlanAiPlaceDetailsResult>
  transitEstimate(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    // forceMode——選填,指定交通方式(walking/driving/transit 等)。
    // 2026-10 補進介面:/app 的 TripPlanPage 讓使用者手動切換交通方式
    // (見該元件 onTransitModeChange 的完整說明),省略時由實作自己決定
    // ——真後端交給後端判斷,假資料固定回傳同一組。
    forceMode?: string,
  ): Promise<PlanAiTransitEstimateResult>
  // photoAssets — 2026-10 新增(使用者明確要求讀取層「可以像推論層那樣
  // 獨立抽換,用相同的方式對接取得資料,包含地點資訊、圖片」)。
  //
  // 原本只有 placeDetails/transitEstimate 在介面裡,照片是 /app 正式頁
  // 自己直接呼叫 fetchGeoPlacePhotoAssets 補的(見 TripPlanPage.tsx
  // resolveAttractionForStep 的第七個參數),展示頁則完全沒有這條路徑
  // ——照片網址直接寫在 attractionPool.ts 的假資料裡。兩邊各走各的,
  // 介面因此不完整:換一份實作換不掉照片的來源。
  //
  // 選填(?):假資料實作的照片已經隨 placeDetails 一起回傳
  // (googlePhotoUrls),不需要第二次查詢;真後端則是分兩段(詳情先回,
  // 照片可能還在背景補圖,之後重試才拿得到)。呼叫端沒有這個方法時
  // 就不做第二段查詢,跟展示頁目前的行為一致。
  photoAssets?(placeId: string): Promise<PlanAiPhotoAssetsResult>
  // searchNearby——2026-10 新增(見 PlanAiSearchNearbyResult 的完整
  // 說明),供 open_ask_page 的「探查模式」使用。輸入三選一:
  //   - query(地名文字):對齊 search_attraction 的既有邏輯,先查這個
  //     地名的座標,再查該座標附近的候選。
  //   - coords(座標,地圖中心或使用者位置皆用同一種輸入形狀,呼叫端
  //     不需要分辨兩者在這支方法眼中的差異——都是「直接拿這個座標查
  //     附近」):跳過地名查詢那一步,直接查鄰近候選。
  // 兩種輸入互斥,呼叫端依實際拿到的參數擇一傳入(見 AskPage.tsx
  // 探查模式處的完整說明)。
  searchNearby?(input: { query: string } | { coords: { lat: number; lng: number } }): Promise<PlanAiSearchNearbyResult>
}
