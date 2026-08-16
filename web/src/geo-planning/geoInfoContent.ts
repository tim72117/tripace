import type { GeoAttraction, GeoHotel, GeoPlace, GeoPlaceDetails } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'

// hotelInfoContent/placeInfoContent/poiInfoContent:把地圖點擊回報的原始
// 資料轉成 GeoInfoPanel(桌面版)/GeoOutlinePhoneInfoSheet(手機版)共用的
// GeoInfoContent 形狀——candidate 欄位是 GeoInfoContent 本身既有的
// optional 欄位(見 GeoInfoPanel.tsx 的型別定義),桌面版需要它驅動「加入
// 候選」按鈕,手機版第一階段(唯讀瀏覽)不需要,呼叫端各自決定要不要傳。
export function hotelInfoContent(h: GeoHotel): GeoInfoContent {
  return {
    name: h.name,
    photoUrl: h.photoUrl,
    subtitle: h.address,
    badges: [],
    candidate: { kind: 'hotel', ...h },
  }
}

export function placeInfoContent(p: GeoPlace): GeoInfoContent {
  return {
    name: p.name,
    photoUrl: p.photoUrl,
    subtitle: p.address,
    badges: [],
    candidate: { kind: 'place', ...p },
  }
}

// poiInfoContent:點擊地圖上 Google 原生 POI 圖標查回的 GeoPlaceDetails——
// 沒有 primaryType 欄位(GeoPlace 候選籃形狀需要,但 Places Details API
// 這支查詢沒有回傳分類),補空字串,理由同 GeoHotelSidebar 卡片「+」的
// 既有慣例(這裡的候選籃資料本來就只拿 name/address/lat/lng/photoUrl
// 顯示,primaryType 目前沒有任何顯示邏輯依賴它)。
export function poiInfoContent(details: GeoPlaceDetails): GeoInfoContent {
  return {
    name: details.name,
    photoUrl: details.photoUrl,
    subtitle: details.address,
    summary: details.summary,
    badges: details.rating != null ? [`評分 ${details.rating.toFixed(1)}`] : [],
    candidate: {
      kind: 'place',
      name: details.name,
      address: details.address,
      lat: details.lat,
      lng: details.lng,
      primaryType: '',
      photoUrl: details.photoUrl,
    },
  }
}

// attractionBadges:自建景點區域(GeoAttraction)的知名度/景點數量/範圍
// 半徑組成的 badges 陣列——AttractionInfoPanel.tsx(桌面版)與
// GeoOutlinePhoneInfoSheet.tsx(手機版)共用同一套組裝規則,理由同上方
// 三個函式,只是這裡的呼叫端不需要組出完整 GeoInfoContent(attraction
// 走獨立分支,不轉換成 GeoInfoContent 形狀,見 AttractionInfoPanel.tsx
// 開頭的說明)。
export function attractionBadges(attraction: GeoAttraction): string[] {
  return [
    ...(attraction.level != null ? [`知名度 L${attraction.level}`] : []),
    ...(attraction.placeCount != null ? [`${attraction.placeCount} 筆景點`] : []),
    ...(attraction.radiusMeters != null ? [`範圍約 ${Math.round(attraction.radiusMeters)} 公尺`] : []),
  ]
}
