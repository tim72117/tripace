import { lazy, Suspense } from 'react'
import type { ClientConfig } from '../../../api'
import { getPlanAiApiDataSource } from '../../data/api'
import { localStoragePlanTimelineStore } from '../../timeline/storage'
import type { LivePlanLayerContract } from '../../shared/layerContracts'

// PlanPanelContent:「AI 規劃」正式功能頁(TripPlanPage 加兩邊共同的設定)——lazy 載入,理由同 planning/member/desktop/LivePlanLayer.tsx:
// 這個頁面串接 onagent AgentBridge、地圖、markdown 渲染等較重的依賴,不該拖累 /app 主 bundle 的初始載入體積。
const PlanPanelContent = lazy(() => import('../../panel/PlanPanelContent').then((m) => ({ default: m.PlanPanelContent })))

// LivePlanLayer(登入後手機版)——規劃面板的「推論層」,對應 /ai-plan 的 planning/preview/LivePlanLayer 與登入後桌面的
// planning/member/desktop/LivePlanLayer:同一個層級、同一個名字,負責把規劃面板內容(PlanPanelContent)接上這個入口——cfg、橫向時間軸
// 等入口特有的設定收在這裡,入口(planning/member/phone/Content)只要渲染它。
//   - dataSource:登入後一律用登入版資料存取層(打 /internal),明確傳,不靠 TripPlanPage 的預設值。
//   - horizontalTimeline:不傳,由 PlanPanelContent 依螢幕決定(手機橫向、桌面直向,三個入口同一條規則)。
//   - selectedStopId 受控、tripPlanProps(四個回呼):時間軸卡片與地圖圓點共用同一個選取狀態,見 planning/timeline/usePlanStopsState。
//   - initialAskPage={{ country: {} }}:使用者明確要求「一開始要從詢問視窗開啟」,由 PlanPanelContent 的預設值提供,與
//     /ai-plan 一致;面板用 hidden 保持掛載,所以詢問頁在使用者第一次打開面板之前就已經準備好、打開時直接看到。
// 局部 Suspense:面板永遠掛載(只隱藏 overlay),chunk 會在進 /app 的當下就開始載入;若只靠 App.tsx 最外層的 Suspense,
// 整個 /app 畫面(含地圖)會被它擋住,是明顯的體驗回歸。fallback 給 null:面板預設是關閉狀態,載入期間不需要骨架畫面。
// cfg 的來源:由入口傳進來(登入後一定有 token),不像 /ai-plan 的 LivePlanLayer 自己讀訪客設定。
// LivePlanLayerProps——滿足共同契約 LivePlanLayerContract(planning/shared/layerContracts.ts),加 cfg(登入設定)。
export interface LivePlanLayerProps extends LivePlanLayerContract {
  cfg: ClientConfig
}

export function LivePlanLayer({
  cfg,
  selectedStopId,
  tripPlanProps,
}: LivePlanLayerProps) {
  return (
    <Suspense fallback={null}>
      <PlanPanelContent
        cfg={cfg}
        dataSource={getPlanAiApiDataSource(cfg)}
        store={localStoragePlanTimelineStore}
        selectedStopId={selectedStopId}
        {...tripPlanProps}
      />
    </Suspense>
  )
}
