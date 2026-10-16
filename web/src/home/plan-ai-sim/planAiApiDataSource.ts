import {
  fetchGeoPlacePhotoAssets,
  fetchPlanAiPlaceDetailsAny,
  fetchPlanAiTransitEstimate,
  type ClientConfig,
} from '../../api'
import type { PlanAiDataSource } from './planAiDataSource'

// planAiApiDataSource.ts — PlanAiDataSource(見 planAiDataSource.ts 的
// 完整說明)的真後端實作,對應假資料實作 planAiFakeDataSource.ts。
//
// 2026-10 新增(使用者明確要求讀取層「可以像推論層那樣獨立抽換,用相同
// 的方式對接取得資料,包含地點資訊、圖片」,並指定「首頁用的是純前端的,
// 讀取的資料由前端提供;進到自動撥放時,則用使用 api 讀取後端的方式」)。
//
// 在這之前 PlanAiDataSource 只有假資料一份實作,而且被 import 寫死在
// AIPlanTimelinePage.tsx 裡——介面存在但沒有第二個實作,抽換能力是空的。
// 真後端這條路徑當時只存在於 /app 的 TripPlanPage.tsx,它直接 import
// api.ts 的 fetchPlanAi* 系列,沒有走這個介面,兩邊各寫各的。
//
// 為什麼是工廠函式而不是像 planAiFakeDataSource 那樣直接匯出實例:
// 真後端的每個呼叫都要帶 cfg(ClientConfig,內含 baseURL 與登入 token),
// 那是呼叫端才知道的執行期值。介面本身刻意不收 cfg(見 PlanAiDataSource
// 的完整說明:「由各自的實作函式自行決定要不要收」),所以用閉包把它包
// 進來,呼叫端拿到的仍然是一個符合介面、不需要再傳 cfg 的物件。
//
// 需要登入:這些端點都在 /internal/ 底下。未登入時 request() 會丟
// ApiError(401),由呼叫端既有的錯誤處理接(resolveAttractionForStep
// 的 catch 會讓那一站維持 loading:false、不帶真實資料,不會整頁壞掉)。
// 這也是為什麼公開展示頁(/ai-plan、首頁小展示)固定用假資料實作——
// 那些頁面不需要登入就能看,打這些端點只會拿到 401。
export function createPlanAiApiDataSource(cfg: ClientConfig): PlanAiDataSource {
  return {
    placeDetails: (placeId) => fetchPlanAiPlaceDetailsAny(cfg, placeId),
    // transitEstimate——介面的簽名沒有 mode 參數(假資料實作不需要,
    // 見 planAiDataSource.ts),真後端的 mode 是選填的,省略時由後端
    // 自己決定用哪一種交通方式,行為跟假資料實作一致。
    transitEstimate: (from, to) => fetchPlanAiTransitEstimate(cfg, from, to),
    photoAssets: (placeId) => fetchGeoPlacePhotoAssets(cfg, placeId),
  }
}
