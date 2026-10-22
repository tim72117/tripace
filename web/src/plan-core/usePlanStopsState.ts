import { useMemo, useState } from 'react'
import type { HoverTransitPair } from '../geo-planning/mapMarkerLayer/planStops'
import type { PlanStopMarker } from '../geo-planning/usePlanStopMarkers'

// PlanSelection——「使用者現在在看哪一站」這組檢視狀態(選取、hover)。
//
// 選取不是推論的產物:AI 排出哪些站是推論結果,使用者在看哪一站不是——它不持久化、不進 AI 的工具、
// 重新整理後不該還在。所以由站點檢視實例持有,不放進任何推論結果。
// /ai-plan 有模擬到真實的交接:模擬態(useSimulatedStopsView)與推論態(這裡的 usePlanStopsState,與登入後同一個)各是
// 一個完整的實例,交接時整個換掉(2026-10,使用者明確要求「交接的時候要置換整個實例」),所以沒有 clear。
// 這個型別與 hook 原本寫在 /ai-plan 的 home/plan-ai-sim/Content.tsx,現在搬到這裡,與登入後共用。
export interface PlanSelection {
  selectedStopId: string | null
  hoverStopId: string | null
  setSelectedStopId: (id: string | null) => void
  setHoverStopId: (id: string | null) => void
}

export function usePlanSelection(): PlanSelection {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [hoverStopId, setHoverStopId] = useState<string | null>(null)
  return { selectedStopId, hoverStopId, setSelectedStopId, setHoverStopId }
}

// usePlanStopsState——規劃面板(TripPlanPage)回報的站點,加上選取與 hover,加上轉乘膠囊 hover:
// 登入後手機(phone/Content)與登入後桌面(desktop/Content)原本各寫四個 useState,現在共用。
//
// 資料流:TripPlanPage 透過 tripPlanProps 的四個回呼把站點、選取、hover、轉乘配對寫進來,地圖元件
// (PlanMap)只讀這些狀態、點圓點時用 setSelectedStopId 寫回——selectedStopId 是地圖與時間軸共用的
// 唯一事實來源,點卡片與點地圖圓點都寫同一個 state,不會出現兩邊各自高亮不同站。
//
// tripPlanProps 的身分穩定(回呼都是 useState 的 setter),可以直接 spread 進 TripPlanPage。
export function usePlanStopsState() {
  const selection = usePlanSelection()
  return { ...useReportedStops(selection), ...selection }
}

// useReportedStops——usePlanStopsState 去掉「自己持有 selection」的那一半:站點、轉乘膠囊 hover 與
// tripPlanProps,選取與 hover 寫進呼叫端傳入的 selection。/ai-plan 的 selection 由頁面持有(模擬來源
// 與真實來源共用同一份,交接時要清空),所以走這個;登入後直接用 usePlanStopsState。
export function useReportedStops(selection: Pick<PlanSelection, 'setSelectedStopId' | 'setHoverStopId'>) {
  const [stops, setStops] = useState<PlanStopMarker[]>([])
  const [hoverTransitPair, setHoverTransitPair] = useState<HoverTransitPair | null>(null)

  const { setSelectedStopId, setHoverStopId } = selection
  const tripPlanProps = useMemo(
    () => ({
      onStopsChange: setStops,
      onSelectedStopChange: setSelectedStopId,
      onHoverStopChange: setHoverStopId,
      onHoverTransitChange: setHoverTransitPair,
    }),
    [setSelectedStopId, setHoverStopId],
  )

  return { stops, hoverTransitPair, tripPlanProps }
}

// maskPlanStopsView——面板(規劃面板)關閉時,遮蔽要傳給地圖的站點檢視(2026-10 從登入後手機 phone/Content 與桌面
// desktop/Content 各一組相同的 `open ? x : 空` 抽出)。
//
// 站點圖層只在規劃面板開啟時顯示,關閉時傳空陣列/null(圖層自己會把 marker 清掉)。selected/hover/轉乘配對同樣要遮蔽:
// 面板用 hidden 保持掛載(不重連 WebSocket、不丟對話狀態),TripPlanPage 的 state 不會歸零,值會停在最後的選取/懸停——
// hover 更是連「移出」事件都收不到(被 display: none 隱藏的元素不產生 onMouseLeave)。stops 為空時圖層本來就沒有 marker
// 可套用,另外遮蔽 selected/hover 是明確表達意圖、不依賴那個間接保證。
// 回傳的欄位名與 PlanMap / PlanPhoneView 的 prop 同名,呼叫端直接展開。空檢視是模組級常數(身分穩定,不會每次 render 都換)。
export interface PlanStopsViewProps {
  stops: PlanStopMarker[]
  selectedStopId: string | null
  hoverStopId: string | null
  hoverTransitPair: HoverTransitPair | null
}

const HIDDEN_VIEW: PlanStopsViewProps = { stops: [], selectedStopId: null, hoverStopId: null, hoverTransitPair: null }

export function maskPlanStopsView(view: PlanStopsViewProps, visible: boolean): PlanStopsViewProps {
  return visible ? view : HIDDEN_VIEW
}

// PlanPanelStopsProps:useReportedStops 回傳的 tripPlanProps 的型別——規劃面板(PlanPanelContent / TripPlanPage)把站點、
// 選取、hover、轉乘配對回報給入口用的四個回呼,各入口的 LivePlanLayer 用它當 prop 型別。
export type PlanPanelStopsProps = ReturnType<typeof useReportedStops>['tripPlanProps']

// PlanPanelStopsBinding——三個入口的 LivePlanLayer(/ai-plan、登入後手機、登入後桌面)共同的「站點檢視接線」props:
// 受控的 selectedStopId(時間軸卡片與地圖圓點共用同一份選取,雙向同步)加四個回報回呼(tripPlanProps)。
// 三個 LivePlanLayer 的 props 都以它為基礎,再補各自特有的(cfg、visible、onPanToStop 等)。
export interface PlanPanelStopsBinding {
  selectedStopId: string | null
  tripPlanProps: PlanPanelStopsProps
}
