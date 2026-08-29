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
// SNAP_TOLERANCE_PX:拖曳結束時的位移量在這個門檻(px)內一律彈回原本的
// 段,不切換段/不關閉——所有段(不論單段模式、多段模式的最頂/最底/中繼
// 段)統一套用同一個容忍帶,沒有例外(使用者明確要求「不管單段多段,都
// 是關卡點移動 60,中間應該要往上有 60 往下也有 60,最上方也是往下
// 60」)——原本最頂/最底段是「沒有容忍帶,拉了就走」,跟中繼段的防手滑
// 邏輯不一致,已統一。單段模式的 finishDrag 分支沿用同一個常數(原本
// 就是寫死 60,現在改讀這個常數,理由同上,值不變)。
const SNAP_TOLERANCE_PX = 60

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
  // keepMounted:true 時 shouldRender 恆為 true,不論 open 值為何,不走
  // exitDurationMs 那套「延遲一段時間後才卸載」的邏輯——children 永遠
  // 留在 DOM 上,open 變 false 只用 translateY 位移到畫面外隱藏,不會被
  // React 拔掉。用於呼叫端把某個需要維持連線/內部 state 的元件(例如
  // ChatScreen,要避免每次開關對話都重新連線 WebSocket)直接放進
  // children 的情境——這樣不需要額外透過 React Portal 把該元件從別處
  // 投影進來(見 PhoneContent.tsx 對話疊加層原本的 mainChatSlotNode/
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
  keepMounted = false,
  isTopmost = true,
  stackOffsetPx = 0,
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

  // bodyRef:.body 是否接收原生捲動由 CSS overflow 屬性直接切換(見下方
  // bodyOverflow),不是 JS 攔截 touch 事件模擬——曾經嘗試用 JS 手動改
  // scrollTop 模擬捲動(搭配 .panel/.body 都設 touch-action: none 擋掉
  // 原生行為),但使用者實測(含真實手機,不是只有 DevTools 模擬)回報
  // 「sheet 拖曳跟清單捲動兩者會同時被觸發」——touch-action: none 只能
  // 降低瀏覽器接管的機率,無法保證瀏覽器完全不會在某些情境下仍嘗試原生
  // 捲動這個 overflow 容器,兩套手勢系統(JS 模擬 + 瀏覽器原生)在同一個
  // DOM 節點上互搶,沒有辦法做到真正互斥。改成完全不用 JS 模擬,情境
  // 未到最頂段時直接把 .body 設成 overflow: hidden(內容在 DOM 層級就
  // 不可能被捲動,不需要依賴 touch-action 去「勸阻」瀏覽器),到了最頂段
  // 才切回 overflow-y: auto 交給瀏覽器原生捲動——兩態互斥且由瀏覽器自己
  // 保證,不會再有兩套邏輯同時搶一次觸控手勢的問題。
  const bodyRef = useRef<HTMLDivElement>(null)

  // hasOpenedRef:是否曾經真正 open 過——keepMounted 的呼叫端(如
  // PhoneContent.tsx 的對話疊加層)首次掛載時 open 就是 false,這個元件
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
    // 事件起點若落在 .body 內部,交給 bodyOnTouchStart 判斷(見下方)——
    // 這裡只處理起點在 .body 之外的情況(拖曳把手/標頭),不能無差別用
    // atMaxExpansion 擋掉整個 .panel,那樣會連帶讓單段模式的拖曳把手
    // 也失效(冒泡上來的事件一樣會被這裡擋住)。
    if (atMaxExpansion && bodyRef.current?.contains(e.target as Node)) return
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
    finishDrag()
  }

  // bodyOnTouchStart/Move/End:只在展開最多的那個段掛在 .body 上(見下方
  // JSX),負責「已經捲到清單最上面(scrollTop <= 0)時,繼續往下拖要能
  // 收合 sheet」這個交接——使用者明確要求「捲動到頂時,sheet 又可以往下
  // 拉動」。平常(scrollTop > 0,或往上拖看更多內容)完全不介入,讓
  // .body 的 overflow-y: auto 走真正的原生捲動(見上方 atMaxExpansion
  // 的說明,不用 JS 模擬)。一旦偵測到「起點就在頂部且往下拖」,呼叫
  // preventDefault() 擋掉這次手勢接下來的原生捲動(這個節點此時
  // touch-action 是預設的 auto,不像 .panel 那樣整段禁用原生手勢,才需要
  // 在這裡主動擋),改交給跟 .panel 共用的同一套 draggingRef/dragOffset
  // 拖曳邏輯,行為與「非最頂段時直接拖曳」完全一致。
  const bodyDragHandoffRef = useRef(false)
  function bodyOnTouchStart(e: ReactTouchEvent) {
    if (!atMaxExpansion) return
    startYRef.current = e.touches[0].clientY
    startTopRef.current = currentTop
    bodyDragHandoffRef.current = false
  }
  function bodyOnTouchMove(e: ReactTouchEvent) {
    if (!atMaxExpansion || startYRef.current === null) return
    const body = bodyRef.current
    const delta = e.touches[0].clientY - startYRef.current

    if (!bodyDragHandoffRef.current) {
      if (draggingRef.current) {
        // 已經交接過、正在拖 sheet——後續的移動事件不再重新判斷,固定
        // 繼續拖曳(避免手勢中途因為 scrollTop 讀值時機不同又跳回捲動)。
        bodyDragHandoffRef.current = true
      } else if (delta > 0 && (!body || body.scrollTop <= 0)) {
        // 起點就在頂部(或還沒有真正捲動過)且往下拖——交接給 sheet 拖曳。
        bodyDragHandoffRef.current = true
        draggingRef.current = true
      } else {
        // 其餘情況(還沒捲到頂、或往上拖看更多內容)交給原生捲動,不介入。
        return
      }
    }

    if (!draggingRef.current) return
    e.preventDefault()
    // 單段模式只能往下拖(比照 onTouchMove 的 isSingleStop 分支)——交接
    // 條件本身已限制 delta > 0 才會交接,但交接後使用者可能中途把手指
    // 往上推回去,這裡同樣要夾住下限,避免面板被往上推超出原位置。
    setDragOffset(isSingleStop ? Math.max(0, delta) : delta)
  }
  function bodyOnTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    bodyDragHandoffRef.current = false
    finishDrag()
  }

  // finishDrag:onTouchEnd 的共用收尾邏輯——.panel 的 onTouchEnd 與
  // .body 的 bodyOnTouchEnd 都需要同一套「鬆手後依 dragOffset 決定吸附
  // 到哪一段(或單段模式時是否觸發 onClose)」判斷,抽出來避免兩處各自
  // 重複一份。
  function finishDrag() {
    if (isSingleStop) {
      if (dragOffset > SNAP_TOLERANCE_PX) onClose()
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
  // PhoneContent.tsx 的對話疊加層)在 open=false 時面板仍會渲染,但這時
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
        ref={panelRef}
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
        {/* body:停在最小段時隱藏(單段模式不適用,見上方 .panelCollapsed
            的 CSS 說明),其餘情況永遠顯示。loading 為 true 時顯示置中
            轉圈動畫取代 children——讓呼叫端可以先把面板打開(例如使用者
            按下某個會觸發非同步查詢的入口),資料還沒回來前先顯示這個,
            不用自己在每個 children 裡各刻一份 loading 畫面(見上方
            loading prop 的說明)。bodyScrollable/onTouch*:只在展開最多
            的那個段疊加(見上方 atMaxExpansion/bodyOnTouchStart 等的
            說明),交給真正的原生捲動,不影響其餘段落維持 overflow:
            hidden、完全不接收觸控事件的預設行為。 */}
        <div
          className={`${styles.body}${atMaxExpansion ? ` ${styles.bodyScrollable}` : ''}`}
          ref={bodyRef}
          onTouchStart={bodyOnTouchStart}
          onTouchMove={bodyOnTouchMove}
          onTouchEnd={bodyOnTouchEnd}
        >
          {loading ? <div className={styles.spinner} aria-label="載入中" /> : renderedChildren}
        </div>
      </div>
    </>
  )
}
