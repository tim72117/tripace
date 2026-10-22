import { useCallback, useEffect, useRef } from 'react'

// useFirstStopAutoPan——「第一站出現時,自動把地圖平移過去」,四個入口(/ai-plan 手機與桌面、登入後手機與桌面)全部套用,
// 與卡片「移動到此」的平移(useStopPan.ts,只分手機與桌面)是兩件獨立的事:這裡不認識裝置,也不認識地圖實作。
//
// 怎麼平移由呼叫端注入:
//   - pan:收一個座標,把地圖移過去。/ai-plan 傳 useMapSafeArea 的 panToWithinSafeArea(依安全區算中心);登入後桌面傳
//     geo.setPanTarget 的包裝;登入後手機傳 PlanPhoneView 內 geo 的同一種包裝。
//   - ready:地圖是否可以平移。/ai-plan 是「mapReady 且 mapRef 有值」;宣告式 panTarget 的入口(登入後)地圖就緒前會
//     自己保留目標,傳 true 即可。
//   - enabled:由呼叫端依情境決定(例如 /ai-plan 非 wide 的桌面疊加版面沒有安全區不平移;/ai-plan 的模擬態與推論態各開一個實例,各自一次性)。
// 一次性 latch:消費後不再受 stops 變動影響。要等 ready 才消費——否則撞上「mapRef 已有、mapReady 還沒翻」的時間窗口會在
// 地圖沒初始化好時平移,且永遠不補。
type LatLng = { lat: number; lng: number }

export function useFirstStopAutoPan({
  stops,
  enabled,
  ready,
  pan,
}: {
  stops: LatLng[]
  enabled: boolean
  ready: boolean
  pan: (target: LatLng) => void
}) {
  const donePanRef = useRef(false)
  useEffect(() => {
    if (donePanRef.current || !enabled || !ready) return
    if (stops.length === 0) return
    donePanRef.current = true
    pan({ lat: stops[0].lat, lng: stops[0].lng })
  }, [enabled, ready, stops, pan])
}

// usePanWithFirstStopPriority——首站平移與「目前位置」平移共用同一條平移路徑時的優先順序:首站優先。
// 兩者都是一次性的程式化平移,誰後到誰贏;使用者的目前位置(授權、定位逾時)可能在規劃面板排出首站之後才回來,
// 把剛平移到首站的地圖又拉走(code review 發現)。這裡的規則是:首站平移過之後,位置平移不再移動地圖
// (藍點仍照常畫);位置先到、首站後到則照常,首站會再把地圖移過去。
// 回傳兩個函式,分別交給 useFirstStopAutoPan 的 pan 與 useCurrentLocation 的 onLocated。pan 本身可以每次渲染換新。
export function usePanWithFirstStopPriority(pan: (target: LatLng) => void) {
  const panRef = useRef(pan)
  panRef.current = pan
  const firstStopPannedRef = useRef(false)
  const panToFirstStop = useCallback((target: LatLng) => {
    firstStopPannedRef.current = true
    panRef.current(target)
  }, [])
  const panToLocation = useCallback((target: LatLng) => {
    if (!firstStopPannedRef.current) panRef.current(target)
  }, [])
  return { panToFirstStop, panToLocation }
}
