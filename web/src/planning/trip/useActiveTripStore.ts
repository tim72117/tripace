import { useCallback, useMemo } from 'react'
import { isTimelineEmpty } from '../timeline/model'
import type { PlanTimelineStore } from '../timeline/storage'
import { LEGACY_TRIP_ID, createTrip, createTripTimelineStore } from './trips'
import { useTrips } from './useTrips'

// useActiveTripStore——規劃面板入口(LivePlanLayer)用:取得「使用中那一趟行程」的時間軸 store,與「開始新行程」。
// 還沒有任何 Trip(舊使用者第一次進來、或全新)時用 legacy Trip——時間軸 key 就是原本固定的那一份,內容不變,
// 存檔時 touchTrip 會把它補進索引。呼叫端用 tripId 當 React key,切換行程時整個面板重新掛載,改用新的 store。
//
// startNewTrip——目前這一趟還是空的就不建立(回 false,畫面上本來就是空白行程,不用再疊一個);有內容才建立新的並切過去(回 true)。
export function useActiveTripStore(): { tripId: string; store: PlanTimelineStore; startNewTrip: () => boolean } {
  const { activeTripId } = useTrips()
  const tripId = activeTripId ?? LEGACY_TRIP_ID
  const store = useMemo(() => createTripTimelineStore(tripId), [tripId])
  const startNewTrip = useCallback(() => {
    if (isTimelineEmpty(store.loadTimelineWithRev().timeline)) return false
    createTrip()
    return true
  }, [store])
  return { tripId, store, startNewTrip }
}
