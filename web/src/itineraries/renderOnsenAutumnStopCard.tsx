import type { PlanNode } from '../plan-core/planTimeline'
import type { StopCardRenderContext } from '../plan-core/PlanTimelineView'
import { MAPLE_LEAF_PATH, MAPLE_STEM_PATH } from './mapleLeafPath'
import styles from './renderOnsenAutumnStopCard.module.css'

// createRenderOnsenAutumnStopCard——「秋日泡湯」主題的地點卡渲染(2026-10
// 新增,使用者要求定山溪溫泉街紅葉散策一日遊 jozankei-1day 的地點卡
// 要有專屬的秋日泡湯視覺識別:溫泉蒸氣、楓葉、木頭/和紙質感、秋夜暖色)。
// 由 itinerary.cardTheme === 'onsen-autumn' 觸發(見 types.ts 的完整說明),
// 跟 renderItineraryStopCard.tsx 的 createRenderItineraryStopCard 是並列
// 的兄弟工廠——同樣透過 PlanTimelineView 的 renderStopCard 插槽接上、
// 同樣不修改共用元件本身;刻意另開一個檔案而不是在既有工廠多加一個
// mode 參數:既有工廠的 playful/standard 只是同一套版型換描邊,這套則
// 是整張卡片的配色/質感/縮圖內容都不同,硬塞進同一個函式會讓兩邊的
// JSX 條件分支糾纏在一起。
//
// 設計上最大的差異是「不依賴照片」:jozankei-1day 的站點目前沒有
// photos 欄位(早期草稿用的 Pexels/Wikimedia 占位圖不是真實 GCS 資產,
// 刻意沒寫進資料庫),所以縮圖區在沒有照片時不是退回一顆 📍,而是依
// 站點 kind 畫一個主題圖樣(OnsenThumbGlyph:景點→楓葉、美食→溫泉
// 饅頭、其他→溫泉記號 ♨ 的三條蒸氣),底下疊一層緩慢上升的蒸氣動畫
// (SteamWisps),讓每張卡片在沒有照片的狀態下仍然有份量感。真的有
// 照片時(ctx.usablePhotos 非空)縮圖區仍正常顯示照片+放大按鈕,行為
// 對齊既有卡片,只是不再畫圖樣。
//
// 互動接法(onClick/hover/focus/鍵盤 Enter/Space)跟既有卡片完全一致,
// 這張卡片只換皮不換骨——訪客在這份行程的點選/連動體驗不應該因為
// 主題不同而有差異。

// SteamWisps——縮圖區背景的三縷蒸氣,純裝飾(aria-hidden)。三條路徑
// 各自用不同的動畫延遲做上升+淡出循環(見 .module.css .steamWisp 的
// 完整說明),錯開後看起來像溫泉面持續冒出的熱氣,而不是三條線同步
// 上下跳動。路徑用 S 形 cubic 曲線,寬度窄、線端圓頭,模擬熱氣扭曲
// 上升的形狀。
function SteamWisps() {
  return (
    <svg className={styles.steam} viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <path className={styles.steamWisp} d="M30 96 C 22 82, 40 74, 30 60 C 20 46, 38 38, 30 24" />
      <path className={`${styles.steamWisp} ${styles.steamWisp2}`} d="M50 100 C 42 86, 60 78, 50 64 C 40 50, 58 42, 50 28" />
      <path className={`${styles.steamWisp} ${styles.steamWisp3}`} d="M70 96 C 62 82, 80 74, 70 60 C 60 46, 78 38, 70 24" />
    </svg>
  )
}

// OnsenThumbGlyph——沒有照片時縮圖區的主題圖樣,依 kind 切換(見檔首
// 的完整說明)。三種圖樣共用 100x100 viewBox,填色/描邊由 .module.css
// 決定(金黃填色+深褐描邊,跟楓葉相框的配色同一個色票)。
//   - 景點:楓葉(重用 mapleLeafPath.ts 的幾何,跟地圖外框同一片葉子)
//   - 美食:溫泉饅頭——一顆圓頂饅頭坐在蒸籠格上,呼應定山溪物產館/
//     麵包坊這類「現做熱食」的站點
//   - 其他(神社/住宿等):溫泉記號 ♨——一個淺盆加三條短蒸氣,日本
//     地圖上溫泉地的標準記號,用路徑畫而不是直接打 ♨ 字元,避免字型
//     差異讓這個記號在不同平台長得不一樣(同 CompassRose 的考量)
function OnsenThumbGlyph({ kind }: { kind: string }) {
  if (kind === '景點') {
    return (
      <svg className={styles.glyph} viewBox="0 0 100 100" aria-hidden="true">
        <g className={styles.glyphLeaf} transform="translate(50 50) rotate(-18) scale(0.78) translate(-50 -50)">
          <path d={MAPLE_LEAF_PATH} />
          <path d={MAPLE_STEM_PATH} className={styles.glyphStem} />
        </g>
      </svg>
    )
  }
  if (kind === '美食') {
    return (
      <svg className={styles.glyph} viewBox="0 0 100 100" aria-hidden="true">
        <g className={styles.glyphFill}>
          <path d="M22 62 C 22 40, 78 40, 78 62 Z" />
          <rect x="16" y="62" width="68" height="12" rx="4" />
        </g>
        <g className={styles.glyphLine}>
          <path d="M26 68 H 74" />
          <path d="M40 34 C 36 28, 44 24, 40 18" />
          <path d="M52 32 C 48 26, 56 22, 52 16" />
          <path d="M64 34 C 60 28, 68 24, 64 18" />
        </g>
      </svg>
    )
  }
  return (
    <svg className={styles.glyph} viewBox="0 0 100 100" aria-hidden="true">
      <path className={styles.glyphFill} d="M18 62 L 82 62 C 82 78, 68 86, 50 86 C 32 86, 18 78, 18 62 Z" />
      <g className={styles.glyphLine}>
        <path d="M34 50 C 28 42, 40 36, 34 26" />
        <path d="M50 52 C 44 44, 56 38, 50 28" />
        <path d="M66 50 C 60 42, 72 36, 66 26" />
      </g>
    </svg>
  )
}

export function createRenderOnsenAutumnStopCard() {
  return function renderOnsenAutumnStopCard(step: PlanNode, ctx: StopCardRenderContext) {
    if (step.type !== 'stop') return null
    const cardClass = [styles.card, ctx.isSelected ? styles.cardSelected : ''].filter(Boolean).join(' ')
    const hasPhoto = ctx.usablePhotos.length > 0
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
        <div className={styles.thumb}>
          {step.loading ? (
            <span className={styles.thumbSpinner} aria-label="查詢地點資料中" />
          ) : hasPhoto ? (
            <button
              type="button"
              className={styles.thumbPhotoBtn}
              onClick={(e) => {
                e.stopPropagation()
                ctx.onOpenPhotos()
              }}
              aria-label={ctx.usablePhotos.length > 1 ? `瀏覽 ${ctx.usablePhotos.length} 張照片` : '放大檢視照片'}
            >
              <img src={ctx.usablePhotos[0]} alt={step.name} className={styles.thumbImg} />
              {ctx.usablePhotos.length > 1 && <span className={styles.thumbPhotoCount}>{ctx.usablePhotos.length}</span>}
            </button>
          ) : (
            <>
              <SteamWisps />
              <OnsenThumbGlyph kind={step.kind ?? ''} />
            </>
          )}
        </div>
        <div className={styles.body}>
          {/* cornerLeaf——文字區右上角一小片金黃楓葉,純裝飾(aria-hidden),
              跟地圖外框四角的楓葉叢呼應,讓卡片跟相框是同一個季節的東西。 */}
          <svg className={styles.cornerLeaf} viewBox="0 0 100 100" aria-hidden="true">
            <g transform="translate(50 50) rotate(28) translate(-50 -50)">
              <path d={MAPLE_LEAF_PATH} />
              <path d={MAPLE_STEM_PATH} className={styles.cornerLeafStem} />
            </g>
          </svg>
          {/* tag——「停留時間 · 類型」做成暖簾式小標籤(深褐底、米色字),
              取代既有卡片的灰色 meta 文字行;資訊內容完全相同,只是視覺
              上更像溫泉街店家門口掛的小木牌。 */}
          <div className={styles.tag}>
            <span className={styles.tagDuration}>{step.duration}</span>
            <span className={styles.tagDivider} aria-hidden="true" />
            <span>{step.kind}</span>
          </div>
          <div className={styles.name}>{step.name}</div>
          {step.desc && <div className={styles.desc}>{step.desc}</div>}
        </div>
      </div>
    )
  }
}
