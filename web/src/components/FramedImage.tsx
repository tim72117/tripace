import { forwardRef, useCallback, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { Image as ImageIcon, ImageOff } from 'lucide-react'
import { SkeletonBlock, resolveRadius, toCssSize } from './Skeleton'
import type { SkeletonRadius, SkeletonSize } from './Skeleton'
import styles from './FramedImage.module.css'

// FramedImage:固定外框+佔位+淡入+失敗佔位的圖片——2026-10 新增,
// 原型是 planning/place/PhotoCarousel.tsx 的 CarouselImg,抽成不綁 160px
// 高度、不綁 PhotoCarousel 樣式的通用版本。
//
// 為什麼要有固定外框:<img> 在下載完成前沒有固有尺寸,直接放進版面會
// 先是 0 高、載完才撐開,卡片其他內容跟著跳。這裡外框尺寸由 width/height
// 或 aspectRatio 在 src 載入前就決定,<img> 絕對定位鋪滿外框、不參與排版,
// 所以四種狀態外框的 class 與尺寸完全不變:
//   idle   (沒有 src)   :靜態佔位(不掃光)+placeholder(預設中性圖示)。
//   loading(有 src 下載中):掃光佔位(SkeletonBlock)。
//   loaded               :圖片 0.25s 淡入蓋上(reduced-motion 不淡入)。
//   error                :同尺寸靜態佔位+ImageOff 圖示,不露出破圖圖示與
//                          alt 文字;不掃光,表示「已經停了、不是還在載」。
// 狀態寫在外框的 data-status 屬性上(不換 class),使用端要針對狀態調整
// 樣式時用 [data-status="error"] 之類的選擇器。
//
// pending(還不知道 src、正在查):沒有 src 時 pending=true 視為 loading
// (掃光佔位,不顯示靜態圖示);pending 變 false 且仍沒有 src 才轉 idle。
// 有 src 時 pending 被忽略,以 src 載入狀態為準。
//
// ref:forwardRef 轉到「外框 <span>」(使用端掛 IntersectionObserver 等)。
// 內部對 <img> 的 callback ref(快取命中補判)掛在不同元素上,兩者互不干擾。
// rest:其餘 HTML 屬性(data-*、aria-*、id、onClick…)展開在外框上,但展開
// 順序在前——內部管理的 className、style、data-status 一律以內部組出的為準,
// 不會被覆蓋(使用端的 className/style 要走專屬 prop 才會合併進去)。
// onLoad/onError 是 <img> 的事件(無參數版),不屬於 rest;同樣不收
// dangerouslySetInnerHTML(外框的子節點由元件自己管)與 onLoadCapture/
// onErrorCapture(放在外框上會攔到內部 <img> 的事件,語意混淆)。
//
// 無障礙:loading/loaded 時 <img> 在,替代文字由 img 的 alt 提供;idle/error
// 時 img 已移除,外框改帶 role="img" + aria-label={alt},替代文字不會從輔助
// 科技樹消失。alt 為空字串(裝飾性圖片)時不加。rest 裡使用端自己給的
// role/aria-label 優先(例如查詢中把外框標成 role="status")。
//
// unstyled:外框不輸出預設的 inline width(100%)與 border-radius(0),尺寸
// 與圓角完全交給 className(使用端的 class 決定 44px/10px 圓角這類情況);
// 明確傳入的 width/height/aspectRatio/radius 仍照常輸出。取代過去「style 傳
// { width: undefined } 蓋掉預設值」的隱性做法。
//
// 佔位底色:.placeholder 用 background 簡寫讀 --framed-image-placeholder-bg
// (可放漸層或 transparent),沒設時退回 --skeleton-base,再退回 --ios-sep。
// 為什麼不只用 --skeleton-base:那個變數也會被載入中的掃光層
// (SkeletonBlock 的 background-color 與漸層 color stop)使用,只能是單一
// 顏色;塞漸層進去,掃光層的 computed 值整個失效(底色透明、沒有掃光)。
//
// 既有各處的同類做法(PhotoCarousel CarouselImg、行程清單 .coverImg 與
// renderItineraryStopCard .stopThumbImg 的 data-loaded/data-failed、
// ListItemCard 的 PhotoLeading)都可以逐步改用這個元件。

export type FramedImageStatus = 'idle' | 'loading' | 'loaded' | 'error'

export type FramedImageProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'className' | 'style' | 'children' | 'onLoad' | 'onError' | 'dangerouslySetInnerHTML' | 'onLoadCapture' | 'onErrorCapture'
> & {
  src?: string | null
  alt: string
  /** 外框寬;數字視為 px,字串原樣(可用 %、em、var())。預設 100%(unstyled 時不輸出)。 */
  width?: SkeletonSize
  /** 外框高;與 aspectRatio 擇一即可。 */
  height?: SkeletonSize
  /** 例如 '16 / 9' 或 1。 */
  aspectRatio?: number | string
  /** 預設 'none'(多數圖片外框的圓角由外層卡片裁切;unstyled 時不輸出)。 */
  radius?: SkeletonRadius
  /** 預設 'cover'。 */
  fit?: 'cover' | 'contain'
  /** 沒有 src 時佔位中間顯示的內容,預設中性的圖片圖示;傳 null 則只留底色。 */
  placeholder?: ReactNode
  /** 還不知道 src、正在查;沒有 src 時顯示掃光佔位而非靜態佔位。有 src 時忽略。預設 false。 */
  pending?: boolean
  onLoad?: () => void
  onError?: () => void
  /** 加在外框上(外框 class 在所有狀態下不變)。 */
  className?: string
  style?: CSSProperties
  /** 加在 <img> 上。 */
  imgClassName?: string
  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'sync' | 'auto'
  fetchPriority?: 'high' | 'low' | 'auto'
  /** true 時不輸出預設的 inline width/border-radius,尺寸與圓角交給 className;明確傳入的尺寸 props 仍輸出。預設 false。 */
  unstyled?: boolean
}

export const FramedImage = forwardRef<HTMLSpanElement, FramedImageProps>(function FramedImage({
  src,
  alt,
  width,
  height,
  aspectRatio,
  radius,
  fit = 'cover',
  placeholder,
  pending = false,
  onLoad,
  onError,
  className,
  style,
  imgClassName,
  loading,
  decoding,
  fetchPriority,
  unstyled = false,
  ...rest
}, ref) {
  const currentSrc = src || undefined
  const [status, setStatus] = useState<FramedImageStatus>(currentSrc ? 'loading' : 'idle')
  const [prevSrc, setPrevSrc] = useState(currentSrc)
  // 換 src 時在 render 期間就回到 loading/idle(React 官方的「依 prop 調整
  // state」寫法),不用 useEffect——effect 會先用舊狀態畫一幀(新圖直接
  // 以 loaded 的不透明狀態出現,沒有佔位也沒有淡入)。
  if (prevSrc !== currentSrc) {
    setPrevSrc(currentSrc)
    setStatus(currentSrc ? 'loading' : 'idle')
  }

  // settled:已經回報過 onLoad/onError 的 <img> 元素——快取命中時 callback
  // ref 補判與原生 load 事件可能都會觸發,只通知使用端一次。以元素而非
  // src 當鍵:<img> 帶 key={src},每換一次 src 就是新元素,A→B→A 換回來
  // 也會重新判定,不會因為「A 以前回報過」而卡在 loading。
  const settled = useRef<WeakSet<HTMLImageElement>>(new WeakSet())
  const callbacks = useRef({ onLoad, onError })
  callbacks.current = { onLoad, onError }

  const settle = useCallback((el: HTMLImageElement, next: 'loaded' | 'error') => {
    if (settled.current.has(el)) return
    settled.current.add(el)
    setStatus(next)
    if (next === 'loaded') callbacks.current.onLoad?.()
    else callbacks.current.onError?.()
  }, [])

  // 快取命中的圖片可能在 React 掛上 onLoad 之前就已經載完(complete=true),
  // 用 callback ref 補判一次,避免永遠停在透明狀態(同 CarouselImg)。
  // complete 但 naturalWidth 為 0 代表已經載入失敗。
  const imgRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el || !el.complete) return
      settle(el, el.naturalWidth > 0 ? 'loaded' : 'error')
    },
    [settle],
  )

  // 有 src 時 status 不會是 idle,所以只有「無 src」才會套用 pending。
  const shownStatus: FramedImageStatus = status === 'idle' && pending ? 'loading' : status

  const frameStyle: CSSProperties = {
    width: toCssSize(width ?? (unstyled ? undefined : '100%')),
    height: toCssSize(height),
    aspectRatio: aspectRatio === undefined ? undefined : String(aspectRatio),
    borderRadius: resolveRadius(radius ?? (unstyled ? undefined : 'none')),
    ...style,
  }

  // img 不在(idle/error)時由外框代替提供替代文字;放在 rest 之前展開,使用端給的 role/aria-label 優先。
  const imgAbsent = shownStatus === 'idle' || shownStatus === 'error'
  const a11yAttrs = imgAbsent && alt ? { role: 'img', 'aria-label': alt } : undefined

  // React 18 不認得 camelCase 的 fetchPriority(會警告並丟掉),用小寫屬性
  // 轉傳;型別上 React 的 img 屬性沒有小寫版本,所以用一個寬鬆物件展開。
  const priorityAttr = fetchPriority ? ({ fetchpriority: fetchPriority } as Record<string, string>) : undefined

  return (
    <span
      {...a11yAttrs}
      {...rest}
      ref={ref}
      className={`${styles.frame}${className ? ` ${className}` : ''}`}
      style={frameStyle}
      data-status={shownStatus}
    >
      {shownStatus === 'loading' && <SkeletonBlock className={styles.layer} radius="none" />}
      {(shownStatus === 'idle' || shownStatus === 'error') && (
        <span className={`${styles.layer} ${styles.placeholder}`} aria-hidden="true">
          {status === 'error' ? (
            <ImageOff className={styles.icon} size={22} strokeWidth={1.6} data-testid="framed-image-error-icon" />
          ) : placeholder === undefined ? (
            <ImageIcon className={styles.icon} size={22} strokeWidth={1.6} />
          ) : (
            placeholder
          )}
        </span>
      )}
      {currentSrc && status !== 'error' && (
        <img
          key={currentSrc}
          ref={imgRef}
          className={`${styles.img}${status === 'loaded' ? ` ${styles.imgLoaded}` : ''}${imgClassName ? ` ${imgClassName}` : ''}`}
          style={{ objectFit: fit }}
          src={currentSrc}
          alt={alt}
          loading={loading}
          decoding={decoding}
          {...priorityAttr}
          onLoad={(e) => settle(e.currentTarget, 'loaded')}
          onError={(e) => settle(e.currentTarget, 'error')}
        />
      )}
    </span>
  )
})
