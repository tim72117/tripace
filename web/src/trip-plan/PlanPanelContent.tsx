import { TripPlanPage } from './TripPlanPage'
import { useIsDesktop } from '../hooks/useIsDesktop'

type TripPlanPageProps = Parameters<typeof TripPlanPage>[0]

// PlanPanelContent——規劃疊加面板裡的內容:TripPlanPage 加上兩邊共同的設定。
//
// /ai-plan 的 LivePlanLayer 與登入後手機的 phone/Content 原本各自渲染 TripPlanPage,傳同一組設定
// (登入後那份的註解還寫著「跟 /ai-plan 的 LivePlanLayer 傳的一致」,等於靠註解維持一致),現在收在這裡:
//   - compact:緊湊版面。
//   - transparentBackground:面板透明、疊在滿版地圖上,地圖自然透出。
//   - hideEmptyState:不顯示「想去哪裡玩?」的空狀態,詢問頁已經是入口。
//   - initialAskPage={{ country: {} }}:一開始從詢問頁開啟,空的國家輸入表示顯示全部國家。
//     TripPlanPage 只在掛載時、且沒有任何站點才會開這個詢問頁;已經有行程就不開。
// 三個固定的設定不能被覆寫(兩邊一致是這個元件存在的理由);initialAskPage 有預設值,呼叫端可以覆寫。
//
// 各邊特有的設定由呼叫端傳入,原樣轉給 TripPlanPage:
//   - /ai-plan:store(草稿儲存)、dataSource(公開資料來源)、onNewDraft。
//   - 登入後:cfg、selectedStopId(受控)與 tripPlanProps 的四個回報回呼。
//   - horizontalTimeline 三個入口都不傳,由這裡依螢幕決定(手機橫向、桌面直向)。
export type PlanPanelContentProps = Omit<TripPlanPageProps, 'compact' | 'transparentBackground' | 'hideEmptyState'>

export function PlanPanelContent({
  initialAskPage = { country: {} },
  horizontalTimeline,
  ...rest
}: PlanPanelContentProps) {
  // horizontalTimeline 預設依螢幕:手機橫向、桌面直向(2026-10 收到這裡,原本 /ai-plan 的 LivePlanLayer 寫 !isDesktop、
  // 登入後手機寫死 true、桌面不傳,三處是同一條規則)。呼叫端仍可明確傳值覆寫。
  const isDesktop = useIsDesktop()
  return (
    <TripPlanPage
      {...rest}
      horizontalTimeline={horizontalTimeline ?? !isDesktop}
      initialAskPage={initialAskPage}
      compact
      transparentBackground
      hideEmptyState
    />
  )
}
