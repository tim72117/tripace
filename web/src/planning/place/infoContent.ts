import type { GeoAttraction, GeoPlaceDetails, GeoSearchResult } from '../../api'
import type { PlaceInfoContent } from './PlacePanel'
import { type GeoCandidate, searchResultToCandidate } from './candidateHelpers'

// searchResultInfoContent:把飯店/推薦地點/搜尋結果三種來源統一後的
// GeoSearchResult 轉成 PlacePanel(桌面版)/PlanPhoneInfoSheet
// (手機版)共用的 PlaceInfoContent 形狀——取代原本各自獨立的
// hotelInfoContent/placeInfoContent/geocodeCandidateInfoContent 三個函式
// (見 api.ts GeoSearchResult 的完整說明,三種來源已合併成同一份清單、
// 同一套邏輯)。candidate 欄位是 PlaceInfoContent 本身既有的 optional 欄位
// (見 PlacePanel.tsx 的型別定義),供呼叫端決定要不要驅動「加入候選」
// 按鈕——geocode 類型純定位用途,不能加入候選籃(理由見 GeoSearchResult
// 的說明),固定不帶 candidate;hotel/place 才組出對應的 GeoCandidate。
export function searchResultInfoContent(r: GeoSearchResult): PlaceInfoContent {
  if (r.kind === 'geocode') {
    return { name: r.name, subtitle: r.address, badges: [] }
  }
  return {
    name: r.name,
    photoUrl: r.photoUrl,
    // placeId:只有 place 來源(GeoGeocodeCandidate,見該型別的說明)才
    // 可能有值,hotel(GeoHotel)本身已經有 eager photoUrl、
    // 沒有 placeId——見 PlaceInfoContent.placeId 的完整說明,呼叫端據此決定
    // 要不要另外補查照片。
    placeId: r.placeId,
    subtitle: r.address,
    badges: [],
    // 有 placeId 才會去查文字(見 PlaceInfoContent.textStatus 的說明)。
    textStatus: r.placeId != null ? 'pending' : undefined,
    // 照片:有 placeId、又還沒有照片才要查(見 PlaceInfoContent.photoStatus)。
    photoStatus: r.placeId != null && !r.photoUrl ? 'pending' : undefined,
    candidate: searchResultToCandidate(r),
  }
}

// poiInfoContent:點擊地圖上 Google 原生 POI 圖標查回的 GeoPlaceDetails——
// 沒有 primaryType 欄位(GeoCandidate 的 place 分支需要,見
// GeoGeocodeCandidate 型別,但 Places Details API 這支查詢沒有回傳分類),
// 補空字串,理由同 planning/place/desktop/ResultList 卡片「+」的既有慣例(這裡的候選籃
// 資料本來就只拿 name/address/lat/lng 顯示,primaryType 目前沒有任何
// 顯示邏輯依賴它)。
//
// candidate.photoUrl:GeoCandidate 的 place 分支已經跟著
// GeoGeocodeCandidate 拿掉 photoUrl、改成 placeId(見該型別的說明)——但這裡的資料
// 來源是 GeoPlaceDetails(handleGeoPlaceDetails,POI 點擊查詢),且這支
// 查詢本身沒有回傳 placeId 讓候選籃形狀可以承接,故候選籃項目這裡不帶
// photoUrl(候選籃 UI 目前也沒有為 place 分支顯示候選卡片縮圖的路徑,
// 僅供加入候選/寫入 entry 使用,不影響任何畫面呈現)。
//
// 2026-10:GeoPlaceDetails 已經拿掉 photoUrl 欄位(見該型別的完整
// 說明,後端不再傳這個相容欄位),這裡不再把 details.photoUrl 往下帶
// ——PlaceInfoContent.photoUrl 這個頂層欄位仍保留(供 GeoSearchResult
// 等只有單張圖的來源使用,見 PlacePanel.tsx 的完整說明),只是這個函式
// 的資料來源(GeoPlaceDetails)已經沒有這個值可帶,資訊卡的照片顯示
// 改由 googlePhotoUrls 清單負責(PhotoCarousel.tsx 收到空的 fallbackUrl
// 時不受影響)。
export function poiInfoContent(details: GeoPlaceDetails): PlaceInfoContent {
  return {
    name: details.name,
    googlePhotoUrls: details.googlePhotoUrls,
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
// PlanPhoneInfoSheet.tsx(手機版)共用同一套組裝規則,理由同上方
// 三個函式,只是這裡的呼叫端不需要組出完整 PlaceInfoContent(attraction
// 走獨立分支,不轉換成 PlaceInfoContent 形狀,見 AttractionInfoPanel.tsx
// 開頭的說明)。
//
// 2026-08:不再顯示「知名度 Lx」——level 現在身兼「主題點/精選點」的內部
// 分級用途(見 attractionGlowLayer.ts 的完整說明:level===1 是主題點,
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
// PlaceInfoContent,讓精選點能用跟飯店/推薦地點一樣的 PlacePanel(可加入
// 候選/加入行程)展示,而不是 AttractionInfoPanel 那種唯讀介紹卡——理由
// 是精選點(茶屋、店舖、餐廳這類使用者可能真的想排進行程的地點)跟
// attraction 原本設計給大範圍景點區域(整個古城、整條老街)的唯讀定位不同
// (見 AttractionInfoPanel.tsx 開頭的說明),使用者明確要求點擊後改開
// 「地點」卡片,而非沿用 attraction 卡片。
//
// candidate 直接組出 { kind: 'attraction', ...attraction }——GeoCandidate
// 型別本來就有這個分支(candidateHelpers.ts),下游的
// createEntryFromCandidate/candidateEntryKind 也已經正確處理(固定對應
// entry kind 'activity',location 優先取 landmarkName),只是先前完全沒有
// UI 入口會建構它,這是第一個真正產生 attraction 候選的入口。
//
// 已知缺口:若使用者按的是「加入候選並顯示候選籃」(不選日期,直接進候選
// 籃「候選中」分組),planning/place/desktop/CandidateList 目前沒有渲染 kind==='attraction'
// 候選卡片的分支(型別排除,見 candidateInfoContent 下方的說明)——這條
// 路徑目前只保證「選日期排入行程」(onSchedule →
// createEntryFromCandidate → 寫入真正的 entry,寫入後會以
// kind:'entry'/inTrip:true 的形狀重新出現,走的是完全支援的既有分支)
// 沒有問題,直接進候選籃這個次要按鈕的畫面呈現尚未補上,留待之後需要時
// 再處理。
export function attractionToInfoContent(attraction: GeoAttraction): PlaceInfoContent {
  return {
    name: attraction.name,
    // photoUrl 不再讀 attraction.landmarkPhotoUrl(2026-09 使用者明確
    // 要求「完全不要使用 landmarkPhotoUrl」)——固定 undefined,有
    // placeId 時交給 PlaceInfoContent.placeId 說明裡提到的既有機制
    // (usePlanningState.ts 的 placePhotoFetch effect)自動呼叫
    // fetchGeoPlacePhoto 補查,那支端點跟主題介紹卡(AttractionInfoPanel.tsx)
    // 是同一套 photo_assets 資料來源(見後端 applyPhotoAssetsAsSource 的
    // 完整說明),不是另外重新發明一條查詢路徑。沒有 placeId 的地點(舊
    // 資料,尚未補上 place_id)固定顯示 placeholder,不回退任何舊表資料。
    photoUrl: undefined,
    placeId: attraction.placeId,
    // 有 placeId 時照片待查(usePlanningState 的 placePhotoFetch 會查)。注意:
    // 不經過 usePlanningState 顯示的呼叫端(例如桌面版第二張 PlacePanel 的
    // nearbyInfoContent、useThemeAttractionSelection 的 poiContent)沒有人查,
    // 要自己把它改成最終狀態,否則會一直掃光。
    photoStatus: attraction.placeId != null ? 'pending' : undefined,
    subtitle: attraction.landmarkName && attraction.landmarkName !== attraction.name
      ? attraction.landmarkName
      : undefined,
    summary: attraction.summary,
    badges: attractionBadges(attraction),
    candidate: { kind: 'attraction', ...attraction },
  }
}

// candidateInfoContent:候選籃項目本體被點擊時開資訊卡(桌面版
// planning/place/desktop/CandidateList、手機版候選籃抽屜共用)——candidate 欄位刻意不帶
// (undefined),因為這個項目已經在候選籃裡,
// PlacePanel/PlanPhoneInfoSheet 不需要再顯示一次「加入候選」
// 按鈕(理由同 PlaceInfoContent.candidate 欄位的 optional 設計)。候選籃
// 目前仍不會出現 kind==='attraction' 的「候選中」項目進到這個函式——
// attractionToInfoContent(見上方)只有「選日期排入行程」這條路徑會真的
// 建立資料,寫入後轉成 kind:'entry' 形狀,不會停留在 attraction 候選
// 形狀被點擊觸發這裡,故這裡暫時不需要處理該分支。entry 種類(行程本身
// 已有座標的既有內容)用 location 當 subtitle,其餘兩種沿用 address。
export function candidateInfoContent(c: Exclude<GeoCandidate, { kind: 'attraction' }>): PlaceInfoContent {
  if (c.kind === 'entry') {
    return { name: c.name, subtitle: c.location ?? undefined, badges: [] }
  }
  // hotel 候選有 photoUrl(GeoHotel 查詢完成時就同步帶照片);place 候選
  // 用 placeId(見 GeoGeocodeCandidate/GeoCandidate 的說明),交給
  // usePlanningState.ts 的 placePhotoFetch effect 補查;文字(簡介、
  // 評分)同樣由 placeTextFetch effect 補查,故有 placeId 時 textStatus 是
  // 'pending'。
  const placeId = c.kind === 'place' ? c.placeId : undefined
  return {
    name: c.name,
    photoUrl: c.kind === 'hotel' ? c.photoUrl : undefined,
    placeId,
    subtitle: c.address,
    badges: [],
    textStatus: placeId != null ? 'pending' : undefined,
    photoStatus: placeId != null ? 'pending' : undefined,
  }
}

// reservesLateTextSlots:這張資訊卡的評分徽章/簡介是否可能「卡片開了之後才
// 補上」——Google 地點來源(有 placeId、不是人工建檔景點)開卡時通常只有
// 名稱+地址,評分與簡介要等 place-text 查詢回來才 PATCH 進來(見
// planning/member/usePlanningState.ts 的 patchGeocodeCandidateText),中間
// 這段時間若不預留空間,徽章列冒出來、簡介從一行變三行時,下方內容(加入
// 行程按鈕、照片、地址)會整塊往下跳。呼叫端(PlacePanel/
// PlanPhoneInfoSheet)用這個判斷要不要固定保留徽章列高度與簡介最小高度。
// 人工建檔景點(candidate.kind==='attraction')的文字是同步帶進來的,不需要
// 預留,避免短簡介下方多出一塊空白。
//
// 刻意只看 placeId、不看 textStatus(2026-10 評估後的取捨):文字查完
// (textStatus 變 undefined)但確實沒有評分/簡介時,若此時才收起空徽章列
// (19px),下方的照片、簡介、按鈕會在使用者眼前往上跳一次——跟「先站位、
// 資料到了也不推擠」的原則相反。保留空列的代價只是一條固定的空白,比查完
// 才跳動好;訪客版(沒有 placeText,開卡就知道不會有文字)理論上可以一開始
// 就不預留,但這需要卡片內容另外帶「這個來源不查文字」的資訊,目前不值得為
// 這 19px 多開一個欄位,維持一致的版面。
export function reservesLateTextSlots(content: PlaceInfoContent): boolean {
  return content.placeId != null && content.candidate?.kind !== 'attraction'
}
