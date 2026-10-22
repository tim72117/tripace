import {
  fetchPlanAiAttractionSearch,
  fetchPlanAiPlaceDetailsAny,
  fetchPlanAiPlaceSearch,
  fetchPublicGeoAttractionByID,
  fetchPublicGeoAttractions,
  fetchPublicGeoPlaceDetails,
  fetchPublicGeoPlacePhotoAssets,
  type ClientConfig,
  type GeoAttraction,
} from '../../api'
import { getSharedPlaceDetailsDedupe } from './placeDetailsDedupe'
import type { PlanAiDataSource, PlanAiSearchNearbyResult } from './planAiDataSource'

// planAiPublicDataSource.ts — PlanAiDataSource 的「訪客」實作:全部打
// /public/* 端點,不需要登入。
//
// 2026-10 新增(使用者實機回報「很多錯誤」,網路面板顯示未登入狀態下
// /internal/geo/place-photo-assets 連噴 8 次 401、transit-estimate 噴
// 2 次)。
//
// 背景:/ai-plan 原本的假設是「展示頁播劇本,不需要真的查後端」,所以
// createPlanAiApiDataSource 固定打 /internal/*,註解也寫明「公開展示頁
// 固定用假資料實作」。但 ?skipDemo=1 讓未登入訪客直接進真實 AI 推論
// (那正是這個參數的用途),那個假設就不成立了——AI 查得到地點詳情
// (place-details-any 有公開版),卻補不上照片與交通時間。
//
// 為什麼是第三份實作,不是在 api 實作裡加 `cfg.token ? a : b`:
// 「訪客模式」是一種完整的資料來源,不是每個方法各自的分岔。分岔寫在
// 方法裡的話,每新增一個方法都要記得加判斷,而且 transit-estimate 這種
// 「公開版根本不存在」的限制只能寫成特例;寫成獨立實作,那個限制就是
// 這個檔案裡一段明確的程式碼與說明(見下方 transitEstimate)。
// 這也對齊 PlanTimelineStore 的既有模式(localStorage/noop/draft 三份
// 實作,而不是一份實作內部判斷要不要真的寫入)。

// GUEST_CFG——token 為 null 的設定。api.ts 的 fetchPlanAiPlaceSearch/
// AttractionSearch/PlaceDetailsAny 三支看到 token 是 null 就會自動改打
// /public/ 版本(見那幾支的 `cfg.token ? internal : public`),所以這裡
// 直接重用它們,不需要另外包一層 public 專用的函式。
// 寫法比照 InteractiveExploreMap.tsx / BlogArticlePage.tsx 的既有慣例。
function guestCfg(baseURL: string): ClientConfig {
  return { baseURL, token: null }
}

async function searchNearbyByCoords(cfg: ClientConfig, lat: number, lng: number): Promise<PlanAiSearchNearbyResult> {
  try {
    const { attractions } = await fetchPlanAiAttractionSearch(cfg, lat, lng)
    const candidates = attractions
      .filter((a) => !!a.placeId)
      .map((a) => ({ placeId: a.placeId!, name: a.name, summary: a.summary, category: a.category }))
    return { found: true, candidates }
  } catch {
    // 降級成「查無候選」而非往上拋——理由同 planAiApiDataSource.ts 的
    // 同名函式(呼叫端失敗時該顯示空狀態,不該整頁壞掉)。
    return { found: true, candidates: [] }
  }
}

export function createPlanAiPublicDataSource(baseURL: string): PlanAiDataSource {
  const cfg = guestCfg(baseURL)
  // 去重(見 placeDetailsDedupe.ts):plan-ai-sim/Content 的 askPageDataSource 與
  // LivePlanLayer 的 publicDataSource 是兩個不同實例,所以記憶依 baseURL 共用。
  const dedupe = getSharedPlaceDetailsDedupe(`public|${baseURL}`)
  return {
    placeDetails: (placeId) => dedupe.get(placeId, () => fetchPlanAiPlaceDetailsAny(cfg, placeId)),
    // transitEstimate——後端目前沒有公開版(只有
    // GET /internal/geo/plan-ai/transit-estimate,見 api.go 該路由上方
    // 的註解:「transit-estimate 這兩支目前確認的展示頁流程不需要查詢,
    // 仍留在 internal」——那個判斷在展示頁只播劇本時成立,?skipDemo=1
    // 之後不再成立)。
    //
    // 這裡直接讓它失敗,不打任何端點:打了必然 401,徒增一次請求與一筆
    // console 錯誤,而呼叫端(refreshTransitForStop)對失敗的處理本來
    // 就是「這一段不顯示交通資訊」,行為一致。
    //
    // 要讓訪客也看到交通時間,得先在後端開放 /public/geo/plan-ai/
    // transit-estimate——那會多一個消耗 Google API 配額的公開端點,
    // 需要比照 place-search 那批加上 IP 節流,是獨立的決定,不在這個
    // 檔案的範圍內。
    // 2026-10 修正:原本 resolve 一組空值 { mode: '', minutes: 0, distance: '' },
    // 以為那等同「沒有交通資訊」。實際上呼叫端(TripPlanPage 的
    // refreshTransitForStop)走的是成功分支,無條件把它寫進
    // transitFromPrev,渲染端(PlanTimelineView)的判斷是
    // `transit.minutes != null`——0 會通過,於是每一段路程都顯示
    // 「🚶 0 分」的假資訊,比原本 401 時什麼都不顯示更糟。
    //
    // 改成 reject:呼叫端既有的 .catch 會把 transitFromPrev 清成
    // undefined,膠囊完全不渲染——那才是這個檔案原本註解說的「這一段
    // 不顯示交通」。
    transitEstimate: () =>
      Promise.reject(new Error('訪客模式沒有交通時間估算:後端沒有 /public/geo/plan-ai/transit-estimate 公開端點')),
    photoAssets: (placeId) => fetchPublicGeoPlacePhotoAssets(cfg, placeId),
    geoPlaceDetails: (placeId) => fetchPublicGeoPlaceDetails(cfg, placeId),
    attractionsByCity: async (city) => (await fetchPublicGeoAttractions(cfg, city)).attractions ?? [],
    attractionByID: (id) => fetchPublicGeoAttractionByID(cfg, id),
    // 訪客沒有 token,/internal 會 401,改打後端已開放的免登入端點(查自家資料庫、
    // 免費、有 IP 節流)。api.ts 沒有訪客版包裝函式,fetch 就放在這個資料存取層裡。
    nearbyAttractionAreas: async (lat, lng, radiusMeters) => {
      const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radiusMeters) })
      const res = await fetch(`${cfg.baseURL.replace(/\/+$/, '')}/public/geo/attractions/nearby-only?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { attractions?: GeoAttraction[] }
      return body.attractions ?? []
    },
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

// getPlanAiPublicDataSource——依 baseURL 共用同一個訪客版實例(理由同 getPlanAiApiDataSource)。
const sharedPublicDataSources = new Map<string, PlanAiDataSource>()

export function getPlanAiPublicDataSource(baseURL: string): PlanAiDataSource {
  let ds = sharedPublicDataSources.get(baseURL)
  if (!ds) {
    ds = createPlanAiPublicDataSource(baseURL)
    sharedPublicDataSources.set(baseURL, ds)
  }
  return ds
}
