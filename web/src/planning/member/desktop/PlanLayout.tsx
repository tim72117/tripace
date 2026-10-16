import type { ReactNode } from 'react'
import { DesktopLayoutShell } from '../../../DesktopLayoutShell'
import { DesktopMain } from '../../../DesktopMain'
import type { PlanLayoutContract } from '../../shared/layerContracts'
import { OVERLAY_SLOT, slotAttr } from '../../shared/overlayDom'

// PlanLayout(登入後桌面版)——最外層容器,對應 /ai-plan 的 planning/preview/PlanLayout 與登入後手機版的 planning/member/phone/PlanLayout:
// 同一個層級、同一個名字,都渲染 data-slot="container" 的容器(見 planning/shared/overlayDom.ts),疊加層(PlanOverlayLayout)
// 與地圖都在容器底下。
//
// 桌面版的容器由兩個通用積木組成(DesktopLayoutShell 是橫向 flex 的最外層、DesktopMain 是右側主顯示區,所以積木本身留在 src/ 根目錄):
//   - nav:最左側導覽列(desktop/Nav),排在主顯示區之前。
//   - children:主顯示區的內容(地圖與疊加層、浮動卡片、資訊卡等),放進 DesktopMain。
//   - unbounded:是否拿掉主顯示區的寬度上限、滿版鋪底(地圖類內容用,見 DesktopMain.tsx 對 unbounded 的說明)。
//   - unboundedScroll:僅在 unbounded 為 true 時有意義,讓主顯示區本身接手垂直捲動(內容會超出可視高度的整頁分頁用,
//     例如部落格文章編輯器 blog-editor;見 DesktopMain.tsx 對 unboundedScroll 的說明)。
//   - debugPanel:右側除錯面板(開發工具),排在主顯示區之後,同一排 flex。
// 手機版的容器(planning/member/phone/PlanLayout)只管撐滿高度並把 TabBar 高度寫成 CSS 變數,版面骨架不同,所以只共用名字與
// data-slot="container" 這個契約。
// PlanLayoutProps——滿足共同契約 PlanLayoutContract(planning/shared/layerContracts.ts),加桌面特有的 nav、unbounded、unboundedScroll、debugPanel。
export interface PlanLayoutProps extends PlanLayoutContract {
  nav: ReactNode
  unbounded?: boolean
  unboundedScroll?: boolean
  debugPanel?: ReactNode
}

export function PlanLayout({
  nav,
  unbounded,
  unboundedScroll,
  debugPanel,
  children,
}: PlanLayoutProps) {
  return (
    <DesktopLayoutShell {...slotAttr(OVERLAY_SLOT.container)}>
      {nav}
      <DesktopMain unbounded={unbounded} unboundedScroll={unboundedScroll}>{children}</DesktopMain>
      {debugPanel}
    </DesktopLayoutShell>
  )
}
