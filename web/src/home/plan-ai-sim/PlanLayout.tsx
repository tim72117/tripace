import type { ReactNode, Ref } from 'react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { OVERLAY_SLOT, slotAttr } from '../../plan-core/overlayDom'
import type { PlanLayoutContract } from '../../plan-core/layerContracts'
import styles from './PlanLayout.module.css'

// PlanLayout——/ai-plan 完整展示頁(home/plan-ai-sim/Content.tsx)的外層
// 版面骨架。2026-10 新增(使用者明確要求「先重構播放態的layout」,
// 「這個佈局輕量化,只有佈局本身邏輯,內部元件都是挖洞組合進去的」):
// 原本 .container 根容器、地圖背景(.mapLayer)、上方漂浮 nav 按鈕列這三塊
// 排版區塊直接寫在 home/plan-ai-sim/Content.tsx 兩千多行的 JSX 裡,跟
// handedOver/composerCollapsed 等大量資料狀態混在一起——這裡抽出來,
// 只管「容器放哪裡、多大」,四個具名插槽的實際內容(地圖元件、nav
// 按鈕、時間軸、composer)完全由呼叫端決定,這個元件自己不持有任何
// state 或業務邏輯。
//
// 內部繼續包著 PlanOverlayLayout(地圖層、控制項插槽與疊加面板的外殼,
// 見該元件的完整說明;手機版交給 plan-core/OverlayShell.tsx,桌面與 wide
// 交給 PlanOverlayPanel 的側欄版面)——它們原本就已經是純版面配置,
// 不需要重寫,這裡只是把「根容器+nav」這一層原本沒被收進
// 任何 layout 元件的部分一併包起來,讓整個播放態的版面骨架收斂成
// 單一元件,不再分散在頁面主體與 PlanOverlayLayout 兩處。
//
// 之後首頁小展示(AiPlanPhoneDemoScreen.tsx)要依照同一種「挖洞組合」
// 模式建立自己獨立的 layout 元件——不是共用這個元件或繼承它,是參考
// 同樣的設計哲學各自建立,因為兩者服務的容器尺寸、定位方式完全不同
// (這裡是整頁 100dvh 的展示頁,小展示是寫死 390×844 尺寸的手機螢幕
// 內容)。
export interface PlanLayoutProps extends PlanLayoutContract {
  // embedded——見原本 home/plan-ai-sim/Content.tsx isEmbedded 的完整說明:
  // 被當 iframe 嵌入時隱藏捲動把手。
  embedded?: boolean
  // theme——data-theme 屬性值,見原本 .container data-theme 的完整說明。
  theme?: 'dark' | 'light' | null
  // mapBackground——地圖背景插槽(NativeMapBase + 安全區除錯疊圖),
  // 鋪滿整個容器,z-index 最低。
  mapBackground?: ReactNode
  // nav——上方漂浮按鈕列插槽(SiteNavBrand 等),fixed 定位元件自己
  // 處理疊層,這裡只是提供掛載位置。
  nav?: ReactNode
  // wide——寬螢幕(>=1024px)版面:交給 PlanOverlayLayout 渲染
  // PlanOverlayPanel 的 wide 分支(側欄樣式,見該元件開頭的完整設計理由,2026-10 新增,使用者
  // 明確要求「左邊地圖中心,右側時間軸,下方 composer」,後確認「地圖
  // 一樣要滿版」)。
  //
  // 跟 isDesktop 是獨立的兩個判斷,不是同一個斷點的兩種取值——isDesktop
  // 決定 PlanOverlayLayout 走手機版(OverlayShell)還是桌面側欄版面(見該 prop 的完整
  // 說明),wide 決定「側欄外殼要不要換成 PlanOverlayPanel 的 wide 樣式那一份」。
  // 呼叫端目前的用法是 wide 時 isDesktop 必為 true(1024px 必然也
  // >=768px),但這裡不假設這個關係、不做互斥檢查——两個 prop 各自描述
  // 各自的版面決策,耦合關係留給呼叫端的斷點判斷邏輯負責,這層不重複
  // 那份邏輯。
  //
  // 地圖容器(.mapLayer)不隨 wide 改變,維持 absolute 鋪滿整個
  // .container、side 疊加在上方(跟桌面版 PlanOverlayPanel 同一種模式)——
  // 使用者明確要求「地圖一樣要滿版」,側欄佔用的範圍改由呼叫端
  // (home/plan-ai-sim/Content.tsx)的安全可視區換算處理,不是版面層級的擠壓。
  // wide 因此只切換側欄本身用哪個元件,不影響地圖/nav/children 的
  // 外層 DOM 結構或 CSS。
  wide?: boolean
  // 以下皆透傳給內部的 PlanOverlayLayout(wide 時它渲染 PlanOverlayPanel 的
  // wide 分支)。wide 分支不支援 passThrough(見 PlanOverlayPanel.tsx 開頭的
  // 說明:桌面滑鼠操作沒有觸控穿透問題);safeAreaRef 在 wide 時掛在
  // PlanOverlayLayout 渲染的安全區節點上,非 wide 的桌面版面不會用到它。
  isDesktop: boolean
  safeAreaRef: Ref<HTMLDivElement>
  passThrough?: boolean
  composer?: ReactNode
  children: ReactNode
  // debugOverlay——開發工具疊圖插槽(例如 WideLayoutDebugOverlay,見該
  // 元件的完整說明),渲染在 .container 的最後一個子元素、跟 composer 插槽
  // 同層級。2026-10 新增(查證「composer 疊圖看不見」的真正根因):
  // mapBackground 插槽被包進 .mapLayer(z-index: 0,見該 class 的
  // 完整說明),composer 插槽(PlanOverlayPanelWide.module.css/PlanOverlayPanel.module.css 的
  // .composerSlot)是 z-index: 20——兩者都是 .container 的直接子元素,
  // stacking context 在父層級比較時 .mapLayer 的 0 已經輸給 20,
  // 不管塞進 .mapLayer 內部的疊圖元素自己 z-index 設多高都無法
  // 蓋過 composer(子層級的 z-index 救不回父層級已經輸掉的比較結果)。
  // 需要標示 composer 範圍的疊圖必須跟 composer 插槽同層級、且自己的
  // z-index 高於它,不能塞進 mapBackground。
  debugOverlay?: ReactNode
}

export function PlanLayout({
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
}: PlanLayoutProps) {
  return (
    <div
      {...slotAttr(OVERLAY_SLOT.container)}
      className={`${styles.container} ${embedded ? styles.pageEmbedded : ''} app-theme-root`}
      data-theme={theme ?? undefined}
    >
      {!embedded && nav}
      <PlanOverlayLayout
        mapBackground={mapBackground}
        wide={wide}
        isDesktop={isDesktop}
        safeAreaRef={safeAreaRef}
        passThrough={passThrough}
        composer={composer}
      >
        {children}
      </PlanOverlayLayout>
      {debugOverlay}
    </div>
  )
}
