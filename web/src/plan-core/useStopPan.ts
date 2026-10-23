import { useCallback } from 'react'

// useStopPan——卡片「移動到此」的平移,只分手機與桌面兩種,由入口建立後注入對應的 LivePlanLayer(PlanPanelContent 的
// onPanToStop):
//   usePhoneStopPan   手機:收 stopId,查站點或展開主題點的子景點座標,依安全區平移(/ai-plan 手機使用)
//   useDesktopStopPan 桌面:收站點座標,交給注入的 pan(登入後桌面是 geo.setPanTarget 的包裝)
// 「首站自動平移」是另一件事,四個入口都有,見 useFirstStopAutoPan.ts,不放在這裡。
// 平移本身(panToWithinSafeArea / pan)由呼叫端注入;這裡只決定「移到哪一站」。enabled 由呼叫端依情境決定
// (例如 /ai-plan 推論態不平移)。

type LatLng = { lat: number; lng: number }
type StopLike = { id: string; lat: number; lng: number }
type ChildLike = { id: string; lat?: number | null; lng?: number | null }

// 先查站點,查不到再查展開中的主題點子景點(子景點 id 不在站點清單裡)。
export function resolveStopPanTarget(stopId: string, stops: StopLike[], children: ChildLike[] | undefined): LatLng | null {
  const stop = stops.find((s) => s.id === stopId)
  if (stop) return { lat: stop.lat, lng: stop.lng }
  const child = children?.find((c) => c.id === stopId)
  return child && child.lat != null && child.lng != null ? { lat: child.lat, lng: child.lng } : null
}

export function usePhoneStopPan({
  mapRef,
  mapReady,
  stops,
  expandedChildren,
  enabled,
  panToWithinSafeArea,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  stops: StopLike[]
  expandedChildren?: ChildLike[]
  enabled: boolean
  panToWithinSafeArea: (target: LatLng) => void
}) {
  const panToStop = useCallback(
    (stopId: string) => {
      if (!enabled || !mapReady || !mapRef.current) return
      const target = resolveStopPanTarget(stopId, stops, expandedChildren)
      if (target) panToWithinSafeArea(target)
    },
    [enabled, mapReady, mapRef, stops, expandedChildren, panToWithinSafeArea],
  )
  return { panToStop }
}

export function useDesktopStopPan({ enabled, pan }: { enabled: boolean; pan: (target: LatLng) => void }) {
  const panToStop = useCallback(
    (stop: LatLng) => {
      if (enabled) pan({ lat: stop.lat, lng: stop.lng })
    },
    [enabled, pan],
  )
  return { panToStop }
}

// useStopCardClick——「點選圖卡」的共用處理:高亮該站並(有注入 pan 時)平移地圖到那一站。
// 時間軸站點卡(PlanTimelineView 的 onPanToStop)的點擊都走這個:TripPlanPage(推論態、登入後兩個入口)與 /ai-plan
// 模擬態的 Content 各自注入自己的 select 與 pan,點卡片的行為只有這一份。
// 沒有座標的節點直接略過、連高亮都不做:查詢中的佔位卡(座標要等查完才有)點了不該有任何反應。
export function useStopCardClick({
  select,
  pan,
}: {
  select: (stopId: string) => void
  pan?: (target: LatLng) => void
}) {
  return useCallback(
    (step: { id: string; lat?: number | null; lng?: number | null }) => {
      if (step.lat == null || step.lng == null) return
      select(step.id)
      pan?.({ lat: step.lat, lng: step.lng })
    },
    [select, pan],
  )
}
