import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import styles from './Skeleton.module.css'

// Skeleton:全專案共用的「載入中站位」零件組——2026-10 新增。
//
// 為什麼要有這組:新增前專案各處各自寫了十幾份佔位(縱橫兩版時間軸的
// 掃光與轉圈、對話頁的呼吸、行程清單/詳情頁的 skeletonText + 呼吸、
// PhotoCarousel 的佔位掃光、LateTextSkeleton 自己的長條……),每份各自抄
// 一次漸層、深色模式覆寫與 reduced-motion 處理,視覺語彙也不一(有掃光、
// 有明暗呼吸、有轉圈)。上面列舉的這些私有實作已改用這組零件並移除
// (個別歷史見各使用端的註解與 CHANGELOG);home/、blog/ 頁面的圖片掃光
// 等仍是各自實作,尚未併入。
// 這組零件把視覺統一為「淡色掃光」,顏色集中在 Skeleton.module.css 的
// --skeleton-base/--skeleton-highlight(亮暗各一組),reduced-motion 一律退成
// 靜態底色。
//
// 刻意只提供「可調的零件」,不提供「某種卡片的骨架」:各卡片的骨架由
// 使用端用這些零件自己組(或直接用 SkeletonMask 蓋在真卡片上),因為
// 卡片長相屬於使用端,這裡只管「站位要長怎樣、怎麼讓讀屏不逐個唸」。
//
//   SkeletonBlock:一塊掃光色塊(縮圖、徽章、按鈕位置)。
//   SkeletonLines:N 行文字長條,行寬用固定比例組(不隨機)。
//   SkeletonRegion:包住一組骨架,對輔助科技只宣告一次「載入中」。
//   (兩者的讀屏宣告都走 DeferredStatusText:live region 先空著掛上,延後才填文字。)
//   SkeletonMask:直接渲染真卡片,loading 時把內容遮成骨架,不改盒模型。
//
// 圖片的「固定外框+佔位+淡入+失敗」另見 FramedImage.tsx(它內部也用
// SkeletonBlock 當載入中的掃光層)。

/** 尺寸值:數字視為 px,字串原樣傳給 CSS(可用 em、%、var(--x)、calc())。 */
export type SkeletonSize = number | string

/** 圓角:具名級距或任意 CSS 長度(數字視為 px)。 */
export type SkeletonRadius = 'none' | 'sm' | 'md' | 'lg' | 'full' | number | string

// 具名圓角級距——取自專案既有骨架的實際數值:sm 對應文字長條(既有
// .skeletonText 4px)、md 對應小卡片/縮圖、lg 對應大卡片(時間軸卡片
// 16px)、full 對應圓形縮圖/膠囊(既有 999px 寫法)。
const RADIUS_MAP: Record<'none' | 'sm' | 'md' | 'lg' | 'full', string> = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '16px',
  full: '999px',
}

/** 把 SkeletonSize 轉成 CSS 值;undefined 原樣回傳(不輸出該屬性)。 */
export function toCssSize(v: SkeletonSize | undefined): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'number' ? `${v}px` : v
}

/** 把 SkeletonRadius 轉成 CSS border-radius 值;FramedImage 也共用這份換算。 */
export function resolveRadius(r: SkeletonRadius | undefined): string | undefined {
  if (r === undefined) return undefined
  if (typeof r === 'number') return `${r}px`
  return r in RADIUS_MAP ? RADIUS_MAP[r as keyof typeof RADIUS_MAP] : r
}

function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/** 逃生口:SkeletonMask 遮罩中仍要維持可見的元素加這個 class(或 data-skeleton-keep 屬性),整個子樹都保留原樣。 */
export const SKELETON_KEEP_CLASS = 'skeleton-keep'

// ---------------------------------------------------------------------------
// SkeletonBlock
// ---------------------------------------------------------------------------

export type SkeletonBlockProps = {
  width?: SkeletonSize
  height?: SkeletonSize
  /** 例如 '16 / 9' 或 1;給了 aspectRatio 通常只需要 width。 */
  aspectRatio?: number | string
  /** 預設 'sm'。 */
  radius?: SkeletonRadius
  /** 'sweep'(預設)= 淡色掃光;'none' = 靜態底色(例如「沒有資料」的佔位,表示不是還在載)。 */
  animation?: 'sweep' | 'none'
  className?: string
  style?: CSSProperties
}

// SkeletonBlock:一塊站位色塊。用 <span>(display:block)而不是 <div>,
// 讓它可以放進 <p>、<button> 這類只能裝 phrasing content 的元素裡;
// 預設 aria-hidden——單一色塊對讀屏沒有意義,「載入中」的宣告交給外層
// SkeletonRegion 或使用端自己的 role="status" 一次說完。
export function SkeletonBlock({
  width,
  height,
  aspectRatio,
  radius = 'sm',
  animation = 'sweep',
  className,
  style,
}: SkeletonBlockProps) {
  const sizeStyle: CSSProperties = {
    width: toCssSize(width),
    height: toCssSize(height),
    aspectRatio: aspectRatio === undefined ? undefined : String(aspectRatio),
    borderRadius: resolveRadius(radius),
    ...style,
  }
  return (
    <span
      className={cx(styles.block, animation === 'sweep' ? styles.sweep : styles.still, className)}
      style={sizeStyle}
      aria-hidden="true"
      data-skeleton="block"
    />
  )
}

// ---------------------------------------------------------------------------
// SkeletonLines
// ---------------------------------------------------------------------------

// 行寬比例組:除了最後一行,其餘依序取這組比例循環。刻意不用隨機——
// 隨機寬度在每次 re-render 都會換,畫面會一直閃;固定比例讓同樣的行數
// 永遠長一樣(測試也能重現)。數值落在 88%–100% 之間,像一段自然換行的
// 文字右緣參差,但不會短到像段落結尾(段落結尾交給 lastLineWidth)。
export const SKELETON_LINE_WIDTHS = ['100%', '92%', '96%', '88%', '94%', '90%'] as const

/** 算出每一行的寬度(純函式,方便測試):最後一行用 lastLineWidth,其餘循環取 SKELETON_LINE_WIDTHS;只有一行時就是 lastLineWidth。 */
export function skeletonLineWidths(lines: number, lastLineWidth: SkeletonSize = '60%'): string[] {
  const n = Math.max(0, Math.floor(lines))
  const last = toCssSize(lastLineWidth) ?? '60%'
  return Array.from({ length: n }, (_, i) =>
    i === n - 1 ? last : SKELETON_LINE_WIDTHS[i % SKELETON_LINE_WIDTHS.length],
  )
}

export type SkeletonLinesProps = {
  /** 行數。 */
  lines: number
  /** 最後一行寬度,預設 '60%'。 */
  lastLineWidth?: SkeletonSize
  /** 每行佔的高度,預設 '1.4em'——吃目前字級,與真文字的行高對齊時,N 行骨架總高 = N 行文字總高。 */
  lineHeight?: SkeletonSize
  /** 長條本身的粗細,預設 '0.7em'(在行高內垂直置中)。 */
  barHeight?: SkeletonSize
  /** 行與行之間額外的間距,預設 0(行距已含在 lineHeight 裡,像真文字一樣)。 */
  gap?: SkeletonSize
  animation?: 'sweep' | 'none'
  className?: string
}

// SkeletonLines:N 行文字長條。每一行是一個高度 = lineHeight 的容器,
// 長條在裡面垂直置中(做法源自 planning/place/LateTextSkeleton 原本自己的
// 長條,該檔現在改用這個元件:不用 margin 置中,避免相鄰 margin 折疊讓
// 總高不足)。外框高度因此可預期:
// lines × lineHeight + (lines − 1) × gap,使用端只要讓 lineHeight 等於真文字
// 的行高,載入前後就不會跳。
export function SkeletonLines({
  lines,
  lastLineWidth = '60%',
  lineHeight = '1.4em',
  barHeight = '0.7em',
  gap = 0,
  animation = 'sweep',
  className,
}: SkeletonLinesProps) {
  const widths = skeletonLineWidths(lines, lastLineWidth)
  const rootStyle = {
    '--skeleton-line-height': toCssSize(lineHeight),
    '--skeleton-bar-height': toCssSize(barHeight),
    rowGap: toCssSize(gap),
  } as CSSProperties
  return (
    <span className={cx(styles.lines, className)} style={rootStyle} aria-hidden="true" data-skeleton="lines">
      {widths.map((w, i) => (
        <span key={i} className={styles.line} data-skeleton-line="">
          <span
            className={cx(styles.bar, animation === 'sweep' ? styles.sweep : styles.still)}
            style={{ width: w }}
          />
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// SkeletonRegion
// ---------------------------------------------------------------------------

export type SkeletonRegionProps = {
  /** 必填:讀屏唸的「載入中」說明,例如「行程清單載入中」。 */
  label: string
  children: ReactNode
  className?: string
  style?: CSSProperties
}

// SKELETON_STATUS_FILL_DELAY_MS:live region 掛上之後延後多久才填入文字。
// 為什麼要延後:讀屏只會唸「已經在無障礙樹裡的 live region 的內容變動」;
// 掛載當下就帶著文字的 role="status",多數讀屏(NVDA/JAWS/VoiceOver)根本
// 不會唸。先掛一個空的 region,等它進到無障礙樹(實務上 setTimeout 0 偶爾
// 仍太快,取 100ms 這個常見的保守值)再填入文字,就是一次內容變動。附帶
// 好處:載入時間短於這個延遲時(例如快取命中),根本不會唸,不製造噪音。
export const SKELETON_STATUS_FILL_DELAY_MS = 100

/** 延後填入的視覺隱藏文字(放在 live region 裡),見 SKELETON_STATUS_FILL_DELAY_MS。 */
function DeferredStatusText({ text }: { text: string }) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    setShown('')
    const t = setTimeout(() => setShown(text), SKELETON_STATUS_FILL_DELAY_MS)
    return () => clearTimeout(t)
  }, [text])
  return <span className={styles.srOnly}>{shown}</span>
}

// SkeletonRegion:一組骨架的外框。對輔助科技宣告一次 role="status" +
// aria-label,內部所有骨架包在 aria-hidden 的容器裡,避免讀屏逐個唸出一堆
// 無意義的色塊。內層容器是 display:contents,不產生盒子,使用端給外框的
// className(flex/grid)直接作用在子骨架上,排版跟真內容寫法一樣。
//
// 2026-10 修正讀屏宣告:原本是 role="status" + aria-busy="true" + 只有
// aria-label、沒有文字內容——掛載時就固定的 aria-label 不算內容變動,
// aria-busy 又會讓讀屏把這個 region 的通知壓到「忙完」才處理(而骨架
// 卸載時就整個消失了),實際上幾乎不會被唸。取捨:拿掉 aria-busy,保留
// role="status" + aria-label(既有使用端以 getByRole('status', { name })
// 找它,介面與結構向下相容),另在 region 裡放一段延後填入的視覺隱藏文字
// (DeferredStatusText),讓讀屏真的收到一次內容變動。
export function SkeletonRegion({ label, children, className, style }: SkeletonRegionProps) {
  return (
    <div role="status" aria-label={label} className={className} style={style} data-skeleton="region">
      <div className={styles.contents} aria-hidden="true">
        {children}
      </div>
      <DeferredStatusText text={label} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkeletonMask
// ---------------------------------------------------------------------------

export type SkeletonMaskProps = {
  /** true 時把內容遮成骨架;false 時完全不影響內容。 */
  loading: boolean
  children: ReactNode
  /** loading 時讀屏唸的說明,預設「載入中」。 */
  label?: string
}

// SkeletonMask:「直接渲染真卡片+載入中標記」的遮罩模式——對應既有
// itineraries/AiItineraryListPage 的 ListSkeleton(沿用真卡片 class、文字
// 透明、改淡色底)這種做法,把它變成一個通用包裝。
//
// 為什麼只改顏色/背景/可見度、絕不碰盒模型(padding/margin/border 寬度/
// display/尺寸):遮罩的唯一承諾是「載入前後外框尺寸一定相同」。只要
// 遮罩改到任何一個會影響排版的屬性,真內容出現的那一刻就會跳;只改
// 顏色類屬性,盒子由真內容(或使用端給的佔位文字)撐出,兩個狀態必然
// 一樣大。所以:
//   - 文字元素(p、span、a、button、li、h1–h6 等):文字變透明、鋪掃光底
//     (只鋪在「最內層」的文字元素上,避免外層 li 跟內層 span 兩層疊色)。
//   - img:用 object-position 把圖片移出框外(不用 visibility/opacity,
//     那兩個會連底色一起藏掉),露出底色。
//   - svg:子圖形隱藏、svg 本身鋪底色(尺寸不變)。
//   - 互動:外層 pointer-events:none + inert(不能點、不能 Tab 進去),
//     並 aria-hidden,讀屏只聽到一次 role="status" 的 label。
//   - 讀屏宣告:status 先空著掛上、延後才填入 label(見
//     SKELETON_STATUS_FILL_DELAY_MS)。使用端不要把遮罩包在 aria-busy="true"
//     的祖先裡——aria-busy 會壓住子樹裡 live region 的通知。
// 兩層包裝都是 display:contents,不產生盒子,放進 flex/grid 也不改排版;
// 不輸出任何 inline style。要維持可見的元素加 SKELETON_KEEP_CLASS 或
// data-skeleton-keep。
export function SkeletonMask({ loading, children, label = '載入中' }: SkeletonMaskProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  // inert 用 DOM API 設:React 18 不認得 inert 這個布林屬性(傳 true 會警告、
  // 傳 '' 在 React 19 又會被當成 false),直接 toggleAttribute 兩版都正確。
  // 用 useLayoutEffect:在瀏覽器繪製前就設好,掛載第一幀的按鈕/連結不會
  // 短暫可被 Tab 或 autofocus 取得焦點(useEffect 在繪製後才跑)。
  useLayoutEffect(() => {
    contentRef.current?.toggleAttribute('inert', loading)
  }, [loading])

  return (
    <div className={styles.contents} data-skeleton="mask" data-loading={loading ? '' : undefined}>
      {loading && (
        // 不加 aria-busy:這個 status 的內容就是要被唸出的 label 本身,
        // aria-busy="true" 會讓部分讀屏延後到「忙完」才唸。文字延後填入
        // (DeferredStatusText),讀屏才會把它當成內容變動唸出。
        <span role="status" className={styles.srOnly}>
          <DeferredStatusText text={label} />
        </span>
      )}
      <div
        ref={contentRef}
        className={cx(styles.contents, loading && styles.maskLoading)}
        aria-hidden={loading ? true : undefined}
      >
        {children}
      </div>
    </div>
  )
}
