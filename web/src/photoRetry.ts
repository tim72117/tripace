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
