import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import styles from './PhoneBottomSheet.module.css'

// SHEET_EASE/SHEET_DURATION:放開手指後的「回彈到位」動畫曲線/時長——
// 參考 Vaul(react bottom sheet 函式庫)的 TRANSITIONS 設定
// (cubic-bezier(0.32, 0.72, 0, 1)),這條貝茲曲線開頭加速快、尾段有較長
// 的緩停尾巴,比瀏覽器內建的 ease/ease-out 更貼合「拖曳鬆手回彈停靠」的
// 物理感。時長採 0.35s——比 Vaul 原始的 0.5s 略短,bottom sheet 高度
// 變化用太長時間顯得遲鈍。
const SHEET_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const SHEET_DURATION = '0.35s'
// PHONE_BOTTOM_SHEET_EXIT_MS:對外匯出,供呼叫端的 exitDurationMs 對齊
// 這裡的動畫時長(毫秒版本,SHEET_DURATION 是 CSS transition 用的字串)
// ——見 exitDurationMs prop 的說明。
export const PHONE_BOTTOM_SHEET_EXIT_MS = 350
// MID_SNAP_TOLERANCE_PX:'snap' 模式下,拖曳起點若是三段以上 snapPoints
// 裡「既不是最小也不是最大」的中繼點,結束時的位移量在這個門檻(px)內
// 一律彈回原本的中繼點,不切換段——見 onTouchEnd 裡 isFromMidPoint 的
// 說明(使用者明確要求的「防手滑」設計)。
const MID_SNAP_TOLERANCE_PX = 40

// PhoneBottomSheet:手機版由下往上彈出的 bottom sheet 共用容器——抽出自
// trip/PhoneTripsDrawer.tsx、geo-planning/GeoOutlinePhoneListDrawer.tsx、
// geo-planning/GeoOutlinePhoneInfoSheet.tsx 三份原本各自複製貼上的
// backdrop/panel/dragHandle 外殼與拖曳手勢邏輯,收斂成這一個元件,往後
// 新增一個 bottom sheet 或調整拖曳手感只需要改一處。
//
// 定位細節(position/z-index/底部貼齊位置/backdrop 顏色)不寫死在這裡,
// 全部開放給呼叫端指定——三份原始檔案的這些數值互不相同(各自依附不同
// 的 position: relative 祖先、身處不同的疊層脈絡),屬於「這個 sheet
// 出現在畫面上哪裡」的呼叫端決策,不是這個共用容器該替呼叫端決定的事。
// 這個元件只負責兩件事:視覺骨架(backdrop + panel + dragHandle + head
// slot + 內容區)、拖曳手勢行為(見下方 mode 的說明)。
//
// mode 決定拖曳手勢的語意,對齊既有兩種用法:
// - 'slide-close':拖到底(或點 backdrop)整個滑出畫面關閉,對齊
//   PhoneTripsDrawer.tsx/GeoOutlinePhoneListDrawer.tsx 原本用的
//   useDragToClose——只能往下拖,超過門檻呼叫 onClose,backdrop 恆定
//   顯示(open 時)。高度固定為 maxHeightVh,不支援 snapPoints。
// - 'snap':在 snapPoints(vh 高度陣列,由小到大排序)之間拖曳吸附,對齊
//   GeoOutlinePhoneInfoSheet.tsx 原本的展開/收合雙態手勢,但泛化成任意
//   段數(參考 Vaul 的 snap points 設計:拖曳結束時吸附到「目前位置最
//   接近」的那個 snap point,而非固定位移門檻判斷「有沒有超過就整個
//   切態」)——這裡不做 Vaul 那種依拖曳速度(velocity)決定要不要跳過
//   中間點的「甩動」判斷,單純比較拖曳結束當下的高度離哪個 snap point
//   最近,對兩三段的用量已經足够,速度判斷留待真的需要時再加。
//   activeSnapIndex/onSnapIndexChange 是受控 state,由呼叫端持有「目前
//   吸附在第幾個 snap point」;索引 0 通常是最小高度(例如
//   GeoOutlinePhoneInfoSheet.tsx 用來顯示「只剩 head 標頭列」),最後一
//   個索引是 maxHeightVh(完整展開)。backdrop 只在 activeSnapIndex 對應
//   到「不是最小的那個 snap point」時顯示(收合到最小時不擋背景內容,
//   理由同原本的 expand-collapse 設計);onClose 只由呼叫端自己在 head
//   裡放的關閉按鈕觸發,不是拖曳觸發。
export interface PhoneBottomSheetProps {
  open: boolean
  onClose: () => void
  mode: 'slide-close' | 'snap'
  // maxHeightVh:'slide-close' 模式的固定高度(vh)。'snap' 模式忽略這個
  // prop,改用 snapPoints 的最後一個值當展開上限。
  maxHeightVh?: number
  // snapPoints:'snap' 模式專用,由小到大排序的高度陣列(vh)——至少要有
  // 兩個值,見上方元件說明。
  snapPoints?: number[]
  // activeSnapIndex/onSnapIndexChange:'snap' 模式專用的受控 state——見
  // 上方元件說明。
  activeSnapIndex?: number
  onSnapIndexChange?: (index: number) => void
  // head:標頭 slot(標題文字、關閉按鈕、分頁列等,由呼叫端自行組裝)——
  // 'snap' 模式收合到最小 snap point 時只會顯示這個 slot,不顯示
  // children。
  head?: ReactNode
  children: ReactNode
  // exitDurationMs:'snap' 模式專用,open 變 false 時延遲多久才真正
  // unmount(用來播放退場滑出動畫,見下方 shouldRender 的說明)——毫秒,
  // 需要跟 SHEET_DURATION 對齊。'slide-close' 模式不需要,呼叫端(如
  // GeoOutlinePhoneListDrawer.tsx/PhoneTripsDrawer.tsx)本身就是常駐
  // 掛載,不會在 open=false 時把整個元件從 React 樹拔掉,天生沒有這個
  // 問題。省略則'snap' 模式退場時直接 unmount,沒有滑出動畫。
  // panelStyle:定位相關樣式(position/z-index/left/right/bottom 等),
  // 由呼叫端決定,見上方元件說明——與這個元件自己算出的
  // maxHeight/transform/transition 合併套用在 panel 上。
  panelStyle?: CSSProperties
  // backdropStyle:同 panelStyle,但套用在 backdrop 上(z-index/bottom/
  // background 等)。
  backdropStyle?: CSSProperties
  // showBackdrop:'slide-close' 模式下,呼叫端可能想要透明 backdrop
  // (承接點外部關閉手勢,但不疊暗色調,見 GeoOutlinePhoneListDrawer.tsx
  // 原本的用法)——backdropStyle 已經能指定 background 為 transparent,
  // 這個 flag 純粹是要不要渲染 backdrop 這個節點,兩者搭配使用。
  // 'snap' 模式下預設(true)沿用「展開時顯示、收合到最小 snap point 時
  // 不顯示」的邏輯(見上方元件說明);傳 false 則整個 mode 都不顯示
  // backdrop,不管 activeSnapIndex 是多少——用於呼叫端希望背景內容
  // (例如地圖)全程保持可見可互動的情境(見
  // geo-planning/GeoOutlinePhoneInfoSheet.tsx 的用法)。預設 true。
  showBackdrop?: boolean
  panelClassName?: string
  exitDurationMs?: number
}

export function PhoneBottomSheet({
  open,
  onClose,
  mode,
  maxHeightVh,
  snapPoints,
  activeSnapIndex = 0,
  onSnapIndexChange,
  head,
  children,
  panelStyle,
  backdropStyle,
  showBackdrop = true,
  panelClassName,
  exitDurationMs,
}: PhoneBottomSheetProps) {
  // shouldRender/lastContent:'snap' 模式的延遲卸載——呼叫端(如
  // GeoOutlinePhoneInfoSheet.tsx)常常是「資料來源本身決定要不要渲染」
  // (content/attraction 變 null 時 open 直接變 false),若這個元件此時
  // 立刻不渲染 panel,退場的滑出動畫完全沒有機會播放(使用者實測回報
  // 「點關閉是瞬間消失,沒有滑出動畫」)。有給 exitDurationMs 時,
  // open 變 false 後不立刻停止渲染,而是:1) 記住最後一次的
  // head/children 內容(lastContent,呼叫端這時通常已經把資料清空,
  // 不能直接繼續讀 props 的 head/children,必須用快照);2) 讓
  // translate/panelHeightVh 依正常邏輯位移出畫面播放退場動畫;3) 動畫
  // 時長跑完後才真正把 shouldRender 設為 false,元件回傳 null。
  // 'slide-close' 模式或沒傳 exitDurationMs 時不啟用這套機制,shouldRender
  // 恆為 open 本身(呼叫端自己決定要不要保留節點,見上方 prop 說明)。
  const [shouldRender, setShouldRender] = useState(open)
  const lastContentRef = useRef<{ head?: ReactNode; children: ReactNode }>({ head, children })
  if (open) {
    lastContentRef.current = { head, children }
  }
  useEffect(() => {
    if (open) {
      setShouldRender(true)
      return
    }
    if (!exitDurationMs) {
      setShouldRender(false)
      return
    }
    const timer = setTimeout(() => setShouldRender(false), exitDurationMs)
    return () => clearTimeout(timer)
  }, [open, exitDurationMs])
  const renderedHead = open ? head : lastContentRef.current.head
  const renderedChildren = open ? children : lastContentRef.current.children

  // 拖曳手勢:兩種 mode 共用同一套 touch handler,行為依 mode 分岔——
  // startYRef 記錄手勢起點,dragOffset 是這次拖曳的即時位移(拖曳中即時
  // 跟手,鬆手後歸零)。startHeightVhRef 記錄'snap' 模式手勢開始當下的
  // 高度(vh),讓拖曳中即時高度 = 起始高度 + 位移換算的 vh 量,不用等
  // 手勢結束才更新視覺。
  const startYRef = useRef<number | null>(null)
  const startHeightVhRef = useRef(0)
  const draggingRef = useRef(false)
  const [dragOffset, setDragOffset] = useState(0)

  // entered:首次出現時「整張卡片從螢幕下方滑入」的進場動畫旗標——參考
  // Vaul(react bottom sheet 函式庫)的做法:掛載當下先讓 panel 停在
  // translateY(100%)(位移到畫面外),下一個 requestAnimationFrame 才切到
  // translateY(0)觸發 CSS transition 播放滑入動畫,而不是像瀏覽器預設
  // 掛載時就用最終樣式那樣直接「憑空出現」。'snap' 模式原本只靠
  // max-height 從 0 展開,沒有這個位移滑入效果,視覺上是原地长高而非
  // 從下方滑出(使用者明確要求要有滑出效果),故兩種 mode 現在共用同一套
  // entered 進場位移邏輯。open 從 false 變 true 時重新觸發(對齊
  // 「重新出現」也要有進場動畫,不是只有第一次掛載)。
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    setEntered(false)
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [open])

  const sortedSnapPoints = mode === 'snap' ? (snapPoints ?? []) : []
  const currentSnapVh = sortedSnapPoints[activeSnapIndex] ?? sortedSnapPoints[0] ?? 0

  const panelRef = useRef<HTMLDivElement>(null)

  function onTouchStart(e: ReactTouchEvent) {
    startYRef.current = e.touches[0].clientY
    startHeightVhRef.current = currentSnapVh
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startYRef.current === null) return
    const delta = e.touches[0].clientY - startYRef.current

    if (mode === 'slide-close') {
      // 只能往下拖(delta >= 0)——理由同 useDragToClose 的原始寫法。
      setDragOffset(Math.max(0, delta))
    } else {
      // 'snap' 模式:即時位移量換算成 vh,更新跟手高度,夾在
      // [最小 snap point, 最大 snap point] 之間,不需要額外方向限制
      // (跟原本雙態版本不同,泛化成任意段數後,拖曳方向本身不需要看
      // 目前是不是已經在極值,由夾值範圍自然限制)。
      const deltaVh = (-delta / window.innerHeight) * 100
      setDragOffset(deltaVh)
    }
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (mode === 'slide-close') {
      if (dragOffset > 60) onClose()
      setDragOffset(0)
    } else if (sortedSnapPoints.length > 0) {
      const min = sortedSnapPoints[0]
      const max = sortedSnapPoints[sortedSnapPoints.length - 1]
      const rawVh = startHeightVhRef.current + dragOffset
      const clampedVh = Math.min(max, Math.max(min, rawVh))
      const startIndex = sortedSnapPoints.indexOf(startHeightVhRef.current)

      // 吸附規則(使用者明確要求的設計,非 Vaul 的距離最近判斷)——注意
      // dragOffset 在 'snap' 模式下的正負號定義(見上方 onTouchMove 的
      // deltaVh 算法,有一個負號):dragOffset > 0 代表往上拉(手指往
      // 螢幕上方移動,卡片變高),dragOffset < 0 代表往下拉(卡片變矮),
      // 跟 onTouchMove 裡原始的 delta(觸控 Y 座標差)方向相反,不要
      // 搞混(這裡曾經寫反過,導致「完全都在最上方無法拉動」——起點是
      // 最小 snap point 時判斷式誤判成「只有往下拉才切到下一段」,但
      // 從最小往下已經是陣列外、被 clampedVh 夾住不會真的移動,實際上
      // 唯一能觸發換段的往上拉方向被判斷式擋掉了)。
      //  - 起點是最小 snap point:只要有往上拉的動作(dragOffset > 0,
      //    不論拉多遠/多快),一律吸附到相鄰的下一段——沒有容忍帶,拉了
      //    就走。
      //  - 起點是最大 snap point:同理,只要有往下拉(dragOffset < 0)
      //    就吸附到相鄰的上一段。
      //  - 起點是中繼點(其餘所有 snap point):有
      //    ±MID_SNAP_TOLERANCE_PX(換算成 vh)的容忍帶——結束時的高度
      //    落在容忍帶內,彈回原本的中繼點;落在容忍帶之外,依方向(往上
      //    拉/往下拉)吸附到相鄰的上一段/下一段。
      let nearestIndex: number
      if (startIndex === 0) {
        nearestIndex = dragOffset > 0 ? 1 : 0
      } else if (startIndex === sortedSnapPoints.length - 1) {
        nearestIndex = dragOffset < 0 ? sortedSnapPoints.length - 2 : startIndex
      } else {
        const toleranceVh = (MID_SNAP_TOLERANCE_PX / window.innerHeight) * 100
        if (Math.abs(clampedVh - startHeightVhRef.current) <= toleranceVh) {
          nearestIndex = startIndex
        } else if (dragOffset > 0) {
          nearestIndex = startIndex + 1
        } else {
          nearestIndex = startIndex - 1
        }
      }
      onSnapIndexChange?.(nearestIndex)
      setDragOffset(0)
    }
    startYRef.current = null
  }

  // panelHeightVh:'snap' 模式下面板實際套用的高度(vh)——跟手拖曳中
  // 即時反映 startHeightVhRef + dragOffset(夾在範圍內),放開手指後
  // (dragOffset 已歸零)回到 currentSnapVh。這個值套在 CSS 的 height
  // (不是 max-height)——max-height 只能限制上限、不能強迫容器撐開到
  // 那麼高,若卡片實際內容(標頭+圖片+簡介)的自然高度本來就小於算出來
  // 的 panelHeightVh,用 max-height 會導致「數值在變、畫面上卡片高度
  // 完全沒反應」(使用者實測回報「拖曳完全沒有視覺效果」,加了臨時
  // console.log 後確認 dragOffset/panelHeightVh 都正確計算,問題出在
  // CSS 套用方式上)。改用 height 後容器一律撐到指定高度,不管內容多短,
  // 拖曳時才會真的看到卡片邊界跟著手指移動。'slide-close' 模式維持用
  // max-height(該模式的固定高度不需要跟手拖曳撐開的視覺效果,行為對齊
  // 原本三份原始檔案的既有寫法)。
  const panelHeightVh =
    mode === 'snap' && sortedSnapPoints.length > 0
      ? draggingRef.current
        ? Math.min(
            sortedSnapPoints[sortedSnapPoints.length - 1],
            Math.max(sortedSnapPoints[0], startHeightVhRef.current + dragOffset),
          )
        : currentSnapVh
      : maxHeightVh

  // 是否目前停在最小的 snap point(對齊原本 expand-collapse 設計的
  // 「收合」狀態,見元件開頭 mode 的說明)——只有這個狀態才隱藏 body、
  // 不顯示 backdrop。
  const isAtMinSnap = mode === 'snap' && sortedSnapPoints.length > 0 && !draggingRef.current && activeSnapIndex === 0

  // translate:'slide-close' 模式下,關閉時整個位移出畫面(100% +
  // dragOffset,對齊 useDragToClose 原本的算法),開啟且已完成進場動畫
  // (entered)時貼齊 0(高度變化已經靠 max-height 呈現,不需要額外位移)。
  // 'snap' 模式在 entered 之前也位移到 100%(畫面外)——見上方 entered
  // 的說明,讓首次出現時整張卡片從螢幕下方滑入,而不是原地长高(使用者
  // 明確要求要有滑出效果);entered 之後歸 0,高度變化交給
  // panelHeightVh 呈現,拖曳中的跟手位移則由 dragOffset 換算的 vh 反映
  // 在 panelHeightVh 本身,不透過 translate。
  const translate =
    mode === 'slide-close'
      ? open
        ? `${dragOffset}px`
        : `calc(100% + ${dragOffset}px)`
      : entered
        ? '0px'
        : '100%'
  // transition:拖曳中關掉動畫(即時跟手),放開手指後才套用「回彈到位」
  // 動畫——'snap' 模式套用 height(該模式改用 height 撐開容器,見上方
  // panelHeightVh 的說明),'slide-close' 模式套用 max-height,兩者都
  // 統一跟 transform 套同一條曲線跟時長(見上方 SHEET_EASE/SHEET_DURATION
  // 的說明),避免不同步的違和感。這裡曾經寫死只對 max-height 做動畫,
  // 'snap' 模式改用 height 屬性後,沒有一併把 transition 的目標屬性換成
  // height,導致該屬性變化時完全沒有動畫(瞬間跳變)、只有 transform 有
  // 漸變,兩者不同步——使用者實測回報「拖曳可以動了,但收合/展開沒有
  // 分段效果、也看不出滑出特效」,根因就是這裡少換一個屬性名稱。 */
  const transition = draggingRef.current
    ? 'none'
    : mode === 'snap'
      ? `height ${SHEET_DURATION} ${SHEET_EASE}, transform ${SHEET_DURATION} ${SHEET_EASE}`
      : `max-height ${SHEET_DURATION} ${SHEET_EASE}, transform ${SHEET_DURATION} ${SHEET_EASE}`

  // backdrop 顯示條件:'slide-close' 模式由 open && showBackdrop 決定
  // (對齊三份原始檔案「backdrop 只在 open 時渲染」的既有寫法);'snap'
  // 模式在 showBackdrop 為 false 時全程不顯示,否則沿用「收合到最小
  // snap point 時不顯示」的邏輯(見上方 showBackdrop 的說明)。
  const backdropVisible = mode === 'slide-close' ? open && showBackdrop : open && showBackdrop && !isAtMinSnap

  // shouldRender 為 false 代表退場動畫(若有)已播完、或呼叫端根本沒給
  // exitDurationMs——這個元件完全不渲染,理由見上方 shouldRender 的說明。
  if (!shouldRender) return null

  return (
    <>
      {backdropVisible && (
        <div className={styles.backdrop} style={backdropStyle} onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        className={`${styles.panel}${panelClassName ? ` ${panelClassName}` : ''}${isAtMinSnap ? ` ${styles.panelCollapsed}` : ''}`}
        style={{
          height: mode === 'snap' ? `${panelHeightVh}vh` : undefined,
          maxHeight: mode === 'slide-close' ? `${panelHeightVh}vh` : undefined,
          transform: `translateY(${translate})`,
          transition,
          ...panelStyle,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.dragHandle}>
          <div className={styles.dragHandleBar} />
        </div>
        {renderedHead}
        {/* body:'snap' 模式停在最小 snap point 時隱藏(見 .panelCollapsed
            的 CSS 說明),其餘情況(含 'slide-close' 模式)永遠顯示。 */}
        <div className={styles.body}>{renderedChildren}</div>
      </div>
    </>
  )
}
