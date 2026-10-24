import { useState, type ReactNode } from 'react'
import { ComposerSlotContext } from '../../shared/overlayDom'
import wideStyles from '../PlanOverlayPanelWide.module.css'

// PlanOverlayPanel(/ai-plan wide 側欄版面,planning/preview/wide/)——寬螢幕(>=1024px)疊在地圖上方的側欄。
// 與 desktop/PlanOverlayPanel.tsx 同名同結構(composer 插槽 state + ComposerSlotContext + 面板 + 手足插槽),只換一份樣式
// (PlanOverlayPanelWide.module.css:top/bottom 讓出導覽列與 composer 帶、固定側欄寬度,常數見 planOverlayGeometry.ts)。
// wide 不支援 passThrough(桌面滑鼠操作沒有觸控穿透問題),也不帶 data-slot 標記(那是手機 overlay 的 DOM 契約,
// wide 不在其中)。
interface PlanOverlayPanelProps {
  composer?: ReactNode
  children: ReactNode
}

export function PlanOverlayPanel({ composer, children }: PlanOverlayPanelProps) {
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null)

  return (
    <ComposerSlotContext.Provider value={composerSlot}>
      <div className={wideStyles.panel}>{children}</div>
      <div className={wideStyles.composerSlot} ref={setComposerSlot}>
        {composer}
      </div>
    </ComposerSlotContext.Provider>
  )
}
