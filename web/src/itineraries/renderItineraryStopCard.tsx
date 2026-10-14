import type { PlanNode } from '../plan-core/planTimeline'
import type { StopCardRenderContext } from '../plan-core/PlanTimelineView'
import styles from './renderItineraryStopCard.module.css'

// createRenderItineraryStopCard——itineraries 專屬的地點卡渲染(2026-10
// 新增,使用者明確要求「置換成 ai-itineraries 的版本，圖片放大一點」),
// 透過 PlanTimelineView 的 renderStopCard 插槽接上(見該 prop/
// StopCardRenderContext 的完整說明),不修改共用元件本身的 .stopCard
// 樣式——那會連動影響 /app、/trip-plan 等所有正式功能頁面。
//
// 縮圖 96px/標題 19px,比正式頁預設的 64px/17px 明顯放大(約 1.5 倍)
// ——這是展示頁(訪客瀏覽範例行程,不是實際規劃工具),希望縮圖本身
// 更有「像在看一篇精選行程」的份量感,不是工具型介面的密集資訊列表。
//
// 跟 home/AiPlanPhoneDemoScreen.tsx 的 renderDemoStopCard 差異:那個是
// 手機外框裡的純展示縮圖(pointer-events:none,不接互動、不顯示 desc),
// 這裡是訪客會實際點擊/hover 的正式展示頁卡片,保留 desc 文字、多張
// 照片角標、選取/hover 狀態等完整互動,只是放大版面尺寸,不是砍掉
// 互動性換取簡潔。
//
// 改成工廠函式(createXxx 回傳實際 render 函式)而非直接 export 一份
// 固定的 render 函式——2026-10 新增,使用者明確要求「圖卡加入一些手繪
// 卡通樣式,活潑一點」,但確認只套在走手繪地圖的行程(itinerary.mapStyle
// === 'hand-drawn',目前是 erziping-1day),不是全站所有行程都套用。
// PlanTimelineView 的 renderStopCard 插槽簽名是 (step, ctx) => ReactNode,
// 本身沒有管道傳「這份行程是不是手繪風」這種跟單一節點無關的頁面層級
// 設定,所以在組裝 renderStopCard 之前,由呼叫端(AiItineraryDetailPage.tsx/
// AiItineraryDetailPageMapView.tsx)先依 itinerary.mapStyle 呼叫這個工廠
// 函式,決定要不要套用 .playful 系列的手繪卡通樣式(見 .module.css 的
// 完整說明),拿到的才是真正符合插槽簽名、可以直接傳給 PlanTimelineView
// 的函式。
export function createRenderItineraryStopCard(isPlayful: boolean) {
  return function renderItineraryStopCard(step: PlanNode, ctx: StopCardRenderContext) {
    if (step.type !== 'stop') return null
    const cardClass = [
      styles.stopCard,
      isPlayful ? styles.stopCardPlayful : '',
      ctx.isSelected ? (isPlayful ? styles.stopCardPlayfulSelected : styles.stopCardSelected) : '',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <div
        className={cardClass}
        role="button"
        tabIndex={0}
        onClick={ctx.onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') ctx.onClick()
        }}
        onMouseEnter={ctx.onMouseEnter}
        onMouseLeave={ctx.onMouseLeave}
        onFocus={ctx.onFocus}
        onBlur={ctx.onBlur}
      >
        <div className={styles.stopThumb} style={{ background: ctx.usablePhotos.length ? undefined : step.thumbBg }}>
          {step.loading ? (
            <span className={styles.thumbSpinner} aria-label="查詢地點資料中" />
          ) : ctx.usablePhotos.length ? (
            <button
              type="button"
              className={styles.stopThumbPhotoBtn}
              onClick={(e) => {
                e.stopPropagation()
                ctx.onOpenPhotos()
              }}
              aria-label={ctx.usablePhotos.length > 1 ? `瀏覽 ${ctx.usablePhotos.length} 張照片` : '放大檢視照片'}
            >
              <img src={ctx.usablePhotos[0]} alt={step.name} className={styles.stopThumbImg} />
              {ctx.usablePhotos.length > 1 && <span className={styles.stopThumbPhotoCount}>{ctx.usablePhotos.length}</span>}
            </button>
          ) : (
            step.thumbIcon
          )}
          {/* playfulBadge——手繪版才有的小貼紙裝飾,純視覺,不影響互動或
              資訊內容,呼應「活潑一點」的要求。aria-hidden:裝飾性質,
              螢幕閱讀器不需要唸出來。 */}
          {isPlayful && <span className={styles.playfulBadge} aria-hidden="true">📍</span>}
        </div>
        <div className={styles.stopBody}>
          <div className={styles.stopMeta}>{step.duration} · {step.kind}</div>
          <div className={styles.stopName}>{step.name}</div>
          {step.desc && <div className={styles.stopDesc}>{step.desc}</div>}
        </div>
      </div>
    )
  }
}
