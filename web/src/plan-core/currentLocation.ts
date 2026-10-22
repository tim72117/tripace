import { useCallback, useEffect, useRef, useState } from 'react'
import type { CurrentLocation, LatLng } from './currentLocationContract'

// getCurrentPositionOrNull——靜默向瀏覽器要一次目前位置。三個入口各自的 useCurrentLocation
// (home/plan-ai-sim/、phone/、desktop/,介面見 currentLocationContract.ts)共用這一份取座標的底層。
//
// 定位只是錦上添花的體驗改善,任何一種失敗(瀏覽器不支援、使用者拒絕授權、逾時、丟例外)都不該讓地圖
// 打不開或卡住,所以一律吞掉錯誤回 null,不往上拋。
//
// 逾時 5 秒:定位是輔助功能、不是核心操作路徑,不該讓使用者等太久看不到地圖。
// maximumAge 1 分鐘:允許用最近一次已有的定位結果,不強制每次都重新定位(預設 0 必須全新定位),
// 在室內或 GPS 冷啟動較慢的裝置上更容易在逾時前拿到座標。
export const GEOLOCATION_TIMEOUT_MS = 5000
export const GEOLOCATION_MAX_AGE_MS = 60_000

// LatLng 的定義在 currentLocationContract.ts;這裡重新匯出,取座標的呼叫端只需要從這個檔案 import。
export type { LatLng }

export function getCurrentPositionOrNull(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS },
      )
    } catch {
      resolve(null)
    }
  })
}

// useLocateWhenWanted——三個入口的 useCurrentLocation 共用的狀態機(政策由呼叫端以函式傳入)。
//   - wanted 變 true:執行一次 locateAuto,有座標就存下並通知 onLocated;
//   - wanted 變 false:座標清空,之後才回來的結果一律丟棄(卸載同理),不 setState;
//   - 每次 effect 一個執行編號(runRef):wanted 在請求回來前 true → false → true 時,第一輪的結果編號對不上、
//     丟棄,只採用第二輪的(單一布林擋不住這個情形,會讓結果寫入兩次、onLocated 呼叫兩次);
//   - request():執行 locateOnRequest(使用者手勢觸發),規則同上。
// locateAuto / locateOnRequest / onLocated 每次渲染可以是新函式,內部用 ref 讀最新的,不會讓 effect 重跑。
export function useLocateWhenWanted({
  wanted,
  locateAuto,
  locateOnRequest,
  onLocated,
}: {
  wanted: boolean
  locateAuto: () => Promise<LatLng | null>
  locateOnRequest: () => Promise<LatLng | null>
  onLocated?: (position: LatLng) => void
}): CurrentLocation {
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null)
  const aliveRef = useRef(false)
  const runRef = useRef(0)
  const policyRef = useRef({ locateAuto, locateOnRequest, onLocated })
  policyRef.current = { locateAuto, locateOnRequest, onLocated }

  useEffect(() => {
    if (!wanted) {
      setCurrentPosition(null)
      return
    }
    aliveRef.current = true
    const run = ++runRef.current
    void policyRef.current.locateAuto().then((pos) => {
      if (runRef.current !== run || !pos) return
      setCurrentPosition(pos)
      policyRef.current.onLocated?.(pos)
    })
    return () => {
      aliveRef.current = false
      runRef.current++
    }
  }, [wanted])

  const request = useCallback(async (): Promise<LatLng | null> => {
    if (!aliveRef.current) return null
    const run = runRef.current
    const pos = await policyRef.current.locateOnRequest()
    if (runRef.current !== run || !pos) return null
    setCurrentPosition(pos)
    policyRef.current.onLocated?.(pos)
    return pos
  }, [])

  return { currentPosition, request }
}
