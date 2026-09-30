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
  photoUrl?: string
}

export interface PlanAiTransitEstimateResult {
  mode: string
  icon: string
  minutes: number
  distance: string
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
  ): Promise<PlanAiTransitEstimateResult>
}
