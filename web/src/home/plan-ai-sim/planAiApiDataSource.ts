import {
  fetchGeoAttractionsOnlyNearby,
  fetchGeoAttractions,
  fetchGeoGeocode,
  fetchGeoPlaceDetails,
  fetchGeoPlacePhoto,
  fetchGeoPlaceText,
  fetchPublicGeoAttractionByID,
  fetchGeoPlacePhotoAssets,
  fetchPlanAiAttractionSearch,
  fetchPlanAiPlaceDetailsAny,
  fetchPlanAiPlaceSearch,
  fetchPlanAiTransitEstimate,
  type ClientConfig,
} from '../../api'
import { getSharedPlaceDetailsDedupe } from './placeDetailsDedupe'
import type { PlanAiDataSource, PlanAiSearchNearbyResult } from './planAiDataSource'

// planAiApiDataSource.ts — PlanAiDataSource(見 planAiDataSource.ts 的
// 完整說明)的真後端實作,對應假資料實作 planAiFakeDataSource.ts。
//
// 2026-10 新增(使用者明確要求讀取層「可以像推論層那樣獨立抽換,用相同
// 的方式對接取得資料,包含地點資訊、圖片」,並指定「首頁用的是純前端的,
// 讀取的資料由前端提供;進到自動撥放時,則用使用 api 讀取後端的方式」)。
//
// 在這之前 PlanAiDataSource 只有假資料一份實作,而且被 import 寫死在
// home/plan-ai-sim/Content.tsx 裡——介面存在但沒有第二個實作,抽換能力是空的。
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
// 這也是為什麼公開展示頁不直接用這份實作:首頁小展示與 /ai-plan 的播放態
// (劇本)用假資料實作 planAiFakeDataSource;/ai-plan 的詢問頁與推論態
// (見 home/plan-ai-sim/Content.tsx 與 LivePlanLayer.tsx)用訪客版
// planAiPublicDataSource(打 /public/*)。那些頁面不需要登入就能看,
// 打這些端點只會拿到 401。只有登入後頁面,以及 Content.tsx 在有 token 時
// 的景點光暈查詢才用這份。
// searchNearbyByCoords——「依座標查鄰近候選」這一段邏輯(呼叫
// fetchPlanAiAttractionSearch、過濾沒有 placeId 的候選、轉成
// PlanAiNearbyCandidate 形狀)同時被 query 模式(先查地名拿到座標)與
// coords 模式(直接拿座標)共用,抽成這支小函式,不在 createPlanAiApiDataSource
// 裡重複寫兩次——理由同 attractionTools.ts createSearchAttraction 內部
// 對 nearby 候選的既有處理方式(見該函式的完整說明:過濾沒有 placeId
// 的候選、只保留 placeId/name/summary/category 四個欄位)。
async function searchNearbyByCoords(cfg: ClientConfig, lat: number, lng: number): Promise<PlanAiSearchNearbyResult> {
  try {
    const { attractions } = await fetchPlanAiAttractionSearch(cfg, lat, lng)
    const candidates = attractions
      .filter((a) => !!a.placeId)
      .map((a) => ({ placeId: a.placeId!, name: a.name, summary: a.summary, category: a.category }))
    return { found: true, candidates }
  } catch {
    // 查詢失敗(網路問題等)降級成「查無候選」而非往上拋——理由同
    // createSearchAttraction 對 nearby 候選查詢失敗的既有降級慣例:
    // 這支方法的呼叫端(AskPage.tsx 探查模式)失敗時應該顯示空狀態,
    // 不該讓整個詢問頁因為一次查詢失敗而連帶壞掉。
    return { found: true, candidates: [] }
  }
}

export function createPlanAiApiDataSource(cfg: ClientConfig): PlanAiDataSource {
  // 去重(見 placeDetailsDedupe.ts):依 baseURL+token 共用,詢問頁與時間軸
  // 即使各自建立資料來源實例,同一個 placeId 也只會發一次請求。
  const dedupe = getSharedPlaceDetailsDedupe(`api|${cfg.baseURL}|${cfg.token ?? ''}`)
  return {
    placeDetails: (placeId) => dedupe.get(placeId, () => fetchPlanAiPlaceDetailsAny(cfg, placeId)),
    // transitEstimate——介面的簽名沒有 mode 參數(假資料實作不需要,
    // 見 planAiDataSource.ts),真後端的 mode 是選填的,省略時由後端
    // 自己決定用哪一種交通方式,行為跟假資料實作一致。
    transitEstimate: (from, to, forceMode) => fetchPlanAiTransitEstimate(cfg, from, to, forceMode),
    photoAssets: (placeId) => fetchGeoPlacePhotoAssets(cfg, placeId),
    geoPlaceDetails: (placeId) => fetchGeoPlaceDetails(cfg, placeId),
    attractionsByCity: async (city) => (await fetchGeoAttractions(cfg, city)).attractions ?? [],
    attractionByID: (id) => fetchPublicGeoAttractionByID(cfg, id),
    placePhoto: (placeId, name) => fetchGeoPlacePhoto(cfg, placeId, name),
    placeText: (placeId) => fetchGeoPlaceText(cfg, placeId),
    geocode: (query, center, mode, radiusMeters) => fetchGeoGeocode(cfg, query, center, mode, radiusMeters),
    nearbyAttractionAreas: async (lat, lng, radiusMeters) => {
      const r = await fetchGeoAttractionsOnlyNearby(cfg, lat, lng, radiusMeters)
      return r.attractions ?? []
    },
    // searchNearby——見 PlanAiDataSource.searchNearby 的完整說明。
    // query 模式對齊 attractionTools.ts createSearchAttraction 的既有
    // 兩段式邏輯(先查地名座標,再查鄰近候選);coords 模式跳過第一段,
    // 直接用傳入的座標查詢。
    searchNearby: async (input) => {
      if ('coords' in input) {
        return searchNearbyByCoords(cfg, input.coords.lat, input.coords.lng)
      }
      const result = await fetchPlanAiPlaceSearch(cfg, input.query)
      if (!result.found || result.lat == null || result.lng == null) {
        return { found: false, candidates: [] }
      }
      return searchNearbyByCoords(cfg, result.lat, result.lng)
    },
  }
}

// getPlanAiApiDataSource——依 baseURL + token 共用同一個登入版實例(2026-10)。ClientConfig 只有這兩個欄位,實例
// 是無狀態的轉接(去重記憶本來就依同一組 key 共用),所以同一組設定不需要各處各建一個:入口、地圖元件、規劃面板
// 呼叫它拿到同一個實例,身分也穩定(適合放進依賴陣列),不必每處都寫 useMemo(() => create…(cfg), [baseURL, token])。
// 測試要自己組實例時仍可用 createPlanAiApiDataSource。
const sharedApiDataSources = new Map<string, PlanAiDataSource>()

export function getPlanAiApiDataSource(cfg: ClientConfig): PlanAiDataSource {
  const key = `${cfg.baseURL}|${cfg.token ?? ''}`
  let ds = sharedApiDataSources.get(key)
  if (!ds) {
    ds = createPlanAiApiDataSource(cfg)
    sharedApiDataSources.set(key, ds)
  }
  return ds
}
