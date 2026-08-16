import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { Trip } from '../trip/types'
import { LS_DEFAULT_TRIP, errMsg } from '../AppCommon'

// useTripsState:行程列表共用資料邏輯(抓取/建立/自動導向預設行程)。
// 手機版 PhoneNavDrawer 的行程列表分頁(見 trip/PhoneTripsDrawer.tsx)與
// 桌面版側欄列表 DesktopTripList(見 trip/DesktopTripList.tsx)共用同一份
// state 管理與 API 呼叫,只有呈現方式(渲染 JSX)不同,避免整套重寫一份。
export function useTripsState(cfg: ClientConfig, onOpen: (t: Trip) => void) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const hasAutoNavigatedRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    hasAutoNavigatedRef.current = false
    try {
      setTrips(await api.fetchTrips(cfg))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (trips.length > 0 && !hasAutoNavigatedRef.current) {
      const defaultID = localStorage.getItem(LS_DEFAULT_TRIP)
      if (defaultID) {
        const defaultTrip = trips.find((t) => t.id === defaultID)
        if (defaultTrip) {
          hasAutoNavigatedRef.current = true
          onOpen(defaultTrip)
        }
      }
    }
  }, [trips, onOpen])

  const submitCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const created = await api.createTrip(cfg, name)
      setNewName('')
      setCreating(false)
      // 新增後預設選中剛建立的這個行程,而不是只重新整理清單留在原地——
      // 使用者建立行程的意圖幾乎都是「馬上開始用它」,若不自動選中,還得
      // 從剛整理好的清單裡再找一次自己剛剛建的那筆。hasAutoNavigatedRef
      // 先標記為 true,避免緊接著 load() 觸發下方「自動導向 localStorage
      // 預設行程」的 effect 又把選取蓋掉——onOpen 本身通常也會寫入這個
      // localStorage 值(見各呼叫端),但那是非同步的,這裡不能依賴它先
      // 生效。
      hasAutoNavigatedRef.current = true
      onOpen(created)
      load()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  return {
    trips, err, loading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  }
}
