import { loadTimelineWithRev, saveTimeline } from '../plan-core/planTimelineStorage'
import type { PlanTimeline } from '../plan-core/planTimeline'

// importTimelineToPlanDraft——把行程詳情頁解析後的時間軸,寫進登入後「規劃面板」用的那份規劃草稿(localStorage,
// plan-core/planTimelineStorage.ts 的固定 key,/ai-plan 推論態與登入後手機、桌面的規劃面板共用同一份),
// 使用者進 /app 打開規劃面板就看得到這些站(含天數、時間、座標、照片、交通)。
//
// 草稿已有內容時,寫入會取代它(登入後沒有多份草稿的介面,沒辦法並存),所以預設不寫、回傳 'needs_confirm',
// 由呼叫端(ImportToPlanButton 的頁內確認)問使用者,確認後以 replaceExisting: true 再呼叫一次。
// 寫入失敗(localStorage 被停用、配額滿)回傳 'failed',不丟例外。
// 版次沿用目前磁碟上的 rev 往前推一(其他已掛載的規劃面板實例比對版次,會在顯示時重讀,見 TripPlanPage 的 visible)。
export type ImportToPlanDraftResult = 'saved' | 'needs_confirm' | 'failed'

export function importTimelineToPlanDraft(
  timeline: PlanTimeline,
  { replaceExisting = false }: { replaceExisting?: boolean } = {},
): ImportToPlanDraftResult {
  const current = loadTimelineWithRev()
  if (current.timeline.headId != null && !replaceExisting) return 'needs_confirm'
  return saveTimeline(timeline, current.rev) == null ? 'failed' : 'saved'
}
