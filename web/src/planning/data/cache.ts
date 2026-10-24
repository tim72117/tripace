import type { ClientConfig, GeoPlaceDetails } from '../../api'
import { fetchGeoPlaceDetails, fetchPublicGeoPlaceDetails } from '../../api'
import { PlaceDetailsDedupe } from './dedupe'

// 實作:用 planning/data/dedupe.ts 的 PlaceDetailsDedupe(進行中共用 + 成功結果記憶,失敗不記)——
// 與資料存取層 placeDetails(place-details-any,另一個端點與形狀)的去重是同一套機制,這裡只是政策不同:
// 這份存的是 geo/place-details(GeoPlaceDetails),整個頁面存活期間一律記憶、不過期、不限筆數(沿用原本行為),
// 照片重試查到新結果時用 updateCachedPlaceDetails 覆寫,讓地圖縮圖與詳情卡看到同一份最新資料。
const store = new PlaceDetailsDedupe({
  ttlMs: Number.POSITIVE_INFINITY,
  maxEntries: Number.POSITIVE_INFINITY,
  shouldRemember: () => true,
})

// getCachedPlaceDetails——同步讀取已經快取的結果,不觸發任何查詢。供
// 呼叫端(例如 AttractionInfoPanel 在自己的 effect 跑之前)判斷「這個
// placeId 是否已經有現成資料可以直接用,不需要顯示 loading/placeholder
// 過場」。
export function getCachedPlaceDetails(placeId: string): GeoPlaceDetails | undefined {
  return store.peek<GeoPlaceDetails>(placeId)
}

// updateCachedPlaceDetails——2026-10 code review 抓到的 bug 修正:
// attractionGlowLayer.ts 對主題點套用的照片重試機制
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
  store.replace(placeId, details)
}

// fetchPlaceDetailsCached——呼叫端改用這支函式取代直接呼叫
// fetchGeoPlaceDetails/fetchPublicGeoPlaceDetails,讓同一個 placeId 的
// 查詢在整個頁面範圍內最多只有一個真正送出的請求。usePublic 對齊兩個
// 呼叫端原有的 usePublicPlaceDetails 語意,決定要打 /internal/* 還是
// /public/* 版本的端點。
export function fetchPlaceDetailsCached(
  cfg: ClientConfig,
  placeId: string,
  usePublic: boolean,
): Promise<GeoPlaceDetails> {
  const fetcher = usePublic ? fetchPublicGeoPlaceDetails : fetchGeoPlaceDetails
  return fetchPlaceDetailsCachedVia((pid) => fetcher(cfg, pid), placeId)
}

// fetchPlaceDetailsCachedVia——同一份快取與 in-flight 去重,但查詢函式由呼叫端傳入(2026-10:光暈走資料存取層
// 實例的 geoPlaceDetails,端點由實例決定,不再由 cfg + usePublic 旗標選)。fetchPlaceDetailsCached 是它的
// 舊介面轉接。
export function fetchPlaceDetailsCachedVia(
  fetchDetails: (placeId: string) => Promise<GeoPlaceDetails>,
  placeId: string,
): Promise<GeoPlaceDetails> {
  return store.get(placeId, () => fetchDetails(placeId))
}

// clearPlaceDetailsCacheForTests——僅供測試使用,清空模組級的快取/
// in-flight 狀態。這份快取刻意是模組級單例(見檔案開頭的完整說明),
// 多個測試檔/測試案例若查詢同一個 placeId(測試資料常重複使用相同的
// 假 placeId 字串),不清空會讓後面的測試誤判成「已經快取,不會呼叫
// mock」,拿到跟上一個測試殘留的結果。正式程式碼不應該呼叫這支函式
// ——頁面存活期間快取本該持續有效,不該有任何時機點需要清空它。
export function clearPlaceDetailsCacheForTests(): void {
  store.clear()
}
