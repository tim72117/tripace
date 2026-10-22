import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import { X } from 'lucide-react'
import { useElementHeight } from '../hooks/useElementHeight'
import { useStableCallback } from '../hooks/useStableCallback'
import styles from './PhoneBottomSheet.module.css'

// SheetHead:標準 head slot 版面骨架(左側標題區 + 右側動作列 + 關閉鈕),
// 供呼叫端直接帶入 PhoneBottomSheet 的 head prop——使用者明確要求「用
// 相同樣式的 head」,原本 geo-planning/GeoOutlinePhoneListDrawer.tsx、
// timeline/PhoneTimelineDrawer.tsx、trip/phone/TripList.tsx
// 各自在呼叫端重複刻一份同樣結構的 JSX(或完全不帶 head、只能靠拖曳
// 關閉),收斂成這個元件,往後新增一個 bottom sheet 只需要帶
// title/onClose 兩個 prop。
//
// 2026-10 擴充(使用者明確要求「SheetHead 內可以自行放置 button,但是
// layout 要共用,像是業界 UI 套件那樣的設計模式」,對齊
// components/FloatingPanel.tsx/PanelHead.tsx 的 headerAction 插槽同一套
// 設計思路):
//   - title 從 string 放寬成 ReactNode——左側標題區不再侷限於一行純
//     文字,可以放副標題、badges、分類篩選 chip 列等任意內容(見
//     geo-planning/GeoOutlinePhoneInfoSheet.tsx 的實際需求:名稱+副標+
//     badges+chips 這種多行複合結構)。純字串呼叫端(其餘六個既有呼叫
//     端)不需要改動既有呼叫方式——下方用 typeof title === 'string'
//     判斷,字串時自動包一層 .title(既有的 18px/700 字級樣式),維持
//     這六個呼叫端原本的視覺不變;傳入非字串(自訂 JSX)時,不強制套用
//     這份文字樣式——呼叫端此時通常是整段複合結構(標題+副標+badges),
//     套上單一文字樣式反而不合適,排版完全交給呼叫端自己決定。
//   - 新增 actions 插槽:選填 ReactNode,渲染在關閉鈕左邊(同一排動作
//     列),只在呼叫端有傳入時才渲染對應的 wrapper——這讓
//     GeoOutlinePhoneInfoSheet.tsx 的「加入行程」icon 按鈕這類額外動作
//     可以沿用這份共用骨架,不需要整個放棄 SheetHead、自己重新刻一份
//     只為了多塞一顆按鈕。
// 這兩個擴充讓原本「head 內容結構不同」就必須整個繞開共用元件的呼叫端
// (GeoOutlinePhoneInfoSheet.tsx)也能改用 SheetHead,統一 layout(間距/
// 對齊方式/關閉鈕位置)同時保留放置任意內容的彈性——呼叫端只需要決定
// 「標題區放什麼」「要不要加額外動作」,不需要重新刻一份 .head/.closeBtn
// 骨架。
export function SheetHead({
  title,
  actions,
  onClose,
}: {
  title: ReactNode
  // actions——選填,渲染在關閉鈕左邊的額外動作(例如「加入行程」icon
  // 按鈕)。沒有傳入時這個位置完全不佔版面,不影響既有呼叫端的版面。
  actions?: ReactNode
  onClose: () => void
}) {
  return (
    <div className={styles.head}>
      <div className={styles.titleArea}>
        {typeof title === 'string' ? <span className={styles.title}>{title}</span> : title}
      </div>
      <div className={styles.headActions}>
        {actions}
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// SheetBodyContext/SheetBody——2026-10 新增(使用者明確要求「要類似
// Vaul/react-modal-sheet 那種具名元件表達捲動/拖拉交接,而不是散落在
// 樣式/隱含邏輯裡」):原本「捲到頂繼續往下拖要能收合 sheet」這整套交接
// 判斷(atMaxExpansion/scrollTop/bodyDragHandoffRef)完全藏在
// PhoneBottomSheet 內部,無條件套用在 children 外層那個固定的 .body
// div 上——呼叫端的 JSX 完全看不出「這塊內容會不會參與拖拉交接」,只能
// 翻這個檔案的實作細節才知道規則,這正是使用者回報「好幾個 bottom
// sheet,拉動時的反應都不一樣」的根本原因之一:呼叫端沒有宣告的能力,
// 要嘛整塊 children 都被套用同一套規則,要嘛得去改共用元件本身。
//
// 改成 SheetBody 具名子元件(業界常見的 Compound Component 模式,
// 對照 react-modal-sheet 的 <Sheet.Scroller>、Radix UI 用具名子元件取代
// 一長串 boolean prop 的設計思路):呼叫端在 children 裡明確寫
// `<SheetBody>...</SheetBody>` 才會套用「捲到頂可以往下拖收合」這個
// 行為,不寫就是普通內容、不參與任何拖拉交接判斷。PhoneBottomSheet 不再
// 自動幫 children 包一層 .body,呼叫端自己決定要不要用、放在哪裡。
//
// SheetBody 需要讀取/寫入的狀態(atMaxExpansion、draggingRef、
// startYRef/startTopRef/startIndexRef、dragOffset、finishDrag)都是
// PhoneBottomSheet 內部私有的拖曳狀態,不透過一般 props 往下傳(那樣
// 呼叫端又要手動轉接一堆內部實作細節,等於換湯不換藥)——改用 React
// Context,PhoneBottomSheet 是唯一的 Provider,SheetBody 是唯一合法的
// Consumer,中間不會有第三方誤用這個 context 的疑慮(沒有對外匯出
// useContext hook,只匯出 SheetBody 這個元件本身)。
interface SheetBodyContextValue {
  atMaxExpansion: boolean
  isSingleStop: boolean
  draggingRef: React.MutableRefObject<boolean>
  startYRef: React.MutableRefObject<number | null>
  startTopRef: React.MutableRefObject<number>
  startIndexRef: React.MutableRefObject<number>
  // currentTop/activeSnapIndex 用函式讀取(而非直接放值)——這兩個值
  // 每次 render 都可能改變,SheetBody 的事件處理常式用原生
  // addEventListener 綁定(理由同原本 bodyOnTouchMove 的完整說明:
  // React 17+ 的 passive listener 預設值問題),不是每次 render 都重新
  // 綁定,若直接把當下這一輪的值放進 context 物件,處理常式閉包住的會是
  // 綁定當下那一輪的舊值(stale closure)。改成傳函式,事件觸發當下呼叫
  // 才能讀到最新值——這個函式本身每次 render 都重新建立沒關係,因為
  // SheetBody 不需要靠它觸發重新綁定 effect(只在觸控事件發生當下呼叫,
  // 不放進任何依賴陣列)。
  getCurrentTop: () => number
  // getMaxIndex——atMaxExpansion 成立時,這次交接的起點索引固定是
  // stops.length - 1(展開最多的那個段,見 PhoneBottomSheet 內部
  // atMaxExpansion 的完整說明)。SheetBody 自己不知道 stops 陣列長度,
  // 用函式讀取理由同 getCurrentTop(避免 stale closure)。
  getMaxIndex: () => number
  setDragOffset: (value: number) => void
  finishDrag: () => void
  // registerBodyRef——把 SheetBody 自己管理的 bodyRef 回報給
  // PhoneBottomSheet,讓它的 onTouchStart(head/拖曳把手那組)能判斷
  // 「事件起點是否落在 body 內部」(見下方 PhoneBottomSheet onTouchStart
  // 的完整說明,這是原本 bodyRef 要解決的同一個問題,只是現在 bodyRef
  // 的擁有者換成 SheetBody 自己)。
  registerBodyRef: (el: HTMLDivElement | null) => void
}
const SheetBodyContext = createContext<SheetBodyContextValue | null>(null)

// useIsInsideSheetBody——2026-10 新增(使用者明確要求「業界會在元件內
// 規範上層元件要有什麼規範才能正確運作的這種規範模式嗎」「目前有哪些
// 元件適合這種規範」,盤點後確認 SheetBody↔ScrollArea 這組關係是目前
// 唯一真正適合投資這個模式的候選,見下方 ScrollArea.tsx 實際使用處的
// 完整說明):對外匯出的唯一用途是讓其他共用元件(目前只有 ScrollArea)
// 能偵測「自己是不是被渲染在 SheetBody 管轄的子樹裡」,藉此在開發模式
// 主動警告「這裡不該疊加兩層各自管理 overflow/touch-action 的捲動
// 容器」(對齊 Radix UI 的做法:元件掛載時主動檢查自己期待的環境條件
// 是否成立,不成立就在 console 警告,而不是放著讓使用者自己去讀文件/
// 猜測、或是等實機測試才發現視覺衝突——這個專案已經踩過一次真實案例,
// 見 user/SettingsScreen.tsx 的 ScrollArea 用法)。
//
// 刻意不直接匯出 SheetBodyContext 本身,只匯出這個回傳單一布林值的
// hook——外部元件不需要、也不該知道 SheetBodyContext 內部有哪些欄位
// (atMaxExpansion/draggingRef 等都是 PhoneBottomSheet/SheetBody 之間
// 的私有實作細節,見該 interface 的完整說明),只需要回答「我在不在
// SheetBody 管轄範圍內」這一個問題,避免外部誤用/讀取不該讀的內部
// 狀態。
export function useIsInsideSheetBody(): boolean {
  return useContext(SheetBodyContext) !== null
}

// SheetBody——宣告「這塊內容是可捲動、且捲到頂時可以往下拖交接給 sheet
// 收合」的具名插槽。對齊 react-modal-sheet 的 <Sheet.Scroller>:呼叫端
// 只需要知道「這是放可捲動內容的地方」,不需要知道任何 scrollTop/
// touch-action 的實作細節。必須渲染在 PhoneBottomSheet 的 children 裡
// 才能拿到 context(見下方 useContext 的 guard),用法:
//   <PhoneBottomSheet ...>
//     <SheetBody>{長內容,例如清單/捲動區域}</SheetBody>
//   </PhoneBottomSheet>
// 不需要用 SheetBody 包起來的情境(例如內容本身固定高度、不需要捲動,
// 像是一個簡短的表單):children 直接放普通內容即可,不會被任何拖拉
// 交接邏輯影響,也不會收合到最小段時被隱藏(見下方 PhoneBottomSheet
// 對「停在最小段只顯示 head」這個行為的完整說明——目前只有用了
// SheetBody 的內容才會被隱藏,普通內容會持續顯示,呼叫端若需要「收合時
// 隱藏」的行為,應該用 SheetBody 包住)。
export interface SheetBodyProps {
  children: ReactNode
  // loading——true 時顯示置中轉圈動畫取代 children(搬自原本
  // PhoneBottomSheetProps.loading,見 StandaloneSheet 等呼叫端的完整
  // 說明:這個機制只對「有內容可以載入」的 SheetBody 有意義,其餘不需要
  // 捲動/交接行為的普通內容不會用到,收斂到這裡而非留在
  // PhoneBottomSheetProps 上)。讓呼叫端可以先把面板打開(例如使用者
  // 按下某個會觸發非同步查詢的入口),資料還沒回來前先顯示這個,不用
  // 自己在每個 children 裡各刻一份 loading 畫面。省略則不顯示,照常
  // 渲染 children(預設行為不變)。
  loading?: boolean
}

// forwardRef——2026-10 新增:使用者指出至少 timeline/PhoneTimelineDrawer.tsx
// 這類呼叫端需要拿到內部捲動容器的 DOM 節點做程式化捲動(開啟時自動
// 捲到「今天」那一列,見該檔案的完整說明)——原本直接用 <ScrollArea
// ref={bodyRef}> 達成,但 ScrollArea 自己固定 overflow-y: auto(見該
// 元件的完整說明:「捲動本身」跟 PhoneBottomSheet 的拖拉交接開關是刻意
// 分開的兩個概念),若在 SheetBody 外面疊一層 ScrollArea,會跟 SheetBody
// 內部「未到頂段 overflow:hidden、到頂才 auto」的切換邏輯衝突(兩層
// overflow 容器互相干擾,拖拉交接判斷可能錯亂)。改成讓 SheetBody 自己
// 透過 forwardRef 暴露內部捲動容器的 ref,取代 ScrollArea 的角色——
// 呼叫端原本掛在 ScrollArea 上的 ref 直接掛到 SheetBody 上即可,不需要
// 額外再包一層捲動容器。
export const SheetBody = forwardRef<HTMLDivElement, SheetBodyProps>(function SheetBody(
  { children, loading = false },
  forwardedRef,
) {
  const ctx = useContext(SheetBodyContext)
  const bodyRef = useRef<HTMLDivElement>(null)
  // bodyDragHandoffRef:同一塊內容自己的「這次手勢是否已經交接給 sheet
  // 拖曳」旗標——理由同原本 PhoneBottomSheet.tsx 內部版本的完整說明:
  // 已經交接過就固定繼續拖曳,避免手勢中途因為 scrollTop 讀值時機不同
  // 又跳回捲動判斷。
  const bodyDragHandoffRef = useRef(false)

  // useImperativeHandle——把內部 bodyRef 這份「唯一真正的 DOM 節點」
  // 暴露給呼叫端的 forwardedRef,讓外部可以做 scrollTo 之類的程式化
  // 捲動控制(見上方 forwardRef 的完整說明)。依賴陣列空——bodyRef.current
  // 本身是 ref 物件,不需要隨 render 重新建立這個 handle。
  useImperativeHandle(forwardedRef, () => bodyRef.current as HTMLDivElement, [])

  // setBodyRef——同時寫入自己的 bodyRef(供下方 touch 事件讀 scrollTop)
  // 與回報給父層(見 registerBodyRef 的完整說明)。用 callback ref 而非
  // 兩個 useEffect 分別處理,確保兩邊永遠同步、不會有時序落差。
  function setBodyRef(el: HTMLDivElement | null) {
    ;(bodyRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    ctx?.registerBodyRef(el)
  }

  if (!ctx) {
    // 防禦性處理:理論上不該發生(呼叫端照文件用法一定在
    // PhoneBottomSheet 的 children 裡),但沒有 context 時不該整頁壞掉
    // ——退化成單純渲染 children,不接任何拖拉交接邏輯,比丟出例外更
    // 安全(呼叫端若真的誤用,頂多是少了收合手勢,不是整個畫面白屏)。
    return <div className={styles.body} ref={setBodyRef}>{children}</div>
  }

  const {
    atMaxExpansion, isSingleStop, draggingRef, startYRef, startTopRef, startIndexRef,
    getCurrentTop, getMaxIndex, setDragOffset, finishDrag,
  } = ctx

  function onTouchStart(e: TouchEvent) {
    if (!atMaxExpansion) return
    startYRef.current = e.touches[0].clientY
    startTopRef.current = getCurrentTop()
    // startIndexRef——這個交接只在 atMaxExpansion(已經停在 stops 陣列
    // 最後一個索引,見 PhoneBottomSheet 的完整說明)才會觸發,起點索引
    // 固定是 stops.length - 1,用 getMaxIndex() 取得這個值(見該 context
    // 欄位的完整說明),確保 finishDrag 讀到的 startIndexRef 永遠反映
    // 這次手勢真正的起點,不會殘留上一次 head 拖曳寫入的舊值。
    startIndexRef.current = getMaxIndex()
    bodyDragHandoffRef.current = false
  }
  function onTouchMove(e: TouchEvent) {
    if (!atMaxExpansion || startYRef.current === null) return
    const body = bodyRef.current
    const clientY = e.touches[0].clientY
    const delta = clientY - startYRef.current

    if (!bodyDragHandoffRef.current) {
      if (draggingRef.current) {
        bodyDragHandoffRef.current = true
      } else if (delta > 0 && (!body || body.scrollTop <= 0)) {
        bodyDragHandoffRef.current = true
        draggingRef.current = true
        // startYRef 重新鎖定到「交接發生當下」的座標——2026-10 修正
        // 實際回報的 bug(「拉動到頂端、sheet 開始縮合時會突然縮一大段,
        // 造成畫面抖動」):delta 原本是從 touchstart(手指一開始按下)
        // 的座標算起,但交接之所以會「延後」到這個分支才發生,正是因為
        // 剛才那段位移(scrollTop > 0 的期間)整段都被原生捲動吃掉了,
        // 完全沒有反映在 sheet 的 dragOffset 上——交接當下 delta 其實是
        // 「原生捲動吃掉的位移 + 剛才那一瞬間真正該交給 sheet 的位移」
        // 兩段加總,下方 setDragOffset(delta) 會直接把這個虛高的累積值
        // 套用上去,sheet 瞬間跳到「好像已經被拖了一大段」的位置。改成
        // 交接這一刻重設 startYRef 為目前的 clientY,讓 dragOffset 從
        // 這一刻開始重新從 0 累積,不把原生捲動已經消耗掉的那段距離
        // 算進 sheet 的拖曳位移裡。
        startYRef.current = clientY
        setDragOffset(0)
        return
      } else {
        return
      }
    }

    if (!draggingRef.current) return
    e.preventDefault()
    const handoffDelta = clientY - startYRef.current
    setDragOffset(isSingleStop ? Math.max(0, handoffDelta) : handoffDelta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    bodyDragHandoffRef.current = false
    finishDrag()
  }

  // stableOnTouchStart/Move/End——2026-10 修正實測回報的 bug(「拉動
  // body 不管哪一段、往上往下都完全沒反應」,經 fireEvent 測試套件
  // PhoneBottomSheet.dragHandoff.test.tsx 證實是 stale closure,不是
  // CSS/原生手勢競態):下方 addEventListener 原本直接綁定
  // onTouchStart/onTouchMove/onTouchEnd 這三個函式,而 useEffect 的
  // 依賴陣列只有 [atMaxExpansion, isSingleStop]——這兩個值在同一輪拖曳
  // 過程中通常不會變,導致 addEventListener 上真正掛著的,永遠是手勢
  // 開始那一刻(effect 上次真正重新執行時)的舊版 onTouchEnd,它閉包住的
  // finishDrag(來自 ctx,每次父元件 PhoneBottomSheet re-render 都重新
  // 產生、閉包著當下最新的 dragOffset)也是那一輪的舊版本——鬆手時
  // finishDrag() 讀到的 dragOffset 因此永遠停留在手勢剛開始(通常是 0)
  // 的值,落在 SNAP_TOLERANCE_PX 容忍帶內,判斷永遠是「彈回原本的
  // 段」,表現出來就是「不管怎麼拖都沒反應」。
  //
  // 2026-10 code review 修正:第一版手刻了一個 latestHandlersRef 物件
  // 包三個 handler,重造了 hooks/useStableCallback.ts 已經解決的同一個
  // 問題(該 hook 的 docstring 明講「不需要每個消費端各自重寫一份
  // xxxRef = useRef(xxx); xxxRef.current = xxx 的樣板」)——改用這支
  // 既有 hook,分別包三個 handler:回傳一個參照永遠不變、內部永遠執行
  // 最新版本邏輯的穩定函式,addEventListener 只需要綁定一次(依賴陣列
  // 固定空),不需要因為 atMaxExpansion/isSingleStop 等狀態改變而重新
  // 綁定/解綁。
  const stableOnTouchStart = useStableCallback(onTouchStart)
  const stableOnTouchMove = useStableCallback(onTouchMove)
  const stableOnTouchEnd = useStableCallback(onTouchEnd)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.addEventListener('touchstart', stableOnTouchStart, { passive: true })
    body.addEventListener('touchmove', stableOnTouchMove, { passive: false })
    body.addEventListener('touchend', stableOnTouchEnd, { passive: true })
    return () => {
      body.removeEventListener('touchstart', stableOnTouchStart)
      body.removeEventListener('touchmove', stableOnTouchMove)
      body.removeEventListener('touchend', stableOnTouchEnd)
    }
    // 依賴陣列只在 bodyRef.current 這個 DOM 節點本身改變時才需要重新
    // 綁定(例如 SheetBody 卸載/重新掛載)——stableOnTouchStart 等三個
    // 穩定函式參照本身恆定不變(useStableCallback 的設計保證),不需要
    // 也不應該在 atMaxExpansion/isSingleStop 或任何其他 state 改變時
    // 重新 add/removeEventListener,那樣做不但無助於解決 stale closure
    // (治標不治本,只是把重新綁定的時機點從「幾乎不變」換成「更頻繁但
    // 仍不保證涵蓋每一輪 render」),還會在拖曳過程中產生不必要的
    // remove/add 開銷。
  }, [stableOnTouchStart, stableOnTouchMove, stableOnTouchEnd])

  return (
    <div
      // data-testid——2026-10 新增,讓測試能穩定抓到這個節點觸發真實的
      // touch 事件(fireEvent.touchStart/touchMove/touchEnd),不需要靠
      // CSS Modules 雜湊過的 class 名稱或 DOM 結構(排除 head/dragHandle
      // 後拿剩下子節點)這類脆弱的定位方式——見
      // PhoneBottomSheet.dragHandoff.test.tsx 的完整說明。不影響任何
      // 現有邏輯/樣式。
      data-testid="sheet-body"
      className={`${styles.body}${atMaxExpansion ? ` ${styles.bodyScrollable}` : ''}`}
      ref={setBodyRef}
    >
      {loading ? <div className={styles.spinner} aria-label="載入中" /> : children}
    </div>
  )
})

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
// SNAP_TOLERANCE_PX:拖曳結束時的位移量在這個門檻(px)內一律彈回原本的
// 段,不切換段/不關閉——所有段(不論單段模式、多段模式的最頂/最底/中繼
// 段)統一套用同一個容忍帶,沒有例外(使用者明確要求「不管單段多段,都
// 是關卡點移動 60,中間應該要往上有 60 往下也有 60,最上方也是往下
// 60」)——原本最頂/最底段是「沒有容忍帶,拉了就走」,跟中繼段的防手滑
// 邏輯不一致,已統一。單段模式的 finishDrag 分支沿用同一個常數(原本
// 就是寫死 60,現在改讀這個常數,理由同上,值不變)。
const SNAP_TOLERANCE_PX = 60

// PhoneBottomSheet:手機版由下往上彈出的 bottom sheet 共用容器——抽出自
// trip/phone/TripList.tsx、geo-planning/GeoOutlinePhoneListDrawer.tsx、
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
//   trip/phone/TripList.tsx/GeoOutlinePhoneListDrawer.tsx 原本用的
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
  // keepMounted:true 時 shouldRender 恆為 true,不論 open 值為何,不走
  // exitDurationMs 那套「延遲一段時間後才卸載」的邏輯——children 永遠
  // 留在 DOM 上,open 變 false 只用 translateY 位移到畫面外隱藏,不會被
  // React 拔掉。用於呼叫端把某個需要維持連線/內部 state 的元件(例如
  // ChatScreen,要避免每次開關對話都重新連線 WebSocket)直接放進
  // children 的情境——這樣不需要額外透過 React Portal 把該元件從別處
  // 投影進來(見 phone/Content.tsx 對話疊加層原本的 mainChatSlotNode/
  // createPortal 設計),避免 portal 內容在 React 元件樹上跟這個元件是
  // 平行兄弟節點、導致觸控事件無法沿 React 樹冒泡到這裡的
  // onTouchStart/onTouchMove/onTouchEnd(使用者實測回報「對話疊加層只有
  // 標頭能拖,內容區完全拖不動」,地點清單/時間軸同樣結構但內容直接是
  // children、沒有這個問題,兩相對照後確認的根因)。與 exitDurationMs
  // 互斥,同時給的話 keepMounted 優先。預設 false,不影響既有呼叫端。
  keepMounted?: boolean
  // isTopmost:配合 components/useSheetStack.ts 的多層 sheet 堆疊管理——
  // false 代表這個 sheet 目前被壓在堆疊下層(不是使用者目前互動的那一
  // 層),套用退縮視覺(見下方 stackOffsetPx)並停用所有觸控手勢(拖曳/
  // 點擊),純粹當背景卡片顯示。預設 true,不使用堆疊管理的既有呼叫端
  // 不受影響(永遠是 true,行為與新增這個 prop 前完全相同)。
  isTopmost?: boolean
  // stackOffsetPx:isTopmost 為 false 時,這個 sheet 相對於「原本
  // panelTop 該在的位置」要往下(離頂部更遠)位移多少 px——由呼叫端依
  // 這個項目在堆疊中的深度算出(例如離頂端 1 層用 8px、2 層用 16px),
  // 讓多層堆疊時每一層都露出一小段邊緣,不會完全重疊看不出「後面還有
  // 東西」。isTopmost 為 true 時忽略這個值。
  stackOffsetPx?: number
  // onDraggingDownChange:這個 sheet 是否「正在往下拖曳」的即時回報
  // (true = 目前正往下拖;false = 沒有在往下拖,含鬆手/往上拖/根本沒在
  // 拖曳)——供呼叫端(堆疊容器,例如 geo-planning/GeoOutlinePhoneView.tsx)
  // 得知「使用者正在把這個 sheet 往下拉」這個訊號,決定要不要連動堆疊
  // 中其他層的顯示狀態(例如頂層被往下拖時,後層縮到最小段,見
  // GeoOutlinePhoneView.tsx 的接線)。這個元件本身不管跨 sheet 的堆疊
  // 互動邏輯要怎麼反應(使用者明確要求「上層容器管理交互邏輯」),只負責
  // 回報自己「正在往下拖」這個布林狀態,不回報精確位移量——呼叫端目前
  // 的需求只需要知道「有沒有在往下拖」這個粗粒度訊號,不需要逐 px 跟手
  // 連動,不做超出實際需求的精確度設計。只有 isTopmost 為 true(接收
  // 拖曳手勢的那一層)才會觸發,非頂層本身不接收手勢,沒有拖曳狀態可以
  // 回報。
  onDraggingDownChange?: (draggingDown: boolean) => void
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
  keepMounted = false,
  isTopmost = true,
  stackOffsetPx = 0,
  onDraggingDownChange,
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
  const [shouldRender, setShouldRender] = useState(open || keepMounted)
  if ((open || keepMounted) && !shouldRender) {
    setShouldRender(true)
  }
  const lastContentRef = useRef<{ head?: ReactNode; children: ReactNode }>({ head, children })
  if (open) {
    lastContentRef.current = { head, children }
  }
  useEffect(() => {
    if (keepMounted || open) return
    if (!exitDurationMs) {
      setShouldRender(false)
      return
    }
    const timer = setTimeout(() => setShouldRender(false), exitDurationMs)
    return () => clearTimeout(timer)
  }, [open, exitDurationMs, keepMounted])
  // keepMounted 時 renderedChildren/renderedHead 恆讀取即時的 props,不用
  // lastContentRef 快照——children 從不因為 open 變化而被拔除,呼叫端
  // (例如永遠掛載 ChatScreen 的對話疊加層)本身就會持續傳入同一份即時
  // 內容,不需要快照機制(那是給「open 變 false 時呼叫端已經清空資料」
  // 的情境設計的,keepMounted 情境不適用)。
  const renderedHead = keepMounted || open ? head : lastContentRef.current.head
  const renderedChildren = keepMounted || open ? children : lastContentRef.current.children

  // stops:合併 minHeightPx(若有)與 snapPoints 成單一「離頂部距離 px」
  // 陣列,索引 0 固定是收合段(minHeightPx 換算出的最小展開段)、其餘依
  // snapPoints 原始順序接續(由大到小排序的離頂部距離,見呼叫端
  // SHEET_SNAP_POINTS 的說明)——內部拖曳/吸附邏輯統一用這份陣列運算,
  // 不用分別處理 minHeightPx 與 snapPoints 兩種來源。minHeightPx 是固定
  // 高度(不是離頂部距離),換算成「離頂部距離」需要知道面板可視範圍的
  // 高度。
  //
  // 2026-10 修正(兩輪):
  // 第一輪誤判原本的 containerHeightRef(useRef)問題出在「寫入 ref 不會
  // 觸發 re-render」,改成 state + useLayoutEffect 量測 panelRef.current.
  // parentElement.clientHeight。但實測仍然空白、且拖不動——根因其實更
  // 根本:這個 sheet 的祖先容器(例如 InteractiveExploreMap.tsx 搭配
  // MobileMapReveal.tsx 的手機版地圖,展開前整個地圖用 hidden/display:none
  // 隱藏,主題卡卻在隱藏期間就已經 mount)量測當下 clientHeight 本來就是
  // 0,不管用 ref 還是 state、useEffect 還是 useLayoutEffect,量到的都是
  // 0,問題不在量測時機。
  // 第二輪根因:(1)minHeightAsTop 算出 0 時,`[...snapPoints,
  // minHeightAsTop].sort()` 把 0 排到陣列最前面沒錯,但 0 原本該代表
  // 「完全展開」(離頂部距離為 0),不是「收合段」——sort 讓索引語意隨著
  // 量測結果正確與否而翻轉,量測正確時 index 0 是收合段、量測失敗
  // (clientHeight=0)時 index 0 卻變成最接近完全展開的位置,activeSnapIndex
  // 這個數字本身沒有跟著重新映射,導致「同一個 0」在兩種情況下指向完全
  // 相反的視覺意圖;(2)collapsed 判斷(isAtMinSnap)固定看 activeSnapIndex
  // === 0,量測失敗時這個索引其實指向「展開最多」的高度,於是出現「面板
  // 卡在接近滿版的高度,卻套用 collapsed 樣式隱藏內容」這種高度與樣式
  // 對不上的矛盾;且因為這個位置已經是 stops 裡的最大值,拖曳的夾值
  // (clamp)邏輯會把它當成上限,手勢往下拖完全無法移動面板。
  //
  // 修法(第二輪):改量 window.innerHeight(視窗高度,搭配下方 resize
  // effect 保持最新)取代量測祖先容器的 clientHeight——這個 sheet
  // 本身是 position: fixed(見呼叫端 panelStyle 的完整說明),定位基準
  // 一開始就是視窗,不是任何祖先容器,window.innerHeight 不會受祖先
  // 容器是否隱藏/尚未撐開影響,從掛載當下就是正確值,沒有「量測前」的
  // 空窗期。同時不再用 sort 排序合併後的陣列,改成固定把 minHeightAsTop
  // 放在索引 0、snapPoints 原始順序接續在後——索引語意永遠固定,不隨
  // 數值大小洗牌,不會再出現語意翻轉的問題。
  //
  // 第三輪修正(code review 抓到):window.innerHeight 只對 position:
  // fixed 的呼叫端(目前只有 GeoOutlinePhoneInfoSheet.tsx)才正確——其餘
  // 傳 minHeightPx 的呼叫端(phone/Content.tsx/
  // GeoOutlinePhoneCandidateDrawer.tsx/GeoOutlinePhoneListDrawer.tsx/
  // PhoneTimelineDrawer.tsx)panelStyle 都是 position: absolute,定位
  // 基準是各自的 position: relative 祖先容器(例如 .container),不是視窗
  // ——這些容器的高度可能因為安全區域、上方固定列等因素而小於
  // window.innerHeight,若整個方案固定改用視窗高度,minHeightAsTop 算出
  // 的「離頂部距離」會對不上這些呼叫端的實際定位基準,收合段的實際像素
  // 位置偏離容器範圍。
  //
  // 改成混合量測:用 useLayoutEffect 量 panelRef.current.parentElement
  // 的 clientHeight(對 absolute 呼叫端是正確的祖先容器高度,對 fixed
  // 呼叫端的父容器高度理論上也等於視窗高度,兩者在父容器已撐開時結果
  // 一致),量到 0(代表容器目前不可見,見第一輪修正說明的空窗期問題)
  // 時 fallback 用 window.innerHeight——這個 fallback 專門解決第一輪的
  // bug(容器隱藏期間量不到正確高度),容器一旦真的撐開,下一次 open
  // 變化或呼叫端重新渲染觸發的量測就會拿到正確的祖先容器高度,不會一直
  // 停留在 fallback 值上(對 fixed 呼叫端而言,fallback 值本來就等於
  // 正確答案,不會有「卡在錯誤值」的疑慮)。
  //
  // 第四輪修正(code review 發現這套手刻邏輯跟同一輪新增的
  // hooks/useElementHeight.ts 是重複實作):上面這段「用
  // useLayoutEffect + window resize listener 手動量 clientHeight」的
  // 做法已經整段移除,改用 useElementHeight(見下方 containerRef 的
  // 完整說明)——第三輪解決的「混合量測、0 時 fallback 視窗高度」這些
  // 設計意圖都保留,只是改用 ResizeObserver 驅動,不再手刻一份
  // window resize 監聽。
  const panelRef = useRef<HTMLDivElement>(null)
  // containerRef——2026-10 code review 修正(Reuse 角度發現:
  // containerHeight 原本手刻一份「掛載時量 + window resize 時重量」的
  // 邏輯,跟同一輪新增的 hooks/useElementHeight.ts 是同一類問題的兩套
  // 重複實作)。改用 useElementHeight 量測這個 sheet 的定位祖先容器
  // (panelRef.current.parentElement)真實高度——ResizeObserver 天生
  // 持續監聽任何尺寸變化來源(不只是 window resize 事件),取代原本只能
  // 偵測「視窗尺寸改變」這一種情境的做法。
  //
  // containerRef 需要跟 panelRef 的掛載同一輪 commit 完成賦值,
  // useElementHeight 的 useEffect 才能在第一次執行時就讀到正確的
  // ref.current(理由同 phone/Content.tsx 的 tabBarRef:直接掛在
  // forwardRef 上、跟隨 React commit phase 同步賦值,不是事後才由某個
  // effect 去設置——後者會因為 useElementHeight 的依賴陣列是穩定的
  // ref 物件本身,第一次執行時讀到 null 就不會再重新 observe)。改成
  // callback ref 形式的 setPanelRef,在賦值 panelRef.current 的同一個
  // 時機點,一併把 el.parentElement 寫進 containerRef.current,兩者
  // 保證同步,不會有時序落差。
  const containerRef = useRef<HTMLElement | null>(null)
  function setPanelRef(el: HTMLDivElement | null) {
    ;(panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    containerRef.current = el?.parentElement ?? null
  }
  // measuredContainerHeight:useElementHeight 量到的父容器真實高度——
  // 初始值 0(ResizeObserver 回呼前的空窗期,見該 hook 的完整說明),
  // 這裡額外 fallback 回 window.innerHeight(理由同原本手刻版本:0
  // 代表容器目前不可見/尚未撐開,此時用視窗高度至少是一個合理的近似
  // 值,不會让後續的 minHeightAsTop 計算直接算出負值或 0)。
  const measuredContainerHeight = useElementHeight(containerRef)
  const containerHeight = measuredContainerHeight > 0 ? measuredContainerHeight : window.innerHeight
  // panelBottomPx:2026-10 新增(code review 抓到的根因,使用者實機截圖
  // 回報「旅程清單/行程清單收合段被壓縮成 35px,預期 80-100px」)——
  // 下方 minHeightAsTop 的計算公式(containerHeight - minHeightPx)原本
  // 隱含假設 panelStyle.bottom 恆為 0(也就是面板貼齊容器底部),但
  // trip/phone/TripList.tsx/timeline/PhoneTimelineDrawer.tsx 這類
  // 呼叫端的 bottom 其實是 var(--tab-bar-height)(非 0,用來避開底部
  // 常駐功能列),導致算出來的可視高度變成
  // minHeightPx - panelBottomPx,不是設計意圖的 minHeightPx。
  //
  // panelStyle 是不透明的 CSSProperties(呼叫端可能傳數字、字串、
  // calc()/var() 等任意 CSS 表達式),這個元件無法在 JS 端靜態解析
  // panelStyle.bottom 真正等於多少 px——改用 getComputedStyle 讀取
  // .panel 這個 DOM 節點的 computed style,瀏覽器會把 var()/calc() 都
  // 解析成固定的 px 字串(例如 "64px"),不管呼叫端寫的是什麼格式,量到
  // 的永遠是瀏覽器實際套用的真實值,讓下面的計算公式對任何 bottom 值
  // 恆成立,而不是像先前那樣只能在輸出層對「收合段」這個特例額外疊加
  // height 補救(那個修法沒有修正 containerHeight/minHeightAsTop 本身
  // 的座標假設,在容器高度不足的邊界情況下反而可能誤套用到展開段,見
  // code review 的完整說明)。
  const [panelBottomPx, setPanelBottomPx] = useState(0)
  // measure:只負責量 panelBottomPx(getComputedStyle 讀 bottom 的真實
  // px 值)——containerHeight 已經改用 useElementHeight(見上方
  // containerRef 的完整說明),不再需要這裡手動量測。
  //
  // 2026-10 code review 待辦(Angle A/Angle C 交叉發現,尚未修正):
  // 這裡的重新量測時機只在 open 切換或 window resize 時觸發,sheet
  // 已經開啟期間若 panelStyle.bottom 背後的 CSS 自訂屬性(例如
  // --tab-bar-height)獨立變化(不伴隨 window resize 事件,例如
  // phone/Nav 因內容/字級變化改變自身高度),panelBottomPx 不會
  // 重新量測,停留舊值——ResizeObserver 無法直接監聽 CSS 自訂屬性
  // 變化(它只能偵測元素尺寸變化,而 --tab-bar-height 改變時
  // .panel 自己的尺寸不一定跟著變,只有位置變),沒有瀏覽器原生 API
  // 可以直接訂閱 CSS 變數變化——使用者已確認這個邊界情況「晚點
  // 處理」,先維持目前這組量測時機,不在這裡動手修。
  const measure = useCallback(() => {
    const el = panelRef.current
    // getComputedStyle(el).bottom——只有在 el 已經掛載且套用了
    // panelStyle 之後才讀得到正確值;parseFloat 對 "64px" 這類字串
    // 取數值部分,對 "auto"(例如呼叫端沒設 bottom)會得到 NaN,
    // 用 Number.isFinite 檔掉,fallback 回 0(等同假設 bottom:0,維持
    // 這個元件原本的預設行為)。
    const computedBottom = el ? parseFloat(getComputedStyle(el).bottom) : 0
    setPanelBottomPx(Number.isFinite(computedBottom) ? computedBottom : 0)
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    measure()
  }, [open, measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])
  // minHeightAsTop 額外 clamp 成不小於 snapPoints 裡的最大值(code review
  // 抓到的邊界案例):下方拖曳/吸附邏輯(finishDrag/panelTop 等)全部假設
  // stops 由大到小排列、stops[0] 是「展開最少」的那一段——固定把
  // minHeightAsTop 放在索引 0(見上方完整說明,不再排序以保留固定索引
  // 語意)這個設計的前提是「收合段離頂部的距離,理當比任何展開段都更
  // 遠」,正常視窗高度下成立,但容器高度不足時(例如手機橫向模式,容器
  // 可能只有 300 多 px)containerHeight - minHeightPx - panelBottomPx
  // 可能小於 snapPoints 裡的某個值(例如 SHEET_SNAP_POINTS 的 400),
  // stops 變成 [275, 400, 80]這種不是嚴格遞減的陣列,下方假設 stops[0]
  // 是最大值/stops[length-1] 是最小值的程式碼全部會算錯(拖曳上限/
  // 下限顛倒、吸附邏輯混亂)。clamp 下限保證 minHeightAsTop 不會小於
  // 其他段,維持 stops 陣列的排序前提恆成立。
  const minHeightAsTop = minHeightPx != null
    ? Math.max(0, containerHeight - minHeightPx - panelBottomPx, ...snapPoints)
    : null
  const stops = minHeightAsTop != null ? [minHeightAsTop, ...snapPoints] : snapPoints
  const isSingleStop = stops.length <= 1

  // 拖曳手勢:startYRef 記錄手勢起點,dragOffset 是這次拖曳的即時位移
  // (拖曳中即時跟手,鬆手後歸零,單位 px)。startTopRef 記錄手勢開始
  // 當下面板頂部離螢幕頂部的距離(px),讓拖曳中即時距離 =
  // 起始距離 - 位移(手指往上拉,距離變小,面板展開更多)。
  const startYRef = useRef<number | null>(null)
  const startTopRef = useRef(0)
  // startIndexRef:2026-10 新增(修正實際回報的 bug:「拉動內容到頂時
  // sheet 不會縮小/拉動時視窗變小但不會吸附到下一段」)——finishDrag
  // 原本用 stops.indexOf(startTopRef.current) 從數值反查手勢起點的索引,
  // 這是脆弱的精確浮點數比對:stops[0](minHeightAsTop)是從
  // containerHeight(見該 state 的完整說明)動態算出來的值,而
  // containerHeight 會在 resize 事件(例如行動瀏覽器網址列伸縮、虛擬
  // 鍵盤開合)時重新量測、可能產生極小的數值差異。若這次拖曳手勢
  // 進行中(bodyOnTouchStart 記下 startTopRef.current 之後、
  // finishDrag 執行之前)剛好發生一次這類 resize、使 stops 陣列重新
  // 計算出跟手勢開始當下不完全相等的新陣列,indexOf 會找不到完全相等
  // 的數值而回傳 -1,導致 finishDrag 的吸附判斷整個算錯(收合/展開方向
  // 顛倒,或固定停在某個不正確的索引)——這解釋了「拖曳視覺有跟手,放開
  // 卻沒有吸附到正確段落」這類症狀。改成手勢開始當下就直接記錄索引本身
  // (bodyOnTouchStart/onTouchStart 當時的 activeSnapIndex),finishDrag
  // 直接讀這個索引,不再需要從可能已經漂移的數值反查,徹底避免這類浮動
  // 比對失敗。
  const startIndexRef = useRef(0)
  const draggingRef = useRef(false)
  const [dragOffset, setDragOffset] = useState(0)

  // bodyElRef:SheetBody(若呼叫端有用,見該元件的完整說明)透過
  // registerBodyRef 回報過來的 DOM 節點——這裡只需要知道它存不存在、
  // 範圍涵不涵蓋事件目標(見下方 onTouchStart 的 bodyElRef.current?.
  // contains 判斷),不需要知道它內部 overflow/scrollTop 的實作細節,
  // 那些交給 SheetBody 自己管理(.body/.bodyScrollable 這組 CSS 切換
  // 以及 scrollTop 判斷的完整理由,已經搬到 SheetBody 裡)。children 沒
  // 用 SheetBody 包住時,registerBodyRef 永遠不會被呼叫,bodyElRef 恆為
  // null,下方的 contains 判斷自然恆為 false——不影響這類呼叫端原本
  // 「整塊 children 都能被頭部手勢直接拖動」的行為(没有 SheetBody 就
  // 没有交接判斷,直接走 head 那組 onTouchStart)。
  const bodyElRef = useRef<HTMLDivElement | null>(null)

  // hasOpenedRef:是否曾經真正 open 過——keepMounted 的呼叫端(如
  // phone/Content.tsx 的對話疊加層)首次掛載時 open 就是 false,這個元件
  // 從第一次 render 開始就要位移到畫面外(translateY(100vh))。實測發現
  // 這個「從未開啟過、掛載當下就要在畫面外」的情境,即使 transform 算出
  // 的值正確,套用了 transition 動畫屬性後,瀏覽器仍會在某些情況下把
  // 首次掛載的樣式直接當成最終穩定狀態繪製,不觸發任何過渡效果——但
  // React devtools 顯示的 computed style 卻讀到位移已生效的矩陣,實際
  // 視覺(getBoundingClientRect)卻仍停在未位移的位置,兩者矛盾(使用者
  // 實測回報「一開啟手機版就看到對話匡,關不掉」,用醒目邊框直接肉眼
  // 確認面板真的佔滿整個畫面、完全沒有位移,但手動在 DevTools 把
  // transform 改成固定的 900px 卻能立刻生效)——懷疑是掛載當下「沒有
  // 真正的前一個狀態可以過渡」時,浏览器對 transition 動畫的合併/跳過
  // 優化造成的邊界案例。保守起見,「從未真正 open 過」的這段期間強制
  // transition: none,不依賴任何動畫過渡把它擺到畫面外的最終位置,確保
  // 穩定;一旦真正 open 過一次(hasOpenedRef.current 變 true),之後才
  // 恢復正常的動畫過渡(不影響「開啟中/已經開過一次後續的關閉」這些
  // 情境原本就穩定的動畫效果)。
  const hasOpenedRef = useRef(open)
  if (open) hasOpenedRef.current = true

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

  // atMaxExpansion:是否已經停在展開最多的那個段——這個狀態直接決定
  // .body 的 CSS overflow(見下方 bodyOverflow)是不是要交給瀏覽器原生
  // 捲動,不是在 JS 手勢處理常式裡才判斷。未到最頂段時 .body 是
  // overflow: hidden,這個 DOM 節點在瀏覽器眼裡根本不可捲動,onTouchStart
  // 當下這個節點就已經不會攔截任何觸控手勢,不需要再靠 JS 判斷「這次
  // 手勢該不該讓內容捲」——手勢天生只可能落在 sheet 拖曳上。到了最頂段
  // 換成 overflow-y: auto,這時要反過來完全不驅動 sheet 拖曳,把手勢
  // 讓給瀏覽器原生捲動處理,onTouchStart/onTouchMove 直接視為未在拖曳。
  //
  // 單段模式(isSingleStop)恆為 true——單段模式只有一個 snapPoints 值,
  // 這個唯一的段本身就是「展開最多」的段,語意上跟多段模式的最頂段完全
  // 一樣:內容需要能原生捲動(使用者明確要求「旅程數量多時清單還是需要
  // 能捲動」),捲到頂端後繼續往下拖要能交接給 sheet 收合。原本這裡寫成
  // `!isSingleStop && ...`,單段模式恆為 false,導致 .body 疊加的
  // bodyOnTouchStart/Move/End(見下方)整組直接失效(第一行就
  // `if (!atMaxExpansion) return`)——.body 卻同時有 ScrollArea 帶來的
  // touch-action: pan-y(內容需要捲動,不能拿掉),這組 CSS 屬性讓瀏覽器
  // 對這個節點的觸控手勢優先走原生路徑,跟 .panel 上被停用的 JS 拖曳邏輯
  // 互搶,使用者實測回報「往下拖曳時卡片完全不跟手移動,放開手指才突然
  // 關閉」——正是這個交接機制沒有生效、原生手勢又搶走事件的結果。
  const atMaxExpansion = isSingleStop || activeSnapIndex === stops.length - 1
  function onTouchStart(e: ReactTouchEvent) {
    // 事件起點若落在 SheetBody 管理的節點內,交給它自己的 onTouchStart/
    // Move/End 判斷(見該元件的完整說明)——這裡只處理起點在那塊範圍
    // 之外的情況(拖曳把手/標頭/未使用 SheetBody 的普通內容),不能無
    // 差別用 atMaxExpansion 擋掉整個 .panel,那樣會連帶讓單段模式的
    // 拖曳把手也失效(冒泡上來的事件一樣會被這裡擋住)。沒有使用
    // SheetBody 的呼叫端,bodyElRef.current 恆為 null,這個判斷恆為
    // false,行為等同「整塊 children 都能被這裡直接拖動」。
    if (atMaxExpansion && bodyElRef.current?.contains(e.target as Node)) return
    startYRef.current = e.touches[0].clientY
    startTopRef.current = currentTop
    startIndexRef.current = activeSnapIndex
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
    finishDrag()
  }

  // finishDrag:onTouchEnd 的共用收尾邏輯——這裡的 onTouchEnd 與
  // SheetBody 自己的 onTouchEnd(透過 context 呼叫)都需要同一套「鬆手後
  // 依 dragOffset 決定吸附到哪一段(或單段模式時是否觸發 onClose)」
  // 判斷,抽出來避免兩處各自重複一份。
  function finishDrag() {
    if (isSingleStop) {
      if (dragOffset > SNAP_TOLERANCE_PX) onClose()
      setDragOffset(0)
    } else {
      const minTop = stops[stops.length - 1]
      const maxTop = stops[0]
      const rawTop = startTopRef.current + dragOffset
      const clampedTop = Math.min(maxTop, Math.max(minTop, rawTop))
      // startIndex——直接讀取手勢開始當下記錄的索引(startIndexRef,見該
      // ref 宣告處的完整說明),不再用 stops.indexOf(startTopRef.current)
      // 從數值反查:那是脆弱的精確浮點數比對,stops[0] 會隨 containerHeight
      // 的 resize 重新量測而變動,手勢進行中若剛好發生一次這類 resize,
      // indexOf 會找不到完全相等的值而回傳 -1,讓後續吸附方向判斷整個
      // 算錯。
      const startIndex = startIndexRef.current

      // 吸附規則(使用者明確要求的設計,非 Vaul 的距離最近判斷)——
      // dragOffset > 0 代表往下拖(面板頂部離螢幕頂部的距離變大,展開
      // 變少),dragOffset < 0 代表往上拖(距離變小,展開變多)——跟觸控
      // Y 座標差的方向一致,不像舊版(vh 高度)需要額外反號。所有段
      // (不論起點是最頂/最底/中繼段)統一套用 ±SNAP_TOLERANCE_PX 的
      // 容忍帶——結束時的距離落在容忍帶內,彈回原本的段;落在容忍帶之外,
      // 依方向(往上拖/往下拖)吸附到相鄰的下一段/上一段。原本最頂/最底
      // 段是「沒有容忍帶,拉了就走」的例外,使用者明確要求取消這個例外,
      // 三種情況(最頂/最底/中繼)行為完全一致。
      let nearestIndex: number
      if (Math.abs(clampedTop - startTopRef.current) <= SNAP_TOLERANCE_PX) {
        nearestIndex = startIndex
      } else if (dragOffset < 0) {
        nearestIndex = Math.min(stops.length - 1, startIndex + 1)
      } else {
        nearestIndex = Math.max(0, startIndex - 1)
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
  // isTopmost 為 false 時額外疊加 stackOffsetPx——讓被壓在堆疊下層的
  // sheet 露出一小段邊緣(見 isTopmost/stackOffsetPx prop 的說明)。非
  // 頂層不接收拖曳手勢(見下方 onTouchStart 等的 isTopmost 短路判斷),
  // 這裡的 panelTop 因此不需要考慮 draggingRef 分支——非頂層時
  // draggingRef 恆為 false,天然走 currentTop 分支。
  const panelTop = (draggingRef.current
    ? Math.min(stops[0], Math.max(stops[stops.length - 1], startTopRef.current + dragOffset))
    : currentTop) + (isTopmost ? 0 : stackOffsetPx)

  // 拖曳中即時回報「是否正在往下拖」給呼叫端(見 onDraggingDownChange
  // prop 的說明)——依賴 dragOffset(state,變化會觸發這個 effect;
  // draggingRef 是 ref,不會觸發 re-render,不能當依賴)。dragOffset > 0
  // 代表往下拖(見上方 panelTop/onTouchMove 對 dragOffset 正負號方向的
  // 說明),鬆手後 dragOffset 歸零、draggingRef 變 false,這裡回報 false
  // 讓呼叫端知道「不再往下拖了」。
  useEffect(() => {
    if (!onDraggingDownChange) return
    onDraggingDownChange(draggingRef.current && dragOffset > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragOffset])

  // 是否目前停在展開最少的那個段(對齊原本 expand-collapse 設計的
  // 「收合」狀態,見元件開頭的說明)——只有這個狀態才隱藏 body、不顯示
  // backdrop。單段模式時 activeSnapIndex 恆為 0,isAtMinSnap 因此恆為
  // true——但這不影響單段模式的視覺(該模式原本就沒有「收合成只剩標頭」
  // 這個中間態,拖到底直接觸發 onClose,不會停在這個狀態久到讓
  // .panelCollapsed 的隱藏 body 視覺生效)。
  const isAtMinSnap = !draggingRef.current && activeSnapIndex === 0

  // translate:關閉時整個位移出畫面,開啟且已完成進場動畫(entered)時歸 0
  // 或反映拖曳位移(見下方單段模式說明),entered 之前維持在畫面外——讓
  // 首次出現時整張卡片從螢幕下方滑入,而不是原地长高。位移量用 100vh
  // (不是 100%)——CSS transform: translateY(百分比) 是相對於元素自身
  // 高度計算,不是相對螢幕/視窗高度;keepMounted 的呼叫端(見
  // phone/Content.tsx 的對話疊加層)在 open=false 時面板仍會渲染,但這時
  // .panelCollapsed 可能讓 .body 隱藏、面板實際高度縮得很小,100% 换算
  // 出來的實際位移距離遠遠不夠把面板推出可視範圍,導致「使用者實測
  // 回報一開啟手機版對話匡就一直陰在畫面上,點關閉也沒反應」——面板其實
  // 已經在嘗試位移,只是位移量不足以真正離開螢幕。100vh 是視窗高度的
  // 固定值,不受面板自身高度影響,足以確保任何情況下都能推出畫面外。
  //
  // 單段模式(isSingleStop)拖曳中要加上 dragOffset——多段模式的展開
  // 程度變化交給 panelTop(top 屬性)呈現,不透過 translate,但單段模式
  // 只有一個 stops 值,panelTop 的 Math.min(stops[0], Math.max(stops[0],
  // ...)) 夾出來的結果恆等於那一個值,dragOffset 完全反映不到 top 上;
  // 若 translate 也忽略 dragOffset(entered 時固定回傳 '0px'),整張卡片
  // 拖曳中會完全不跟手——使用者實測回報「往下拖曳時卡片完全不跟手
  // 移動,放開手指才突然關閉」,單段模式必須靠 translate 呈現跟手位移,
  // 這是它跟多段模式(用 panelTop)不同的呈現路徑,原本遺漏了這一段。
  const translate = !open
    ? `calc(100vh + ${dragOffset}px)`
    : entered
      ? isSingleStop
        ? `${dragOffset}px`
        : '0px'
      : '100vh'
  // transition:拖曳中關掉動畫(即時跟手),放開手指後才套用「回彈到位」
  // 動畫——top 跟 transform 套同一條曲線跟時長(見上方
  // SHEET_EASE/SHEET_DURATION 的說明),避免不同步的違和感。「從未
  // open 過」(!hasOpenedRef.current)時強制 none,不套用任何過渡——
  // 理由見上方 hasOpenedRef 的說明。
  const transition = draggingRef.current || !hasOpenedRef.current
    ? 'none'
    : `top ${SHEET_DURATION} ${SHEET_EASE}, transform ${SHEET_DURATION} ${SHEET_EASE}`

  // backdrop 顯示條件:展開時顯示、收合到最小段時不顯示(見上方
  // showBackdrop prop 的說明)。單段模式(isSingleStop)時 isAtMinSnap
  // 恆為 true(見上方說明),若沿用這個條件會變成「backdrop 永遠不顯示」
  // ——跟原本'slide-close'模式「backdrop 只要 open 就顯示」的既有行為
  // 不符,故單段模式不看 isAtMinSnap,只看 open && showBackdrop。
  // isTopmost 為 false 時一律不顯示 backdrop——同一個堆疊裡只該有最上層
  // 那個 sheet 負責遮罩背景內容(地圖等),下層的 backdrop 若也顯示,會
  // 疊加出比實際需要更暗的遮罩,且點擊 backdrop 關閉的語意也只該作用在
  // 目前真正互動中的那一層。
  const backdropVisible =
    isTopmost && (isSingleStop ? open && showBackdrop : open && showBackdrop && !isAtMinSnap)

  // shouldRender 為 false 代表退場動畫(若有)已播完、或呼叫端根本沒給
  // exitDurationMs——這個元件完全不渲染,理由見上方 shouldRender 的說明。
  // 這代表 data-testid="phone-bottom-sheet"(見下方 panel div)存在與否,
  // 就等同於 open 狀態是否成立——測試可以直接查這個節點,不需要猜呼叫端
  // 的文案內容或反查這裡的實作細節。
  if (!shouldRender) return null

  return (
    <>
      {backdropVisible && (
        <div className={styles.backdrop} style={backdropStyle} onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={setPanelRef}
        data-testid="phone-bottom-sheet"
        className={`${styles.panel}${panelClassName ? ` ${panelClassName}` : ''}${!isSingleStop && isAtMinSnap ? ` ${styles.panelCollapsed}` : ''}${isTopmost ? '' : ` ${styles.panelStacked}`}`}
        style={{
          top: `${panelTop}px`,
          transform: `translateY(${translate})`,
          transition,
          // visibility: hidden 是「從未 open 過」時的雙重保險——實測
          // 發現即使 transform 的計算值正確(DevTools 檢查 computed style
          // 確認過)、will-change: transform 也加了,keepMounted 呼叫端
          // 首次掛載時仍可能出現「元素明明該在畫面外,卻整個佔滿螢幕」
          // 的瀏覽器渲染異常(使用者實測回報「一開啟手機版就一直看到
          // 對話匡,關不掉」,多輪排查都無法用單純調整 transform/
          // transition 的寫法解決)。不再嘗試釐清瀏覽器內部合成/重繪的
          // 確切原因,改用 visibility: hidden 這個不依賴 transform 計算
          // 結果、直接讓元素完全不可見(不佔用畫面、不接收互動)的
          // 保底機制——只在「從未 open 過」這段期間套用,一旦真正 open
          // 過一次(hasOpenedRef.current 變 true),之後的關閉/收合都
          // 恢復依賴 transform 動畫(不影響「開啟中/已經開過一次後續的
          // 關閉」這些情境原本就正常的動畫效果)。
          ...(hasOpenedRef.current ? {} : { visibility: 'hidden' }),
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
        {/* SheetBodyContext.Provider——把這個元件內部的拖曳狀態暴露給
            children 裡可能有的 <SheetBody>(見該元件與 context 的完整
            說明)。直接渲染 renderedChildren,不再像原本那樣固定包一層
            .body div——呼叫端若用了 SheetBody,它自己會渲染 .body(含
            atMaxExpansion 時疊加 .bodyScrollable,交給真正的原生捲動,
            見該元件的完整說明);若呼叫端沒有使用 SheetBody(內容不需要
            捲動/拖拉交接,例如簡短表單),renderedChildren 原樣渲染,不會
            被任何 .body 相關的 CSS(含 .panelCollapsed .body 的收合
            隱藏規則)影響——這類內容在收合到最小段時會繼續顯示,這是
            刻意的差異化行為(見 SheetBody 開頭的完整說明):只有宣告成
            可捲動內容的 SheetBody 才有「收合時隱藏」的語意,固定內容
            不需要、也不該被收合邏輯影響。 */}
        <SheetBodyContext.Provider
          value={{
            atMaxExpansion,
            isSingleStop,
            draggingRef,
            startYRef,
            startTopRef,
            startIndexRef,
            getCurrentTop: () => currentTop,
            getMaxIndex: () => stops.length - 1,
            setDragOffset,
            finishDrag,
            registerBodyRef: (el) => { bodyElRef.current = el },
          }}
        >
          {renderedChildren}
        </SheetBodyContext.Provider>
      </div>
    </>
  )
}

// StandaloneSheet/StackedSheet/PersistentSheet——2026-10 新增:使用者
// 明確指出「目前有好幾個 bottom sheet,但是拉動時的反應都不一樣」,問
// 業界有什麼管理這類不一致的設計模式。盤點現有十個呼叫端後發現:
// exitDurationMs/isTopmost/keepMounted 這幾個選填 prop 的傳法分成三種
// 彼此互斥、各自合理的固定組合(不是遺漏,也不該用「全部必填」強迫
// 呼叫端假裝都一樣),改用具名工廠元件(Compound Component 模式,業界
// 常見做法,例如 Radix UI/Headless UI 用具名子元件取代一長串 boolean
// prop)收斂這三種組合——往後新增 bottom sheet 只需要判斷自己屬於哪一類
// 掛載方式、挑對應的具名元件,不可能漏傳某個該有的 prop(因為對應的
// 選項根本不存在於該元件的介面上),也不會誤用不屬於這個情境的 prop。
//
// 三種情境的判斷依據(對應下方三個元件):
//   1. 這個 PhoneBottomSheet 本身會不會因為 open 變 false 而被呼叫端
//      從 React 樹整個拔掉(條件式掛載,例如 `{open && <PhoneBottomSheet
//      .../>}`,或是雖然 PhoneBottomSheet 本身常駐但 children 是條件式
//      卸載)?──如果是,需要 exitDurationMs 讓退場滑出動畫有機會播完
//      才真正卸載,見該 prop 原始的完整說明。
//   2. 這個 sheet 有沒有需要維持連線/內部 state、不能被卸載(例如
//      WebSocket)?──如果是,用 keepMounted,children 永遠是 React 子孫
//      不會被拔掉,連 exitDurationMs 都不需要(沒有卸載這回事)。
//   3. 這個 sheet 是不是 useSheetStack 多層堆疊裡的一員(可能被壓在
//      下層)?──如果是,需要 isTopmost(必填,見下方說明)決定要不要
//      停用手勢、套用退縮視覺。
// 這三點兩兩互斥(目前十個呼叫端沒有同時符合兩種以上的情況),故設計成
// 三個平行的具名元件,而非可疊加的 mixin/flag。

// StandaloneSheet——最常見的情況:獨立開關的 sheet,不屬於任何堆疊,也
// 不需要保持連線。固定帶 exitDurationMs(見上方 PHONE_BOTTOM_SHEET_EXIT_MS
// 常數)——不論呼叫端本身是常駐掛載還是條件式掛載都安全:常駐掛載時這個
// prop 不會被用到(shouldRender 邏輯只在真的因為 open=false 且非
// keepMounted 時才會用上 exitDurationMs 的延遲,見上方 shouldRender 的
// 完整說明),條件式掛載時則確實需要它才能播完退場動畫。
// onDraggingDownChange 保留在這個介面上(不像 isTopmost/stackOffsetPx
// 被排除)——盤點時發現 GeoOutlinePhoneInfoSheet.tsx 雖然不屬於堆疊
// (不傳 isTopmost),但仍需要這個 prop 回報「正在往下拖」給
// GeoOutlinePhoneView.tsx,讓它連動下層的 GeoOutlinePhoneListDrawer 縮小
// (見該 prop 原始的完整說明)——「是否在堆疊裡」跟「要不要回報拖曳狀態」
// 是兩件獨立的事,不該因為共用同一顆具名元件就被迫綁在一起。
// 對應現有呼叫端:設定頁/配速面板/trip/phone/TripList/PhoneTimelineDrawer
// (常駐掛載)、GeoOutlinePhoneInfoSheet/geo-planning/phone/CandidateList(children
// 條件式卸載或本身條件式掛載)。
export function StandaloneSheet(
  props: Omit<PhoneBottomSheetProps, 'exitDurationMs' | 'keepMounted' | 'isTopmost' | 'stackOffsetPx'>,
) {
  return <PhoneBottomSheet {...props} exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS} />
}

// StackedSheet——useSheetStack 多層堆疊管理裡的一員(見
// components/useSheetStack.ts),可能被壓在堆疊下層、需要退縮視覺並
// 停用手勢。isTopmost 刻意設計成必填(不給預設值)——這是跟 StandaloneSheet
// 最主要的差異所在,呼叫端必須明確從 sheetStack 算出目前是不是頂層,
// 不能像 PhoneBottomSheet 本身那樣讓它預設為 true 而被無意間忽略。
// 同樣固定帶 exitDurationMs,理由同 StandaloneSheet。
// 對應現有呼叫端:GeoOutlinePhoneDateCalendarSheet/GeoOutlinePhoneListDrawer/
// GeoOutlinePhoneDatePickerSheet。
export function StackedSheet(
  props: Omit<PhoneBottomSheetProps, 'exitDurationMs' | 'keepMounted' | 'isTopmost'> & { isTopmost: boolean },
) {
  return <PhoneBottomSheet {...props} exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS} />
}

// PersistentSheet——children 需要永遠留在 React 樹上、不能被卸載的情境
// (例如 ChatScreen 的 WebSocket 連線,見 keepMounted prop 原始的完整
// 說明)。固定帶 keepMounted,不接受 exitDurationMs——keepMounted 時
// shouldRender 恆為 true,不會真的卸載,exitDurationMs 的延遲邏輯永遠
// 不會被用到,乾脆不讓呼叫端傳入以免誤會這裡也有退場延遲可以調。
// 對應現有呼叫端:對話小匡(phone/Content.tsx 的 chatSheetOpen)。
export function PersistentSheet(
  props: Omit<PhoneBottomSheetProps, 'exitDurationMs' | 'keepMounted' | 'isTopmost' | 'stackOffsetPx' | 'onDraggingDownChange'>,
) {
  return <PhoneBottomSheet {...props} keepMounted />
}
