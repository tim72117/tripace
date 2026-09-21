import { useEffect, useState, type ReactNode } from 'react'
import { useIsDesktop } from '../hooks/useIsDesktop'
import styles from './MobileMapReveal.module.css'

// MobileMapReveal:手機版(<768px,見 useIsDesktop)把「開頭互動地圖」
// 換成一顆圓形地點縮圖,使用者點擊後才真正掛載 InteractiveExploreMap
// (children,呼叫端組好帶各城市專屬 props 傳進來)——地圖本身(Google
// Maps SDK 載入、建圖)有明確成本,手機版使用者一進頁面就先付出這筆
// 成本、但多數人是先看文字敘事捲動下去,不一定馬上要跟地圖互動,故
// 延後到「使用者主動點了縮圖」才建圖。展開動畫用 clip-path: circle()
// 從縮圖圓心向外撐開到滿版(視覺概念沿用專案更早的 KyotoExploreBloom
// 原型,見該檔案 git 歷史,那份原型本身已刪除、且是完全不同的 SVG 假
// 地圖機制,這裡只借用「圓形展開」這個轉場手法,地圖本體仍是這個共用
// 元件外部傳入的真實 InteractiveExploreMap)。
//
// 桌面版(isDesktop true)完全不啟用這套機制,直接原樣渲染 children
// ——桌面版本來就是非滿版、固定高度的展示卡片(見 InteractiveExploreMap.
// module.css 的 .stage),沒有「先佔滿手機小螢幕」的問題,維持原有的
// 直接掛載行為,不需要縮圖/點擊這一步。
export function MobileMapReveal({
  photoUrl,
  photoAlt,
  children,
}: {
  photoUrl: string
  photoAlt: string
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  // expanded:是否已展開成滿版地圖——一旦展開就不會再收合回縮圖(這個
  // 展示頁的地圖是「進入式」體驗,不是可反覆開關的抽屜,使用者展開後
  // 就維持在地圖狀態)。
  const [expanded, setExpanded] = useState(false)

  // 展開後鎖住 body 捲動——這個頁面(KyotoPage/JiufenPage)是純文件流
  // 頁面(body 本身會捲動),跟正式功能 GeoOutlinePhoneView 的情境不同
  // (該處的祖先 .mainArea 本身是固定 100dvh、天生不會捲動,見
  // GeoOutlinePhoneInfoSheet.tsx panelStyle 的完整說明,那個 bottom
  // sheet 用 position: fixed 相對視窗定位,不需要額外鎖 body)。這裡若
  // 不鎖住,bottom sheet(GeoOutlinePhoneInfoSheet)內部捲動觸底後繼續
  // 滑動的手勢會「穿透」到底層仍可捲動的 body——iOS Safari 已知行為:
  // fixed 定位元素疊在可捲動 body 上時,觸底手勢會被瀏覽器誤判成頁面
  // 手勢,除了直接拖動底層頁面導致破版,也會觸發類似 pinch-zoom 的
  // 縮放假象(實測回報過這兩種症狀)。只設 overflow: hidden 在 iOS
  // Safari 經常無效(著名的坑),額外加 position: fixed 才能徹底阻斷
  // rubber-band 捲動——退場時用 window.scrollY 記錄的值還原捲動位置,
  // 避免 position: fixed 造成頁面視覺上跳回頂部。
  useEffect(() => {
    if (!expanded) return
    const scrollY = window.scrollY
    const { body } = document
    const prevPosition = body.style.position
    const prevTop = body.style.top
    const prevWidth = body.style.width
    const prevOverflow = body.style.overflow
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = prevPosition
      body.style.top = prevTop
      body.style.width = prevWidth
      body.style.overflow = prevOverflow
      window.scrollTo(0, scrollY)
    }
  }, [expanded])

  if (isDesktop) return <>{children}</>

  if (!expanded) {
    return (
      <button
        type="button"
        className={styles.thumb}
        onClick={() => setExpanded(true)}
        aria-label={`展開${photoAlt}互動地圖`}
      >
        <img src={photoUrl} alt="" />
        <span className={styles.thumbHint}>點一下探索地圖</span>
        {/* scrollHint:提示使用者不點縮圖、直接往下捲動也能繼續看內容
            ——視覺上呼應各城市頁 hero 區塊已有的 SCROLL 提示(如
            KyotoPage.tsx 的 .kyoto-hero-scroll-hint),但這裡是共用
            元件,不能直接借用該頁面色票變數(--vermilion/--ink-soft
            只在 .kyoto-page 作用域定義),改用中性的 currentColor +
            透明度,顏色自然跟隨外層頁面(.kyoto-page/.jiufen-page 都
            有設 color)。 */}
        <span className={styles.scrollHint} aria-hidden="true">
          <span>SCROLL</span>
          <span className={styles.scrollHintBar} />
        </span>
      </button>
    )
  }

  return (
    <div className={styles.expandedStage}>
      {children}
    </div>
  )
}
