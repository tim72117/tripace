import { useEffect, useMemo, useRef } from 'react'
import { usePlanSelection, type PlanSelection } from '../timeline/usePlanStopsState'
import { listNodes, lodgingsOf, type PlanTimeline } from '../timeline/model'
import { routeSegmentsFromTimeline, type RouteSegment } from '../timeline/segments'
import type { PlanStopMarker } from '../map/marker/planStops'
import { lodgingMapMarkers, resolveMapChildren } from '../timeline/resolved'
import { useResolvedRefs } from '../data/PlanDataProvider'

// useSimulatedStopsView — 「模擬來源」的具體實作:包裝模擬層自己的
// mapStops/selectedStopId/hoverStopId 這幾個 state 與其 setter,原樣對應
// 既有行為,不是重新設計一套。timeline 由呼叫端(usePlanSimSocket 的回傳值)
// 傳入,這個 hook 只負責從中篩出站點、管理選取/hover 這兩個 state。
//
// latestInsertedStopIdRef——2026-10 新增(見 usePlanSimSocket 同名 ref
// 的完整說明):新地點站插入後,這裡同步把 selectedStopId/hoverStopId
// 指過去,修正 HorizontalPlanTimeline 的自動捲動 effect 因為
// selectedStopId 一直停在舊卡、要等下一輪才追上的「慢一拍」問題。
//
// SimulatedStopsView——模擬態的站點檢視實例:站點(從劇本的時間軸投影出來,有座標的 stop 節點)、連線段
// (routeSegments,有交通膠囊的那一段才畫,planning/timeline/segments.ts,與推論態同一個規則)加自己持有的選取。
// 形狀與推論態(usePlanStopsState)的站點、連線段、選取欄位相同,模擬態只由 Content(/ai-plan)使用,推論態由 LiveContent(/ai-plan/live)使用。
export type SimulatedStopsView = { stops: PlanStopMarker[]; routeSegments: RouteSegment[] } & PlanSelection

export function useSimulatedStopsView(
  timeline: PlanTimeline,
  latestInsertedStopIdRef: { current: string | null },
): SimulatedStopsView {
  // 模擬態自己持有選取(使用者明確要求「模擬就用自己的實例」):不與推論態共用,交接時整個被換掉。模擬態仍然會
  // 「寫入」選取:新站點排出來時自動選中它(見下方 lastAutoSyncedStopIdRef 的 effect),那是劇本的行為
  // (排出新站 → 把焦點帶過去)。
  const selection = usePlanSelection()
  // resolved——節點上的 attractions/places id 經資料存取層查回來的結果(只在執行時,不存回節點)。向 PlanDataProvider 的
  // 共用 store 取(模擬態整棵子樹在假資料的 Provider 底下,地圖投影與時間軸視圖用同一份,不再各查一次)。
  // steps——依序列出全部節點(listNodes 每次呼叫都是新陣列,所以以 timeline 為依賴 memo)。
  const steps = useMemo(() => listNodes(timeline), [timeline])
  // 旅館(PlanTimeline.lodgings)的 placeId 一併解析:座標給下方 stops 的旅館圓點(名稱由視圖自己解析)。
  const lodgings = lodgingsOf(timeline)
  const resolved = useResolvedRefs(steps, lodgings)
  const { setSelectedStopId, setHoverStopId } = selection
  // 2026-10 修正無限重渲染迴圈:steps 是 listNodes 的結果,
  // 雖然現在已用 timeline memo 住,仍保留內容摘要當依賴的做法(見下)——曾經每次呼叫都是新陣列參照,即使 timeline 內容
  // 沒變——直接把 steps 放進 useMemo 依賴陣列,等於這個 memo 永遠判定
  // 「依賴變了」而重新計算出新的 stops 陣列,導致呼叫端(見下方 return)
  // 回傳的 SimulatedStopsView.stops 也永遠是新參照,使 planning/preview/Content
  // 裡依賴 simulatedSource.stops 的 effect 永遠判定變動、無限重新執行
  // (見該 effect 的完整說明)。改用內容摘要字串當依賴(理由同
  // map/draw/useSharedDrawLayer.ts 的 stopsKey),只有篩選/映射後的實際結果真的
  // 不同時,stops 才換新參照。
  //
  // 2026-10(第二輪,使用者明確要求「點選聚合點時,原本的點變成一個範圍
  // 圈圈,顯示圈圈內的地點小點」):子景點不再混進這份清單跟主題點用
  // 同一套圓點樣式——改成獨立的範圍圓圈+子景點小點圖層(見下方
  // useThemeRadiusCircle 的完整說明),視覺上明確區分「主題點本身」跟
  // 「展開後的範圍與子景點」,不是把子景點偽裝成跟其他站點一樣的一般
  // marker。這份清單維持只放「真正獨立佔用時間軸時間點的站點」,主題
  // 點本身(不論是否展開)仍然只在這裡佔一筆。
  // stopsKey——把子景點(解析結果)的座標也編進去(2026-10):子景點的座標是
  // 非同步查回來的,晚於父節點插入。不編進 key 的話,子景點從沒座標
  // 變成有座標時 stopsKey 不變,stops 不重算,主題點永遠展不開。
  const stopsKey = steps
    .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
    .map((s) => {
      const childrenKey = resolveMapChildren(s, resolved)
        .map((c) => `${c.id}:${c.lat}:${c.lng}`)
        .join(';')
      return `${s.id}|${s.lat}|${s.lng}|${s.name ?? ''}|${childrenKey}`
    })
    .join(',')
  // 旅館圓點(座標由 placeId 查到才有):排在站點之後;連線由時間軸節點切段(planning/timeline/segments.ts),旅館不是節點,自然不在線上。key 要編進去——座標是非同步查回來的。
  const lodgingMarkers = lodgingMapMarkers(lodgings, resolved)
  const lodgingsKey = lodgingMarkers.map((m) => `${m.id}|${m.lat}|${m.lng}|${m.name ?? ''}`).join(',')
  const stops = useMemo<PlanStopMarker[]>(
    () => [
      ...steps
        .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
        .map((s) => {
          // children——只收已經查到座標的子景點(見 PlanStopMarker.children
          // 的完整說明)。沒有任何有效子景點時不帶這個欄位,讓下游的
          // 「有沒有 children」判斷單純看它在不在。
          const children = resolveMapChildren(s, resolved)
          return {
            id: s.id,
            lat: s.lat!,
            lng: s.lng!,
            name: s.name,
            ...(children.length > 0 ? { children } : {}),
          }
        }),
      ...lodgingMarkers,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopsKey, lodgingsKey],
  )
  // lastAutoSyncedStopIdRef——2026-10 修正(使用者實機回報「自動播放
  // 結束後,點其他卡片會被拉回最後一個」):記錄「這個 latestId 已經
  // 自動同步過選取了」,不是只看 selectedStopId 現在是不是等於
  // latestId。原本的判斷式 `if (selectedStopId === latestId) return`
  // 沒有分辨「selectedStopId 還沒追上最新插入的站(該自動同步)」跟
  // 「使用者後來手動點了別的站,selectedStopId 刻意不等於 latestId」
  // 這兩種情況——只要 selectedStopId 不等於 latestId 就一律覆蓋,導致
  // 自動播放結束(latestInsertedStopIdRef.current 停在最後一站不再變)
  // 後,使用者點任何其他卡片觸發 setSelectedStopId(otherId),這個
  // effect 因為依賴陣列裡的 selectedStopId 改變而重新執行,又把選取
  // 強制拉回最後一站,使用者點哪張卡都沒有反應。
  const lastAutoSyncedStopIdRef = useRef<string | null>(null)
  useEffect(() => {
    const latestId = latestInsertedStopIdRef.current
    if (latestId == null) return
    if (!stops.some((s) => s.id === latestId)) return
    // 這個 latestId 已經自動同步過一次了——不管 selectedStopId 現在是
    // 不是等於它,都不再重複同步,讓使用者之後手動選別的卡片時這裡
    // 不會把選取搶回來。
    if (lastAutoSyncedStopIdRef.current === latestId) return
    lastAutoSyncedStopIdRef.current = latestId
    setSelectedStopId(latestId)
    setHoverStopId(latestId)
  }, [stops, latestInsertedStopIdRef, setSelectedStopId, setHoverStopId])
  // routeSegments——地圖連線段,直接從時間軸切(推論態由 TripPlanPage 回報,模擬態這裡自己算)。
  const routeSegments = useMemo(() => routeSegmentsFromTimeline(timeline), [timeline])
  return { stops, routeSegments, ...selection }
}

