import type { GeoSearchResult } from '../../api'
import { ASK_CANDIDATE_CATEGORY } from '../map/mapMarkers'

// askMapView——詢問頁(選擇景點)的候選點在地圖上的畫法(使用者明確要求「感興趣點要用 searchResultLayer 換置地圖點」)。
//
// 詢問頁(AskPage 的 CandidatesPanel)把候選點與目前勾選回報上來,經 TripPlanPage 的 onAskMapViewChange 一路傳到各入口的地圖,
// 地圖把它們併進搜尋結果標記(map/draw/layers/searchResultLayer.ts)畫出來:候選是 kind 'place' 的標記,已勾選的帶勾選徽章
// (候選籃標記),點標記可切換勾選(onToggle)。詢問頁關閉、換頁時回報空檢視,標記跟著清掉。

// AskMapPoint——地圖上要畫的一個候選點。
export interface AskMapPoint {
  placeId: string
  name: string
  lat: number
  lng: number
}

// AskMapView——地圖要畫的詢問頁候選。results 是現成的搜尋結果標記資料;selectedPlaceIds 是目前勾選的;
// onToggle 由詢問頁提供(點地圖標記等同點該張候選卡),沒有候選頁時為 undefined。
export interface AskMapView {
  results: GeoSearchResult[]
  selectedPlaceIds: string[]
  onToggle?: (placeId: string) => void
}

export const EMPTY_ASK_MAP_VIEW: AskMapView = { results: [], selectedPlaceIds: [] }

export function askPointToSearchResult(p: AskMapPoint): GeoSearchResult {
  return { kind: 'place', name: p.name, address: '', lat: p.lat, lng: p.lng, placeId: p.placeId, category: ASK_CANDIDATE_CATEGORY }
}

export function buildAskMapView(points: AskMapPoint[], selectedPlaceIds: string[], onToggle?: (placeId: string) => void): AskMapView {
  if (points.length === 0) return EMPTY_ASK_MAP_VIEW
  return { results: points.map(askPointToSearchResult), selectedPlaceIds, onToggle }
}
