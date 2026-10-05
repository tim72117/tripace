import type { ClientConfig, GeoPlaceDetails } from '../api'
import { fetchGeoPlaceDetails, fetchPublicGeoPlaceDetails } from '../api'

// placeDetailsCache——useAttractionOverlays.ts(地圖上的景點圓點/縮圖)與
// AttractionInfoPanel.tsx(點開景點後的詳情卡)原本各自獨立呼叫
// fetchGeoPlaceDetails/fetchPublicGeoPlaceDetails,互不知情對方是否已經
// 查過、或正在查同一個 placeId——使用者點擊一個地圖上已顯示 overlay 的
// 精選點時,兩邊幾乎同時對同一個 placeId 發出請求,撞上後端 per-user
// 節流(server/internal/api/api.go 的 throttleGeoQueryByUser,200ms 一次)
// 其中一個被 429 擋下(2026-10 實測記錄)。
//
// 模組級(不是某個 hook/component 的 useRef)的 Map 是刻意的:這個問題的
// 本質是「同一個 placeId,被兩個互不相干的元件各自查詢」,快取若仍然各自
// 存在元件自己的 useRef 裡,即使各自都有快取,第一次相遇(一邊還沒查完、
// 另一邊也還沒查)仍然會各發一次請求。放在模組層級,兩邊 import 到的是
// 同一份 Map,才能真正做到「誰先發出請求,後來者就等同一個 Promise,不
// 另外發送」。
//
// 快取 Promise 而非已解析的值,是 in-flight 去重的關鍵:查詢進行中時
// Map 裡存的就是那個尚未完成的 Promise,後來者 get 到的是同一個物件,
// await 它即可拿到同一次請求的結果,不會各自觸發一次網路呼叫。查詢失敗
// 時立即把這個 key 從 Map 移除(不快取失敗結果)——理由同兩個呼叫端原本
// 各自的既有行為:失敗可能是暫時性的,不該讓這個 placeId 之後永遠查不到
// 結果。
//
// 額外好處(非本次要解決的主要問題,但值得記錄):後端 handleGeoPlaceDetails
// 每次被呼叫都會 IncrementPlaceClickCount,推進漸進補圖節奏(見
// fetchGeoPlacePhotoAssets 開頭註解的完整說明)——共用快取連帶減少了
// 這個計數被同一個使用者短時間內重複推進的次數,雖然不是這次要解決的
// 核心問題。
const inFlight = new Map<string, Promise<GeoPlaceDetails>>()

// resolvedCache:查詢已完成(不論是這次呼叫還是之前任何一次)的結果——
// 跟 inFlight 分開是因為两者的生命週期不同:inFlight 的條目在請求完成
// (成功或失敗)後就該移除(見下方 finally),已完成的結果則應該比照
// useAttractionOverlays.ts 原本 photoUrlCacheRef 的既有行為,整個 session
// 期間持續有效,不隨任一呼叫端的元件掛載/卸載而清空。
const resolvedCache = new Map<string, GeoPlaceDetails>()

// getCachedPlaceDetails——同步讀取已經快取的結果,不觸發任何查詢。供
// 呼叫端(例如 AttractionInfoPanel 在自己的 effect 跑之前)判斷「這個
// placeId 是否已經有現成資料可以直接用,不需要顯示 loading/placeholder
// 過場」。
export function getCachedPlaceDetails(placeId: string): GeoPlaceDetails | undefined {
  return resolvedCache.get(placeId)
}

// updateCachedPlaceDetails——2026-10 code review 抓到的 bug 修正:
// useAttractionOverlays.ts 對主題點套用的照片重試機制
// (fetchPlaceDetailsWithPhotoRetry,見 ../photoRetry.ts)查到照片後,
// 只會透過 onUpdate 更新地圖 overlay 本身,不會經過 fetchPlaceDetailsCached
// 的 .then(見上方),導致 resolvedCache 永遠停留在「第一次查詢、還沒
// 補到圖」的版本——使用者點開 AttractionInfoPanel 詳情卡時,
// getCachedPlaceDetails 會命中這份過期快取,卡片顯示沒有照片,即使地圖
// 縮圖其實已經補上了,且沒有任何 TTL 會讓它自己修正。供重試機制在每次
// 查到新結果時呼叫,把合併後的最新內容寫回同一份共用快取,讓兩邊(地圖
// overlay/詳情卡)看到的永遠是同一份最新資料,不只是 fetchPlaceDetailsCached
// 第一次查詢那個時間點的快照。只在已經有快取紀錄時才覆寫(没有的話代表
// 還沒真正呼叫過 fetchPlaceDetailsCached,不該由這裡意外建立一筆)。
export function updateCachedPlaceDetails(placeId: string, details: GeoPlaceDetails): void {
  if (!resolvedCache.has(placeId)) return
  resolvedCache.set(placeId, details)
}

// fetchPlaceDetailsCached——兩個呼叫端(useAttractionOverlays.ts/
// AttractionInfoPanel.tsx)都改用這支函式取代直接呼叫
// fetchGeoPlaceDetails/fetchPublicGeoPlaceDetails,讓同一個 placeId 的
// 查詢在整個頁面範圍內最多只有一個真正送出的請求。usePublic 對齊兩個
// 呼叫端原有的 usePublicPlaceDetails 語意,決定要打 /internal/* 還是
// /public/* 版本的端點。
export function fetchPlaceDetailsCached(
  cfg: ClientConfig,
  placeId: string,
  usePublic: boolean,
): Promise<GeoPlaceDetails> {
  const cached = resolvedCache.get(placeId)
  if (cached) return Promise.resolve(cached)

  const existing = inFlight.get(placeId)
  if (existing) return existing

  const fetcher = usePublic ? fetchPublicGeoPlaceDetails : fetchGeoPlaceDetails
  const promise = fetcher(cfg, placeId)
    .then((details) => {
      resolvedCache.set(placeId, details)
      return details
    })
    .finally(() => {
      inFlight.delete(placeId)
    })
  inFlight.set(placeId, promise)
  return promise
}

// clearPlaceDetailsCacheForTests——僅供測試使用,清空模組級的快取/
// in-flight 狀態。這份快取刻意是模組級單例(見檔案開頭的完整說明),
// 多個測試檔/測試案例若查詢同一個 placeId(測試資料常重複使用相同的
// 假 placeId 字串),不清空會讓後面的測試誤判成「已經快取,不會呼叫
// mock」,拿到跟上一個測試殘留的結果。正式程式碼不應該呼叫這支函式
// ——頁面存活期間快取本該持續有效,不該有任何時機點需要清空它。
export function clearPlaceDetailsCacheForTests(): void {
  inFlight.clear()
  resolvedCache.clear()
}
