import type { GeoAttraction, GeoPlaceDetails, GeoSearchResult } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'
import { type GeoCandidate } from './geoCandidateHelpers'

// searchResultInfoContent:把飯店/推薦地點/搜尋結果三種來源統一後的
// GeoSearchResult 轉成 GeoInfoPanel(桌面版)/GeoOutlinePhoneInfoSheet
// (手機版)共用的 GeoInfoContent 形狀——取代原本各自獨立的
// hotelInfoContent/placeInfoContent/geocodeCandidateInfoContent 三個函式
// (見 api.ts GeoSearchResult 的完整說明,三種來源已合併成同一份清單、
// 同一套邏輯)。candidate 欄位是 GeoInfoContent 本身既有的 optional 欄位
// (見 GeoInfoPanel.tsx 的型別定義),供呼叫端決定要不要驅動「加入候選」
// 按鈕——geocode 類型純定位用途,不能加入候選籃(理由見 GeoSearchResult
// 的說明),固定不帶 candidate;hotel/place 才組出對應的 GeoCandidate。
export function searchResultInfoContent(r: GeoSearchResult): GeoInfoContent {
  if (r.kind === 'geocode') {
    return { name: r.name, subtitle: r.address, badges: [] }
  }
  return {
    name: r.name,
    photoUrl: r.photoUrl,
    subtitle: r.address,
    badges: [],
    candidate:
      r.kind === 'hotel'
        ? { kind: 'hotel', name: r.name, address: r.address, lat: r.lat, lng: r.lng, primaryType: '', photoUrl: r.photoUrl }
        : { kind: 'place', name: r.name, address: r.address, lat: r.lat, lng: r.lng, primaryType: '', category: r.category, photoUrl: r.photoUrl },
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

// candidateInfoContent:候選籃項目本體被點擊時開資訊卡(桌面版
// GeoCandidateSidebar/AddFromCandidateSidebar、手機版候選籃抽屜共用)
// ——candidate 欄位刻意不帶(undefined),因為這個項目已經在候選籃裡,
// GeoInfoPanel/GeoOutlinePhoneInfoSheet 不需要再顯示一次「加入候選」
// 按鈕(理由同 GeoInfoContent.candidate 欄位的 optional 設計)。候選籃
// 不會出現 kind==='attraction' 的項目(attraction 沒有任何入口能被加入
// 候選籃),故這裡不需要處理該分支。entry 種類(行程本身已有座標的既有
// 內容)用 location 當 subtitle,其餘兩種沿用 address。
export function candidateInfoContent(c: Exclude<GeoCandidate, { kind: 'attraction' }>): GeoInfoContent {
  if (c.kind === 'entry') {
    return { name: c.name, subtitle: c.location ?? undefined, badges: [] }
  }
  return { name: c.name, photoUrl: c.photoUrl, subtitle: c.address, badges: [] }
}
