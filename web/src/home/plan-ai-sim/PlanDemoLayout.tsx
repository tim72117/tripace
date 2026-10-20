import type { ReactNode, Ref } from 'react'
import { PlanOverlayPanel } from './PlanOverlayPanel'
import styles from './PlanDemoLayout.module.css'

// PlanDemoLayout——/ai-plan 完整展示頁(AIPlanTimelinePage.tsx)的外層
// 版面骨架。2026-10 新增(使用者明確要求「先重構播放態的layout」,
// 「這個佈局輕量化,只有佈局本身邏輯,內部元件都是挖洞組合進去的」):
// 原本 .page 根容器、地圖背景(.mapBackdrop)、上方漂浮 nav 按鈕列這三塊
// 排版區塊直接寫在 AIPlanTimelinePage.tsx 兩千多行的 JSX 裡,跟
// handedOver/composerCollapsed 等大量資料狀態混在一起——這裡抽出來,
// 只管「容器放哪裡、多大」,四個具名插槽的實際內容(地圖元件、nav
// 按鈕、時間軸、composer)完全由呼叫端決定,這個元件自己不持有任何
// state 或業務邏輯。
//
// 內部繼續包著既有的 PlanOverlayPanel(時間軸/composer 的版面外殼,
// 見該元件的完整說明)——PlanOverlayPanel 原本就已經是純版面配置,
// 不需要重寫,這裡只是把「根容器+地圖背景+nav」這一層原本沒被收進
// 任何 layout 元件的部分一併包起來,讓整個播放態的版面骨架收斂成
// 單一元件,不再分散在頁面主體與 PlanOverlayPanel 兩處。
//
// 之後首頁小展示(AiPlanPhoneDemoScreen.tsx)要依照同一種「挖洞組合」
// 模式建立自己獨立的 layout 元件——不是共用這個元件或繼承它,是參考
// 同樣的設計哲學各自建立,因為兩者服務的容器尺寸、定位方式完全不同
// (這裡是整頁 100dvh 的展示頁,小展示是寫死 390×844 尺寸的手機螢幕
// 內容)。
interface PlanDemoLayoutProps {
  // embedded——見原本 AIPlanTimelinePage.tsx isEmbedded 的完整說明:
  // 被當 iframe 嵌入時隱藏捲動把手。
  embedded?: boolean
  // theme——data-theme 屬性值,見原本 .page data-theme 的完整說明。
  theme?: 'dark' | 'light' | null
  // mapBackground——地圖背景插槽(NativeMapBase + 安全區除錯疊圖),
  // 鋪滿整個容器,z-index 最低。
  mapBackground?: ReactNode
  // nav——上方漂浮按鈕列插槽(SiteNavBrand 等),fixed 定位元件自己
  // 處理疊層,這裡只是提供掛載位置。
  nav?: ReactNode
  // 以下皆透傳給內部的 PlanOverlayPanel,見該元件 props 的完整說明。
  isDesktop: boolean
  safeAreaRef: Ref<HTMLDivElement>
  passThrough?: boolean
  composer?: ReactNode
  children: ReactNode
}

export function PlanDemoLayout({
  embedded = false,
  theme,
  mapBackground,
  nav,
  isDesktop,
  safeAreaRef,
  passThrough,
  composer,
  children,
}: PlanDemoLayoutProps) {
  return (
    <div
      className={`${styles.page} ${embedded ? styles.pageEmbedded : ''} app-theme-root`}
      data-theme={theme ?? undefined}
    >
      {mapBackground && <div className={styles.mapBackdrop}>{mapBackground}</div>}
      {!embedded && nav}
      <PlanOverlayPanel
        isDesktop={isDesktop}
        safeAreaRef={safeAreaRef}
        passThrough={passThrough}
        composer={composer}
      >
        {children}
      </PlanOverlayPanel>
    </div>
  )
}
