import { useCallback, useEffect, useRef } from 'react'
import { TIME_DRAG_ENABLED } from '../DesktopShared'
import { PlanTimelineView, type StopCardRenderContext } from '../plan-core/PlanTimelineView'
import { getTimeDragBounds, type PlanNode } from '../plan-core/planTimeline'
import { usePlanSimSocket } from './plan-ai-sim/AIPlanTimelinePage'
import demoMapSrc from './assets/ai-plan-demo-map.png'
import styles from './AiPlanPhoneDemoScreen.module.css'

// renderDemoStopCard——這個展示框專屬的地點卡渲染(使用者明確要求「讓
// 只有小展示地點卡可以替換元件」「讓圖片跟標題大一點」),透過
// PlanTimelineView 的 renderStopCard 插槽接上(見該 prop/
// StopCardRenderContext 的完整說明),不修改共用元件本身的 .stopCard
// 樣式——那會連動影響 /app、/trip-plan 等所有正式頁面。
//
// 縮圖 88px/標題 20px,比正式頁預設的 64px/17px 明顯放大(約 1.3 倍)
// ——這個展示框本身縮小嵌在手機外框裡(見 AiPlanPhoneDemo.tsx 的
// SCALE),卡片在這個尺寸下需要更大的視覺元素才容易被辨識,不是單純
// 「比較好看」的偏好調整。
//
// 2026-10 使用者明確定調「小展示不做互動,大展示除了 AI 對話外都要
// 對齊功能」——曾經一度接上 ctx.onClick/onMouseEnter/onMouseLeave 讓
// 這張卡片呈現選取/hover 視覺,但這個方向已經撤銷:小展示維持純展示
// 性質,不接任何點選/hover 回呼,只用 ctx.usablePhotos 這個純資料欄位
// 決定外觀。ctx.isSelected 不再被引用——這個展示框完全沒有管道能把
// 任何站點標成選取狀態(見下方 onPanToStop 的完整說明),保留判斷式
// 只會是永遠不成立的死碼,已拿掉(連同 .demoStopCardSelected 這個
// CSS class)。拖拉調整時間功能(TIME_DRAG_ENABLED)不受影響,維持原狀
// ——那是使用者明確要求保留的既有功能,不在這次撤銷範圍內。
function renderDemoStopCard(step: PlanNode, ctx: StopCardRenderContext) {
  if (step.type !== 'stop') return null
  return (
    <div className={styles.demoStopCard}>
      <div className={styles.demoStopThumb} style={{ background: ctx.usablePhotos.length ? undefined : step.thumbBg }}>
        {ctx.usablePhotos.length ? (
          <img src={ctx.usablePhotos[0]} alt={step.name} className={styles.demoStopThumbImg} />
        ) : step.thumbIcon}
      </div>
      <div className={styles.demoStopBody}>
        <div className={styles.demoStopMeta}>{step.duration} · {step.kind}</div>
        <div className={styles.demoStopName}>{step.name}</div>
      </div>
    </div>
  )
}

// AiPlanPhoneDemoScreen — 功能介紹頁手機外框(AiPlanPhoneDemo.tsx)內部
// 顯示的展示畫面(方案 B,2026-10 使用者明確確認:「試做B我試試看效果」)。
//
// 背景:這個小展示原本用 <iframe src="/ai-plan?embedded=1"> 整頁嵌入
// AIPlanTimelinePage.tsx,後來 AIPlanTimelinePage 的地圖換成真實互動
// 地圖(NativeMapBase,見該檔案的完整說明)後,使用者希望小展示改回
// 「靜態圖片地圖 + 模擬元件」——但若直接把這個元件(非 iframe)嵌進
// 功能介紹頁再用 CSS transform:scale() 縮小,AIPlanTimelinePage 現有的
// 響應式版面(@media (max-width: 767px) 手機斷點)會判斷錯誤:
// media query 看的是瀏覽器真實視窗寬度,不是縮放後的視覺尺寸,縮小後的
// 外框在桌面瀏覽器裡仍然會套用桌面版版面規則,版面會跟手機外框的形狀
// 衝突。
//
// 這個元件採用「方案 B」解法:整個版面寫死成手機尺寸(不依賴任何
// @media 判斷),專門只給這個固定尺寸的手機外框使用,不透過 iframe、
// 也不是整頁 AIPlanTimelinePage 的縮小版——只共用它的劇本模擬邏輯
// (usePlanSimSocket,已改成 export 供這裡 import,見該函式宣告處的
// 完整說明),地圖、composer、頂部導覽列等版面相關的部分都是這裡重新
// 寫的簡化版,不是原頁面的複製貼上。
//
// 地圖用存好的靜態圖片(assets/ai-plan-demo-map.png,跟
// AIPlanTimelinePage.tsx 先前 NativeMapBase 用的 CENTER/ZOOM 同一組
// 構圖參數,2026-10 用 Static Maps API 產生並存檔),不是即時 API 呼叫
// ——這個小展示本身在功能介紹頁上是裝飾性質的縮圖,不需要每次頁面
// 載入都重新打一次 API 或掛載完整的 Maps JS SDK。
//
// 這個元件本身不處理手機外框造型(鈦金屬邊框/notch/按鈕等,那是
// AiPlanPhoneDemo.tsx 的職責),只負責「螢幕裡顯示的內容」,呼叫端把
// 它放進 .screen 容器裡即可。
export function AiPlanPhoneDemoScreen() {
  // promptTyped 固定傳 true——這個展示框一開始就是「已經送出」的狀態,
  // 不重播打字動畫(手機外框本身很小,打字動畫在這個尺寸下不易辨識,
  // 且使用者的重點是「看到排程逐站長出來」,不是「看到怎麼打字」)。
  const { steps, isGenerating, timelineRef, dragStopTime } = usePlanSimSocket(true)

  // mountedIdsRef/scrollRef——PlanTimelineView 必填的輔助 ref,理由同
  // AIPlanTimelinePage.tsx 同名變數的完整說明(追蹤進場動畫播過的節點
  // id、捲動容器參照)。這裡沒有額外邏輯需要掛在這兩個 ref 上。
  const mountedIdsRef = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const stopCount = steps.filter((s) => s.type === 'stop').length

  // scrollToLatest/自動跟隨捲動——理由同 AIPlanTimelinePage.tsx 同名
  // 邏輯的完整說明(排程過程中新站點/呼吸點長出來,畫面要跟著捲到底,
  // 否則使用者只看得到最上面幾站、看不到持續安排的動態)。這裡是簡化
  // 版:不需要 followingRef/handleScroll 那套「使用者手動往上捲就退出
  // 跟隨」的邏輯——這個展示框整個是 pointer-events:none(見
  // AiPlanPhoneDemo.tsx 的完整說明),使用者無法在上面滑動捲頁,不會有
  // 「跟隨 vs 使用者主動瀏覽」的衝突情境,永遠跟隨到底即可。
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = scrollRef.current
        if (!scroller) return
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      })
    })
  }, [])

  useEffect(() => {
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, isGenerating, scrollToLatest])

  return (
    <div className={`${styles.screen} app-theme-root`}>
      {/* app-theme-root(不帶 data-theme 屬性)——使用者明確要求「跟著
          使用者系統偏好自動切換明暗」:base-ui.css 的
          .app-theme-root:not([data-theme="light"]) 搭配
          @media (prefers-color-scheme: dark)(見該檔案開頭四段式寫法的
          完整說明)只在沒有 data-theme 屬性、或屬性不是 "light" 時才會
          跟隨系統偏好套用深色 token——不指定這個屬性,就是「跟隨系統」
          的語意,不需要自己讀 prefers-color-scheme 再手動判斷。沒有
          app-theme-root 這個 class,token 會是 undefined,CSS 裡的
          fallback 值會生效但不保證跟設計稿一致。 */}
      {/* 地圖背景——見檔頭說明,存好的靜態圖片,不即時呼叫 API。
          pointer-events:none(見 .module.css):這張圖本身不可互動,
          整個展示框的點擊事件由外層 AiPlanPhoneDemo.tsx 的 <Link>
          接收。 */}
      <img src={demoMapSrc} alt="" className={styles.mapBackdrop} aria-hidden="true" />
      <div className={styles.scrim} />
      <div className={styles.timelineWrap}>
        <PlanTimelineView
          steps={steps}
          isThinking={isGenerating}
          emptyStateMessage=""
          hideEmptyState
          endMarkerMessage="行程結束"
          // selectedStopId/onPanToStop——這個展示框不做互動(2026-10
          // 使用者明確定調「小展示不做互動」),PlanTimelineView 的這兩個
          // prop 是必填,給一組最小可用的 no-op 實作滿足型別,不做任何
          // 實際的地圖平移(靜態圖片沒有「平移」這個概念),也不维護任何
          // selectedStopId state——沒有狀態就沒有永遠不成立的死碼分支。
          selectedStopId={null}
          showJumpPill={false}
          onJumpToLatest={() => {}}
          onPanToStop={() => {}}
          // TIME_DRAG_ENABLED——feature flag(見 DesktopShared.tsx 同名
          // 常數的完整說明),關閉時兩個 prop 都不傳。
          getStopTimeDragBounds={TIME_DRAG_ENABLED ? (stopId) => getTimeDragBounds(timelineRef.current, stopId) : undefined}
          onDragStopTime={TIME_DRAG_ENABLED ? dragStopTime : undefined}
          renderStopCard={renderDemoStopCard}
          onOpenPhotos={() => {}}
          mountedIdsRef={mountedIdsRef}
          scrollRef={scrollRef}
          scrollClassName={styles.timelineScroll}
        />
      </div>
      <div className={styles.statusPill}>
        {isGenerating ? (
          <>
            <span className={`${styles.statusDot} ${styles.statusDotGenerating}`} />
            <span>正在安排行程…</span>
          </>
        ) : (
          <>
            <span className={`${styles.statusDot} ${styles.statusDotDone}`} />
            <span>已安排 {stopCount} 站</span>
          </>
        )}
      </div>
    </div>
  )
}
