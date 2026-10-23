import { isTimelineEmpty, lodgingsOf, type PlanTimeline } from '../planning/timeline/model'
import { localStoragePlanTimelineStore, type PlanTimelineStore } from '../planning/timeline/storage'

// importTimelineToPlanDraft——把行程詳情頁的時間軸(useResolvedItineraryTimeline 回傳的 PlanTimeline,站點座標已從共用 store
// 蓋上)寫進登入後「規劃面板」用的那份規劃草稿:planning/timeline/storage.ts 的 localStoragePlanTimelineStore
// (固定 key PLAN_TIMELINE_STORAGE_KEY,登入後手機、桌面的 LivePlanLayer 傳給 TripPlanPage 的就是它),
// 使用者進 /app 打開規劃面板就看得到這些站。
//
// 行程的時間軸本身就是 PlanTimeline(與規劃面板同一份資料規格),原樣寫入:天結構(days 與各天的 id)、
// 站點(時間、停留、座標、交通膠囊、placeId)與住宿(lodgings,dayIds 指向同一批天的 id)一起帶過去,不另外轉換。
// 照片與旅館名稱座標不存快照,規劃面板依 placeId 經資料存取層查(與行程詳情頁同一條路徑)。
//
// 草稿已有內容時(有任何站或任何住宿;只有空的天不算內容),寫入會取代它(登入後沒有多份草稿的介面,沒辦法並存),
// 所以預設不寫、回傳 'needs_confirm',由呼叫端(ImportToPlanButton 的頁內確認列)問使用者,確認後以 replaceExisting: true
// 再呼叫一次。寫入失敗(localStorage 被停用、配額滿,saveTimeline 回 null)回傳 'failed',不丟例外。
// 版次沿用目前磁碟上的 rev 往前推一:其他已掛載的規劃面板實例比對版次,會在顯示時重讀
// (TripPlanPage 的 visible → usePlanTimelineCore 的 resyncFromStorage)。
//
// store 參數只為了測試可替換,正式呼叫端用預設值。
export type ImportToPlanDraftResult = 'saved' | 'needs_confirm' | 'failed'

export function importTimelineToPlanDraft(
  timeline: PlanTimeline,
  { replaceExisting = false, store = localStoragePlanTimelineStore }: { replaceExisting?: boolean; store?: PlanTimelineStore } = {},
): ImportToPlanDraftResult {
  const current = store.loadTimelineWithRev()
  const hasContent = !isTimelineEmpty(current.timeline) || lodgingsOf(current.timeline).length > 0
  if (hasContent && !replaceExisting) return 'needs_confirm'
  return store.saveTimeline(timeline, current.rev) == null ? 'failed' : 'saved'
}
