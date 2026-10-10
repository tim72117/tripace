import { Fragment, useCallback, useRef, useState } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent, Ref, ReactNode, UIEventHandler } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bus, Car, Footprints, TrainFront } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { minutesToTime, type PlanNode, type TimeDragBounds } from './planTimeline'
import styles from './PlanTimelineView.module.css'

// TIME_DRAG_MINUTES_PER_STEP/TIME_DRAG_PX_PER_STEP——anchorDot 拖拉調整
// 時間的刻度(使用者明確要求「上下拉動時調整時間,半小時為刻度」)。
// 每拖動 TIME_DRAG_PX_PER_STEP 像素,時間前進/後退
// TIME_DRAG_MINUTES_PER_STEP 分鐘——18px 是「手感不會太遲鈍(拖一小段
// 距離就能感覺到刻度在跳動),也不會太敏感(不容易因為手滑誤觸多跳
// 好幾格)」的經驗值,不是精算出來的最佳值,之後若使用者回報拖拉手感
// 不順可以調整這個常數。往下拖(位移量為正)時間變晚,往上拖時間變早
// ——對齊時間軸「上早下晚」的既有版面直覺(見 toRenderList 由上到下
// 依時間順序排列的既有設計)。
const TIME_DRAG_MINUTES_PER_STEP = 30
const TIME_DRAG_PX_PER_STEP = 18

// clampToStep — 把分鐘數吸附到最近的 30 分鐘刻度,再 clamp 進
// [min, max] 範圍(min/max 可能不是 30 的倍數——例如前一站是 "09:15"
// 這種非刻度值,此時 clamp 的邊界本身就該是這個精確值,不需要也不該
// 把邊界本身再吸附到刻度上,那樣反而會讓使用者拖到「比邊界還極限」的
// 位置時被攔住在一個跟邊界本身有落差的刻度格上,體感是「明明還沒拖到
// 底,卻被卡住了」)。吸附用 Math.round 而非無條件捨去,讓使用者拖到
// 刻度格中點附近時能四捨五入到比較直覺的那一格。
function clampToStep(minutes: number, bounds: TimeDragBounds): number {
  const stepped = Math.round(minutes / TIME_DRAG_MINUTES_PER_STEP) * TIME_DRAG_MINUTES_PER_STEP
  const lower = bounds.minMinutes ?? 0
  const upper = bounds.maxMinutes ?? 24 * 60 - 1
  return Math.min(Math.max(stepped, lower), upper)
}

// DragState——目前正在拖拉中的節點與即時預覽值(見 anchorDot 拖拉手勢
// 的完整說明)。放在這個元件自己的 state 裡,不透過 onDragStopTime 每次
// 位移都即時回報給呼叫端——拖拉中途的高頻位移如果每次都呼叫呼叫端的
// setTimeline(進而觸發整個時間軸重新計算 toRenderList、存檔到
// localStorage),會造成不必要的效能負擔與存檔頻率;真正的提交只在
// pointer up 那一刻呼叫一次 onDragStopTime,過程中的即時顯示純粹是
//這個元件內部的 state,不影響外部的 timeline 資料。
interface DragState {
  stopId: string
  // pointerId——Pointer Capture 用,確保拖拉過程中即使手指/游標移出
  // anchorDot 本身的範圍,後續的 move/up 事件仍然會送達這個元素(見
  // handlePointerDown 的完整說明)。
  pointerId: number
  startClientY: number
  startMinutes: number
  bounds: TimeDragBounds
  previewMinutes: number
}

// dragTranslateY——anchorDot 本身在拖拉過程中跟著手勢上下位移的像素量
// (使用者明確要求「拉動時圓圈要會動,但是放開前地點卡都不要動」:
// 卡片順序/位置只在真正放開提交後才會因為 timeline 更新而改變,拖拉
// 過程中只有圓點這個純視覺元素跟著移動)。
//
// 換算依據是 previewMinutes 相對 startMinutes 的刻度差,而不是原始
// pointer 位移量本身(deltaY)——理由:displayTime 顯示的是吸附到 30 分
// 刻度、clamp 過邊界的 previewMinutes,若圓點位移用未經吸附/clamp 的
// 原始像素量,會出現「數字已經停在邊界不再變動,但圓點還跟著手指繼續
// 位移」或「數字跳了一格,圓點卻只位移一點點零頭像素」這種視覺與數字
// 對不上的割裂感。用同一份 previewMinutes 反推回像素量,圓點的移動
// 永遠跟數字同步,包括到達邊界後圓點也會跟著停住、不再繼續位移。
function dragTranslateY(state: DragState): number {
  const deltaMinutes = state.previewMinutes - state.startMinutes
  return (deltaMinutes / TIME_DRAG_MINUTES_PER_STEP) * TIME_DRAG_PX_PER_STEP
}

// TRANSIT_MODE_ICONS——交通膠囊改用 lucide icon,不再用 emoji(使用者
// 明確要求「交通行程的膠囊都不要用 emoji,都使用 icon」)。依 transit.mode
// (後端 geo_plan_ai.go iconForTransitMode 挑 emoji 用的同一份字串,見
// server/internal/api/geo_plan_ai.go 的完整說明)對照,不依賴 transit.icon
// 本身的值——後端目前仍會送 emoji 字串進這個欄位(改動後端回應格式是
// 更大範圍的破壞性變更,這裡刻意只在前端渲染層接管「怎麼顯示」,不要求
// 後端同步修改,呼叫端沒跟著升級也不會整組顯示壞掉,只是回退到預設的
// 步行圖示)。沒有命中的 mode 一律回退 Footprints(步行)——對齊後端
// iconForTransitMode 的 default case 語意(查不到就當步行處理)。
const TRANSIT_MODE_ICONS: Record<string, LucideIcon> = {
  開車: Car,
  公車: Bus,
  捷運: TrainFront,
  大眾運輸: Bus,
}

// PlanTimelineView — 2026-10 從 trip-plan/TripPlanPage.tsx 拆出來的時間軸
// 視圖本體(使用者明確要求「先將正式畫面的排程時間軸UI拆成獨立元件」),
// 放進 plan-core/ 跟 planTimeline.ts(純資料層)放在一起——這裡只負責
// 「把一條 PlanNode 陣列畫成時間軸」這件事本身(空狀態/卡片/軸線/交通/
// 備註/訊息/骨架/呼吸點/「回到最新」浮動按鈕),不含 header、composer
// 輸入框、右上角小地圖——那些是外殼頁面(TripPlanPage.tsx)自己的職責,
// 不屬於時間軸視圖。
//
// 之所以現在拆出來,是為了讓 /ai-plan 展示頁(home/plan-ai-sim/
// AIPlanTimelinePage.tsx)有機會重用同一份渲染邏輯——該檔案原本是獨立
// 複製的一份幾乎相同的 JSX,任何 UI 調整(例如 2026-10 新增的多圖瀏覽)
// 都必須兩邊分別修改才會同時生效。拆分本身分兩階段:第一階段只整理
// TripPlanPage.tsx(使用者當時明確要求先不要動 AIPlanTimelinePage.tsx);
// 第二階段(同一天,使用者明確要求「展示頁使用 PlanTimelineView」)
// 展示頁也改接這個共用元件——兩個頁面的差異(結尾文案、捲動容器歸屬、
// 「回到最新」按鈕定位方式)透過 endMarkerMessage/scrollClassName/
// jumpPillWrapClassName 這幾個選填 prop 讓呼叫端各自覆寫,不靠在這裡
// 分支判斷「現在是哪個頁面」。
//
// NOTE_STYLES——備註分類→顏色/圖示的固定對照表,原本定義在
// TripPlanPage.tsx,跟著 JSX 一起搬過來,因為只有這裡的渲染邏輯會用到。
const NOTE_STYLES: Record<string, { color: string; noteIcon: string }> = {
  consideration: { color: 'var(--ios-gray)', noteIcon: '✦' },
  info: { color: 'var(--ios-sand)', noteIcon: 'ⓘ' },
  cost: { color: 'var(--ios-green)', noteIcon: '💰' },
  weather: { color: 'var(--ios-blue)', noteIcon: '☁︎' },
}
const DEFAULT_NOTE_CATEGORY = 'info'

// StopCardRenderContext——renderStopCard 插槽收到的輔助資訊/回呼,見該
// prop 的完整說明。欄位刻意只給插槽實作會需要的東西,不是把整個元件
// 內部 state 都丟出去:usablePhotos 是已經濾掉載入失敗 URL 的清單(見
// failedPhotoUrls 的完整說明),插槽不需要重新實作這個過濾邏輯。
export interface StopCardRenderContext {
  isSelected: boolean
  // isHovered——這張卡片目前是否正被滑鼠/鍵盤焦點 hover 中(2026-10
  // 新增,使用者明確要求「展示畫面對齊點選景點與 hover 的效果」)。
  // 預設渲染(.stopCard)的 hover 視覺完全靠 CSS :hover 偽類達成,不需要
  // 知道「目前是哪一張」這個資訊;插槽渲染沒有這層偽類的等效機制可用
  // (插槽實作可能用任何 DOM 結構),故由這裡明確提供——值來自呼叫端
  // 透過 hoveredStopIdForCard prop 傳入的「目前 hover 中的 id」跟這張
  // 卡片自己的 id 比對結果,見該 prop 的完整說明。
  isHovered: boolean
  usablePhotos: string[]
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
  onOpenPhotos: () => void
  onRemove?: () => void
}

export interface PlanTimelineViewProps {
  steps: PlanNode[]
  isThinking: boolean
  emptyStateMessage: string
  // hideEmptyState——選填,預設 false。2026-10 /ai-plan 展示頁使用者
  // 要求「移除還沒開始對話的空畫面」:時間軸完全空白、isThinking 還是
  // false 的那段期間(這個展示頁是打字動畫播完才把 isThinking 的來源
  // isGenerating 設成 true,見 AIPlanTimelinePage.tsx 的完整說明,這段
  // 空窗期不是一閃即逝,使用者看得到完整的引導文字畫面),希望這段
  // 期間時間軸主顯示區保持空白,不要出現引導文字。
  // 不能直接把 isThinking 傳 true 代替(治標不治本的捷徑):isThinking
  // 除了控制 emptyState 顯示與否,還控制 axisLineBelow(最後一張卡片
  // 下方的軸線是否延伸,見該處完整說明)——恆傳 true 會讓排程結束後
  // 軸線仍多畫一段,跟 endMarker 同時出現時產生額外的視覺瑕疵,這是
  // isThinking 真正的語意(「AI 正在做事」),不該為了隱藏一個不相干的
  // 文字區塊而汙染它。改成獨立的 hideEmptyState prop,只影響
  // .emptyState 這一處渲染,不影響 isThinking 的其他既有用途。
  hideEmptyState?: boolean
  // endMarkerMessage——選填,生成結束後顯示在時間軸底部的文案,預設
  // 「目前安排到這裡」(對齊正式頁 TripPlanPage.tsx 開放式、可持續對話
  // 調整行程的語意)。展示頁 AIPlanTimelinePage.tsx 原本固定顯示
  // 「行程結束」(劇本播完、語意上是一段有限的展示跑完了,跟正式頁
  // 「隨時可以繼續安排」的語意不同)——2026-10 code review 發現拆分
  // 當下把這段文字寫死成正式頁的版本,展示頁因此文案被覆蓋,改成這個
  // 選填 prop 讓兩邊各自傳入自己的措辭。
  endMarkerMessage?: string
  selectedStopId: string | null
  showJumpPill: boolean
  onJumpToLatest: () => void
  onPanToStop: (step: PlanNode) => void
  // onRemoveStop——選填:卡片右上角顯示一顆刪除按鈕,點擊時呼叫並傳入
  // 這個節點的 id。選填而非必填,是因為這個元件也被 /ai-plan 展示頁
  // (home/plan-ai-sim/AIPlanTimelinePage.tsx,使用者明確要求不要修改
  // 那份檔案行為,見 TripPlanPage.tsx 檔頭的完整說明)共用——展示頁不
  // 傳這個 prop 就不會出現刪除按鈕,維持原本的行為不受影響。正式功能頁
  // (TripPlanPage.tsx)原本只能透過 AI 對話下指令間接呼叫 removeStep
  // (remove_attraction 工具,見 attractionTools.ts 的完整說明)移除
  // 景點,使用者明確要求「也要可以從介面上刪除」,這裡補上直接的 UI
  // 入口,呼叫同一條底層路徑。
  onRemoveStop?: (id: string) => void
  // getStopTimeDragBounds/onDragStopTime——anchorDot(時間軸小圓點)
  // 拖拉調整時間的入口(使用者明確要求「時間軸的小圓點可以拖拉,上下
  // 拉動時調整時間,半小時為刻度」)。兩者都選填且必須同時存在才會啟用
  // 拖拉(見下方 handlePointerDown 的判斷)——跟 onRemoveStop 一樣的
  // 理由,這個元件也被 /ai-plan 展示頁共用,展示頁不傳這兩個 prop 就
  // 不會出現拖拉手勢,維持原本的行為不受影響。
  //
  // 拆成兩個函式而非一個「拖拉開始時」的單一 callback:getStopTimeDragBounds
  // 是同步的純查詢(不需要觸發任何狀態更新,拖拉手勢開始的當下就要立刻
  // 拿到範圍才能在第一次 pointermove 就正確 clamp),onDragStopTime 是
  // 拖拉結束時的提交動作——兩者的呼叫時機跟性質完全不同,合併成一個
  // callback 反而要呼叫端自己判斷「這次呼叫是查詢還是提交」,不如拆開
  // 清楚。
  getStopTimeDragBounds?: (stopId: string) => TimeDragBounds
  onDragStopTime?: (stopId: string, newTime: string) => void
  // onHoverStop——滑鼠移入/移出站點卡時回報是哪一站(移出時傳 null),
  // 2026-10 新增:使用者明確要求「滑鼠移動到介紹卡時,地圖圓加強顯示」。
  // 選填——/ai-plan 展示頁等沒有地圖的使用情境不需要這個回報。
  onHoverStop?: (id: string | null) => void
  // onHoverTransit——滑鼠移入/移出「交通膠囊」時回報這段交通連接的兩個
  // 站點 id(移出傳 null),2026-10 新增:使用者明確要求「移動到交通的
  // 膠囊上,地圖上讓連接的兩個點都顯示 hover 狀態,並用虛線做連線」。
  // 選填,理由同 onHoverStop——/ai-plan 展示頁等沒有地圖的使用情境不
  // 需要這個回報。
  onHoverTransit?: (pair: { fromId: string; toId: string } | null) => void
  // renderStopCard——選填:替換掉這個元件預設的 .stopCard 渲染(縮圖/
  // 名稱/描述/tags/刪除按鈕那一整塊),改由呼叫端提供的函式決定要畫
  // 什麼(使用者明確要求「讓時間軸元件的地點卡類似用插槽的方式讓外部
  // 可以替換」,2026-10 新增:home/AiPlanPhoneDemoScreen.tsx 的小展示
  // 需要更大的縮圖/標題字級,但不能直接改這個共用元件的 .stopCard 樣式
  // ——那會連動影響 /app、/trip-plan 等所有正式頁面)。
  //
  // 插槽邊界刻意切在 .stopCard 本身(不含外層的 .stopCardWrap/時間欄/
  // 軸線/拖拉圓點/進場動畫 class):那些是「這個節點在時間軸上的骨架
  // 位置」,不是卡片視覺設計的一部分,不該被插槽取代,否則呼叫端還要
  // 自己重新處理進場動畫/拖拉手勢這些複雜邏輯。
  //
  // 回傳 ReactNode,呼叫端自行決定要不要接上 onClick/onMouseEnter 等
  // 互動(context 裡提供對應的 callback,直接用解構賦值取用即可)——
  // 未傳這個 prop 時使用預設渲染,行為與新增這個插槽之前完全相同。
  renderStopCard?: (step: PlanNode, ctx: StopCardRenderContext) => ReactNode
  // hoveredStopIdForCard——選填,只給 renderStopCard 插槽用(見
  // StopCardRenderContext.isHovered 的完整說明)。這個元件本身是純渲染
  // 元件、不持有自己的 hover state(見檔頭說明),預設渲染的 hover 視覺
  // 靠 CSS :hover 偽類達成,不需要這個 prop;只有使用插槽、且插槽實作
  // 想要「目前是哪一張在 hover」這個資訊時,呼叫端才需要自己管理一份
  // hoverStopId state 並傳進來(見 home/AiPlanPhoneDemoScreen.tsx 的
  // 完整說明)——/app、/trip-plan 等正式頁不使用插槽,不需要傳這個 prop。
  hoveredStopIdForCard?: string | null
  onOpenPhotos: (photos: { photos: string[]; alt: string }) => void
  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,呼叫端
  // (TripPlanPage.tsx)擁有這個 ref 的生命週期,這裡只負責讀寫其內容,
  // 理由同原本直接內嵌在該檔案時的完整說明:用 id 而非陣列 index 判斷
  // justMounted,插入到中間的節點才能正確觸發進場動畫。
  mountedIdsRef: MutableRefObject<Set<string>>
  scrollRef?: Ref<HTMLDivElement>
  // onScroll——選填:展示頁(/ai-plan)的捲動容器就是這個元件自己渲染的
  // .scroll(onScroll 直接掛在這個 div 上判斷是否還跟隨最新節點),跟正式
  // 頁(TripPlanPage.tsx)不同——後者的真正捲動容器收在外層 <main>
  // (DesktopMain 的 unboundedScroll,見該檔案的完整說明),這個元件的
  // .scroll 只是流動內容、不綁 onScroll。兩邊捲動模型不同,用這個可選
  // prop 讓展示頁接上自己的 handleScroll,正式頁不傳就維持原狀。
  onScroll?: UIEventHandler<HTMLDivElement>
  // scrollClassName——選填,疊加在這個元件自己的 .scroll 上。兩個呼叫端
  // 的捲動模型完全不同:正式頁 TripPlanPage.tsx 的 .page 是自然高度、
  // 捲動權收在外層 <main>(unboundedScroll),.scroll 本身不需要
  // overflow-y/padding-bottom;展示頁 AIPlanTimelinePage.tsx 的 .page 是
  // height:100dvh + overflow:hidden 的固定視窗容器,.scroll 自己才是
  // 真正的捲動容器,需要 overflow-y:auto,composer 又是 position:absolute
  // 蓋在內容上方,還需要額外的 padding-bottom 讓最後一張卡片捲到底時
  // 不被蓋住。2026-10 這兩條 CSS 規則一度被拆分成共用元件本身固定的
  // .scroll(只含正式頁需要的 flex/padding),展示頁因此完全失去捲動
  // 能力(使用者實測回報「展示頁往下安排時不能往下拉了」)——改成由
  // 呼叫端各自傳入自己需要的 class 疊加上去,不讓共用元件替兩種完全不同
  // 的捲動模型做決定。
  scrollClassName?: string
  // jumpPillWrapClassName——選填,疊加在這個元件自己的 .jumpPillWrap 上。
  // 跟 scrollClassName 同一種需要的理由:共用元件的 .jumpPillWrap 用
  // position:sticky(相對「最近的捲動祖先」貼齊,見該 class 的完整
  // 說明),這個寫法要求 .jumpPillWrap 的某個祖先元素本身是可捲動的
  // ——正式頁 TripPlanPage.tsx 符合這個前提(捲動祖先是外層 <main>,
  // 整棵 .page 樹都在它底下)。但展示頁 AIPlanTimelinePage.tsx 的
  // .jumpPillWrap 是 PlanTimelineView 自己 .scroll(透過 scrollClassName
  // 取得 overflow-y:auto)的手足元素、不是它的子孫——sticky 完全沒有
  // 可依附的捲動容器,按鈕會變成普通區塊顯示、不再浮動貼齊畫面底部
  // (2026-10 code review 抓到的回歸,使用者尚未實際回報但已確認會
  // 發生)。改成由呼叫端疊加自己需要的定位方式:展示頁傳入的
  // class 比照原本的寫法(position:absolute 相對 .page 置中定位),不
  // 依賴 sticky。
  jumpPillWrapClassName?: string
  // jumpPillClassName——選填,疊加在按鈕本身(.jumpPill)上。2026-10
  // 新增:正式頁對話小匡(compact)使用者要求「太扁太寬,且要用 icon
  // 不要用文字的箭頭」——小匡只有 440px 寬,文字膠囊(padding:8px 16px
  // + 「↓ 回到最新」五個字)比例上太寬太扁;全頁版維持原本的文字膠囊,
  // 不需要跟著改。
  jumpPillClassName?: string
  // jumpPillContent——選填,覆寫按鈕內部內容(預設「↓ 回到最新」文字)。
  // 跟 jumpPillClassName 搭配使用:小匡版傳一個只有 icon 的 ReactNode,
  // 不重新定義另一顆按鈕元件——這個元件仍然只有一個 <button>,只是
  // 內容跟外觀由呼叫端決定,維持「這個元件不知道自己在哪種容器裡」的
  // 既有設計慣例(同 scrollClassName/jumpPillWrapClassName)。
  jumpPillContent?: ReactNode
  // endMarkerClassName——選填,疊加在這個元件自己的 .endMarker 上。跟
  // scrollClassName/jumpPillWrapClassName 同一種需要的理由:2026-10
  // /ai-plan 展示頁(AIPlanTimelinePage.tsx)讀者回報「── 行程結束 ──」
  // 文字顯示不清楚——.endMarker 用共用 token(--ios-gray)的淺灰色文字,
  // 在展示頁疊在地圖背景上方(見 AIPlanTimelinePage.module.css 的
  // .timelineScroll 說明,這裡整個時間軸浮在地圖底圖之上)
  // 時,地圖紋理當背景、文字本身又淡,對比度不足。正式頁(/app)的
  // .endMarker 疊在純色頁面背景上,同樣的顏色沒有這個問題,不能直接
  // 改 .endMarker 本身(會連動影響正式頁)。疊加這個 class 讓展示頁
  // 自己覆寫顏色/加文字陰影提高對比,不影響共用元件的基礎樣式。
  endMarkerClassName?: string
}

// PlanTimelineView — 純渲染元件,不持有自己的 state/effect(scroll 追蹤、
// 429 重試、照片重試等邏輯仍留在呼叫端),只依賴傳入的 props 畫出時間軸
// 與「回到最新」浮動按鈕。
export function PlanTimelineView({
  steps,
  isThinking,
  emptyStateMessage,
  hideEmptyState = false,
  endMarkerMessage = '目前安排到這裡',
  selectedStopId,
  showJumpPill,
  onJumpToLatest,
  onPanToStop,
  onRemoveStop,
  getStopTimeDragBounds,
  onDragStopTime,
  onHoverStop,
  onHoverTransit,
  renderStopCard,
  hoveredStopIdForCard,
  onOpenPhotos,
  mountedIdsRef,
  scrollRef,
  onScroll,
  scrollClassName,
  jumpPillWrapClassName,
  jumpPillClassName,
  jumpPillContent,
  endMarkerClassName,
}: PlanTimelineViewProps) {
  // failedPhotoUrls——載入失敗(404/403/過期/網路錯誤)的照片 URL 集合。
  //
  // 2026-10 使用者實際回報:縮圖位置出現破圖 icon 疊著 alt 文字(例如
  // 「全美戲院」四個字擠在 64px 圓形縮圖裡),而不是乾淨的佔位。原因是
  // 這裡的 <img> 沒有 onError——googlePhotoUrls 有值就一律渲染 <img>,
  // URL 本身載入失敗時瀏覽器顯示的就是那個破圖樣式;更糟的是
  // .stopThumb 的 thumbBg 底色在「有 googlePhotoUrls」時被判斷式關掉
  // (見下方 style),所以連底色都沒有,破圖直接疊在透明背景上。
  //
  // photo_assets 的 7 天過期機制(見後端 photoAssetExpiry)讓這不是罕見
  // 邊界情況:節點是持久化的(planTimelineStorage.ts),時間軸可以存在
  // 遠比 7 天更久,舊節點裡的 URL 失效是預期中會發生的事。
  //
  // 用 URL 字串(而非節點 id)當 key——同一張照片可能出現在多個節點,
  // 失敗一次就不需要在其他節點重試;節點 id 則會因為重新插入而改變。
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<ReadonlySet<string>>(() => new Set())
  const markPhotoFailed = useCallback((url: string) => {
    setFailedPhotoUrls((prev) => {
      // 已經記錄過就回傳原本的 Set——onError 可能因為重新渲染而重複觸發,
      // 每次都產生新 Set 會造成不必要的重渲染迴圈。
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }, [])

  // dragState——見 DragState 型別的完整說明。null 代表目前沒有任何節點
  // 在被拖拉。用 useState(而非 ref)是因為 previewMinutes 的變化需要
  // 觸發重渲染,讓使用者在拖拉過程中即時看到時間數字跟著變——這是這個
  // 功能的核心體驗(使用者明確要求「拉動時時間跟著改變」),不能只在
  // 放開時才更新畫面。
  const [dragState, setDragState] = useState<DragState | null>(null)
  // dragStateRef——handlePointerMove/handlePointerUp 是原生事件監聽器
  // (掛在 document 上,見 handlePointerDown 的完整說明),不是每次
  // render 都重新綁定的 React 合成事件處理器,讀到的必須是「當下最新」
  // 的 dragState,不能是綁定當下那次 render 閉包住的舊值(理由同本檔案
  // 其餘 xxxRef 的既有模式,例如 TripPlanPage.tsx 的 getStepsForBridge
  // 一類的完整說明)。
  const dragStateRef = useRef<DragState | null>(null)

  // handlePointerMove/handlePointerUp 用 useCallback 搭配 ref 讀取最新
  // dragState,刻意不放進任何 useEffect 依賴陣列重新建立——這兩個函式
  // 在 handlePointerDown 裡用原生 addEventListener 掛上、在
  // handlePointerUp 自己呼叫時 removeEventListener 移除,整個生命週期
  // 由拖拉手勢自己管理,不依賴 React 的渲染週期。
  const handlePointerMove = useCallback((e: PointerEvent) => {
    const state = dragStateRef.current
    if (!state) return
    const deltaY = e.clientY - state.startClientY
    const deltaSteps = Math.round(deltaY / TIME_DRAG_PX_PER_STEP)
    const rawMinutes = state.startMinutes + deltaSteps * TIME_DRAG_MINUTES_PER_STEP
    const nextMinutes = clampToStep(rawMinutes, state.bounds)
    if (nextMinutes === state.previewMinutes) return
    const next = { ...state, previewMinutes: nextMinutes }
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const state = dragStateRef.current
    if (!state || e.pointerId !== state.pointerId) return
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
    document.removeEventListener('pointercancel', handlePointerUp)
    dragStateRef.current = null
    setDragState(null)
    // 只在時間真的有變動時才提交——拖拉一下又放回原位(deltaSteps 算出
    // 來還是 0)不需要呼叫 onDragStopTime 觸發一次沒有意義的寫入/重新
    // 查詢交通資訊。
    if (state.previewMinutes !== state.startMinutes) {
      onDragStopTime?.(state.stopId, minutesToTime(state.previewMinutes))
    }
  }, [handlePointerMove, onDragStopTime])

  // handlePointerDown——掛在 anchorDot 本身的 onPointerDown。用原生
  // document 層級的 pointermove/pointerup 監聽(而非 React 合成事件的
  // onPointerMove/onPointerUp 掛在 anchorDot 自己身上),是因為拖拉過程
  // 中使用者的游標/手指很容易移出這顆只有 12x12px 的小圓點範圍——若
  // 監聽器只掛在圓點本身,移出範圍後續的 move 事件就收不到了,拖拉手勢
  // 會卡住。改掛在 document 上,不論指標移到畫面任何位置都能持續追蹤。
  //
  // 呼叫 e.preventDefault()——避免觸控裝置上這個手勢被瀏覽器原生的
  // 捲動/選取文字手勢搶走(這張卡片所在的 .scroll 容器本身是可以捲動
  // 的,拖拉圓點這個動作不該連帶觸發頁面捲動)。
  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, stopId: string, currentTime: string | undefined) => {
    if (!getStopTimeDragBounds || !onDragStopTime) return
    if (!currentTime) return
    e.preventDefault()
    e.stopPropagation()
    const [h, m] = currentTime.split(':').map(Number)
    const startMinutes = h * 60 + m
    const bounds = getStopTimeDragBounds(stopId)
    const state: DragState = {
      stopId,
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startMinutes,
      bounds,
      previewMinutes: startMinutes,
    }
    dragStateRef.current = state
    setDragState(state)
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
  }, [getStopTimeDragBounds, onDragStopTime, handlePointerMove, handlePointerUp])

  return (
    <>
      <div className={`${styles.scroll} ${scrollClassName ?? ''}`} ref={scrollRef} onScroll={onScroll}>
        <div className={styles.inner}>
          {/* emptyState——時間軸完全空白、也還沒開始生成時的引導文字。
              isThinking 為 true 時不顯示——那個情況下面已經有呼吸點/
              骨架卡(.tipRow)傳達「正在安排」的狀態,不需要空狀態文字跟
              生成動畫同時出現互相干擾。 */}
          {steps.length === 0 && !isThinking && !hideEmptyState && (
            <div className={styles.emptyState}>
              <span className={styles.emptyStateIcon}>✦</span>
              <p className={styles.emptyStateText}>{emptyStateMessage}</p>
            </div>
          )}
          {steps.map((p, idx) => {
            // justMounted:這個節點是不是「第一次」出現在畫面上——用 id
            // 是否已經記錄過判斷,不是用陣列 index,插入到中間的節點
            // 才能正確觸發進場動畫。
            const justMounted = !mountedIdsRef.current.has(p.id)
            if (justMounted) mountedIdsRef.current.add(p.id)
            const mountedClass = styles.mountFadeIn
            // removingClass:套在每個節點最外層的 .row 容器上,CSS 同時
            // 做透明度淡出跟高度塌縮。
            const removingClass = p.removing ? styles.removingFade : ''
            // usablePhotos——濾掉已知載入失敗的 URL(見 failedPhotoUrls
            // 的完整說明)。整組都失敗時長度為 0,縮圖的判斷式自然退回
            // thumbIcon + thumbBg 佔位,跟「這個地點本來就沒有照片」是
            // 同一條路徑,不需要額外的錯誤樣式。Lightbox 收到的也是這份
            // 濾過的清單,不會點開後翻到破圖。
            const usablePhotos = p.googlePhotoUrls?.filter((u) => !failedPhotoUrls.has(u)) ?? []

            if (p.type === 'section') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.sectionRow} ${mountedClass} ${removingClass}`}>
                  <div className={styles.sectionBand}>
                    <span className={styles.sectionLabel}>{p.label}</span>
                  </div>
                </div>
              )
            }

            if (p.type === 'stop') {
              // transitFromPrev(見 planTimeline.ts TransitInfo 的完整
              // 說明)掛在到達站自己身上——渲染時在這張 stop 卡片「之前」
              // 多畫一列交通卡,key 加 "transit-" 前綴避免跟下面 stop
              // 本身的 key(p.id)衝突。
              const transit = p.transitFromPrev
              // note——這個節點自己的備註(見 planTimeline.ts NoteInfo
              // 的完整說明),掛在這張 stop 卡片自己身上的欄位,渲染時在
              // 卡片「之後」多畫一列(使用者明確要求「note 的出現位置在
              // 景點下面」,2026-10 從卡片之前調整到之後)。
              const note = p.note
              const noteStyle = note ? NOTE_STYLES[note.category ?? ''] ?? NOTE_STYLES[DEFAULT_NOTE_CATEGORY] : null
              return (
                <Fragment key={p.id}>
                  {transit && (
                    <div className={`${styles.row} ${styles.transitRow}`}>
                      <div />
                      <div className={styles.transitAxis}>
                        <div className={styles.transitDashAbove} />
                        <div className={styles.transitDashBelow} />
                        <div
                          className={`${mountedClass} ${justMounted ? styles.pillExpand : ''} ${styles.transitPill}`}
                          // onMouseEnter/Leave——見 onHoverTransit 的完整
                          // 說明。p.prevId 是這段交通的起點(transit 掛在
                          // 到達站 p 自己身上,見 planTimeline.ts
                          // TransitInfo 的完整說明),p.id 是終點。prevId
                          // 理論上不會是 null(transit 存在就代表有前一
                          // 站),但型別上允許,防禦性地在 null 時不觸發
                          // hover——沒有起點就沒有線可畫。
                          onMouseEnter={() => {
                            if (p.prevId) onHoverTransit?.({ fromId: p.prevId, toId: p.id })
                          }}
                          onMouseLeave={() => onHoverTransit?.(null)}
                        >
                          {/* 查詢中(loading:true)只顯示轉圈動畫,不顯示
                              任何文字,重用 stop 卡片查詢中狀態既有的
                              thumbSpinner 動畫。 */}
                          {transit.loading ? (
                            <span className={styles.thumbSpinner} aria-label="查詢交通資訊中" />
                          ) : (
                            <>
                              {(() => {
                                const TransitIcon = TRANSIT_MODE_ICONS[transit.mode ?? ''] ?? Footprints
                                return <TransitIcon size={14} strokeWidth={2.2} aria-hidden />
                              })()}
                              <span>{transit.mode} {transit.minutes} 分 · {transit.distance}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div />
                    </div>
                  )}
                  {(() => {
                    // isDraggingThis——這個節點目前是否正在被拖拉中(見
                    // DragState 的完整說明)。顯示的時間用拖拉中的即時
                    // 預覽值,不是 p.time 本身——p.time 要等 pointer up
                    // 真正提交(onDragStopTime)、父層的 timeline 更新後
                    // 才會變,拖拉過程中(放開前)這裡顯示的是這個元件
                    // 自己 state 裡的暫時值。
                    const isDraggingThis = dragState?.stopId === p.id
                    const displayTime = isDraggingThis ? minutesToTime(dragState.previewMinutes) : p.time
                    return (
                      <div data-tl-node className={`${styles.row} ${styles.stopRow} ${removingClass}`}>
                        <div className={`${styles.stopTime} ${mountedClass}`}>
                          <div className={`${styles.stopTimeText} ${isDraggingThis ? styles.stopTimeDragging : ''}`}>{displayTime}</div>
                        </div>
                        <div className={styles.axisCol}>
                          {idx > 0 && <div className={styles.axisLineAbove} />}
                          {/* axisLineBelow——「還有下一個節點」或「正在生成中」
                              任一成立時都畫出來,避免最後一張卡片下方到呼吸點
                              之間出現斷裂。 */}
                          {(idx < steps.length - 1 || isThinking) && <div className={styles.axisLineBelow} />}
                          {/* onPointerDown 只在 getStopTimeDragBounds/
                              onDragStopTime 都有傳入時才會真的啟動拖拉
                              (見 handlePointerDown 開頭的判斷),未傳入
                              時這裡仍然安全地掛著處理器、但函式內部立刻
                              return,不影響既有(/ai-plan 展示頁)的
                              滑鼠/觸控行為——沒有拖拉能力的 anchorDot
                              跟原本完全一樣,只是多了一個不會做任何事的
                              事件監聽。cursor:grab 的視覺提示只在真的
                              能拖拉時出現(見 .anchorDotDraggable 的
                              完整說明)。 */}
                          <div
                            className={`${styles.anchorDot} ${mountedClass} ${justMounted ? styles.anchorPop : ''} ${getStopTimeDragBounds && onDragStopTime ? styles.anchorDotDraggable : ''} ${isDraggingThis ? styles.anchorDotDragging : ''}`}
                            // style 的 translateY——見 dragTranslateY 的
                            // 完整說明,只在這個節點正在被拖拉時套用,其餘
                            // 時候維持 undefined(不覆寫 CSS 既有的
                            // transform,例如 .anchorDotDragging 的
                            // scale(1.3))。isDraggingThis 為 true 時
                            // dragState 必然非 null(見上方宣告),但
                            // TypeScript narrowing 跨不過 isDraggingThis
                            // 這個中間變數,仍需要 dragState? 保險。
                            style={isDraggingThis && dragState ? { transform: `translateY(${dragTranslateY(dragState)}px) scale(1.3)` } : undefined}
                            onPointerDown={(e) => handlePointerDown(e, p.id, p.time)}
                          />
                        </div>
                        <div className={`${styles.stopCardWrap} ${mountedClass} ${justMounted ? styles.cardSlide : ''}`}>
                          {renderStopCard ? (
                            // renderStopCard——插槽,見該 prop 與
                            // StopCardRenderContext 的完整說明。呼叫端
                            // 自己決定要不要接上 context 裡的互動回呼,
                            // 這裡只負責把 p(當下節點)跟一組現成可用的
                            // callback/資料轉交出去,不預設任何樣式。
                            renderStopCard(p, {
                              isSelected: p.id === selectedStopId,
                              isHovered: p.id === hoveredStopIdForCard,
                              usablePhotos,
                              onClick: () => onPanToStop(p),
                              onMouseEnter: () => onHoverStop?.(p.id),
                              onMouseLeave: () => onHoverStop?.(null),
                              onFocus: () => onHoverStop?.(p.id),
                              onBlur: () => onHoverStop?.(null),
                              onOpenPhotos: () => onOpenPhotos({ photos: usablePhotos, alt: p.name ?? '' }),
                              onRemove: onRemoveStop ? () => onRemoveStop(p.id) : undefined,
                            })
                          ) : (
                            <div
                              className={`${styles.stopCard} ${p.id === selectedStopId ? styles.stopCardSelected : ''}`}
                              role={p.lat != null && p.lng != null ? 'button' : undefined}
                              tabIndex={p.lat != null && p.lng != null ? 0 : undefined}
                              onClick={() => onPanToStop(p)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') onPanToStop(p)
                              }}
                              // onMouseEnter/Leave——地圖上對應的圓點加強顯示
                              // (見 onHoverStop 的完整說明)。onFocus/onBlur
                              // 一併接上:這張卡片在有座標時是 tabIndex=0 的可
                              // 聚焦元素,鍵盤使用者 Tab 到這裡時應該得到跟滑鼠
                              // 懸停一樣的回饋,不是只有滑鼠使用者看得到地圖
                              // 在哪一顆點上。
                              onMouseEnter={() => onHoverStop?.(p.id)}
                              onMouseLeave={() => onHoverStop?.(null)}
                              onFocus={() => onHoverStop?.(p.id)}
                              onBlur={() => onHoverStop?.(null)}
                            >
                              <div
                                className={`${styles.stopThumb} ${justMounted ? styles.thumbPop : ''}`}
                                style={{ background: usablePhotos.length ? undefined : p.thumbBg }}
                              >
                                {p.loading ? (
                                  <span className={styles.thumbSpinner} aria-label="查詢地點資料中" />
                                ) : usablePhotos.length ? (
                                  // 縮圖本身維持只顯示第一張(64px 圓形版型)。
                                  // 只要有照片就能點擊開啟全螢幕 Lightbox 放大
                                  // 瀏覽——即使只有 1 張,使用者明確要求「一張
                                  // 的時候也要」能點開看大圖,不是只有 2 張以上
                                  // 才可互動。不冒泡觸發卡片本身的 onPanToStop
                                  // ——瀏覽照片跟點卡片置中地圖是兩個不同意圖
                                  // 的操作。張數角標只在有 2 張以上時顯示,提示
                                  // 使用者這張縮圖還有更多照片可以切換;1 張時
                                  // 不顯示角標,但按鈕本身仍可點擊,Lightbox 內
                                  // 不會出現左右切換箭頭/頁碼(見 Lightbox 的
                                  // 完整說明,photos 陣列只有 1 項時那些控制項
                                  // 本來就不需要)。
                                  <button
                                    type="button"
                                    className={styles.stopThumbPhotoBtn}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenPhotos({ photos: usablePhotos, alt: p.name ?? '' })
                                    }}
                                    aria-label={
                                      usablePhotos.length > 1
                                        ? `瀏覽 ${usablePhotos.length} 張照片`
                                        : '放大檢視照片'
                                    }
                                  >
                                    {/* onError——載入失敗時把這個 URL 記進
                                        failedPhotoUrls(見該 state 的完整說明),
                                        下次渲染 usablePhotos 就會濾掉它;整組都
                                        失敗時整張縮圖退回 thumbIcon + thumbBg
                                        佔位,不是破圖疊 alt 文字。 */}
                                    <img
                                      src={usablePhotos[0]}
                                      alt={p.name}
                                      className={styles.stopThumbImg}
                                      onError={() => markPhotoFailed(usablePhotos[0])}
                                    />
                                    {usablePhotos.length > 1 && (
                                      <span className={styles.stopThumbPhotoCount}>{usablePhotos.length}</span>
                                    )}
                                  </button>
                                ) : p.thumbIcon}
                              </div>
                              <div className={styles.stopBody}>
                                <div className={styles.stopMeta}>
                                  {p.duration} · {p.kind}
                                  {p.loading && <span className={styles.loadingTag}>查詢地點中…</span>}
                                </div>
                                <div className={styles.stopName}>{p.name}</div>
                                <div className={styles.stopDesc}>{p.desc}</div>
                                {p.tags && p.tags.length > 0 && (
                                  <div className={styles.stopTags}>
                                    {p.tags.map((tag) => (
                                      <span key={tag} className={styles.stopTag}>{tag}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* onRemoveStop——選填,見該 prop 的完整說明。
                                  stopPropagation 避免冒泡觸發卡片本身的
                                  onClick(onPanToStop 會把地圖 pan 過去,刪除
                                  是不相關的操作)。 */}
                              {onRemoveStop && (
                                <button
                                  type="button"
                                  className={styles.stopRemoveBtn}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onRemoveStop(p.id)
                                  }}
                                  aria-label={`移除「${p.name ?? '這一站'}」`}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  {/* note——使用者明確要求「note 的出現位置在景點下面」,
                      改到 stop 卡片之後渲染(原本在卡片之前,2026-10 這次
                      調整)。 */}
                  {note && noteStyle && (
                    <div className={`${styles.row} ${styles.noteRow}`}>
                      <div className={`${styles.noteLeft} ${mountedClass} ${justMounted ? styles.noteFade : ''}`}>
                        <div className={styles.noteInner}>
                          <div className={styles.noteBar} style={{ background: noteStyle.color }} />
                          <div className={styles.noteText}>
                            <span style={{ marginRight: 4 }}>{noteStyle.noteIcon}</span>{note.text}
                          </div>
                        </div>
                      </div>
                      <div className={styles.noteAxisCol}>
                        <div className={styles.noteAxisLine} />
                      </div>
                      <div />
                    </div>
                  )}
                </Fragment>
              )
            }

            // message——LLM/使用者的對話訊息(見 planTimeline.ts
            // PlanNodeType 的完整說明),時間軸上自己獨立的一列,不依附
            // 任何 stop 卡片。新的 stop 節點插入後(p.stale === true)
            // 收合成一行淡化的小字,不整個移除。
            if (p.type === 'message') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.messageRow} ${mountedClass} ${removingClass}`}>
                  <div />
                  <div className={styles.messageAxisCol}>
                    <div className={styles.messageAxisLine} />
                  </div>
                  <div className={styles.messageWrap}>
                    <div className={`${styles.messageBubble} ${p.stale ? styles.messageBubbleStale : ''}`}>
                      {/* stale(收合淡化態)是單行省略號截斷的純文字——
                          markdown 排版在那個高度/寬度下沒有意義。新鮮態
                          才用 ReactMarkdown 渲染完整內容。 */}
                      {p.stale ? (
                        p.text
                      ) : (
                        <div className={styles.messageMarkdown}>
                          <ReactMarkdown>{p.text ?? ''}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })}

          {/* isThinking——onagent 對話推論中(唯一的「AI 正在做事」訊號
              來源)。 */}
          {isThinking ? (
            // key 綁「目前最後一個節點的 id」,讓「最後一個節點變了」
            // 等同「呼吸點換了位置」,強制 React 卸掉舊的 tipRow 重新掛
            // 一個,CSS 動畫才會隨之重播。
            <Fragment key={`tip-after-${steps.length > 0 ? steps[steps.length - 1].id : 'empty'}`}>
              <div data-tl-tip className={`${styles.row} ${styles.tipRow}`}>
                <div />
                <div className={styles.tipAxis}>
                  <div className={styles.tipLineAbove} />
                  <div className={styles.tipDot} />
                  <div className={styles.tipLineBelow} />
                </div>
                <div />
              </div>
              {/* 骨架卡——呼吸點下方的「即將出現的內容」預告,只在已經有
                  節點之後才顯示。 */}
              {steps.length > 0 && (
                <div aria-hidden="true" className={`${styles.row} ${styles.stopRow} ${styles.skeletonRow}`}>
                  <div />
                  <div className={styles.axisCol}>
                    {/* skeletonAxisAbove——骨架卡列自己補一段貫穿到
                        .skeletonAnchor 中點的虛線,不依賴上一列
                        .tipLineBelow 用魔術數字猜測骨架卡列高度往下
                        穿透。 */}
                    <div className={styles.skeletonAxisAbove} />
                    <div className={styles.skeletonAnchor} />
                  </div>
                  <div className={styles.stopCardWrap}>
                    <div className={styles.skeletonCard}>
                      <div className={`${styles.skeletonThumb} ${styles.shimmer}`} />
                      <div className={styles.skeletonBody}>
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineMeta} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineTitle} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineDesc} ${styles.shimmer}`} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          ) : steps.length > 0 ? (
            <div className={`${styles.endMarker} ${styles.endFade} ${endMarkerClassName ?? ''}`}>── {endMarkerMessage} ──</div>
          ) : null}
        </div>
      </div>

      {showJumpPill && (
        <div className={`${styles.jumpPillWrap} ${jumpPillWrapClassName ?? ''}`}>
          <button
            type="button"
            className={`${styles.jumpPill} ${jumpPillClassName ?? ''}`}
            onClick={onJumpToLatest}
            aria-label="回到最新"
          >
            {jumpPillContent ?? '↓ 回到最新'}
          </button>
        </div>
      )}
    </>
  )
}
