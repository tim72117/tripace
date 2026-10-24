import { lazy, Suspense } from 'react'
import type { ClientConfig } from '../../../api'
import { getPlanAiApiDataSource } from '../../data/api'
import { localStoragePlanTimelineStore } from '../../timeline/storage'
import type { LivePlanLayerContract } from '../../shared/layerContracts'

// PlanPanelContent:「AI 規劃」正式功能頁面(見 planning/panel/TripPlanPage.tsx 開頭的完整說明)——lazy 載入,理由同 App.tsx
// 對其餘整頁級路由的既有做法:這個頁面串接 onagent AgentBridge、地圖、markdown 渲染等較重的依賴,不是每個使用者都會點進
// 這個面板,不該拖累 /app 主 bundle 的初始載入體積。
const PlanPanelContent = lazy(() => import('../../panel/PlanPanelContent').then((m) => ({ default: m.PlanPanelContent })))

// LivePlanLayer(登入後桌面版)——規劃面板的「推論層」,對應 /ai-plan 的 planning/preview/LivePlanLayer 與登入後手機的
// planning/member/phone/LivePlanLayer:同一個層級、同一個名字,負責把規劃面板內容(PlanPanelContent)接上這個入口,入口(planning/member/desktop/Content)
// 只要渲染它。
//   - PlanPanelContent 固定帶 compact(含透明背景、不顯示空狀態、詢問頁從全部國家開始):面板沒有祖先在管捲動,
//     TripPlanPage 自己變成固定高度容器、由時間軸區塊接手捲動。見 planning/panel/PlanPanelContent.tsx 與 TripPlanPage 的
//     compact prop 說明。
//   - dataSource:登入後一律用登入版資料存取層(打 /internal),明確傳,不靠 TripPlanPage 的預設值。
//   - visible:這個面板是常駐掛載、用 hidden 隱藏的,元件不會因為關閉而卸載。傳入可見狀態讓它在重新顯示時把
//     其他實例這期間寫入的規劃內容讀回來(原本主要是已移除的 /trip-plan 全頁版)——各實例共用同一份 localStorage,見 TripPlanPage 對這個 prop 與 revRef 的說明。
//   - onPanToStop:點擊時間軸的站點卡,把地圖平移到該站(由入口決定怎麼移,見 planning/member/desktop/Content.tsx 的說明)。
//   - selectedStopId 受控:這一份是地圖與時間軸共用的唯一事實來源(見 TripPlanPage 對這兩個 prop 的完整說明),點卡片與點
//     地圖圓點都寫同一個 state,不可能出現兩邊各自高亮不同站的情形;tripPlanProps 是四個回報用回呼。
// 局部 Suspense:面板永遠掛載(只隱藏 overlay),chunk 會在進 /app 的當下就開始載入;若只靠 App.tsx 最外層包住整個 <Routes>
// 的 Suspense,整個 /app 畫面(含地圖)會被它擋住,是明顯的體驗回歸。fallback 給 null:面板預設是關閉狀態,載入期間使用者
// 看不到任何東西,不需要骨架畫面。
// cfg 的來源:由入口傳進來(登入後一定有 token),不像 /ai-plan 的 LivePlanLayer 自己讀訪客設定。
// LivePlanLayerProps——滿足共同契約 LivePlanLayerContract(planning/shared/layerContracts.ts),加 cfg(登入設定)、visible
// (面板可見狀態)、onPanToStop(點站點卡平移地圖)。
export interface LivePlanLayerProps extends LivePlanLayerContract {
  cfg: ClientConfig
  visible: boolean
  onPanToStop: (stop: { lat: number; lng: number }) => void
}

export function LivePlanLayer({
  cfg,
  visible,
  onPanToStop,
  selectedStopId,
  tripPlanProps,
}: LivePlanLayerProps) {
  return (
    <Suspense fallback={null}>
      <PlanPanelContent
        cfg={cfg}
        dataSource={getPlanAiApiDataSource(cfg)}
        store={localStoragePlanTimelineStore}
        visible={visible}
        onPanToStop={onPanToStop}
        selectedStopId={selectedStopId}
        {...tripPlanProps}
      />
    </Suspense>
  )
}
