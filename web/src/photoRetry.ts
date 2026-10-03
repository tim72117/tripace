// photoRetry.ts — 「查到地點資料但沒有照片時,原地重試幾次等背景補圖
// 完成」這個策略的共用常數與純函式判斷邏輯。
//
// 2026-10 code review 發現:地圖版 geo-planning/useThemeAttractionSelection.ts
// 的 retryWithPhotoAssetsOnly 跟 AI 規劃版 trip-plan/TripPlanPage.tsx 的
// retryPhotoOnly 是兩份幾乎一模一樣的重試邏輯複製——PHOTO_RETRY_DELAY_MS/
// PHOTO_RETRY_MAX_ATTEMPTS 數值相同、「是否已經有照片」的判斷邏輯相同、
// 連解釋理由的註解都幾乎一樣。這是使用者明確要求「AI 規劃版採用一樣的
// 補圖,前端也用一樣的重試機制」刻意對齊的結果,只是實作時各自複製了
// 一份,日後調整重試策略(例如因應配額考量)容易漏改一邊、讓兩邊行為
// 悄悄不一致。
//
// 這裡只抽出「本質相同、呼叫端狀態管理模型不影響其結果」的部分:
//   - PHOTO_RETRY_DELAY_MS/PHOTO_RETRY_MAX_ATTEMPTS 這兩個數值
//   - hasAnyPhoto 這個純函式判斷
// 不抽重試迴圈本身——兩邊的狀態更新方式本質不同:地圖版用 Promise 鏈
// (sleep + 遞迴 .then,結果透過 Promise resolve 與 onUpdate callback
// 雙軌回報完整的 PlaceInfoContent),AI 規劃版用 window.setTimeout 遞迴
// 直接呼叫 setTimeline 更新時間軸裡特定節點的欄位,沒有回傳 Promise。
// 硬抽成同一個函式需要呼叫端傳入一堆回調跟泛型參數,複雜度會超過各自
// 保留約 15 行重試迴圈的重複——兩邊會用到的只有延遲時間、重試次數、
// 判斷式這三樣「數值跟規則」,不是「流程骨架」,抽這三樣已經足夠讓
// 「調整重試策略只需要改一個地方」這個目標達成,不需要為了消滅全部
// 重複而犧牲可讀性。

export const PHOTO_RETRY_DELAY_MS = 2000
export const PHOTO_RETRY_MAX_ATTEMPTS = 3

export function hasAnyPhoto(content: { photoUrl?: string; googlePhotoUrls?: string[] }): boolean {
  return !!content.photoUrl || (content.googlePhotoUrls?.length ?? 0) > 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// fetchPlaceDetailsWithPhotoRetry — 2026-10 code review 發現的真正缺口:
// geo-planning/ExploreMap.tsx 裡「直接點擊地圖上 Google 原生 POI 圖標」
// 與「點擊非主題點地標、查到 placeId 後打 Google Place Details」這兩處
// (handleAttractionClickRouted 的 d.placeId 分支、原生 POI click
// listener)都是單純呼叫一次 fetchPlaceDetails 就直接回報結果給呼叫端,
// 完全沒有接上 useThemeAttractionSelection.ts fetchPoiContent 既有的
// 「查完沒照片,原地重試幾次等背景補圖完成」機制——查詢當下若剛好觸發
// 後端背景補圖(見 handleGeoPlaceDetails 的完整說明),這次回應不會等
// 下載完成,使用者會看到這張卡片沒有照片,且不會自動補上,除非手動重新
// 點擊觸發下一次查詢。
//
// 這支函式把 fetchPoiContent 裡「已經有 placeId,查詳情+沒圖時重試」
// 這段核心邏輯抽出來,不依賴 GeoAttraction(fetchPoiContent 的第一個
// 參數,用來在查無 placeId 時 fallback 成 attractionToInfoContent)——
// 直接點擊 Google 原生 POI 圖標完全沒有對應的 GeoAttraction 物件可以
// retro,不能直接套用 fetchPoiContent 的介面,故需要一支更底層、以
// GeoPlaceDetails 本身為操作對象的版本,讓 fetchPoiContent 改為基於
// 它實作,也讓 ExploreMap.tsx 這兩處能直接呼叫同一套重試邏輯,不再各自
// 停在「查一次就結束」。
//
// 回傳 Promise(resolve 最終結果,含重試後的最新照片),onUpdate(第二
// 參數)比照 fetchPoiContent 的既有慣例:第一次查詢完成就呼叫一次(讓
// 呼叫端立刻顯示卡片,不被後續的照片重試拖慢顯示時機),之後每次重試
// 查到新結果也會再呼叫一次。
//
// fetchPhotoAssets:第一次查詢沒有照片時,後續重試改呼叫這支函式(純讀
// photo_assets,不觸發點擊計數/漸進補圖決策),不能重複呼叫
// fetchPlaceDetails——理由同 fetchPoiContent 的完整說明,連續重試會
// 重複推進漸進補圖的點擊節奏判斷。省略這個參數時完全不重試,查一次就
// resolve,對稱 fetchPoiContent 既有的選填設計。
export function fetchPlaceDetailsWithPhotoRetry<T extends { photoUrl?: string; googlePhotoUrls?: string[] }>(
  placeId: string,
  fetchPlaceDetails: (placeId: string) => Promise<T>,
  onUpdate?: (details: T) => void,
  fetchPhotoAssets?: (placeId: string) => Promise<{ photoUrl?: string; googlePhotoUrls?: string[] }>,
): Promise<T> {
  const retryWithPhotoAssetsOnly = (remainingRetries: number, base: T): Promise<T> => {
    if (remainingRetries <= 0 || !fetchPhotoAssets) return Promise.resolve(base)
    return sleep(PHOTO_RETRY_DELAY_MS)
      .then(() => fetchPhotoAssets(placeId))
      .then((photoAssets) => {
        if (!hasAnyPhoto(photoAssets)) {
          return retryWithPhotoAssetsOnly(remainingRetries - 1, base)
        }
        const details: T = { ...base, photoUrl: photoAssets.photoUrl, googlePhotoUrls: photoAssets.googlePhotoUrls }
        onUpdate?.(details)
        return details
      })
      // 純讀端點查詢失敗(網路問題等)時,視同這次沒查到圖,不中斷剩餘
      // 重試次數——base 本身(第一次查詢的結果)已經是有效內容,不該因為
      // 單次重試失敗就整個退回更差的狀態。
      .catch(() => retryWithPhotoAssetsOnly(remainingRetries - 1, base))
  }

  return fetchPlaceDetails(placeId).then((details) => {
    onUpdate?.(details)
    if (hasAnyPhoto(details)) return details
    return retryWithPhotoAssetsOnly(PHOTO_RETRY_MAX_ATTEMPTS, details)
  })
}
