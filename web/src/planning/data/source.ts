// source.ts(planning/data)— 資料存取層的介面與結果型別(PlanAiDataSource 與它的回傳型別、require* 輔助函式)。
//
// 介面在這裡,三份實作與它同在 planning/data:
//   api.ts     登入版,打 /internal/* 端點(需要 cfg 帶登入 token)
//   public.ts  訪客版,打 /public/* 端點(未登入也能用)
//   fake.ts    純前端假資料(conversation/attractionPool.ts 的展示景點池),不打任何後端
// planning/data 是共用層:時間軸(timeline/transit.ts、usePlanTimelineCore.ts)、共用 store(store.ts)、
// 詢問頁(conversation/AskPage.tsx)、探索與地點面板(explore/、place/)、各入口都透過這個介面取資料,
// 不必各自 import api.ts 的 fetch* 系列;用哪一份實作由入口在根部決定一次(見 PlanDataProvider.tsx)。
//
// 為什麼做成「介面 + 多份實作」:地點查詢(search_attraction 用的地名查詢+鄰近候選、add_attraction 用的
// 地點詳情反查、交通時間預估…)的呼叫端邏輯只有一份,差別只在資料從哪裡來——
//   - 公開展示頁(/ai-plan 的模擬態、首頁手機展示)要固定接純前端假資料,不能打會因為沒有登入態拿到 401 的
//     後端端點;這是各入口固定選定一種實作,不是同一頁可即時切換的開關。
//   - 登入後與訪客直接進真實 AI 推論時,同一套呼叫端改注入 api / public 實作即可,不需要再改一次呼叫端邏輯。
// 若把假資料寫死進呼叫端,每多一種資料來源都要改呼叫端。
// (歷史:這套介面最早隨 plan-ai-sim 分支的模擬展示頁搬進來時只有假資料一份實作,後來才補上 api 與 public。)
//
// 型別命名/欄位刻意對齊 api.ts 的 GeoPlanAiPlaceSearchResult/
// GeoPlanAiAttractionSearchResult/GeoPlanAiPlaceDetailsAnyResult/
// GeoPlanAiTransitEstimateResult(結構相容的獨立宣告;這裡只 import api.ts 的型別,
// 不依賴需要登入態 cfg 的 api.ts 呼叫路徑)。

import type {
  GeoAttraction,
  GeoAttractionTagNeighbor,
  GeoGeocodeCandidate,
  GeoPlaceDetails,
  GeoPlaceText,
  PublicGeoAttractionByID,
} from '../../api'

export interface PlanAiPlaceDetailsResult {
  found: boolean
  name?: string
  address?: string
  lat?: number
  lng?: number
  summary?: string
  googlePhotoUrls?: string[]
  // photoRefreshPending——這次查詢有沒有觸發後端背景補圖(對齊 api.ts GeoPlanAiPlaceDetailsAnyResult 同名欄位):
  // 為 true 代表照片還在補、稍後用純讀的 photoAssets 才拿得到(見 planning/data/store.ts 的照片重試 startPhotoRetry)。
  // 假資料實作不帶。
  photoRefreshPending?: boolean
  // attractionId——2026-10 新增(使用者明確要求「open_ask_page 要可以
  // 輸出 attraction id 與 place id」,見 AskPage.tsx 查詢候選完整資料
  // 處的完整說明)。對齊 api.ts GeoPlanAiPlaceDetailsAnyResult.attractionId
  // 的既有語意:只在這個 placeId 對應到資料庫已建檔景點時才有值。假資料
  // 實作(fake.ts)的展示景點池沒有對應的資料庫紀錄,
  // 固定不帶這個欄位,呼叫端(AskPage.tsx)應視為選填。
  attractionId?: string
  // thumbBg、thumbIcon——選填的佔位縮圖樣式(CSS 漸層+emoji)。只有假資料實作會給:
  // 展示景點池的大部分條目沒有實拍照片,畫面在沒有 googlePhotoUrls 時用它當縮圖。
  // 真後端沒有這個概念,固定不帶,呼叫端(planning/data/store.ts 的解析)視為選填。
  thumbBg?: string
  thumbIcon?: string
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
// 自己先呼叫 search_attraction)。欄位形狀對齊 planning/conversation/tools.ts
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

// PlanAiDataSource — 規劃畫面讀取地點資料的最小介面(站點地點詳情反查、插入 stop 時的交通
// 時間預估、子景點/旅館解析、詢問頁與探索的候選查詢等,消費方見檔頭)。cfg(ClientConfig)不在這個介面裡——
// 真後端實作需要它,假資料實作完全不需要,由各自的實作函式自行決定要不
// 要收 cfg,呼叫端一律透過這個介面呼叫,不需要知道底下是哪一種。
export interface PlanAiDataSource {
  placeDetails(placeId: string): Promise<PlanAiPlaceDetailsResult>
  transitEstimate(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    // forceMode——選填,指定交通方式(walking/driving/transit 等)。
    // 2026-10 補進介面:/app 的 TripPlanPage 讓使用者手動切換交通方式
    // (見該元件 onSetStopTransitMode 的完整說明),省略時由實作自己決定
    // ——真後端交給後端判斷,假資料固定回傳同一組。
    forceMode?: string,
  ): Promise<PlanAiTransitEstimateResult>
  // photoAssets — 2026-10 新增(使用者明確要求讀取層「可以像推論層那樣
  // 獨立抽換,用相同的方式對接取得資料,包含地點資訊、圖片」)。
  //
  // 原本只有 placeDetails/transitEstimate 在介面裡,照片是 /app 正式頁
  // 自己直接呼叫 fetchGeoPlacePhotoAssets 補的(見 planning/timeline/resolveAttractionForStep.ts
  // resolveAttractionForStep 的第七個參數),展示頁則完全沒有這條路徑
  // ——照片網址直接寫在 attractionPool.ts 的假資料裡。兩邊各走各的,
  // 介面因此不完整:換一份實作換不掉照片的來源。
  //
  // 選填(?):假資料實作的照片已經隨 placeDetails 一起回傳
  // (googlePhotoUrls),不需要第二次查詢;真後端則是分兩段(詳情先回,
  // 照片可能還在背景補圖,之後重試才拿得到)。呼叫端沒有這個方法時
  // 就不做第二段查詢,跟展示頁目前的行為一致。
  photoAssets?(placeId: string): Promise<PlanAiPhotoAssetsResult>
  // geoPlaceDetails — 2026-10 新增(使用者明確要求光暈的地點詳情查詢也走資料存取層實例):景點區域光暈
  // 補照片時查的地點詳情(GeoPlaceDetails 完整形狀,含 googlePhotoUrls、photoRefreshPending)。跟上面的
  // placeDetails 是不同端點、不同回傳形狀(placeDetails 打 place-details-any 回傳 PlanAiPlaceDetailsResult),
  // 所以另開方法:登入版打需登入的 /internal/geo/place-details、訪客版打免登入的 /public/geo/place-details。
  // 選填:假資料版不實作(播放態沒有光暈),呼叫端沒有這個方法時不查詢。
  geoPlaceDetails?(placeId: string): Promise<GeoPlaceDetails>
  // placePhoto、placeText、geocode — 2026-10 新增(使用者明確要求「有存取後端的統一走資料存取層」):登入後地圖
  // 規劃的搜尋結果補照片、補文字、地點搜尋。後端只有登入版端點(/internal/geo/place-details 的 photoOnly、
  // textOnly 模式與 /internal/geo/geocode),所以只有登入版實例實作;訪客版與假資料版不實作,呼叫端用
  // requirePlacePhoto 等函式取用,沒實作時回傳 rejected Promise,由既有的 .catch 處理。
  // attractionsByCity、attractionByID — 2026-10 新增:依城市列出已建檔的景點區域(主題介紹頁的展示地圖)、
  // 依 id 查單一已建檔景點的公開資料(行程詳情頁的站點照片)。登入版 attractionsByCity 打
  // /internal/geo/attractions,訪客版打免登入的 /public/geo/attractions;attractionByID 只有公開端點
  // (/public/geo/attraction/{id}),登入版與訪客版都用它。
  attractionsByCity?(city: string): Promise<GeoAttraction[]>
  attractionByID?(id: string): Promise<PublicGeoAttractionByID>
  placePhoto?(placeId: string, name: string): Promise<{ googlePhotoUrls?: string[] }>
  placeText?(placeId: string): Promise<GeoPlaceText>
  geocode?(
    query: string,
    center?: { lat: number; lng: number },
    mode?: 'bias' | 'restrict',
    radiusMeters?: number,
  ): Promise<{ query: string; candidates: GeoGeocodeCandidate[] }>
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
  // nearbyAttractionAreas——依座標與半徑查附近「自家資料庫的景點區域」(2026-10,
  // 使用者明確要求「光暈查詢共用,端點應該是有不同的資料存取層實例」)。
  // 景點區域光暈的資料來源:登入版(createPlanAiApiDataSource)打需登入的
  // /internal/geo/attractions/nearby-only,訪客版(createPlanAiPublicDataSource)
  // 打免登入的 /public/geo/attractions/nearby-only(同樣只查自家資料庫、免費,
  // 有 IP 節流)。呼叫端(/ai-plan 與登入後的 PlanMap 共用的
  // useExploreQueries)只依賴這個方法,不自己挑端點、不自己 fetch。
  // 選填:假資料版沒有這個概念(播放態不查光暈),沒實作時呼叫端視為「沒有資料」。
  nearbyAttractionAreas?(lat: number, lng: number, radiusMeters: number): Promise<GeoAttraction[]>
  // attractionTagNeighbors——同城市、帶有指定標籤的其他已建檔景點,依與 id 這筆的距離由近到遠(最多 5 筆,
  // 見後端 handleGeoAttractionTagNeighbors)。供 AttractionInfoPanel 點擊標籤 chip 時查詢「周邊同標籤地點」。
  // 後端只有登入版端點(/internal/geo/attractions/{id}/tag-neighbors),所以只有登入版實例實作;訪客版與假資料版
  // 不實作,AttractionInfoPanel 據此不顯示可點擊的標籤。
  attractionTagNeighbors?(id: string, tag: string): Promise<GeoAttractionTagNeighbor[]>
}

// requireGeoPlaceDetails、requirePhotoAssets——呼叫選填方法時的統一入口:實例沒有實作(例如假資料版)就回傳
// rejected Promise,讓呼叫端既有的 .catch(查不到就維持沒照片)照常處理,不必到處寫 undefined 判斷。
export function requireGeoPlaceDetails(ds: PlanAiDataSource, placeId: string): Promise<GeoPlaceDetails> {
  return ds.geoPlaceDetails ? ds.geoPlaceDetails(placeId) : Promise.reject(new Error('這個資料存取層沒有實作 geoPlaceDetails'))
}

export function requirePhotoAssets(ds: PlanAiDataSource, placeId: string): Promise<PlanAiPhotoAssetsResult> {
  return ds.photoAssets ? ds.photoAssets(placeId) : Promise.reject(new Error('這個資料存取層沒有實作 photoAssets'))
}

export function requirePlacePhoto(ds: PlanAiDataSource, placeId: string, name: string) {
  return ds.placePhoto ? ds.placePhoto(placeId, name) : Promise.reject(new Error('這個資料存取層沒有實作 placePhoto'))
}

export function requirePlaceText(ds: PlanAiDataSource, placeId: string) {
  return ds.placeText ? ds.placeText(placeId) : Promise.reject(new Error('這個資料存取層沒有實作 placeText'))
}

export function requireGeocode(
  ds: PlanAiDataSource,
  query: string,
  center?: { lat: number; lng: number },
  mode?: 'bias' | 'restrict',
  radiusMeters?: number,
) {
  return ds.geocode ? ds.geocode(query, center, mode, radiusMeters) : Promise.reject(new Error('這個資料存取層沒有實作 geocode'))
}

export function requireAttractionsByCity(ds: PlanAiDataSource, city: string) {
  return ds.attractionsByCity ? ds.attractionsByCity(city) : Promise.reject(new Error('這個資料存取層沒有實作 attractionsByCity'))
}
