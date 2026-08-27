import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import { X } from 'lucide-react'
import styles from './PhoneBottomSheet.module.css'

// SheetHead:標準 head slot 內容(標題文字 + 關閉鈕),供呼叫端直接帶入
// PhoneBottomSheet 的 head prop——使用者明確要求「用相同樣式的 head」,
// 原本 geo-planning/GeoOutlinePhoneListDrawer.tsx、
// timeline/PhoneTimelineDrawer.tsx 各自在呼叫端重複刻一份同樣結構的
// JSX(標題 span + X 圖示關閉鈕),收斂成這個元件,往後新增一個 bottom
// sheet 只需要帶 title/onClose 兩個 prop。不是所有呼叫端都適用這個標準
// 結構——trip/PhoneTripsDrawer.tsx 目前不帶 head、
// geo-planning/GeoOutlinePhoneInfoSheet.tsx 的 head 內容結構不同(名稱/
// 副標/badges/加入行程按鈕),繼續自己組裝,不勉強套用這個元件。
export function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className={styles.head}>
      <span className={styles.title}>{title}</span>
      <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  )
}

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
// MID_SNAP_TOLERANCE_PX:拖曳起點若是三段以上 snapPoints 裡「既不是最小
// 也不是最大展開程度」的中繼點,結束時的位移量在這個門檻(px)內一律彈回
// 原本的中繼點,不切換段——見 onTouchEnd 裡的說明(使用者明確要求的
// 「防手滑」設計)。
const MID_SNAP_TOLERANCE_PX = 40

// PhoneBottomSheet:手機版由下往上彈出的 bottom sheet 共用容器——抽出自
// trip/PhoneTripsDrawer.tsx、geo-planning/GeoOutlinePhoneListDrawer.tsx、
// geo-planning/GeoOutlinePhoneInfoSheet.tsx 三份原本各自複製貼上的
// backdrop/panel/dragHandle 外殼與拖曳手勢邏輯,收斂成這一個元件,往後
// 新增一個 bottom sheet 或調整拖曳手感只需要改一處。
//
// 定位細節(z-index/left/right/bottom 等)不寫死在這裡,全部開放給呼叫端
// 指定——各呼叫端的這些數值互不相同(各自依附不同的 position: relative
// 祖先、身處不同的疊層脈絡),屬於「這個 sheet 出現在畫面上哪裡」的呼叫端
// 決策,不是這個共用容器該替呼叫端決定的事。這個元件只負責兩件事:視覺
// 骨架(backdrop + panel + dragHandle + head slot + 內容區)、拖曳手勢
// 行為(見下方 snapPoints/minHeightPx 的說明)。
//
// 不再用 mode 區分「固定高度滑出關閉」跟「多段吸附」兩種語意(使用者
// 明確要求「元件設計不用分模式,用段落參數判斷可以滑幾段、位置在哪就
// 好」),改成 snapPoints + minHeightPx 決定一切:
//
// - snapPoints:由大到小排序的「離螢幕頂部距離」陣列(px,不是 vh)——
//   數值越大代表面板頂部離螢幕上緣越遠(展開越少),數值越小代表面板頂部
//   越靠近螢幕上緣(展開越多),最後一項(最小值)通常代表最大展開程度。
//   用「離頂部的固定 px 距離」而非「面板高度的 vh 百分比」表達,是因為
//   vh 百分比在不同裝置高度下換算出來的實際留白/可視內容比例不一致
//   (使用者明確要求「才能適應不同的裝置」)——例如「離頂部 64px」在任何
//   裝置上都是同一個實際距離,但「90vh」在矮螢幕裝置上換算出來的留白
//   會比高螢幕裝置窄很多。至少要有一個值;只有一個值時,面板固定在這個
//   展開程度,沒有更多段可以吸附。
// - minHeightPx:額外的收合段固定高度(px,不是離頂部距離)——這個段落
//   本質是「內容自然高度」(例如只顯示 head 標頭列的高度),不該隨裝置
//   高度變化跟著換算(不同裝置的標頭列高度是一樣的,不會因為螢幕比較高
//   就跟著變高),所以獨立於 snapPoints 陣列之外,用固定高度表達,不納入
//   「離頂部距離」那套換算。省略時代表沒有收合段,activeSnapIndex 的
//   索引空間就是 snapPoints 本身;有給 minHeightPx 時,索引 0 固定對應
//   這個收合段,索引 1 開始才對應 snapPoints[0]、snapPoints[1]……以此
//   類推。
//
// 依這兩個參數合起來的段落總數自然分岔行為:
// - 總段數 1(只有 snapPoints 且長度 1,沒有 minHeightPx):退化成原本
//   的'slide-close'語意——固定展開程度,只能往下拖,超過門檻(見
//   onTouchEnd)直接呼叫 onClose,沒有更低的段可以吸附。對齊
//   PhoneTripsDrawer.tsx/GeoOutlinePhoneListDrawer.tsx 原本用的
//   useDragToClose 行為。
// - 總段數 >= 2:在這些段落之間拖曳吸附,對齊 GeoOutlinePhoneInfoSheet.tsx
//   原本的展開/收合雙態手勢,泛化成任意段數(參考 Vaul 的 snap points
//   設計:拖曳結束時吸附到「目前位置最接近」的那個段,而非固定位移門檻
//   判斷「有沒有超過就整個切態」)——這裡不做 Vaul 那種依拖曳速度
//   (velocity)決定要不要跳過中間點的「甩動」判斷,單純比較拖曳結束
//   當下的位置離哪個段最近,對兩三段的用量已經足够,速度判斷留待真的
//   需要時再加。activeSnapIndex/onSnapIndexChange 是受控 state,由
//   呼叫端持有「目前吸附在第幾個段」;索引 0 是最小展開程度(收合段,
//   若有 minHeightPx 就是它,否則是 snapPoints[0]),最後一個索引是
//   最大展開程度。backdrop 只在 activeSnapIndex 對應到「不是最小的
//   那個段」時顯示(收合到最小時不擋背景內容,理由同原本的
//   expand-collapse 設計);onClose 只由呼叫端自己在 head 裡放的關閉
//   按鈕觸發,不是拖曳觸發(總段數 1 的退化情況除外,拖到底仍會觸發
//   onClose,見上方)。
export interface PhoneBottomSheetProps {
  open: boolean
  onClose: () => void
  // snapPoints:由大到小排序的「離螢幕頂部距離」陣列(px)——至少要有
  // 一個值,見上方元件說明。
  snapPoints: number[]
  // minHeightPx:額外的收合段固定高度(px)——見上方元件說明。省略時
  // 沒有這個收合段。
  minHeightPx?: number
  // activeSnapIndex/onSnapIndexChange:受控 state,持有目前吸附在第幾個
  // 段(索引空間見上方 minHeightPx 的說明)——見上方元件說明。總段數為 1
  // 時這兩個 prop 沒有實際作用,可以省略。
  activeSnapIndex?: number
  onSnapIndexChange?: (index: number) => void
  // head:標頭 slot(標題文字、關閉按鈕、分頁列等,由呼叫端自行組裝)——
  // 收合到最小段時只會顯示這個 slot,不顯示 children。
  head?: ReactNode
  children: ReactNode
  // exitDurationMs:open 變 false 時延遲多久才真正 unmount(用來播放退場
  // 滑出動畫,見下方 shouldRender 的說明)——毫秒,需要跟 SHEET_DURATION
  // 對齊。呼叫端若本身就是常駐掛載(不會在 open=false 時把整個元件從
  // React 樹拔掉),天生沒有這個問題,可以省略;省略則退場時直接
  // unmount,沒有滑出動畫。
  // panelStyle:定位相關樣式(position/z-index/left/right/bottom 等),
  // 由呼叫端決定,見上方元件說明——與這個元件自己算出的
  // top/transform/transition 合併套用在 panel 上。
  panelStyle?: CSSProperties
  // backdropStyle:同 panelStyle,但套用在 backdrop 上(z-index/bottom/
  // background 等)。
  backdropStyle?: CSSProperties
  // showBackdrop:預設(true)沿用「展開時顯示、收合到最小段時不顯示」的
  // 邏輯(見上方元件說明);傳 false 則全程不顯示 backdrop,不管
  // activeSnapIndex 是多少——用於呼叫端希望背景內容(例如地圖)全程保持
  // 可見可互動的情境(見 geo-planning/GeoOutlinePhoneInfoSheet.tsx 的
  // 用法)。預設 true。
  showBackdrop?: boolean
  panelClassName?: string
  exitDurationMs?: number
  // loading:true 時 body 區塊顯示置中轉圈動畫取代 children,head 仍正常
  // 顯示——讓呼叫端自己決定「資料還在抓、但使用者已經觸發開啟」這種情境
  // 要不要先把面板打開再補資料,還是等資料回來才開(兩種用法都支援:傳
  // open=true 搭配 loading=true 就是前者,等資料回來前都不傳 open=true
  // 就是後者),這個元件本身不規定任何一種流程。省略則不顯示,body 照常
  // 渲染 children(預設行為不變)。
  loading?: boolean
}

export function PhoneBottomSheet({
  open,
  onClose,
  snapPoints,
  minHeightPx,
  activeSnapIndex = 0,
  onSnapIndexChange,
  head,
  children,
  panelStyle,
  backdropStyle,
  showBackdrop = true,
  panelClassName,
  exitDurationMs,
  loading = false,
}: PhoneBottomSheetProps) {
  // shouldRender/lastContent:延遲卸載——呼叫端(如
  // GeoOutlinePhoneInfoSheet.tsx)常常是「資料來源本身決定要不要渲染」
  // (content/attraction 變 null 時 open 直接變 false),若這個元件此時
  // 立刻不渲染 panel,退場的滑出動畫完全沒有機會播放(使用者實測回報
  // 「點關閉是瞬間消失,沒有滑出動畫」)。有給 exitDurationMs 時,
  // open 變 false 後不立刻停止渲染,而是:1) 記住最後一次的
  // head/children 內容(lastContent,呼叫端這時通常已經把資料清空,
  // 不能直接繼續讀 props 的 head/children,必須用快照);2) 讓
  // translate/panelTop 依正常邏輯位移出畫面播放退場動畫;3) 動畫時長
  // 跑完後才真正把 shouldRender 設為 false,元件回傳 null。沒傳
  // exitDurationMs 時不啟用這套機制,shouldRender 恆為 open 本身(呼叫端
  // 自己決定要不要保留節點,見上方 prop 說明)。
  //
  // shouldRender 在 open 變 true 時改成在 render 階段同步更新(不是靠
  // useEffect 才 setShouldRender(true)),理由:呼叫端有兩種掛載方式——
  // 一種是資料來源決定要不要渲染這個元件本身(如
  // GeoOutlinePhoneInfoSheet.tsx,open 第一次變 true 就等於這個元件第一次
  // mount,shouldRender 的初始值 useState(open) 當下就已經是 true,沒有
  // 延遲問題);另一種是呼叫端自己的容器永遠掛載、只切換 open prop(如
  // GeoOutlinePhoneListDrawer.tsx,理由見該檔案——避免地圖/候選籃等內部
  // state 隨分頁切換被銷毀重建)。後者第一次掛載時 open 是 false,
  // shouldRender 初始值卡在 false,若只靠 useEffect 才 setShouldRender(true)
  // 會比 open 變 true 晚一輪 render 才真正出現 panel 節點,這一輪延遲跟
  // entered 的進場動畫(見下方)需要的「掛載時就有一幀在畫面外、下一幀才
  // 滑入」時序衝突,兩者疊加後瀏覽器可能把這兩個 render 合併成一次繪製,
  // 完全看不到滑入過程(使用者實測回報「GeoOutlinePhoneListDrawer.tsx
  // 滑出動畫正常,滑入完全沒有」,改成容器一直掛載的呼叫端獨有)。改成
  // render 階段同步判斷後,不論呼叫端用哪種掛載方式,open 變 true 的那一次
  // render 就已經是 shouldRender: true,不再有跨渲染輪次的落差。
  const [shouldRender, setShouldRender] = useState(open)
  if (open && !shouldRender) {
    setShouldRender(true)
  }
  const lastContentRef = useRef<{ head?: ReactNode; children: ReactNode }>({ head, children })
  if (open) {
    lastContentRef.current = { head, children }
  }
  useEffect(() => {
    if (open) return
    if (!exitDurationMs) {
      setShouldRender(false)
      return
    }
    const timer = setTimeout(() => setShouldRender(false), exitDurationMs)
    return () => clearTimeout(timer)
  }, [open, exitDurationMs])
  const renderedHead = open ? head : lastContentRef.current.head
  const renderedChildren = open ? children : lastContentRef.current.children

  // stops:合併 minHeightPx(若有)與 snapPoints 成單一「離頂部距離 px」
  // 陣列,由大到小排序(索引 0 展開最少、最後一項展開最多)——內部拖曳/
  // 吸附邏輯統一用這份陣列運算,不用分別處理 minHeightPx 與 snapPoints
  // 兩種來源。minHeightPx 是固定高度(不是離頂部距離),換算成「離頂部
  // 距離」需要知道面板容器的實際高度,這裡用 panelRef 量測(見下方
  // containerHeightRef);量測結果還沒進來前(尚未 mount)暫時當作 0,
  // 只影響第一次渲染的極短暫瞬間,不影響實際互動。
  const containerHeightRef = useRef(0)
  const minHeightAsTop = minHeightPx != null ? Math.max(0, containerHeightRef.current - minHeightPx) : null
  const stops = minHeightAsTop != null ? [...snapPoints, minHeightAsTop].sort((a, b) => b - a) : snapPoints
  const isSingleStop = stops.length <= 1

  // 拖曳手勢:startYRef 記錄手勢起點,dragOffset 是這次拖曳的即時位移
  // (拖曳中即時跟手,鬆手後歸零,單位 px)。startTopRef 記錄手勢開始
  // 當下面板頂部離螢幕頂部的距離(px),讓拖曳中即時距離 =
  // 起始距離 - 位移(手指往上拉,距離變小,面板展開更多)。
  const startYRef = useRef<number | null>(null)
  const startTopRef = useRef(0)
  const draggingRef = useRef(false)
  const [dragOffset, setDragOffset] = useState(0)

  // entered:首次出現時「整張卡片從螢幕下方滑入」的進場動畫旗標——參考
  // Vaul(react bottom sheet 函式庫)的做法:掛載當下先讓 panel 停在
  // translateY(100%)(位移到畫面外),下一個 requestAnimationFrame 才切到
  // translateY(0)觸發 CSS transition 播放滑入動畫,而不是像瀏覽器預設
  // 掛載時就用最終樣式那樣直接「憑空出現」,不論段數一律共用同一套進場
  // 位移邏輯。open 從 false 變 true 時重新觸發(對齊「重新出現」也要有
  // 進場動畫,不是只有第一次掛載)。
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

  const currentTop = stops[activeSnapIndex] ?? stops[0] ?? 0

  const panelRef = useRef<HTMLDivElement>(null)
  // 只在「開啟」那一刻量測一次容器高度,不是每次 render 都重新讀取
  // DOM——原本沒有依賴陣列,每次 render(含拖曳中的每一幀、entered 進場
  // 動畫的每一次狀態變化)都會強制瀏覽器同步計算一次 layout 才能回傳
  // clientHeight(layout thrashing),這個同步 reflow 剛好跟 sheet 自己
  // 的 top/transform CSS transition 動畫同時發生,連帶讓同一個渲染批次
  // 裡的地圖(GeoOutlinePhoneView 的 Google Maps 實例)也被迫重新計算
  // 一次尺寸,視覺上出現地圖跟著偏移(使用者實測回報「對話滑出時還會
  // 影響地圖」)。只有真的需要用到量測結果的情境(minHeightPx 存在時)
  // 才需要它,且只需要在 open 變 true 的那一刻量一次即可,不需要隨拖曳
  // 或動畫每一幀重算。
  useEffect(() => {
    if (open && panelRef.current) {
      containerHeightRef.current = panelRef.current.parentElement?.clientHeight ?? window.innerHeight
    }
  }, [open])

  function onTouchStart(e: ReactTouchEvent) {
    startYRef.current = e.touches[0].clientY
    startTopRef.current = currentTop
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startYRef.current === null) return
    const delta = e.touches[0].clientY - startYRef.current

    if (isSingleStop) {
      // 只能往下拖(delta >= 0)——理由同 useDragToClose 的原始寫法。
      setDragOffset(Math.max(0, delta))
    } else {
      // 多段模式:即時位移量(px)直接當跟手的距離變化量,不需要再乘以
      // 任何比例(離頂部距離本身就是 px 單位,跟觸控座標同一個量綱)。
      setDragOffset(delta)
    }
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (isSingleStop) {
      if (dragOffset > 60) onClose()
      setDragOffset(0)
    } else {
      const minTop = stops[stops.length - 1]
      const maxTop = stops[0]
      const rawTop = startTopRef.current + dragOffset
      const clampedTop = Math.min(maxTop, Math.max(minTop, rawTop))
      const startIndex = stops.indexOf(startTopRef.current)

      // 吸附規則(使用者明確要求的設計,非 Vaul 的距離最近判斷)——
      // dragOffset > 0 代表往下拖(面板頂部離螢幕頂部的距離變大,展開
      // 變少),dragOffset < 0 代表往上拖(距離變小,展開變多)——跟觸控
      // Y 座標差的方向一致,不像舊版(vh 高度)需要額外反號。
      //  - 起點是索引 0(展開最少的段):只要有往上拖的動作(dragOffset
      //    < 0,不論拉多遠/多快),一律吸附到相鄰的下一段(展開更多)
      //    ——沒有容忍帶,拉了就走。
      //  - 起點是最後一個索引(展開最多的段):同理,只要有往下拖
      //    (dragOffset > 0)就吸附到相鄰的上一段(展開較少)。
      //  - 起點是中繼點(其餘所有段):有 ±MID_SNAP_TOLERANCE_PX 的容忍
      //    帶——結束時的距離落在容忍帶內,彈回原本的中繼點;落在容忍帶
      //    之外,依方向(往上拖/往下拖)吸附到相鄰的下一段/上一段。
      let nearestIndex: number
      if (startIndex === 0) {
        nearestIndex = dragOffset < 0 ? 1 : 0
      } else if (startIndex === stops.length - 1) {
        nearestIndex = dragOffset > 0 ? stops.length - 2 : startIndex
      } else if (Math.abs(clampedTop - startTopRef.current) <= MID_SNAP_TOLERANCE_PX) {
        nearestIndex = startIndex
      } else if (dragOffset < 0) {
        nearestIndex = startIndex + 1
      } else {
        nearestIndex = startIndex - 1
      }
      onSnapIndexChange?.(nearestIndex)
      setDragOffset(0)
    }
    startYRef.current = null
  }

  // panelTop:面板實際套用的「離頂部距離」(px)——跟手拖曳中即時反映
  // startTopRef + dragOffset(夾在範圍內),放開手指後(dragOffset 已
  // 歸零)回到 currentTop。這裡曾經誤寫成減號,導致拖曳方向整個相反
  // (使用者實測回報「拉動時的方向是不是有相反」)——dragOffset 直接
  // 等於觸控 Y 座標的變化量(見 onTouchMove,往上拖 delta 為負,往下拖
  // 為正),而「離頂部距離」的變化方向跟觸控 Y 座標變化方向一致:往上拖
  // (dragOffset < 0)時離頂部距離要變小(面板展開更多、頂部往上移動),
  // 往下拖(dragOffset > 0)時離頂部距離要變大(展開變少),所以是加號
  // 不是減號。這個值套在 CSS 的 top(搭配呼叫端 panelStyle 給的
  // bottom: 0),不用 height——top + bottom: 0 讓瀏覽器自己算出實際
  // 高度,不需要這個元件自己量測視窗高度做百分比換算,天然適應不同裝置
  // (使用者明確要求的「離頂部/離下方距離」設計)。
  const panelTop = draggingRef.current
    ? Math.min(stops[0], Math.max(stops[stops.length - 1], startTopRef.current + dragOffset))
    : currentTop

  // 是否目前停在展開最少的那個段(對齊原本 expand-collapse 設計的
  // 「收合」狀態,見元件開頭的說明)——只有這個狀態才隱藏 body、不顯示
  // backdrop。單段模式時 activeSnapIndex 恆為 0,isAtMinSnap 因此恆為
  // true——但這不影響單段模式的視覺(該模式原本就沒有「收合成只剩標頭」
  // 這個中間態,拖到底直接觸發 onClose,不會停在這個狀態久到讓
  // .panelCollapsed 的隱藏 body 視覺生效)。
  const isAtMinSnap = !draggingRef.current && activeSnapIndex === 0

  // translate:關閉時整個位移出畫面(100% + dragOffset,對齊
  // useDragToClose 原本的算法),開啟且已完成進場動畫(entered)時歸 0
  // (展開程度變化交給 panelTop 呈現,拖曳中的跟手位移則由 dragOffset
  // 反映在 panelTop 本身,不透過 translate),entered 之前維持在畫面外
  // (100% + dragOffset)——讓首次出現時整張卡片從螢幕下方滑入,而不是
  // 原地长高。
  const translate = !open
    ? `calc(100% + ${dragOffset}px)`
    : entered
      ? '0px'
      : '100%'
  // transition:拖曳中關掉動畫(即時跟手),放開手指後才套用「回彈到位」
  // 動畫——top 跟 transform 套同一條曲線跟時長(見上方
  // SHEET_EASE/SHEET_DURATION 的說明),避免不同步的違和感。
  const transition = draggingRef.current
    ? 'none'
    : `top ${SHEET_DURATION} ${SHEET_EASE}, transform ${SHEET_DURATION} ${SHEET_EASE}`

  // backdrop 顯示條件:展開時顯示、收合到最小段時不顯示(見上方
  // showBackdrop prop 的說明)。單段模式(isSingleStop)時 isAtMinSnap
  // 恆為 true(見上方說明),若沿用這個條件會變成「backdrop 永遠不顯示」
  // ——跟原本'slide-close'模式「backdrop 只要 open 就顯示」的既有行為
  // 不符,故單段模式不看 isAtMinSnap,只看 open && showBackdrop。
  const backdropVisible = isSingleStop ? open && showBackdrop : open && showBackdrop && !isAtMinSnap

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
        className={`${styles.panel}${panelClassName ? ` ${panelClassName}` : ''}${!isSingleStop && isAtMinSnap ? ` ${styles.panelCollapsed}` : ''}`}
        style={{
          top: `${panelTop}px`,
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
        {/* body:停在最小段時隱藏(單段模式不適用,見上方 .panelCollapsed
            的 CSS 說明),其餘情況永遠顯示。loading 為 true 時顯示置中
            轉圈動畫取代 children——讓呼叫端可以先把面板打開(例如使用者
            按下某個會觸發非同步查詢的入口),資料還沒回來前先顯示這個,
            不用自己在每個 children 裡各刻一份 loading 畫面(見上方
            loading prop 的說明)。 */}
        <div className={styles.body}>
          {loading ? <div className={styles.spinner} aria-label="載入中" /> : renderedChildren}
        </div>
      </div>
    </>
  )
}
