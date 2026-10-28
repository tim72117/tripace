import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { PlanNode } from '../planning/timeline/model'
import type { StopCardRenderContext } from '../planning/timeline/PlanTimelineView'
import { DEFAULT_NOTE_CATEGORY, NOTE_STYLES } from '../planning/timeline/presentation'
import { FramedImage } from '../components/FramedImage'
import styles from './renderItineraryStopCard.module.css'

// createRenderItineraryStopCard——itineraries 專屬的地點卡渲染(2026-10
// 新增,使用者明確要求「置換成 ai-itineraries 的版本，圖片放大一點」),
// 透過 PlanTimelineView 的 renderStopCard 插槽接上(見該 prop/
// StopCardRenderContext 的完整說明),不修改共用元件本身的 .stopCard
// 樣式——那會連動影響 /app、/ai-plan 等所有正式功能頁面。
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
        <StopThumb step={step} ctx={ctx} isPlayful={isPlayful} />
        <div className={styles.stopBody}>
          <div className={styles.stopMeta}>{step.duration} · {step.kind}</div>
          <div className={styles.stopName}>{step.name}</div>
          {step.desc && <div className={styles.stopDesc}>{step.desc}</div>}
          {/* note——比照 PlanTimelineView.tsx 預設卡片的 .stopNoteRow
              (見該處完整說明):卡片內部下方固定高度一個橫列。 */}
          {step.note && (
            <div className={styles.stopNoteRow}>
              <div
                className={styles.stopNoteBar}
                style={{ background: (NOTE_STYLES[step.note.category ?? ''] ?? NOTE_STYLES[DEFAULT_NOTE_CATEGORY]).color }}
              />
              <div className={styles.stopNoteText} title={step.note.text}>
                <span style={{ marginRight: 4 }}>
                  {(NOTE_STYLES[step.note.category ?? ''] ?? NOTE_STYLES[DEFAULT_NOTE_CATEGORY]).noteIcon}
                </span>
                {step.note.text}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
}

// isSingleColorBackground——thumbBg 是不是「單一顏色」(而不是漸層/圖片)。
// 資料裡大多數 thumbBg 是 linear-gradient(...);--skeleton-base 會被共用掃光層
// 用在 background-color 與漸層 color stop,只能放單色,塞漸層進去 computed
// 值整個失效(底色透明、沒有掃光)。判斷寬鬆:有 gradient(/url(/image-set(
// 就不算單色,其餘(#hex、rgb()、var(--x)、color-mix() 等)都視為顏色。
export function isSingleColorBackground(bg: string | undefined): bg is string {
  if (!bg) return false
  return !/(gradient|url|image-set|image)\(/i.test(bg)
}

// 照片按鈕的名稱:帶站名(改用 FramedImage 前,img 的 alt 是 step.name);沒有站名時
// 退回不帶站名的舊文字。溫泉卡(renderOnsenAutumnStopCard.tsx)共用這份。
export function photoButtonLabel(name: string | undefined, count: number): string {
  if (!name) return count > 1 ? `瀏覽 ${count} 張照片` : '放大檢視照片'
  return count > 1 ? `瀏覽「${name}」的 ${count} 張照片` : `放大檢視「${name}」的照片`
}

// StopThumb——縮圖區。抽成元件(而不是寫在 render 函式裡)是因為要用 state 追蹤
// 「目前這張照片載入失敗了」:renderStopCard 插槽是在 PlanTimelineView 的 render
// 裡被當成一般函式呼叫的,裡面不能用 hook。
//
// 外框 .stopThumb 尺寸由卡片撐開(寬 112px、高度 stretch),不隨狀態變動,背景
// 就是 thumbBg(漸層或單色)。圖片交給共用 FramedImage(絕對定位鋪滿外框):查詢中
// (ctx.loading)用 pending 顯示掃光、沒照片顯示 thumbIcon 佔位、照片載入完成淡入、
// 失敗顯示同尺寸失敗佔位。
//   - 佔位底色(--framed-image-placeholder-bg)一律 transparent,透出外框的 thumbBg。
//   - 掃光底色(--skeleton-base)只在 thumbBg 是單色時才帶(見 isSingleColorBackground);
//     漸層時不帶,掃光用共用 token。
//   - 照片按鈕是透明疊層,只負責點擊放大與張數角標;圖片本身的替代文字由按鈕的
//     aria-label 承擔(帶站名),所以 alt 留空。照片載入失敗後隱藏按鈕(縮圖已是
//     失敗佔位,點了只會開一個載不出來的燈箱);換成別張照片時重置。
//     StopCardRenderContext 沒有回報失敗的管道(usablePhotos 由 PlanTimelineView 自己
//     過濾),所以在卡片內自行追蹤,不動共用元件。
function StopThumb({ step, ctx, isPlayful }: { step: PlanNode; ctx: StopCardRenderContext; isPlayful: boolean }) {
  const src = ctx.loading ? undefined : ctx.usablePhotos[0]
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = src !== undefined && failedSrc === src
  const frameVars = {
    '--framed-image-placeholder-bg': 'transparent',
    ...(isSingleColorBackground(step.thumbBg) ? { '--skeleton-base': step.thumbBg } : {}),
  } as CSSProperties
  return (
    <div className={styles.stopThumb} style={{ background: step.thumbBg }}>
      <FramedImage
        className={styles.thumbFrame}
        style={frameVars}
        src={src}
        pending={ctx.loading}
        alt=""
        placeholder={step.thumbIcon}
        onError={() => setFailedSrc(src ?? null)}
        {...(ctx.loading ? { role: 'status', 'aria-label': '查詢地點資料中' } : { 'aria-hidden': true })}
      />
      {!ctx.loading && ctx.usablePhotos.length > 0 && !failed && (
        <button
          type="button"
          className={styles.stopThumbPhotoBtn}
          onClick={(e) => {
            e.stopPropagation()
            ctx.onOpenPhotos()
          }}
          aria-label={photoButtonLabel(step.name, ctx.usablePhotos.length)}
        >
          {ctx.usablePhotos.length > 1 && <span className={styles.stopThumbPhotoCount}>{ctx.usablePhotos.length}</span>}
        </button>
      )}
      {/* playfulBadge——手繪版才有的小貼紙裝飾,純視覺,不影響互動或
          資訊內容,呼應「活潑一點」的要求。aria-hidden:裝飾性質,
          螢幕閱讀器不需要唸出來。 */}
      {isPlayful && <span className={styles.playfulBadge} aria-hidden="true">📍</span>}
    </div>
  )
}
