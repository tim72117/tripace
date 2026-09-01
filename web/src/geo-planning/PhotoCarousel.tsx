import { useEffect, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useIsDesktop } from '../hooks/useIsDesktop'
import styles from './PhotoCarousel.module.css'

// DIRECTION_LOCK_THRESHOLD_PX:MobileSwipeStrip 方向鎖定判斷前的最小
// 位移門檻(見該處 touchStateRef 的完整說明)——手指剛觸碰螢幕時幾乎不
// 會是完全靜止的直線移動,幾像素內的雜訊位移不該被當成方向判斷依據,
// 等位移量明確超過這個門檻才判斷「這次手勢主要是水平還是垂直」。
const DIRECTION_LOCK_THRESHOLD_PX = 6

// PhotoCarousel:GeoInfoPanel.tsx 照片顯示區域的抽出元件——「點擊地圖上
// Google 原生 POI 圖標」這個來源(poiInfoContent,見 geoInfoContent.ts)的
// 後端回應改成 Google/Pexels 兩種來源並列的多圖清單(見 handleGeoPlaceDetails
// 的說明),這個元件負責把兩份清單合併成一份「先 Google 後 Pexels」的
// 顯示順序,並依照片數量與裝置類型分別呈現:
//   0 張:顯示 placeholder(沿用既有 .photoPlaceholder 樣式)。
//   1 張:直接顯示單張 <img>,不顯示任何互動控制項——維持跟改版前完全
//     一樣的單圖體驗,其餘來源(地點清單/候選籃項目,只有單一 photoUrl)
//     走的就是這條路徑。
//   2 張以上,依裝置分兩套完全不同的互動模式(桌面滑鼠點擊/手機觸控滑動
//     是不同的操作語彙,不應該用同一套 UI 硬套兩種裝置):
//     - 桌面版(useIsDesktop 為 true):卡片內只顯示第一張縮圖,點擊後
//       彈出全螢幕 Lightbox,可用左右箭頭/鍵盤方向鍵切換,點背景或關閉
//       鈕收起。
//     - 手機版:卡片內直接是可橫向自由捲動的圖片列(純 overflow-x: auto,
//       不用 scroll-snap,也不是 onTouchEnd 判斷門檻後才切頁的離散式
//       邏輯),手指滑多少、圖片就跟著移動多少,鬆手後停在滑到的位置,
//       不會自動吸附對齊到某一張的邊界——使用者明確要求「圖片滑動,
//       不用吸附」,不額外疊加左右按鈕,這是原生相簿常見的自由捲動
//       操作方式,手機版使用者不需要瞄準小按鈕。頁碼用圓點呈現(以
//       IntersectionObserver 判斷目前捲動到哪一張最靠近可視範圍中心)。
//
// fallbackUrl:兩份清單合併結果為空時的相容 fallback——GeoInfoContent.
// photoUrl(見該型別的說明)本身可能是單一舊格式來源(地點清單/候選籃
// 項目)的唯一照片,這個元件統一收斂「該顯示什麼」的判斷,呼叫端
// (GeoInfoPanel.tsx)不需要自己判斷要不要繞過這個元件直接畫 <img>。
export function PhotoCarousel({
  googlePhotoUrls,
  pexelsPhotoUrls,
  fallbackUrl,
  alt,
  onLayoutChange,
}: {
  googlePhotoUrls?: string[]
  pexelsPhotoUrls?: string[]
  fallbackUrl?: string
  alt: string
  // onLayoutChange:通知呼叫端目前是否渲染成「手機版多圖橫滑」
  // (isMobileSwipe)——手機版呼叫端(GeoOutlinePhoneInfoSheet.tsx)的
  // 外層容器 .imageWrap 原本固定留 16px 左右 padding(給單張圖片/
  // placeholder 用的視覺留白),但這個 padding 套用到多圖橫滑軌道上時,
  // 會讓整條軌道跟卡片外緣之間多出一圈間隙,不是真正貼齊——使用者明確
  // 要求「有圖片的邊邊軌道不能有空隙」,軌道整體要貼齊外框,圓角+間距
  // 效果改由 .swipeItem 逐張處理(像相簿卡片一張張滑,同樣是使用者
  // 明確要求)。PhotoCarousel 本身不知道外層容器套了多少 padding,故
  // 不用固定負 margin 硬編碼去抵銷,改由呼叫端根據這個回呼決定要不要
  // 套 padding——桌面版(GeoInfoPanel.tsx)固定滿版顯示,不需要這個
  // 機制,不傳這個 prop 即可。
  onLayoutChange?: (isMobileSwipe: boolean) => void
}) {
  // photos:Google 排前面、Pexels 排後面依序合併(需求明訂的顯示順序)。
  // 兩份清單都沒有值時,退回 fallbackUrl 組成的單張清單——這是唯一會用到
  // fallbackUrl 的分支,一旦 googlePhotoUrls/pexelsPhotoUrls 任一份有值,
  // 就完全採用這兩份清單的結果,不會把 fallbackUrl 混進去(避免同一張圖
  // 因為剛好也是 photoUrl 又被合併清單重複列出)。
  const merged = [...(googlePhotoUrls ?? []), ...(pexelsPhotoUrls ?? [])]
  const photos = merged.length > 0 ? merged : fallbackUrl ? [fallbackUrl] : []

  const isDesktop = useIsDesktop()
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // isMobileSwipe:對應下方 MobileSwipeStrip 實際被渲染的條件(!isDesktop
  // 且 photos.length > 1)——用同一個判斷式算出來,避免跟下方分支各自
  // 判斷卻不小心寫出不一致的條件。放在所有 early return 之前(Hooks
  // 規則不允許在 early return 之後呼叫 hook),統一算好結果、用單一
  // useEffect 通知呼叫端(見 onLayoutChange 的完整說明)。
  const isMobileSwipe = !isDesktop && photos.length > 1
  useEffect(() => {
    onLayoutChange?.(isMobileSwipe)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileSwipe])

  if (photos.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.photoPlaceholder} />
      </div>
    )
  }

  if (photos.length === 1) {
    return (
      <div className={styles.wrap}>
        <img className={styles.photo} src={photos[0]} alt={alt} />
      </div>
    )
  }

  if (isDesktop) {
    return (
      <>
        <button type="button" className={styles.desktopTrigger} onClick={() => setLightboxOpen(true)}>
          <img className={styles.photo} src={photos[0]} alt={alt} />
          <span className={styles.counter}>{photos.length} 張照片</span>
        </button>
        {lightboxOpen && (
          <Lightbox photos={photos} alt={alt} onClose={() => setLightboxOpen(false)} />
        )}
      </>
    )
  }

  return <MobileSwipeStrip photos={photos} alt={alt} />
}

// MobileSwipeStrip:手機版橫向並排滑動列——純 overflow-x: auto 自由捲動
// (手指移動多少、圖片就跟著移動多少,鬆手後停在滑到的位置),不是量測
// 滑動距離、超過門檻才離散切換一整張的邏輯,也不用 scroll-snap 鬆手後
// 強制吸附回某一張的邊界(使用者明確要求「圖片滑動,不用吸附」,快速
// 滑動時吸附動作會有一段跳動位移,不是想要的手感)。用 IntersectionObserver
// 觀察哪一張目前捲進可視範圍內最多,更新圓點頁碼的 active 狀態——因為
// 沒有吸附,圖片可能停在兩張之間,intersectionRatio 不會有一張精準
// 到 1,取比例最高的那一張仍然是合理的「目前主要看到哪張」判斷依據。
function MobileSwipeStrip({ photos, alt }: { photos: string[]; alt: string }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // 方向鎖定:這張橫滑軌道通常嵌在 PhoneBottomSheet(可上下拖曳收合/
  // 展開的底部面板)裡,兩者的觸控手勢(水平滑照片 vs 垂直拖曳卡片)
  // 目前共用同一批原生觸控事件——PhoneBottomSheet 的 onTouchStart/Move/
  // End 是掛在 .panel 上的 React 合成事件,靠事件冒泡接收,若這裡完全
  // 不處理,手指按在照片上開始滑動時,事件會冒泡上去同時觸發卡片拖曳,
  // 使用者實測回報希望「左右滑動照片時鎖住上下拖動」。做法:記錄觸控
  // 起點,第一次明顯位移(超過 DIRECTION_LOCK_THRESHOLD_PX,避免手指
  // 幾乎沒動就被雜訊誤判方向)時比較水平/垂直位移量決定方向,水平為主
  // 就鎖定成「這次手勢屬於橫滑」,之後同一輪觸控(直到 touchend)的
  // 所有事件都呼叫 stopPropagation() 擋掉冒泡,不讓 PhoneBottomSheet
  // 收到;垂直為主則完全不攔截,讓事件正常冒泡給卡片處理拖曳——一旦
  // 鎖定方向,中途不會再改變(常見的方向鎖行為,避免使用者滑動路徑
  // 微幅斜向時方向判斷來回跳動、手感忽鎖忽放)。
  const touchStateRef = useRef<{ startX: number; startY: number; locked: 'swipe' | 'drag' | null } | null>(null)

  function onTouchStart(e: ReactTouchEvent) {
    const touch = e.touches[0]
    touchStateRef.current = { startX: touch.clientX, startY: touch.clientY, locked: null }
  }

  function onTouchMove(e: ReactTouchEvent) {
    const state = touchStateRef.current
    if (!state) return
    const touch = e.touches[0]
    const dx = touch.clientX - state.startX
    const dy = touch.clientY - state.startY

    if (state.locked === null) {
      if (Math.abs(dx) < DIRECTION_LOCK_THRESHOLD_PX && Math.abs(dy) < DIRECTION_LOCK_THRESHOLD_PX) {
        return
      }
      state.locked = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'drag'
    }

    if (state.locked === 'swipe') {
      e.stopPropagation()
    }
  }

  function onTouchEnd(e: ReactTouchEvent) {
    if (touchStateRef.current?.locked === 'swipe') {
      e.stopPropagation()
    }
    touchStateRef.current = null
  }

  function registerObserver(node: HTMLDivElement | null) {
    trackRef.current = node
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        // 取交集比例最高的那一張當作目前顯示中的頁面——沒有 scroll-snap
        // 強制吸附,圖片可能停在兩張之間,不會有任何一張的 intersectionRatio
        // 精準到 1,但比例最高的那張仍然最接近「使用者目前主要在看哪張」。
        let bestIndex = -1
        let bestRatio = 0
        for (const entry of entries) {
          const idx = itemRefs.current.indexOf(entry.target as HTMLDivElement)
          if (idx !== -1 && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio
            bestIndex = idx
          }
        }
        if (bestIndex !== -1) setActiveIndex(bestIndex)
      },
      { root: node, threshold: [0.5, 0.75, 1] },
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }

  // edgePadding:只有目前顯示第一張(activeIndex===0)或最後一張
  // (activeIndex===photos.length-1)時,軌道對應那一側才留一點間距
  // ——使用者明確要求「第一張顯示時左邊要有間隙、滑到最後一張時右邊
  // 要有間隙」,左右對稱規則,但滑到中間任一張時軌道整體要真正貼齊
  // 卡片外緣,不能一直留白(見呼叫端 GeoOutlinePhoneInfoSheet 的
  // .imageWrapSwipe 說明,那層外框本身已經不留 padding)。用既有的
  // activeIndex(IntersectionObserver 判斷的目前主要顯示張數)當條件,
  // 不需要另外監聽 scrollLeft——activeIndex 對應到第一/最後張時,視覺
  // 上就是「使用者看到的是那一張」,已經足夠對應這個需求。這兩個
  // padding 只加在軌道(.swipeTrack)本身,不影響 .swipeItem 各自的
  // 寬度計算基準(flex 子項目的 calc(100% - 16px)是相對容器內容框
  // 寬度,padding 屬於容器本身,兩者本來就分開處理,只是首尾項目的
  // flexBasis 需要額外扣掉對應側的 padding,見下方 itemStyle)。
  const isFirstActive = activeIndex === 0
  const isLastActive = activeIndex === photos.length - 1
  const leadingPadding = isFirstActive ? 16 : 0
  const trailingPadding = isLastActive ? 16 : 0

  return (
    <div className={styles.wrap}>
      <div
        className={styles.swipeTrack}
        ref={registerObserver}
        style={{ paddingLeft: leadingPadding, paddingRight: trailingPadding }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {photos.map((url, i) => {
          // 首尾項目「不」需要額外覆寫寬度——.swipeItem 的基準值
          // calc(100% - 16px)裡的 100%,對 flex item 而言本來就是
          // 相對「.swipeTrack 內容框(content-box)寬度」計算,而
          // .swipeTrack 的 padding 已經內縮了這個內容框(見上方
          // leadingPadding/trailingPadding),所以首/尾張的 100%
          // 基準本身就已經比中間張少了 16px,維持同一份 calc(100% -
          // 16px)就能讓首尾張露出的遠景寬度跟中間張一致(都是 16px)。
          // 之前這裡誤以為 padding 縮減內容框跟 calc 裡的 16px 是
          // 「兩件各自獨立要扣的東西」,額外疊加了一次 16px(變成
          // calc(100% - 32px)),導致首/尾張顯示時該張圖片明顯比
          // 其他張窄一截、右側露出的遠景寬度也跟著變成 32px,兩種
          // 視覺瑕疵都是這裡多扣一次造成的,拿掉這段 inline override
          // 即可回到跟中間張一致的比例。
          return (
            <div
              key={url + i}
              className={styles.swipeItem}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
            >
              <img className={styles.photo} src={url} alt={alt} />
            </div>
          )
        })}
      </div>
      <div className={styles.dots} role="tablist" aria-label="照片頁碼">
        {photos.map((url, i) => (
          <span
            key={url + i}
            role="tab"
            aria-selected={i === activeIndex}
            className={`${styles.dot}${i === activeIndex ? ` ${styles.dotActive}` : ''}`}
          />
        ))}
      </div>
      <span className={styles.counter}>{activeIndex + 1} / {photos.length}</span>
    </div>
  )
}

// Lightbox:桌面版點擊卡片縮圖後彈出的全螢幕檢視層——左右箭頭/鍵盤方向
// 鍵切換,點背景或右上角關閉鈕收起。桌面版用滑鼠操作,箭頭按鈕比觸控
// 滑動手勢更符合滑鼠使用者的操作習慣,故桌面/手機在這裡刻意採用不同的
// 切換方式,而非同一套邏輯套用到兩種裝置。
function Lightbox({ photos, alt, onClose }: { photos: string[]; alt: string; onClose: () => void }) {
  const [index, setIndex] = useState(0)

  function goTo(next: number) {
    setIndex((next + photos.length) % photos.length)
  }

  return (
    <div
      className={styles.lightboxOverlay}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') goTo(index - 1)
        else if (e.key === 'ArrowRight') goTo(index + 1)
        else if (e.key === 'Escape') onClose()
      }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <button
        type="button"
        className={styles.lightboxCloseBtn}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="關閉"
      >
        <X size={22} strokeWidth={2} />
      </button>
      <img
        className={styles.lightboxImg}
        src={photos[index]}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className={`${styles.lightboxNavBtn} ${styles.lightboxNavBtnPrev}`}
        onClick={(e) => {
          e.stopPropagation()
          goTo(index - 1)
        }}
        aria-label="上一張照片"
      >
        <ChevronLeft size={24} strokeWidth={2} />
      </button>
      <button
        type="button"
        className={`${styles.lightboxNavBtn} ${styles.lightboxNavBtnNext}`}
        onClick={(e) => {
          e.stopPropagation()
          goTo(index + 1)
        }}
        aria-label="下一張照片"
      >
        <ChevronRight size={24} strokeWidth={2} />
      </button>
      <span className={styles.lightboxCounter}>{index + 1} / {photos.length}</span>
    </div>
  )
}
