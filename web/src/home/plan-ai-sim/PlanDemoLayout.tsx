import type { ReactNode, Ref } from 'react'
import { PlanOverlayPanel } from './PlanOverlayPanel'
import { PlanOverlayPanelWide } from './PlanOverlayPanelWide'
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
  // wide——寬螢幕(>=1024px)版面:改渲染 PlanOverlayPanelWide,取代
  // PlanOverlayPanel(見該元件開頭的完整設計理由,2026-10 新增,使用者
  // 明確要求「左邊地圖中心,右側時間軸,下方 composer」,後確認「地圖
  // 一樣要滿版」)。
  //
  // 跟 isDesktop 是獨立的兩個判斷,不是同一個斷點的兩種取值——isDesktop
  // 決定 PlanOverlayPanel 內部的手機/桌面兩種插槽位置(見該 prop 的完整
  // 說明),wide 決定「側欄外殼要不要換成 PlanOverlayPanelWide 那一份」。
  // 呼叫端目前的用法是 wide 時 isDesktop 必為 true(1024px 必然也
  // >=768px),但這裡不假設這個關係、不做互斥檢查——两個 prop 各自描述
  // 各自的版面決策,耦合關係留給呼叫端的斷點判斷邏輯負責,這層不重複
  // 那份邏輯。
  //
  // 地圖容器(.mapBackdrop)不隨 wide 改變,維持 absolute 鋪滿整個
  // .page、side 疊加在上方(跟桌面版 PlanOverlayPanel 同一種模式)——
  // 使用者明確要求「地圖一樣要滿版」,側欄佔用的範圍改由呼叫端
  // (AIPlanTimelinePage.tsx)的安全可視區換算處理,不是版面層級的擠壓。
  // wide 因此只切換側欄本身用哪個元件,不影響地圖/nav/children 的
  // 外層 DOM 結構或 CSS。
  wide?: boolean
  // 以下皆透傳給內部的 PlanOverlayPanel(wide 為 false 時)或
  // PlanOverlayPanelWide(wide 為 true 時)。PlanOverlayPanelWide 不支援
  // passThrough/safeAreaRef(見該元件開頭的完整說明:寬螢幕側欄不疊在
  // 地圖上方,兩者的設計前提都不適用),wide 為 true 時這兩個 prop
  // 原樣接收但不會被用到。
  isDesktop: boolean
  safeAreaRef: Ref<HTMLDivElement>
  passThrough?: boolean
  composer?: ReactNode
  children: ReactNode
  // debugOverlay——開發工具疊圖插槽(例如 WideLayoutDebugOverlay,見該
  // 元件的完整說明),渲染在 .page 的最後一個子元素、跟 composer 插槽
  // 同層級。2026-10 新增(查證「composer 疊圖看不見」的真正根因):
  // mapBackground 插槽被包進 .mapBackdrop(z-index: 0,見該 class 的
  // 完整說明),composer 插槽(PlanOverlayPanelWide/.PlanOverlayPanel 的
  // .composerSlot)是 z-index: 20——兩者都是 .page 的直接子元素,
  // stacking context 在父層級比較時 .mapBackdrop 的 0 已經輸給 20,
  // 不管塞進 .mapBackdrop 內部的疊圖元素自己 z-index 設多高都無法
  // 蓋過 composer(子層級的 z-index 救不回父層級已經輸掉的比較結果)。
  // 需要標示 composer 範圍的疊圖必須跟 composer 插槽同層級、且自己的
  // z-index 高於它,不能塞進 mapBackground。
  debugOverlay?: ReactNode
}

export function PlanDemoLayout({
  embedded = false,
  theme,
  mapBackground,
  nav,
  wide = false,
  isDesktop,
  safeAreaRef,
  passThrough,
  composer,
  children,
  debugOverlay,
}: PlanDemoLayoutProps) {
  return (
    <div
      className={`${styles.page} ${embedded ? styles.pageEmbedded : ''} app-theme-root`}
      data-theme={theme ?? undefined}
    >
      {mapBackground && <div className={styles.mapBackdrop}>{mapBackground}</div>}
      {!embedded && nav}
      {wide ? (
        <PlanOverlayPanelWide composer={composer}>{children}</PlanOverlayPanelWide>
      ) : (
        <PlanOverlayPanel
          isDesktop={isDesktop}
          safeAreaRef={safeAreaRef}
          passThrough={passThrough}
          composer={composer}
        >
          {children}
        </PlanOverlayPanel>
      )}
      {debugOverlay}
    </div>
  )
}
