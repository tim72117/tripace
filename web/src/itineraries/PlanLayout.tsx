import type { PlanLayoutContract } from '../planning/shared/layerContracts'
import { OVERLAY_SLOT, slotAttr } from '../planning/shared/overlayDom'
import styles from './AiItineraryDetailPageMapView.module.css'

// PlanLayout(src/itineraries/)——行程詳情頁(地圖版面)的最外層容器。
//
// 與 /ai-plan(planning/preview/)、登入後手機(planning/member/phone/)、登入後桌面(planning/member/desktop/)的 PlanLayout 同名同層級:
// 渲染 data-slot="container"(見 planning/shared/overlayDom.ts),疊加層(PlanOverlayLayout)與地圖都在容器底下。
// 這頁的容器就是滿版、隱藏溢出的 <main>(.page);其他裝飾(外框、返回連結、美食面板、燈箱)由頁面元件放進 children。
// PlanLayoutProps——就是共同契約 PlanLayoutContract(這頁沒有入口特有的欄位)。
export type PlanLayoutProps = PlanLayoutContract

export function PlanLayout({ children }: PlanLayoutProps) {
  return (
    <main {...slotAttr(OVERLAY_SLOT.container)} className={styles.page}>
      {children}
    </main>
  )
}
