import type { ComponentProps, MutableRefObject, ReactNode } from 'react'
import { PlanTimelineView } from '../../plan-core/PlanTimelineView'
import { getTimeDragBounds } from '../../plan-core/planTimeline'
import { TIME_DRAG_ENABLED } from '../../DesktopShared'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import type { usePlanSimSocket } from './usePlanSimSocket'
import styles from './Content.module.css'

// SimPlanLayer(/ai-plan 模擬態,home/plan-ai-sim/)——第 4 層(規劃面板接線)的模擬態呼叫端。
//
// /ai-plan 在第 4 層有兩個呼叫端,渲染在同一個位置(PlanOverlayLayout 的 children),由 Content 依 handedOver 擇一:
//   - 推論態:LivePlanLayer(真實 AI 對話與時間軸,TripPlanPage);
//   - 模擬態:這個元件(交接前播放固定劇本的時間軸;桌面 PlanTimelineView、手機 HorizontalPlanTimeline,
//     劇本播到詢問頁時改渲染 ScriptedAskPage)。
// 原本這段行內寫在 Content.tsx,現在抽成獨立元件,Content 只剩 <SimPlanLayer … /> 與 <LivePlanLayer … /> 二選一。
//
// 這個元件是「呈現層」:劇本播放、站點檢視、捲動跟隨、拖拉改時間等狀態與 hook 仍由 Content 持有(usePlanSimSocket、
// useSimulatedStopsView 等,地圖也要讀同一份站點),這裡只負責把它們畫出來。所以它的 props 是 Content 傳下來的狀態與
// 回呼,不滿足 LivePlanLayerContract(推論態的狀態在 TripPlanPage 裡,經 tripPlanProps 回報給 Content;模擬態的狀態
// 在 Content,不經回報)。要連狀態也搬進來,需要先把這些 hook 與地圖共用的站點檢視重新切分,這次沒有做。
type SimSocket = ReturnType<typeof usePlanSimSocket>

export interface SimPlanLayerProps {
  isDesktop: boolean
  steps: SimSocket['steps']
  isGenerating: boolean
  emptyStateMessage: string
  timelineRef: SimSocket['timelineRef']
  dragStopTime: SimSocket['dragStopTime']
  retryStopLookup: SimSocket['retryStopLookup']
  // 詢問頁(劇本播到 open_ask_page 時取代時間軸)
  showAskPage: boolean
  askPageInput: ComponentProps<typeof HorizontalPlanTimeline>['askPageInput']
  handleAskPageDone: ComponentProps<typeof HorizontalPlanTimeline>['onAskPageDone']
  renderScriptedAskPage: () => ReactNode
  // 選取、hover、平移
  selectedStopId: string | null
  setSelectedStopId: (id: string | null) => void
  setHoverStopId: (id: string | null) => void
  panToStop: ComponentProps<typeof PlanTimelineView>['onPanToStop']
  panToStopId: ComponentProps<typeof HorizontalPlanTimeline>['onPanToStop']
  // 捲動跟隨與「回到最新」(桌面縱向時間軸)
  scrollRef: ComponentProps<typeof PlanTimelineView>['scrollRef']
  handleScroll: () => void
  showJumpPill: boolean
  jumpToLatest: () => void
  mountedIdsRef: MutableRefObject<Set<string>>
  setLightboxPhotos: ComponentProps<typeof PlanTimelineView>['onOpenPhotos']
}

export function SimPlanLayer({
  isDesktop,
  steps,
  isGenerating,
  emptyStateMessage,
  timelineRef,
  dragStopTime,
  retryStopLookup,
  showAskPage,
  askPageInput,
  handleAskPageDone,
  renderScriptedAskPage,
  selectedStopId,
  setSelectedStopId,
  setHoverStopId,
  panToStop,
  panToStopId,
  scrollRef,
  handleScroll,
  showJumpPill,
  jumpToLatest,
  mountedIdsRef,
  setLightboxPhotos,
}: SimPlanLayerProps) {
  return (
    isDesktop ? (
    /* 桌面版的詢問頁(2026-10 使用者明確要求「桌面版的要顯示 ask
       page」):劇本播到 open_ask_page 時取代縱向時間軸,跟手機版
       「顯示 AskPage 時取代卡片列」是同一種處理(見
       HorizontalPlanTimeline.tsx showAskPage 分支)。
       在這之前桌面版完全沒有渲染 AskPage,而劇本第一則就是
       open_ask_page——planSimFakeSource 等著使用者選擇,畫面上卻沒有
       任何可以點的東西,整段劇本停在第 0 步(實機確認:桌面版時間軸
       全空、一張卡片都沒有)。
       dataSource 用假資料實作,理由同下方手機版分支的完整說明。

       2026-10 改成置換 ScriptedAskPage(使用者明確定調「播放態不會有
       真實互動」、「所以是要做在被置換的原件上,與正式使用的不一樣」):
       這一頁是播放態,渲染的是播放態專用那一份(見 ScriptedAskPage.tsx
       檔頭的完整說明:劇本指定選哪幾張、依序演出點擊特效、時間到自己
       送出),不是正式的 AskPage。正式那一份完全沒有為了展示而加的
       分支,它只服務真實互動。
       兩者的 onDone 形狀一致,所以在這裡是直接互換,呼叫端其餘程式碼
       不需要知道換了哪一份。 */
    showAskPage ? (
    renderScriptedAskPage()
    ) : (
    <PlanTimelineView
      // onRetryStop——見上方 retryStopLookup 的完整說明:標了 failed
      // 就要給得出脫離的路。
      onRetryStop={retryStopLookup}
      steps={steps}
      isThinking={isGenerating}
      emptyStateMessage={emptyStateMessage}
      hideEmptyState
      endMarkerMessage="行程結束"
      selectedStopId={selectedStopId}
      // onHoverStop——卡片 hover/移出時更新 hoverStopId,讓地圖圓點能
      // 跟著 hover 強調(見上方 hoverStopId state 的完整說明)。
      onHoverStop={setHoverStopId}
      showJumpPill={showJumpPill}
      onJumpToLatest={jumpToLatest}
      onPanToStop={panToStop}
      // getStopTimeDragBounds/onDragStopTime——見 dragStopTime 的完整
      // 說明。這兩個 prop 同時存在才會啟用拖拉手勢(見
      // PlanTimelineView.tsx handlePointerDown 開頭的判斷)。
      // TIME_DRAG_ENABLED——feature flag(見 DesktopShared.tsx 同名
      // 常數的完整說明),關閉時兩個 prop 都不傳。
      getStopTimeDragBounds={TIME_DRAG_ENABLED ? (stopId) => getTimeDragBounds(timelineRef.current, stopId) : undefined}
      onDragStopTime={TIME_DRAG_ENABLED ? dragStopTime : undefined}
      onOpenPhotos={setLightboxPhotos}
      mountedIdsRef={mountedIdsRef}
      scrollRef={scrollRef}
      onScroll={handleScroll}
      scrollClassName={styles.timelineScroll}
      jumpPillWrapClassName={styles.timelineJumpPillWrap}
      endMarkerClassName={styles.timelineEndMarker}
    />
    )
    ) : (
    // 手機版(模擬中)——改用橫向卡片時間軸(方案二設計稿的落地,見
    // HorizontalPlanTimeline.tsx 檔頭的完整說明),取代縱向
    // PlanTimelineView。onSelectStop 同時寫入 selectedStopId 跟
    // hoverStopId(而不是只設 selectedStopId)——這兩個 state 一起餵給
    // 上方 useMapMarkerLayer(見該處呼叫的完整說明),地圖圓點的
    // 「選取」樣式實際上同時看這兩個值的其中之一命中(見 mapMarkers.ts/
    // PlanStopMarkerState 的既有邏輯),縱向版本原本是「點擊卡片→
    // selectedStopId」「hover 卡片→hoverStopId」各自觸發,手機版橫向
    // 卡片沒有滑鼠 hover 這件事,只有「捲到/點到哪一站」這一種事件。
    // mapMarkerLayer/mapMarkers.ts 的三態邏輯是 selected 優先於
    // hover(見 PlanStopMarkerState 的完整說明:兩者同時命中同一個 id
    // 時最終呈現 'selected'),只設 selectedStopId 其實已經足夠讓地圖
    // 圓點呈現「選取」高亮;這裡連同 hoverStopId 一併更新純粹是為了
    // 不留下舊的 hoverStopId 殘留(例如使用者先前在桌面寬度下 hover
    // 過某一站、之後縮小視窗切換成手機版橫向卡片,殘留的 hoverStopId
    // 理論上不該發生但避免有這種邊界情況殘留失準的圓點狀態)。
    // focusLatest(2026-10 修正,使用者實機回報「自動播放時第二個
    // 景點後沒有自動往下一個滑動」):這個 prop 名稱雖然原本是為了
    // 「第一張卡滿版、後面壓縮堆疊」這組視覺效果設計的,但那組卡片
    // 寬度縮放邏輯後來已經被取代(見 HorizontalPlanTimeline.tsx
    // isSingleCard 的完整說明:目前只有「只剩一張卡」這個寬度例外,
    // 其餘卡片一律固定寬度,焦點改用捲動位置表達,不是寬度差異)——
    // focusLatest 現在的唯一實際作用,只剩下開關「骨架轉正式卡時
    // 自動捲動到最新站點」這個自動捲動 effect(見該檔案
    // justFinishedGenerating 的完整說明),不會再帶來任何卡片縮放的
    // 副作用。原本這裡沒有傳這個 prop,套用元件預設值 false,整個
    // 自動捲動 effect 的第一行 `if (!focusLatest) return` 直接讓
    // 自動捲動在這個完整展示頁上完全不會啟動——不是只影響第二站
    // 以後,是從第一站就沒有自動捲動,只是使用者在只有一張卡時不易
    // 察覺,到第二站需要真正捲動才會注意到。改成跟首頁 demo
    // (AiPlanPhoneDemoScreen.tsx)一致,啟用自動捲動到最新完成站點。
    <>
    <HorizontalPlanTimeline
      // showAskPage/askPageInput/onAskPageDone/dataSource——見
      // 上方 state 宣告處的完整說明。dataSource 用假資料實作(預設值
      // planAiFakeDataSource,這裡顯式傳入對齊 usePlanSimSocket 呼叫處
      // 的同一份實例,理由同該處說明:這個展示頁不需要登入就能看,
      // 不能打需要登入的後端端點)。
      showAskPage={showAskPage}
      askPageInput={askPageInput}
      onAskPageDone={handleAskPageDone}
      dataSource={planAiFakeDataSource}
      // renderAskPage——置換成播放態專用那一份(見
      // HorizontalPlanTimeline.tsx 該 prop 與 ScriptedAskPage.tsx 檔頭
      // 的完整說明)。桌面分支也是同一份,兩種版面一致。
      renderAskPage={renderScriptedAskPage}
      onRetryStop={retryStopLookup}
      steps={steps}
      selectedStopId={selectedStopId}
      focusLatest
      onSelectStop={(stopId) => {
        setSelectedStopId(stopId)
        setHoverStopId(stopId)
      }}
      // onSelectThemeChild——2026-10 新增(見 HorizontalPlanTimeline.tsx
      // 該 prop 的完整說明)。只設定 selectedStopId(選中主題卡本身,
      // 連帶觸發 expandedThemeId 的 effect 展開範圍圓圈+子景點小點,見
      // 該 effect 的完整說明)。
      //
      // 2026-10(第二輪,使用者明確要求「手機板觸發地圖中心移動跟標示
      // 目標點都要用捲動中心點觸發,不要用點選觸發」):不再呼叫
      // setHoverStopId(child.id)——地圖 panTo 的 effect 已經改成只讀
      // selectedStopId(見該 effect 的完整說明),hoverStopId 不再驅動
      // 任何地圖行為,這裡設定它只會是沒有視覺效果的殘留狀態,拿掉。
      onSelectThemeChild={(parentId) => {
        setSelectedStopId(parentId)
      }}
      // onOpenPhotos——跟桌面版 PlanTimelineView 共用同一個 Lightbox
      // 覆蓋層(見上方 lightboxPhotos state 的完整說明),兩個時間軸
      // 元件都只負責「觸發開啟」,實際渲染/關閉邏輯統一收在這個頁面
      // 層級,不重複實作。
      onOpenPhotos={setLightboxPhotos}
      isGenerating={isGenerating}
      // onPanToStop——2026-10 新增(使用者明確要求「選擇圖卡時不要
      // 移動地圖中心,標誌地點就好,另外做一個 icon,移動到該點」):
      // 卡片角落新增的「移動到此」按鈕觸發,見 panToStopId 的完整
      // 說明。選填 prop,省略時卡片不會渲染這顆按鈕(對齊
      // onRemoveStop/onTransitModeChange 等既有選填 prop 的慣例)。
      onPanToStop={panToStopId}
    />
    </>
    )
  )
}
