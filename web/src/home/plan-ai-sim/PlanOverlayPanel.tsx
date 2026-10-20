import { useState, type ReactNode, type Ref } from 'react'
import { ComposerSlotContext } from '../../plan-core/composerSlot'
import styles from './PlanOverlayPanel.module.css'

// PlanOverlayPanel——/ai-plan 疊在地圖上方的 UI 層外殼:只做版面配置。
//   - 定位:桌面右側欄 / 手機貼底的面板
//   - 事件穿透:手機版讓出空白處給地圖
//   - 地圖安全區:手機版
//   - 輸入框插槽(composer slot):貼底置中的位置,內容由各層放進來
//
// 為什麼獨立出來:交接前的模擬層(AIPlanTimelinePage 自己的時間軸)與
// 交接後的真實層(LivePlanLayer → TripPlanPage)原本各自處理這些事,
// 版面規則散在兩個檔案、兩套 CSS。交接後手機版因此出現輸入框貼在頂端、
// 整張地圖被透明容器蓋住拉不動。外殼不含任何資料或互動行為,只負責
// 「東西放哪裡」;放什麼由呼叫端決定。
//
// 輸入框兩種放法(同一個插槽):
//   1. composer prop——內容是呼叫端自己的 JSX(模擬層的假輸入框)。
//   2. ComposerSlotContext——內容元件自己 portal 進來(真實層的
//      TripPlanPage,它的輸入框綁著對話狀態,不適合拆出去傳 prop)。
interface PlanOverlayPanelProps {
  // isDesktop——桌面版面板是 absolute 側欄,不需要導覽列佔位與安全區,
  // 手機版才渲染(兩者的設計說明見 PlanOverlayPanel.module.css)。
  isDesktop: boolean
  // safeAreaRef——useMapSafeArea 回傳的 safeAreaElRef,接在安全區元素上。
  safeAreaRef: Ref<HTMLDivElement>
  // passThrough——面板本身不接收指標事件(手機版)。交接後的真實層使用:
  // 它的內容是一整頁高的透明疊層,必須讓空白處的手勢穿透到地圖。內容要
  // 自己把需要互動的元素寫回 pointer-events: auto。
  passThrough?: boolean
  // composer——放進輸入框插槽的內容。不傳則插槽留空,可由
  // ComposerSlotContext 的消費者 portal 進來。
  composer?: ReactNode
  children: ReactNode
}

export function PlanOverlayPanel({ isDesktop, safeAreaRef, passThrough = false, composer, children }: PlanOverlayPanelProps) {
  // 用 state 而非 ref 保存插槽節點:要在節點掛載後觸發一次 re-render,
  // 讓 context 的消費者拿到非 null 的值。
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null)

  // slotEl——2026-10 使用者明確要求「composer 區位要跟 UI 區的元素一起
  // 排列」,並確認「只改手機版,不動桌面版」:插槽容器依 isDesktop 放到
  // 不同位置,不是同一份 JSX 兩種斷點共用。
  //
  // 桌面版維持改動前的既有行為(.composerSlot,絕對定位、是 .panel 的
  // 手足而非子孫)——理由仍然成立:桌面 .panel 是固定 560px 的 absolute
  // 側欄,插槽若放進面板內部會被側欄寬度侷限、相對側欄定位,輸入框會跑
  // 進右側欄裡,不再相對整個 .page 置中。這個限制桌面版依然存在,所以
  // 桌面這條路徑原封不動。
  //
  // 手機版插槽改放進 .panel 內部,當 children 之後的最後一個 flex 子項
  // (見 .composerSlotMobile 的完整說明)——手機版 .panel 本身撐滿整頁
  // 寬度(見 .module.css .panel 手機斷點的既有定義),composer 放進去
  // 不會被任何寬度限制卡住,改成正常文件流排列後,不再需要跟其他絕對
  // 定位元素(卡片列、對話泡泡)協調重疊/留白問題。
  const slotEl = (
    <div
      className={isDesktop ? styles.composerSlot : styles.composerSlotMobile}
      ref={setComposerSlot}
    >
      {composer}
    </div>
  )

  return (
    <ComposerSlotContext.Provider value={composerSlot}>
      {!isDesktop && <div className={styles.navSpacer} aria-hidden="true" />}
      <div className={passThrough ? `${styles.panel} ${styles.passThrough}` : styles.panel}>
        {/* 渲染在 children 之前:對齊原本「安全區在時間軸手足之前」的順序。 */}
        {!isDesktop && <div className={styles.safeArea} ref={safeAreaRef} aria-hidden="true" />}
        {children}
        {!isDesktop && slotEl}
      </div>
      {isDesktop && slotEl}
    </ComposerSlotContext.Provider>
  )
}
