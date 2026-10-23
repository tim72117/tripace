import type { ReactNode } from 'react'
import { OVERLAY_SLOT, slotAttr } from '../../plan-core/overlayDom'
import type { PlanLayoutContract } from '../../plan-core/layerContracts'
import styles from './PlanLayout.module.css'

// PlanLayout(/ai-plan)——第 2 層,最外層容器,只管外框:根容器(data-slot="container")、主題(data-theme)、
// 嵌入模式、上方漂浮導覽列 nav、除錯疊圖。
//
// 地圖與疊加面板的版面(地圖層、控制項插槽、疊加層與面板)是第 3 層 PlanOverlayLayout 的事,由 Content 把它
// 放進這個容器的 children,與登入後手機、登入後桌面、行程詳情頁同一種組合方式:
//   <PlanLayout …><PlanOverlayLayout mapBackground …>內容</PlanOverlayLayout></PlanLayout>
// (2026-10 以前這裡自己渲染 PlanOverlayLayout,所以要收 mapBackground、wide、isDesktop、safeAreaRef、composer、
// passThrough 再轉傳;現在拿掉,PlanLayout 只剩外框的 props。)
export interface PlanLayoutProps extends PlanLayoutContract {
  // embedded——被當 iframe 嵌入時隱藏捲動把手,且不渲染 nav。
  embedded?: boolean
  // theme——data-theme 屬性值。
  theme?: 'dark' | 'light' | null
  // nav——上方漂浮按鈕列插槽(SiteNavBrand 等),fixed 定位元件自己處理疊層,這裡只是提供掛載位置。
  nav?: ReactNode
  // debugOverlay——除錯疊圖插槽(wide 版面的安全區示意等)。
  debugOverlay?: ReactNode
}

export function PlanLayout({ embedded = false, theme, nav, debugOverlay, children }: PlanLayoutProps) {
  return (
    <div
      {...slotAttr(OVERLAY_SLOT.container)}
      className={`${styles.container} ${embedded ? styles.pageEmbedded : ''} app-theme-root`}
      data-theme={theme ?? undefined}
    >
      {!embedded && nav}
      {children}
      {debugOverlay}
    </div>
  )
}
