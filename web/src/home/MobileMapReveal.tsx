import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
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
// expanded 為 true 後,children 不會再 unmount——一旦使用者點過展開,
// 地圖實例(及其內部查詢到的景點資料)保留在記憶體/DOM 中,收合/再展開
// 只是切換 CSS 可見性(見下方 JSX,兩層都無條件渲染,用 aria-hidden +
// [hidden] 屬性切換,不是條件式渲染)。這是刻意的取捨:收合後重新展開
// 若走 unmount→remount,會重新呼叫 Google Maps SDK 建圖、重新查一次
// attractions API,使用者體感是「每次展開都要等」;代價是即使使用者
// 只展開過一次又收合,地圖仍在背景持續佔用記憶體、地圖本身的事件監聽
// 仍在運作——這個展示頁一次只會有一份地圖實例,成本可控,故接受這個
// 取捨。
//
// 桌面版(isDesktop true)完全不啟用這套機制,直接原樣渲染 children
// ——桌面版本來就是非滿版、固定高度的展示卡片(見 InteractiveExploreMap.
// module.css 的 .stage),沒有「先佔滿手機小螢幕」的問題,維持原有的
// 直接掛載行為,不需要縮圖/點擊這一步。
//
// 2026-09:原本這個元件內建一顆「SCROLL」往下捲動提示(scrollHint,見
// git 歷史此區塊移除前的版本),提示使用者不點縮圖、直接往下捲也能
// 繼續看內容——那時這個元件本身放在頁面最頂端(hero 標題之前),提示
// 貼在圓形縮圖上合理。使用者接著要求把整個地圖 intro 區塊搬到分站
// 列表結束、結尾 CTA 之前(見各城市頁 xxxPage.tsx 掛載處的完整說明),
// 這個元件不再位於頁面頂端,原本「引導使用者往下看」的提示留在這裡
// 已經不合語意。SCROLL 提示已搬到共用元件 ScrollHint.tsx,由各城市
// 頁自行掛在 hero 標題區塊下方(仍然只在手機版顯示,維持原本範圍),
// 不再是這個元件的職責。
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
  const [expanded, setExpanded] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  // scrollYRef:展開瞬間(使用者按下縮圖的那一刻,不是 useEffect 執行
  // 的時機)立刻記錄的捲動位置——2026-09 使用者回報「關閉後怎麼回到
  // 首頁了」,根因是原本在鎖 body 捲動的 useEffect 內才讀 window.scrollY,
  // 但這個 useEffect 執行時機是 React commit 之後的非同步階段,若中間
  // 有任何 reflow/resize 插入(例如同一批 state 更新裡 body.style
  // 已經被設成 fixed、或瀏覽器在這之間已經處理過一次捲動事件),
  // 讀到的 scrollY 可能不是使用者按下縮圖那個瞬間的真實值,最壞情況
  // 讀到 0,關閉地圖時 window.scrollTo(0, scrollY) 就會把頁面捲回最
  // 頂部(品牌列+hero),在地圖已經搬到頁面中下段的版面裡,使用者會
  // 誤以為「跳到了首頁」(京都頁最頂部的品牌名+大標題視覺上跟真的
  // 首頁 hero 相似)。改成在 onClick 事件處理器裡同步讀取、立刻存進
  // ref(事件處理器本身是同步執行,不會有 effect 排程的時序問題),
  // 鎖 body 捲動的 effect 改讀這個 ref 而非重新呼叫 window.scrollY,
  // 確保拿到的一定是使用者按下當下的真實捲動位置。
  const scrollYRef = useRef(0)

  // 展開時強制重播 clip-path 展開動畫——expandedStage 從一開始就掛載
  // 在 DOM 中(見元件開頭「children 不會再 unmount」的完整說明),只靠
  // CSS animation 掛在 class 上,第二次以後展開(hidden 從 true 變
  // false)瀏覽器不會自動重播已經「播完」的 animation。強制觸發一次
  // reflow(讀取 offsetWidth 會強制瀏覽器同步計算佈局,丟棄還沒套用的
  // 樣式變更批次)讓瀏覽器把這次的 hidden 移除視為全新狀態,animation
  // 才會重新從頭播放。
  useEffect(() => {
    if (!expanded || !stageRef.current) return
    void stageRef.current.offsetWidth
    stageRef.current.classList.remove(styles.replay)
    void stageRef.current.offsetWidth
    stageRef.current.classList.add(styles.replay)
  }, [expanded])

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
    const scrollY = scrollYRef.current
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

  return (
    <>
      <button
        type="button"
        className={styles.thumb}
        onClick={() => {
          scrollYRef.current = window.scrollY
          setExpanded(true)
        }}
        aria-label={`展開${photoAlt}互動地圖`}
        hidden={expanded}
      >
        <img src={photoUrl} alt="" />
        <span className={styles.thumbHint}>點一下探索地圖</span>
      </button>
      {/* expandedStage 無條件掛載(見上方元件開頭的完整說明),用 hidden
          屬性切換可見性,而非條件式渲染——children(InteractiveExploreMap)
          第一次點縮圖展開後就不再 unmount,收合/再展開只是 CSS 顯示
          切換,地圖實例/景點資料保留不重建。hidden 為原生屬性,瀏覽器
          預設 display: none,不需要額外 CSS 規則。 */}
      <div ref={stageRef} className={styles.expandedStage} hidden={!expanded}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => setExpanded(false)}
          aria-label="關閉地圖"
        >
          <X size={20} strokeWidth={2} />
        </button>
        {children}
      </div>
    </>
  )
}
