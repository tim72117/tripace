import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  TRIPS_CHANGED_EVENT,
  TRIPS_INDEX_KEY,
  createTrip,
  deleteTrip,
  getActiveTripId,
  listTrips,
  renameTrip,
  setActiveTrip,
  type PlanTrip,
} from './trips'

// useTrips——訂閱前端 Trip 索引(trips.ts)的 React hook。索引變動(本頁寫入的自訂事件、其他分頁的 storage 事件)時重新讀取。
// 快照用索引原始字串當穩定值(同一份內容不產生新身分),再 useMemo 解析,避免 useSyncExternalStore 因為每次回傳新陣列而無限重繪。
function subscribe(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === TRIPS_INDEX_KEY) callback()
  }
  window.addEventListener(TRIPS_CHANGED_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(TRIPS_CHANGED_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): string {
  // 先 listTrips() 觸發播種(第一次沒有索引時寫入),再讀原始字串。
  listTrips()
  try {
    return localStorage.getItem(TRIPS_INDEX_KEY) ?? ''
  } catch {
    return ''
  }
}

export function useTrips() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => '')
  const trips = useMemo<PlanTrip[]>(() => listTrips(), [snapshot]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeTripId = useMemo(() => getActiveTripId(), [snapshot]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeTrip = useMemo(() => trips.find((t) => t.id === activeTripId) ?? null, [trips, activeTripId])
  return {
    trips,
    activeTrip,
    activeTripId,
    create: useCallback((name?: string) => createTrip(name), []),
    rename: useCallback((id: string, name: string) => renameTrip(id, name), []),
    remove: useCallback((id: string) => deleteTrip(id), []),
    setActive: useCallback((id: string) => setActiveTrip(id), []),
  }
}
