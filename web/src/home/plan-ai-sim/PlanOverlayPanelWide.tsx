import { useState, type ReactNode } from 'react'
import { ComposerSlotContext } from '../../plan-core/composerSlot'
import styles from './PlanOverlayPanelWide.module.css'

// PlanOverlayPanelWide——寬螢幕(>=1024px)專用的版面外殼,跟 PlanOverlayPanel
// (見該檔案的完整設計理由)平行存在、不是它的變體或子分支。2026-10 新增
// (使用者明確要求「先新增一個 1024px 的 layout 元件」「是一個與
// PlanOverlayPanel 相同層的元件,在不同裝置時置換」)。
//
// 跟 PlanOverlayPanel 桌面版(>=768px)用同一種疊加模式:.panel 是
// position: absolute 貼齊右緣的浮動側欄,地圖維持 absolute 鋪滿整個
// .page(使用者明確要求「地圖一樣要滿版」,見 PlanDemoLayout.module.css
// .mapBackdrop 的完整說明)。跟 PlanOverlayPanel 桌面版的差異只在:
// 候選卡片排列方式(呼叫端 ScriptedAskPage/AskPage 依裝置傳
// AskPage.module.css .directionScrollerStacked,見該 class 的完整
// 說明,上下堆疊取代橫向捲動)——不是版面定位邏輯的差異。地圖安全可視
// 區因此仍需要排除右側側欄的範圍,由呼叫端(AIPlanTimelinePage.tsx)
// 接上 mapSafeArea.safeAreaElRef 處理,跟桌面版同一套
// solveSafeAreaCenter 計算,不是另外發明一套。
//
// 不支援 passThrough:跟 PlanOverlayPanel 桌面版同一個理由——桌面版面
// 滑鼠操作不需要「空白處讓觸控手勢穿透到地圖」這個手機版才有的問題
// (見 PlanOverlayPanel.module.css .passThrough 的完整說明)。
//
// 不渲染 navSpacer:只服務手機版 flex column 流裡的導覽列佔位,寬螢幕
// 側欄是 absolute 疊加、不在 flex 流裡,這個概念不適用——對齊
// PlanOverlayPanel 桌面分支「沒有導覽列佔位」的既有先例。safeArea 則
// 由呼叫端自己在 mapBackground 插槽裡掛一個對應側欄範圍的矩形(見
// AIPlanTimelinePage.tsx wide 分支的完整說明),不是這個元件內部渲染
// ——跟 PlanOverlayPanel 手機版把 safeArea 元素收在自己內部不同,因為
// 這裡的安全區矩形要排除的是側欄本身佔用的範圍,由呼叫端知道側欄寬度
// 比這個元件自己猜測更直接。
//
// composer 插槽固定是面板的手足(對齊 PlanOverlayPanel 桌面版的既有
// 行為,理由相同:側欄有自己的寬度限制,插槽放進面板內部會被側欄寬度
// 侷限、相對側欄定位,但 composer 應該相對整個 .page 置中)。
interface PlanOverlayPanelWideProps {
  composer?: ReactNode
  children: ReactNode
}

export function PlanOverlayPanelWide({ composer, children }: PlanOverlayPanelWideProps) {
  // 用 state 而非 ref 保存插槽節點:理由同 PlanOverlayPanel 的同名 state
  // ——要在節點掛載後觸發一次 re-render,讓 context 的消費者拿到非 null
  // 的值。
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null)

  return (
    <ComposerSlotContext.Provider value={composerSlot}>
      <div className={styles.panel}>{children}</div>
      <div className={styles.composerSlot} ref={setComposerSlot}>
        {composer}
      </div>
    </ComposerSlotContext.Provider>
  )
}
