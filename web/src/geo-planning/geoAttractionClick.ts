// geoAttractionClick:點擊地圖上的景點區域地標圖示時,決定「該怎麼放大
// 地圖」與「該用多大的半徑查附近推薦地點」——從 GeoOutlineMap.tsx 的
// handleAttractionClick 抽出的純決策邏輯,不碰 google.maps SDK 本身
// (實際呼叫 fitBounds/panTo/setZoom/fetchGeoPlacesNearby 的動作留在
// GeoOutlineMap.tsx,那裡才知道地圖實例與目前 zoom),讓「該做什麼」與
// 「怎麼做」分開,前者才能不依賴 Google Maps 環境單獨測試。

// 對齊 GeoOutlineMap.tsx 的 minZoomForLevel:給定一個知名度分級,回傳
// 「至少要縮放到多少 zoom 才看得到它」的最小 zoom 值——這裡重新匯出
// 一份而非從 GeoOutlineMap.tsx import,是因為該檔案有大量 Google Maps
// 型別匯入,若被這個純模組 import 會失去「不依賴 SDK」的測試優勢；兩處
// 門檻表若之後調整,要記得同步修改(各自的檔案裡都有這則提醒)。
export function minZoomForLevel(level: number): number {
  if (level <= 1) return 0
  if (level === 2) return 11
  if (level === 3) return 12
  if (level === 4) return 14
  return 15
}

// PLACES_QUERY_DEFAULT_RADIUS_METERS:單點地標(無 radiusMeters,無實際
// 範圍可言)查附近推薦地點時的退回半徑——對齊
// internal/wanttools/recommend_nearby.go 那個 LLM 工具的預設半徑。
export const PLACES_QUERY_DEFAULT_RADIUS_METERS = 1500

// FALLBACK_ZOOM_NO_LEVEL:沒有分級資訊的即時查詢結果(GeoAttraction.level
// 為 undefined)點擊放大時的退回 zoom——明顯比一般瀏覽尺度更近的固定
// 值,確保點下去有感、看得出範圍被放大了。
export const FALLBACK_ZOOM_NO_LEVEL = 16

export interface AttractionClickInput {
  radiusMeters?: number
  level?: number
}

// AttractionClickPlan 是這個決策函式的完整輸出:呼叫端(GeoOutlineMap.tsx)
// 依這個結果去呼叫對應的 Google Maps API,自己不需要重新判斷任何分支。
export type AttractionClickPlan =
  | { kind: 'fit-bounds'; radiusMeters: number }
  | { kind: 'pan-and-zoom'; minZoom: number | null }

// planAttractionClick:決定點擊後地圖該怎麼放大。
//   - 有 radiusMeters(手動整理的觀光慣稱分區才有,如清邁的古城區/尼曼區)
//     → fit-bounds,呼叫端用這個半徑算 bounds 後 fitBounds。
//   - 沒有 radiusMeters 的單點地標 → pan-and-zoom:
//       - 有 level → minZoom 帶 minZoomForLevel(level),呼叫端只在目前
//         zoom 小於這個值時才 setZoom(尊重使用者已經拉近的瀏覽尺度)。
//       - 沒有 level(即時查詢結果)→ minZoom 為 null,呼叫端改用固定的
//         FALLBACK_ZOOM_NO_LEVEL,無條件設定(不像有 level 時那樣有
//         「目前已經夠近就不動」的條件,因為沒有分級可以判斷「夠不夠近」)。
export function planAttractionClick(attraction: AttractionClickInput): AttractionClickPlan {
  if (attraction.radiusMeters && attraction.radiusMeters > 0) {
    return { kind: 'fit-bounds', radiusMeters: attraction.radiusMeters }
  }
  if (attraction.level != null) {
    return { kind: 'pan-and-zoom', minZoom: minZoomForLevel(attraction.level) }
  }
  return { kind: 'pan-and-zoom', minZoom: null }
}

// placesQueryRadiusMeters:決定點擊景點區域後,查附近推薦地點該用多大的
// 半徑——優先用該區域自己的 radiusMeters(範圍剛好對應查詢半徑),單點
// 地標沒有範圍可言,退回 PLACES_QUERY_DEFAULT_RADIUS_METERS。
export function placesQueryRadiusMeters(attraction: AttractionClickInput): number {
  return attraction.radiusMeters && attraction.radiusMeters > 0
    ? attraction.radiusMeters
    : PLACES_QUERY_DEFAULT_RADIUS_METERS
}
