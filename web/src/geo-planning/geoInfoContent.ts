import type { GeoAttraction, GeoPlaceDetails, GeoSearchResult } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'
import { type GeoCandidate, searchResultToCandidate } from './geoCandidateHelpers'

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
    // placeId:只有 place 來源(GeoGeocodeCandidate,見該型別的說明)才
    // 可能有值,hotel(GeoHotel)本身已經有 eager photoUrl、
    // 沒有 placeId——見 GeoInfoContent.placeId 的完整說明,呼叫端據此決定
    // 要不要另外補查照片。
    placeId: r.placeId,
    subtitle: r.address,
    badges: [],
    candidate: searchResultToCandidate(r),
  }
}

// poiInfoContent:點擊地圖上 Google 原生 POI 圖標查回的 GeoPlaceDetails——
// 沒有 primaryType 欄位(GeoCandidate 的 place 分支需要,見
// GeoGeocodeCandidate 型別,但 Places Details API 這支查詢沒有回傳分類),
// 補空字串,理由同 GeoHotelSidebar 卡片「+」的既有慣例(這裡的候選籃
// 資料本來就只拿 name/address/lat/lng 顯示,primaryType 目前沒有任何
// 顯示邏輯依賴它)。
//
// candidate.photoUrl:GeoCandidate 的 place 分支已經跟著
// GeoGeocodeCandidate 拿掉 photoUrl、改成 placeId(見該型別的說明)——但這裡的資料
// 來源是 GeoPlaceDetails(handleGeoPlaceDetails,POI 點擊查詢,不受這次
// 背景化重構影響,仍同步回傳完整 photoUrl),且這支查詢本身沒有回傳
// placeId 讓候選籃形狀可以承接,故候選籃項目這裡不帶 photoUrl(候選籃
// UI 目前也沒有為 place 分支顯示候選卡片縮圖的路徑,僅供加入候選/寫入
// entry 使用,不影響任何畫面呈現)。頂層的 GeoInfoContent.photoUrl 仍然
// 完整帶入,資訊卡本身的照片顯示不受影響。
export function poiInfoContent(details: GeoPlaceDetails): GeoInfoContent {
  return {
    name: details.name,
    photoUrl: details.photoUrl,
    googlePhotoUrls: details.googlePhotoUrls,
    pexelsPhotoUrls: details.pexelsPhotoUrls,
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
    },
  }
}

// attractionBadges:自建景點區域(GeoAttraction)的景點數量/範圍半徑組成
// 的 badges 陣列——AttractionInfoPanel.tsx(桌面版)與
// GeoOutlinePhoneInfoSheet.tsx(手機版)共用同一套組裝規則,理由同上方
// 三個函式,只是這裡的呼叫端不需要組出完整 GeoInfoContent(attraction
// 走獨立分支,不轉換成 GeoInfoContent 形狀,見 AttractionInfoPanel.tsx
// 開頭的說明)。
//
// 2026-08:不再顯示「知名度 Lx」——level 現在身兼「主題點/精選點」的內部
// 分級用途(見 useAttractionOverlays.ts 的完整說明:level===1 是主題點,
// 其餘是精選點),已經不是給使用者看的「這個地點有多知名」資訊,繼續顯示
// 反而會讓使用者誤以為 L2/L3 代表知名度高低差異(實際上精選點之間沒有
// 這種排序意涵,只是「不是主題點」)。
export function attractionBadges(attraction: GeoAttraction): string[] {
  return [
    ...(attraction.placeCount != null ? [`${attraction.placeCount} 筆景點`] : []),
    ...(attraction.radiusMeters != null ? [`範圍約 ${Math.round(attraction.radiusMeters)} 公尺`] : []),
  ]
}

// attractionToInfoContent:2026-08 新增——「附近景點」清單(散策羅盤,見
// AttractionInfoPanel.tsx 的 nearby)點擊精選點時,把 GeoAttraction 轉成
// GeoInfoContent,讓精選點能用跟飯店/推薦地點一樣的 GeoInfoPanel(可加入
// 候選/加入行程)展示,而不是 AttractionInfoPanel 那種唯讀介紹卡——理由
// 是精選點(茶屋、店舖、餐廳這類使用者可能真的想排進行程的地點)跟
// attraction 原本設計給大範圍景點區域(整個古城、整條老街)的唯讀定位不同
// (見 AttractionInfoPanel.tsx 開頭的說明),使用者明確要求點擊後改開
// 「地點」卡片,而非沿用 attraction 卡片。
//
// candidate 直接組出 { kind: 'attraction', ...attraction }——GeoCandidate
// 型別本來就有這個分支(geoCandidateHelpers.ts),下游的
// createEntryFromCandidate/candidateEntryKind 也已經正確處理(固定對應
// entry kind 'activity',location 優先取 landmarkName),只是先前完全沒有
// UI 入口會建構它,這是第一個真正產生 attraction 候選的入口。
//
// 已知缺口:若使用者按的是「加入候選並顯示候選籃」(不選日期,直接進候選
// 籃「候選中」分組),GeoCandidateSidebar/AddFromCandidateSidebar 目前沒有
// 渲染 kind==='attraction' 候選卡片的分支(型別排除,見 candidateInfoContent
// 下方的說明)——這條路徑目前只保證「選日期排入行程」(onSchedule →
// createEntryFromCandidate → 寫入真正的 entry,寫入後會以
// kind:'entry'/inTrip:true 的形狀重新出現,走的是完全支援的既有分支)
// 沒有問題,直接進候選籃這個次要按鈕的畫面呈現尚未補上,留待之後需要時
// 再處理。
export function attractionToInfoContent(attraction: GeoAttraction): GeoInfoContent {
  return {
    name: attraction.name,
    photoUrl: attraction.landmarkPhotoUrl,
    subtitle: attraction.landmarkName && attraction.landmarkName !== attraction.name
      ? attraction.landmarkName
      : undefined,
    summary: attraction.summary,
    badges: attractionBadges(attraction),
    candidate: { kind: 'attraction', ...attraction },
  }
}

// candidateInfoContent:候選籃項目本體被點擊時開資訊卡(桌面版
// GeoCandidateSidebar/AddFromCandidateSidebar、手機版候選籃抽屜共用)
// ——candidate 欄位刻意不帶(undefined),因為這個項目已經在候選籃裡,
// GeoInfoPanel/GeoOutlinePhoneInfoSheet 不需要再顯示一次「加入候選」
// 按鈕(理由同 GeoInfoContent.candidate 欄位的 optional 設計)。候選籃
// 目前仍不會出現 kind==='attraction' 的「候選中」項目進到這個函式——
// attractionToInfoContent(見上方)只有「選日期排入行程」這條路徑會真的
// 建立資料,寫入後轉成 kind:'entry' 形狀,不會停留在 attraction 候選
// 形狀被點擊觸發這裡,故這裡暫時不需要處理該分支。entry 種類(行程本身
// 已有座標的既有內容)用 location 當 subtitle,其餘兩種沿用 address。
export function candidateInfoContent(c: Exclude<GeoCandidate, { kind: 'attraction' }>): GeoInfoContent {
  if (c.kind === 'entry') {
    return { name: c.name, subtitle: c.location ?? undefined, badges: [] }
  }
  // hotel 候選有 photoUrl(GeoHotel 查詢完成時就同步帶照片);place 候選
  // 用 placeId(見 GeoGeocodeCandidate/GeoCandidate 的說明),交給
  // useGeoPlanningState.ts 的 infoContentPhotoFetch effect 補查。
  return {
    name: c.name,
    photoUrl: c.kind === 'hotel' ? c.photoUrl : undefined,
    placeId: c.kind === 'place' ? c.placeId : undefined,
    subtitle: c.address,
    badges: [],
  }
}
