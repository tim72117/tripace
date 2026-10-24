import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listNodes, lodgingSpanLabel, lodgingsOf, lodgingsStartingOnDay, stopLookupFailed, withDay, type PlanLodging, type PlanNode, type PlanTimeline, type NoteInfo, type PlanThemeChild, type TransitInfo } from '../../plan-core/planTimeline'
import type { AskPageInput, AskPageSelection } from '../../plan-core/askPageTools'
import { AskPage } from './AskPage'
import { nodeStatusOf, type NodeStatusMap } from '../../plan-core/planNodeStatus'
import { DEFAULT_NOTE_CATEGORY, NOTE_CATEGORY_META, TRANSIT_MODE_CHOICES } from '../../plan-core/planPresentation'
import { LODGING_FALLBACK_NAME, resolveLodging, resolveNodeRefChildren } from '../../plan-core/useResolvedNodeRefs'
import { usePlanData, useResolvedRefs } from '../../plan-core/PlanDataProvider'
import styles from './HorizontalPlanTimeline.module.css'

// ZOOM_OUT_ENABLED——2026-10 使用者先要求「讓時間尺有 zoom in/zoom out
// 的切換,推論時用 zoom out」,之後又要求「先不做 zoom out」:整套
// zoom out 邏輯(allDays/hasZoomedOut/showZoomOut 的計算、.ruler JSX 裡
// 的 .rulerOverviewSegment/.rulerOverviewDot 渲染分支、對應的
// HorizontalPlanTimeline.test.tsx 測試)保留不刪,只用這個開關強制
// 關閉,方便之後要重新啟用時直接把這裡改回 true,不需要重新實作或從
// git 歷史挖回來。關閉後行為等同這個功能從未存在:.ruler 永遠走 zoom in
// 分支(單日 24 小時範圍 + 跨日滑動過渡),不管 isGenerating 是否為
// true,見 showZoomOut 的完整說明。
const ZOOM_OUT_ENABLED = false

// 2026-10(手機版共用時間軸重構):這個元件原本只給「模擬層」用,現在
// 同時也是「交接後真實層」(LivePlanLayer 內部的 TripPlanPage,手機版時
// 傳 horizontalTimeline)手機版的渲染元件——使用者明確要求「兩個不同的
// 層,時間軸要共用相同的,只有資料層不一樣」。這裡新增的進階互動 props
// (onRemoveStop/onTransitModeChange)全部選填,型別直接對齊
// plan-core/PlanTimelineView.tsx 同名 prop 的用法,理由同該檔案對應
// prop 的既有說明:模擬層(home/plan-ai-sim/Content.tsx 的 handedOver === false
// 分支)完全不傳這些 prop,外觀與行為不變;只有 TripPlanPage.tsx 的
// horizontalTimeline 分支會傳入真正接上 removeStep/
// refreshTransitForStop 的實作。
//
// 2026-10(第二輪,使用者明確要求「圖卡上不要時間」):卡片上原本的
// 時間顯示(.timeRange)連同選填的 getStopTimeDragBounds/onDragStopTime
// 點擊彈出時間微調彈層那整套互動,一併整個移除——這套互動機制走的是
// TIME_DRAG_ENABLED feature flag(VITE_FEATURE_TIME_DRAG 環境變數,
// 預設未設定即為 false),目前沒有任何環境真正啟用它,拿掉不影響任何
// 現行功能。桌面版 PlanTimelineView.tsx 自己的拖拉調時間手勢是完全
// 獨立的另一套實作,不受這次異動影響。起訖時間改成只在手機版橫向時間尺
// (.ruler)選中的段落上方浮動顯示(見 .rulerSegmentTime 的完整說明),
// 不再出現在卡片本身上。

// HorizontalPlanTimeline — /ai-plan 展示頁「模擬中」手機版專用的橫向
// 卡片時間軸(方案二:橫向+迷你時間尺+備註),取代原本手機版也套用的
// 縱向 PlanTimelineView。
//
// 背景:設計依據是 Fable 在 Artifact 做的手機版時間軸三個試做方案,
// 使用者已看過並認可「方案二」的方向(橫向可滑動卡片列+上方迷你時間尺
// +交通移到卡片頂部+備註依分類上色),這裡把那份試做的視覺語言/互動
// 邏輯(時間尺計算、雙向連動、scroll-snap)落地成真正吃 PlanNode[] 的
// TypeScript 元件,不是沿用試做裡的寫死假資料。
//
// 只負責模擬層(handedOver === false)的手機版畫面——桌面版與交接後的
// 真實層(LivePlanLayer)完全不受影響,繼續走 PlanTimelineView,見
// home/plan-ai-sim/Content.tsx 呼叫處的完整說明。
//
// 只畫 stop 節點:跟縱向 PlanTimelineView 不同,這個元件刻意不處理
// section(Day 標題)/message(對話訊息)這些節點類型本身的卡片——方案二
// 設計稿本來就只聚焦在「站點卡片橫向滑動+時間尺」這個核心互動,訊息
// 氣泡/分段標題硬塞進同一條橫向列只會讓時間尺的時間軸語意變得混亂
// (這兩種節點沒有「停留時長」的概念)。Day 分界改成每張卡片自己帶一個
// 「Day N」徽章(對齊設計稿「分天顯示」的需求),不需要為分隔線另外佔用
// 一個橫向卡位。

export interface HorizontalPlanTimelineProps {
  // timeline——依天分組的時間軸本身(跟縱向 PlanTimelineView 的 timeline 同一個型別),這個元件自己依 timeline.days
  // 挑出 type === 'stop' 的節點處理,其餘類型直接忽略（見上方檔頭說明）。空的天會補一張「空天佔位卡」,
  // 它的站點 id 就是那一天的 PlanDay.id:選到空天時 onSelectStop 收到的是 day.id,selectedStopId 等於某個 day.id 就視為選了那一天。
  timeline: PlanTimeline
  selectedStopId: string | null
  // onSelectStop——點卡片/時間尺、或橫向捲動偵測到新的置中卡片時觸發。
  // 取代縱向版本 onPanToStop/onHoverStop 的角色：呼叫端(home/plan-ai-sim/Content.tsx)
  // 接到這個回調後要同時更新 selectedStopId 跟 hoverStopId（兩者都指向
  // 同一顆地圖圓點），確保 usePlanStopMarkers 的地圖連動行為跟改動前一致
  // ——這裡不自己分「選取」跟「hover」兩種語意，手機版橫向卡片列本來就
  // 沒有滑鼠 hover 這件事，「捲到哪張卡」本身就等同「選取哪一站」。
  onSelectStop: (stopId: string) => void
  // onSelectThemeChild——2026-10 新增(使用者明確要求「主題點」概念:
  // 「點下點的時候在地圖上出現小圓點」)。點擊主題卡(node 的 attractions/places 有
  // 內容時,見該欄位的完整說明)底下某個子景點 chip 時觸發,帶上主題
  // 節點 id 與被點的子景點資料,讓呼叫端(home/plan-ai-sim/Content.tsx)決定
  // 要不要在地圖上額外顯示這個子景點的小圓點(見該頁 expandedThemeId
  // 的完整說明)。選填——不傳時子景點 chip 仍會渲染,只是點擊沒有任何
  // 效果(對齊其餘選填互動 prop 的既有模式,例如 onRemoveStop)。
  onSelectThemeChild?: (parentId: string, child: PlanThemeChild) => void
  // onOpenPhotos——點擊卡片照片時開啟全螢幕 Lightbox 放大瀏覽,對齊
  // 縱向版 PlanTimelineView 同名 prop 的既有用法(見該元件呼叫處
  // stopThumbPhotoBtn 的完整說明)——這裡不自己管理 Lightbox 的開關
  // 狀態,外層 home/plan-ai-sim/Content.tsx 已經有現成的 lightboxPhotos
  // state/setLightboxPhotos,兩個時間軸元件共用同一個 Lightbox 覆蓋層。
  onOpenPhotos: (photos: { photos: string[]; alt: string }) => void
  // onHeightChange——這個元件自己(.wrap,含時間尺+卡片列+底部留白)的
  // 實際渲染高度,每次真的改變就回報一次(例如照片陸續載入進來讓卡片
  // 變高)。供外層 home/plan-ai-sim/Content.tsx 用來計算地圖視覺中心該往上
  // 偏移多少(使用者明確要求「讓地圖中心在上半部分的中心」——扣掉這塊
  // 高度之後,剩餘可視區域的正中心),不是這個元件自己需要知道的資訊,
  // 純粹上報用。 */
  onHeightChange?: (height: number) => void
  // onRemoveStop——選填:卡片右上角顯示一顆刪除按鈕,點擊時呼叫並傳入
  // 這個節點的 id。語意與選填理由完全對齊 PlanTimelineView.tsx 同名
  // prop(見該檔案的完整說明)——模擬層不傳就不會出現刪除按鈕。
  // onLatestMessageChange prop 已移除(2026-10,使用者明確指出泡泡
  // 「不應該放在輸入匡區」)——泡泡改由這個元件自己用下方 latestMessage
  // 直接渲染(見 agentBubbleRow 的完整說明),不再需要回報給呼叫端。
  onRemoveStop?: (stopId: string) => void
  // onPanToStop——選填:卡片左下角顯示一顆「移動到此」按鈕,點擊時呼叫
  // 並傳入這個節點的 id。2026-10 新增(使用者明確要求「選擇圖卡時不要
  // 移動地圖中心,標誌地點就好,另外做一個 icon,移動到該點」)——取代
  // 原本「選中卡片就自動 panTo」的做法(見 home/plan-ai-sim/Content.tsx
  // panToStopId 的完整說明:選取跟移動地圖視角拆成兩個分開的動作)。
  // 省略時不會渲染這顆按鈕,對齊 onRemoveStop 的既有選填慣例——桌面版
  // PlanTimelineView.tsx 不受影響(這個元件本來就只給手機版用)。
  onPanToStop?: (stopId: string) => void
  // onTransitModeChange——選填:點擊卡片頂部的交通資訊列(.transitRow)
  // 彈出一個簡易選單讓使用者切換交通方式,選了之後呼叫並傳入這個節點的
  // id(到達站,對齊 TransitInfo 掛在到達站自己身上的既有設計)與選定的
  // mode 字串。視覺/字串值對齊 PlanTimelineView.tsx 的
  // TRANSIT_MODE_OPTIONS/canPickMode 既有邏輯(見下方 TRANSIT_MODE_OPTIONS
  // 的完整說明),但不照搬那邊的 DOM 結構——沒有傳這個 prop 時
  // .transitRow 維持原本純展示、不可點擊,模擬層的外觀完全不變。
  onTransitModeChange?: (stopId: string, mode: string) => void
  // isGenerating——2026-10 新增(使用者明確要求「模擬的部分也加入推論中
  // 的信號,讓圖卡佔位先出現」):對齊縱向版 PlanTimelineView.tsx 的
  // isThinking,「AI 正在排下一站、還沒有這一站的具體資料」這個比
  // status.loading(單一已存在站點正在查詢詳細資料)更前面的狀態——
  // isGenerating 為 true 時,卡片列尾端補一張呼吸點+骨架卡,預告「還有
  // 一站正在生成」,steps 為空(還沒有任何站點)時不顯示骨架卡,只顯示
  // 呼吸點本身(見下方渲染邏輯,對齊縱向版同一條件判斷)。選填,省略時
  // 視為 false,維持改動前的既有外觀(呼叫端尚未提供這個訊號時,不出現
  // 任何骨架卡)。
  isGenerating?: boolean
  // focusLatest——2026-10 新增(使用者明確要求首頁展示「第一張卡滿版,
  // 第二個骨架推論中時,第一張壓小……後面比照前面」):卡片寬度不再是
  // 所有卡片統一的固定 78%/320px(見 .card 的完整說明),改成「目前
  // 最新一張(最後一張,不論是已完成的地點卡還是還在推論中的骨架卡)
  // 滿版佔據可視寬度,其餘較早的卡片一律縮小排在左側」,並自動捲動讓
  // 最新卡片進入可視範圍——視覺上是一張一張把前面的卡「壓」向左側堆疊
  // 讓位給最新進度,縮小後的舊卡仍保留在卷軸列裡,使用者仍能捲動/點擊
  // 回去查看(這個元件本身的捲動/選取邏輯不變,只是寬度不再固定)。
  //
  // 只有首頁展示(AiPlanPhoneDemoScreen.tsx 在捲動模式下呼叫)傳
  // true——/ai-plan 完整展示頁的手機版維持原本「所有卡片固定寬度、
  // 使用者自由橫向瀏覽全部站點」的既有體驗,不受這個新版面邏輯影響。
  // 選填,省略時視為 false,維持改動前的固定寬度行為。
  focusLatest?: boolean
  // dimmed——選填,2026-10 新增(使用者明確要求「對話氣泡出現時,時間軸
  // 淡化」)。原本由呼叫端(TripPlanPage.tsx)算出「目前有一則新鮮
  // (非 stale)的泡泡正顯示」這個條件後傳進來;泡泡本身搬進這個元件
  // 內部後(見下方 agentBubbleRow 的完整說明:使用者明確指出泡泡「不
  // 應該放在輸入匡區」),這個判斷現在改成內部用 latestMessage 自己
  // 算(見下方 effectiveDimmed),省略這個 prop 時走內部算出的值。
  // 仍然保留外部覆寫的管道(受控/非受控雙模式,對齊 showAskPage 等
  // 既有 prop 的同一個模式)——明確傳入時以外部值為準,純視覺 class
  // 切換,不影響底下卡片列的捲動/選取/拖拉互動(pointer-events 不變,
  // 淡化期間仍然可以操作時間軸,只是視覺上退到背景)。
  dimmed?: boolean
  // showAskPage/onAskPageDone——2026-10(使用者明確要求「詢問頁的內容
  // 跟啟動要可以透過程式自己啟動,也要讓 AI 的工具來啟動」):原本
  // showAskPage 是這個元件自己內部管理的 state,改成受控——呼叫端
  // (TripPlanPage.tsx)把 state 提升上去,才能同時被兩個入口驅動:
  // (1) 程式自己(使用者互動、進頁預設顯示)直接呼叫 setter;(2) AI
  // 工具(見 plan-core/askPageTools.ts 的 open_ask_page)透過獨立的
  // AskPageCtx 呼叫同一個 setter。兩者共用同一份狀態,不會有「AI 觸發
  // 完、使用者馬上手動切換」這種兩條路徑各自維護狀態、互相打架的問題。
  //
  // 省略時退回內部自行管理(預設 true,一進頁顯示詢問頁)——維持這個
  // 元件可以獨立掛載測試/使用,不強制呼叫端一定要接上外部狀態管理,
  // 對齊 onRemoveStop 等其餘選填 prop 的既有慣例(省略時該功能的最小
  // 可用行為仍然成立)。
  //
  // onAskPageDone 現在帶一個 AskPageSelection[] 參數(2026-10 第二輪,
  // 使用者明確要求「open_ask_page 要可以輸出 attraction id 與
  // place id,前端拿到後用對應的 UI 呈現」)——AskPage.tsx 的 onDone
  // 回報使用者選了哪些候選,這個元件只是原樣轉呼叫給呼叫端,不在這裡
  // 處理選擇結果本身(例如要不要接著呼叫 add_attraction),那是呼叫端
  // (TripPlanPage.tsx 的 askPageCtx)的職責,見該處的完整說明。
  showAskPage?: boolean
  onAskPageDone?: (selected: AskPageSelection[]) => void
  // onAskPageBack——2026-10(第十輪,使用者明確要求「將國家與地區的
  // 工具分開,並做自動串接」)原樣轉傳給 AskPage 的 onBack prop(見該
  // 元件 CityPanel 的完整說明:「返回上一層」按鈕)。選填,理由同
  // onAskPageDone——不是每個呼叫端都需要這個功能(例如
  // home/plan-ai-sim/Content.tsx 的展示頁劇本不支援真正的國家/城市串接)。
  onAskPageBack?: (countryIds?: string[]) => void
  // askPageInput——showAskPage 為 true 時傳給 AskPage 顯示候選景點卡片所需
  // 的輸入(AskPage 用的 dataSource 改由 PlanDataProvider 提供,見元件內 usePlanData)。選填:這個元件本身可能在完全不會開詢問頁的情境下
  // 掛載(例如只是純展示捲動、showAskPage 固定 false 的呼叫端),這種
  // 情況不需要呼叫端準備這兩個值。showAskPage 為 true 卻沒有傳
  // askPageInput 時,AskPage 收到空候選清單,顯示一個沒有候選卡片、
  // 只剩「不用了」按鈕可按的空狀態——不會因為缺這個 prop 而整頁壞掉。
  //
  // askPageInput——2026-10(使用者明確要求「open_ask_page 輸入支援一個
  // 模式,探查模式」)取代原本的 askPageCandidates,改成承載 candidates
  // 或 explore 其中一種(見 plan-core/askPageTools.ts
  // AskPageCtx.openAskPage 的完整說明),原樣轉傳給 AskPage,這個元件
  // 不需要知道兩種模式的差異。2026-10(第二輪,使用者明確要求「後端的
  // 純文字對話也統一在 ask page 裡面顯示對話氣泡」)新增 text 形態,
  // 見 AskPage.tsx input 聯集與該檔案「第四輪」的完整說明。
  askPageInput?: AskPageInput
  // renderAskPage——2026-10(使用者明確要求「ask page 內的感興趣的景點
  // 詢問,可以用挖洞的方式,再撥放態置換成可以由腳本控制的原件」、
  // 「所以是要做在被置換的原件上,與正式使用的不一樣」):把「用哪一份
  // 詢問頁」挖成一個洞,由呼叫端決定。
  //
  // 這個元件有三個呼叫端,對詢問頁的需求不同:
  //   TripPlanPage(/app 推論態)——真實互動,用正式的 AskPage。
  //   plan-ai-sim/Content(播放態)——自動演示,置換成 ScriptedAskPage
  //     (劇本指定選哪幾張、演出點擊特效、時間到自己送出)。
  //   AiPlanPhoneDemoScreen(小展示)——目前不顯示詢問頁。
  // 省略時用正式的 AskPage(非受控預設),對齊這個元件 showAskPage/
  // dimmed 等既有 prop 的受控/非受控雙模式。
  //
  // 為什麼是 render prop 而不是一個 `scripted?: boolean` 旗標:這個
  // 元件不該知道「播放態」這個概念,也不該 import 只有播放態會用到的
  // 元件——那會讓推論態的打包結果夾帶展示用的程式碼。交出渲染權,
  // 它只需要知道「這塊空間要放詢問頁」。
  renderAskPage?: () => ReactNode
  // onRetryStop——地點資料查詢失敗的站點上顯示「重試」按鈕,語意同
  // PlanTimelineView 的同名 prop(見該處的完整說明)。
  //
  // 2026-10（review 發現）：這個元件原本對 failed 零處理,而手機版
  // 的 /app 走的正是這條橫向路徑——手機使用者實際上拿不到重試入口。
  onRetryStop?: (id: string) => void
  // nodeStatus——選填:節點執行狀態表(loading/failed/removing,見 plan-core/planNodeStatus.ts)。卡片的骨架(查詢中)
  // 與查詢失敗樣式讀這裡;省略時視同所有節點都沒有狀態(只剩資料本身可判斷的失敗:有 placeId 沒座標)。
  nodeStatus?: NodeStatusMap
  // stackedLayout——2026-10 新增,見 .wrapStacked 的完整說明:首頁
  // frameless 展示的 stacked 模式下傳 true,關掉 .wrap 內建的
  // margin-top: auto 貼底機制(那是 /ai-plan 完整展示頁 .timelinePanel
  // 疊圖版面專用的既有推力,在 stacked 模式的 grid 容器裡本來就不會
  // 產生任何效果,但明確關掉能切斷這個元件的排版邏輯去依賴/牽連外層
  // 容器的實作細節,不是遷就它去設計外層)。選填,省略時維持原本的
  // margin-top: auto 行為,/ai-plan 展示頁與 TripPlanPage 不受影響。
  stackedLayout?: boolean
}

// MIN_SEGMENT_MINUTES——沒有 duration 可解析、或下一站時間早於/等於這一
// 站時間時，時間尺區塊的最小寬度（以分鐘為單位折算），避免站點時間資料
// 不完整時算出寬度為 0 或負值的區塊。純粹是版面防呆，不代表真實停留
// 時長。
const MIN_SEGMENT_MINUTES = 20

// parseDurationMinutes——PlanNodeData.duration 目前的型別是自由格式字串
// （例如 "90 分鐘"、"60 分"、"1h"、"1.5h"，見 planTimeline.ts
// PlanNodeData.duration 的型別定義——沒有固定格式規則，是後端/模擬腳本
// 想填什麼字串就填什麼字串），不是結構化的分鐘數。
//
// 2026-10 修正(使用者實機回報「只有一個點時，時間軸線上的已安排樣式
// 比例不對」):原本這裡只抓字串裡第一段連續數字當分鐘數，完全沒有判斷
// 單位——"停留 1h" 被誤判成 1 分鐘(抓到的數字是 "1"，但那個 1 的單位
// 其實是小時，真正的時長是 60 分鐘)，導致只有一站時算出的區塊寬度
// 對應「1 分鐘」而非「1 小時」，在時間尺上幾乎看不出寬度、視覺比例
// 嚴重失真(本專案模擬腳本 planSimScript.ts 大量使用 "1h"/"2h"/"1.5h"
// 這種帶小時單位的格式，不是只有邊界情況才會踩到)。
//
// 改成先判斷字串裡是否出現 "h"(大小寫不拘，對齊既有資料一律小寫 h 的
// 慣例，不特判 "小時"/"hr" 等其他寫法，模擬腳本與未來後端資料若用那些
// 格式會在這裡被判定成查無單位、retreat 到分鐘數邏輯，不是故意要支援
// 多種單位寫法)：有 h 時抓出數字當「小時」乘以 60(支援 "1.5h" 這種
// 小數小時，故用 parseFloat 而非 Number.isInteger 限制)；沒有 h 時維持
// 原本邏輯，字串裡第一段連續數字當分鐘數。
function parseDurationMinutes(duration: string | undefined): number | null {
  if (!duration) return null
  if (/h/i.test(duration)) {
    const match = duration.match(/\d+(\.\d+)?/)
    if (!match) return null
    const hours = Number(match[0])
    return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null
  }
  const match = duration.match(/\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

function timeToMinutesOfDay(time: string | undefined): number | null {
  if (!time) return null
  const match = time.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor((minutes % (24 * 60)) / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// StopSegment——時間尺/卡片共用的每一站計算結果。startMinutes/
// endMinutes 用來算時間尺的區塊寬度與位置；endMinutes 找不到明確時長
// 時退回 startMinutes + MIN_SEGMENT_MINUTES，只是版面計算用，不會拿來
// 顯示（顯示仍然只顯示開始時間，或連同有效的結束時間，見 formatTimeRange）。
interface StopSegment {
  node: PlanNode
  startMinutes: number | null
  endMinutes: number | null
  // durationLabel——卡片要不要顯示「起訖時間」區間字串，取決於
  // duration 有沒有解析出實際分鐘數（見 parseDurationMinutes 的完整
  // 說明)：解析不出來時只顯示開始時間，不要憑空捏造一個結束時間顯示
  // 給使用者看。
  hasParsedDuration: boolean
}

function buildSegments(stops: PlanNode[]): StopSegment[] {
  return stops.map((node) => {
    const startMinutes = timeToMinutesOfDay(node.time)
    const parsedDuration = parseDurationMinutes(node.duration)
    const hasParsedDuration = startMinutes != null && parsedDuration != null
    const endMinutes =
      startMinutes == null
        ? null
        : parsedDuration != null
          ? startMinutes + parsedDuration
          : startMinutes + MIN_SEGMENT_MINUTES
    return { node, startMinutes, endMinutes, hasParsedDuration }
  })
}

// formatTimeRange——卡片上的起訖時間顯示。有解析出 duration 時顯示
// "09:00–10:15" 這種區間格式（對齊方案二設計稿），沒有時只顯示開始
// 時間本身，不勉強拼出一個看起來像區間但其實是瞎猜的結束時間。
function formatTimeRange(seg: StopSegment): string {
  if (seg.startMinutes == null) return seg.node.time ?? ''
  if (seg.hasParsedDuration && seg.endMinutes != null) {
    return `${minutesToLabel(seg.startMinutes)}–${minutesToLabel(seg.endMinutes)}`
  }
  return minutesToLabel(seg.startMinutes)
}

// NOTE_CATEGORY_META——備註分類→配色 token/圖示的對照表。配色沿用
// trip-plan/TripPlanPage.tsx 既有 NOTE_STYLES 的 --ios-* token 選色
// （consideration 用中性灰、info 用 sand、cost 用 green、weather 用
// blue），維持整個專案「同一種備註分類在哪個畫面都長一樣顏色」的既有
// 印象，不另外發明一套新配色。
//
// 圖示改用純線條 SVG（見下方 NoteIcon 元件），不延用 TripPlanPage.tsx
// 那邊的 emoji（✦/ⓘ/💰/☁︎）——這是刻意的取捨，不是單純喜好：
//   1. emoji 的實際字型/粗細/基線對齊跨平台渲染差異很大（iOS/Android/
//      不同字體設定可能長得不一樣甚至缺字），這個新卡片的時間尺/圖示
//      已經大量採用線條 SVG 語言（交通方式圖示等），備註圖示若維持
//      emoji 會在同一張卡片裡出現兩種截然不同的視覺語彙（線條 vs 全彩
//      emoji），反而比沿用既有 emoji 更不一致。
//   2. 這個元件是新設計稿落地的第一個實作，沒有既有使用者已經熟悉的
//      emoji 版本需要維持視覺連續性（不是在改一個使用者已經習慣的
//      既有畫面），不存在「為了一致性保留舊圖示」的理由。
// 分類字串本身（consideration/info/cost/weather）與配色 token 仍然
// 直接對齊 TripPlanPage.tsx 的 NOTE_STYLES，只有圖示呈現方式不同。
// 對照表本身(NOTE_CATEGORY_META、DEFAULT_NOTE_CATEGORY)已抽到 plan-core/planPresentation.ts,與縱向時間軸/TripPlanPage 共用同一份;
// 這個檔案只保留橫向卡片專屬的圖示繪製(下方 NoteIcon)。

function resolveNoteMeta(note: NoteInfo) {
  return NOTE_CATEGORY_META[note.category ?? ''] ?? NOTE_CATEGORY_META[DEFAULT_NOTE_CATEGORY]
}

// NoteIcon——備註分類的純線條 SVG 圖示（見上方 NOTE_CATEGORY_META 的
// 完整說明，取代 emoji）。全部用 currentColor 描邊，顏色由外層套用
// colorVar 決定，不在這裡寫死顏色。
function NoteIcon({ kind }: { kind: 'star' | 'info' | 'cost' | 'weather' }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (kind === 'star') {
    return (
      <svg {...common}>
        <path d="M12 3l2.2 5.6 6 .5-4.6 3.9 1.5 5.9L12 15.8 6.9 18.9l1.5-5.9-4.6-3.9 6-.5L12 3z" />
      </svg>
    )
  }
  if (kind === 'cost') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5c0-1.4 1.1-2.3 2.6-2.3 1.6 0 2.7 1 2.7 2.2 0 2.9-5.3 1.6-5.3 4.4 0 1.3 1.2 2.3 2.7 2.3 1.5 0 2.6-.9 2.6-2.3" />
      </svg>
    )
  }
  if (kind === 'weather') {
    return (
      <svg {...common}>
        <path d="M7.5 18a4 4 0 1 1 .7-7.9A5 5 0 0 1 18 11.5 3.5 3.5 0 0 1 17.5 18h-10z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.5h.01M11 11.5h1v5h1" />
    </svg>
  )
}

// TransitIcon——交通方式的純線條 SVG（卡片頂部「從上一站○○抵達」列用）。
// mode 字串同時對齊兩種既有來源的既有值：
//   - 模擬資料來源（planAiFakeDataSource.ts）用的英文字串
//     drive/car/transit/bus/bike/cycle；
//   - 2026-10 新增:真實後端（server/internal/api/geo_plan_ai.go
//     estimateTransitMode/iconForTransitMode）用的中文字串
//     開車/公車/捷運/步行（見 TRANSIT_MODE_OPTIONS 的完整說明——這個
//     元件現在也被交接後的真實層共用,transitFromPrev.mode 可能是這組
//     真實字串，不是只有模擬腳本的英文字串）。
// 找不到對應的一律退回步行圖示，不阻塞渲染。
function TransitIcon({ mode }: { mode: string | undefined }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (mode === 'drive' || mode === 'car' || mode === '開車') {
    return (
      <svg {...common}>
        <path d="M4 16l1.5-5A2 2 0 0 1 7.4 9.5h9.2a2 2 0 0 1 1.9 1.5L20 16" />
        <rect x="3" y="16" width="18" height="4" rx="1.2" />
        <circle cx="7.5" cy="20" r="1.2" />
        <circle cx="16.5" cy="20" r="1.2" />
      </svg>
    )
  }
  if (mode === 'transit' || mode === 'bus' || mode === '公車' || mode === '捷運' || mode === '大眾運輸') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="13" rx="2" />
        <path d="M4 11h16M8 20l1.5-3M16 20l-1.5-3" />
      </svg>
    )
  }
  if (mode === 'bike' || mode === 'cycle') {
    return (
      <svg {...common}>
        <circle cx="6" cy="17" r="3" />
        <circle cx="18" cy="17" r="3" />
        <path d="M6 17l4-8h4l3 8M10 9h4" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="4.5" r="1.8" />
      <path d="M12 7v5l-3 3M12 12l3 4M9 10l-3 1.5" />
    </svg>
  )
}

// TRANSIT_MODE_OPTIONS——交通方式選單選項(見 onTransitModeChange prop 的完整說明)。字串值與縱向時間軸共用同一份
// (plan-core/planPresentation.ts 的 TRANSIT_MODE_CHOICES,對齊後端 geo_plan_ai.go 認得的中文字串);
// 這裡不帶圖示(橫向選單目前只顯示文字)。
const TRANSIT_MODE_OPTIONS = TRANSIT_MODE_CHOICES

export function HorizontalPlanTimeline({
  timeline,
  selectedStopId,
  onSelectStop,
  onSelectThemeChild,
  onOpenPhotos,
  onHeightChange,
  onRemoveStop,
  onPanToStop,
  onTransitModeChange,
  isGenerating = false,
  focusLatest = false,
  dimmed: dimmedProp,
  showAskPage: showAskPageProp,
  onAskPageDone,
  onAskPageBack,
  askPageInput,
  renderAskPage,
  onRetryStop,
  nodeStatus,
  stackedLayout = false,
}: HorizontalPlanTimelineProps) {
  // showAskPageState/showAskPageSetter——受控/非受控雙模式(對齊
  // selectStop 等既有呼叫端的同一個既有模式):呼叫端有傳 showAskPage
  // prop 時,顯示的值跟寫入動作都以呼叫端為準(內部這份 state 完全
  // 不使用);沒傳時退回這個元件自己管理。預設 false(2026-10 改回,
  // 使用者明確要求「一開始先不要出現詢問頁」,/ai-plan 展示模擬頁與
  // 正式 /app 頁面行為一致)——詢問頁只透過程式呼叫或 AI 的
  // open_ask_page 工具主動開啟。見 HorizontalPlanTimelineProps.
  // showAskPage 的完整說明。
  const [internalShowAskPage, setInternalShowAskPage] = useState(false)
  const showAskPage = showAskPageProp ?? internalShowAskPage
  const handleAskPageDone = onAskPageDone ?? (() => setInternalShowAskPage(false))
  // 資料存取層與解析結果都向 PlanDataProvider 取(2026-10:原本由 dataSource prop 傳入、內部自己起一個解析 hook 實例)。
  const { dataSource: askPageDataSource } = usePlanData()
  // resolvedRefs——主題點/候選卡底下的 attractions/places id 經資料存取層查回來的顯示資料(只在執行時)。
  const allNodes = useMemo(() => listNodes(timeline), [timeline])
  // 旅館的 placeId 一併解析(名稱顯示在住宿卡上),見 plan-core/useResolvedNodeRefs.ts 的「住宿」一節。
  const lodgings = lodgingsOf(timeline)
  const resolvedRefs = useResolvedRefs(allNodes, lodgings)

  // stops——只取 type === 'stop' 的節點，見檔頭說明。對話訊息(獨立於時間軸的 PlanConversation)在這個元件裡完全不渲染。
  //
  // 空的天(沒有任何 stop):沒有卡片就沒辦法滑過去、也選不到。為每個空的天補一個「佔位站點」(id 沿用那一天的 PlanDay.id、day 為
  // 它是第幾天),讓它跟一般卡片走同一套卷軸/吸附/置中偵測/選取;渲染時用 emptyDayIds 辨認並畫成「這一天還沒有行程」
  // 的佔位卡(見下方 emptyDay 分支)。選取它時 onSelectStop 收到的是 day.id,呼叫端找不到對應站點,不會移動地圖。
  //
  // 住宿卡(PlanTimeline.lodgings):同樣的做法再用一次——旅館不是 stop,但要能滑到、能選取,所以在它入住日(第一個停留日)
  // 那天第一張卡之前合成一個佔位項目(id 就是旅館 id、day 為入住日、沒有 time/duration),用 lodgingById 辨認並畫成窄版住宿卡
  // (見下方 lodging 分支);連住的後續天不重複。佔位項目沒有時間,所以不影響時間尺(buildSegments 算出的 startMinutes 為 null,
  // dayHasTime 不計它);也不是真的 stop,onSelectStop 收到旅館 id,呼叫端的地圖若有同 id 的旅館圓點(座標由 placeId 查)
  // 就選取並平移,沒有座標就不會移動。同一天有多筆旅館(換旅館那天)依 lodgings 順序各一張。
  const { stops, emptyDayIds, lodgingById } = useMemo(() => {
    const out: PlanNode[] = []
    const empty = new Set<string>()
    const lodgingMap = new Map<string, PlanLodging>()
    timeline.days.forEach((day, i) => {
      for (const l of lodgingsStartingOnDay(timeline, day.id)) {
        lodgingMap.set(l.id, l)
        out.push({ id: l.id, type: 'stop', day: i + 1, name: l.name })
      }
      const dayStops = day.nodes.filter((n) => n.type === 'stop')
      if (dayStops.length === 0) {
        empty.add(day.id)
        out.push({ id: day.id, type: 'stop', day: i + 1, name: `Day ${i + 1}` })
      } else {
        for (const n of dayStops) out.push(withDay(n, i + 1))
      }
    })
    return { stops: out as (PlanNode & { type: 'stop' })[], emptyDayIds: empty, lodgingById: lodgingMap }
  }, [timeline])
  const segments = useMemo(() => buildSegments(stops), [stops])

  // isSingleCard——2026-10 使用者明確要求「只有單張卡片時要滿版」:
  // 目前卷軸列裡總共只有一張卡時,這張卡改用真正的 width: 100%(見
  // .singleCard 的完整說明)——有兩張以上時,所有卡片一律維持固定的
  // 78%/320px(見 .card 的完整說明),「目前焦點在哪」純粹靠捲動位置
  // 表達,不再靠寬度差異。單張卡片是唯一的例外:此時沒有「捲動到其他
  // 卡片旁邊」這件事可言,維持窄版寬度只會讓畫面中央/右側留下不自然的
  // 大片空白,滿版才符合「這是畫面上唯一內容」的直覺。
  // 2026-10(第二輪,使用者明確要求「安排中時就加入一張卡片,只是這張
  // 卡片沒有資料時就呈現骨架卡」):骨架卡現在就是 stops 陣列裡的一筆
  // 真實節點(loading:true、沒有資料,見 home/plan-ai-sim/Content.tsx
  // ws.onmessage thinking 分支的完整說明),不再是額外獨立渲染的一塊,
  // 不需要再加上 isGenerating 的 +1 補償——stops.length 本身已經涵蓋
  // 骨架卡。
  const isSingleCard = stops.length === 1

  // selectedNote/selectedNoteMeta——2026-10(使用者明確要求「橫向的
  // note 放在時間軸跟圖片卡中間的區域」):備註從「每張卡片各自顯示
  // 自己的備註」改成「整個元件外層一塊全寬的備註區,顯示目前選中那
  // 一站的備註」,位置在 .ruler(時間尺)跟 .scroller(卡片列)之間。
  // 這裡只找出目前選中節點的 note,實際渲染在 .ruler 之後。
  const selectedNote = useMemo(
    () => stops.find((s) => s.id === selectedStopId)?.note ?? null,
    [stops, selectedStopId],
  )
  const selectedNoteMeta = useMemo(() => (selectedNote ? resolveNoteMeta(selectedNote) : null), [selectedNote])

  // effectiveDimmed——見 HorizontalPlanTimelineProps.dimmed 的完整
  // 說明:呼叫端明確傳入時以外部值為準,否則預設不淡化。
  //
  // 2026-10(第二輪,使用者明確要求「後端的純文字對話也統一在 ask page
  // 裡面顯示對話氣泡」):文字氣泡從這個元件自己渲染的 agentBubbleRow
  // (見下方 showAskPage JSX 註解的完整說明,原本跟卡片列同時顯示,
  // 疊在卡片列之上)搬進 AskPage.tsx 內部渲染。.wrapDimmed 套在這個
  // 元件的最外層容器(見下方 JSX),AskPage 本身是這個容器的子元素
  // ——若沿用「showAskPage 顯示中就淡化」當預設值,等於連 AskPage
  // (候選卡片/探查中/文字氣泡)自己都被壓到 0.45 透明度,使用者會
  // 覺得整個詢問畫面「看起來霧霧的」,這不是原本「氣泡蓋在卡片列上
  // 方、讓卡片列退到背景」的語意,是這次搬動衍生出的新問題。文字氣泡
  // 現在就是 AskPage 本身的內容,不再是疊加在卡片列上方的獨立元素,
  // 不需要靠淡化卡片列來讓它突出,因此拿掉這個預設值,恆不淡化
  // (呼叫端仍可透過 dimmedProp 明確要求淡化,只是沒有內部自動觸發)。
  const effectiveDimmed = dimmedProp ?? false

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // dayTransition——跨日過渡的連續進度(使用者明確要求「不要用快速滑入
  // 的動畫,使用跟卡片同步進場,也就是當天最後張卡開始往左滑時,軸線
  // 也跟著移動,滑到第二天第一張卡為中心時,軸線滑動結束」)。
  //
  // 改動前是「事件觸發的動畫」:currentDay 一翻,舊軸線整個卸掉、新的
  // 播一次 0.32s 滑入。那是固定時長的獨立動畫,跟使用者手指的捲動速度
  // 無關——捲得慢時軸線早就播完了還在捲,捲得快時軸線還在播卡片已經
  // 到位,兩者節奏永遠對不上。
  //
  // 改成捲動位置驅動:from(當天最後一張卡置中)到 to(隔天第一張卡
  // 置中)這段捲動距離,線性對應到軸線位移 0 → 100%。使用者捲到一半
  // 停下來,軸線就停在一半;往回捲,軸線跟著往回——完全是同一個手勢的
  // 連續結果,不是兩件各自計時的事。
  //
  // null 代表「目前不在跨日過渡中」,照常只渲染 currentDay 那一條。
  const [dayTransition, setDayTransition] = useState<{
    // fromDay/toDay——過渡的兩端。progress 0 時完全顯示 fromDay,
    // 1 時完全顯示 toDay。
    fromDay: number
    toDay: number
    // progress——0~1。toDay 比 fromDay 大代表往後翻(新軸線從右邊
    // 進來),反之往前翻(從左邊進來),方向由兩個 day 的大小決定,
    // 不需要另外記錄。
    progress: number
  } | null>(null)
  // mountedIdsRef——2026-10 新增(使用者明確要求「每張新卡片發位時都要
  // 從右側滑到左側」):追蹤「已經播過進場動畫的站點 id」,對齊縱向版
  // PlanTimelineView.tsx 的同一種 justMounted 設計(見該處的完整說明:
  // 用 id 而非陣列 index 判斷,插入到中間的節點才能正確觸發進場動畫)。
  // 橫向版原本刻意不需要這套機制(檔頭註解提過「不再需要
  // mountedIdsRef...這套縱向版的輔助機制」),但那時沒有進場動畫需求,
  // 現在需要重新加回——跟縱向版不同的是,這裡自己管理這個 ref(不是
  // 由呼叫端擁有再傳進來),因為這個動畫是這個元件自己的視覺細節,不是
  // 需要跨元件共享的狀態。 */
  const mountedIdsRef = useRef<Set<string>>(new Set())
  // programmaticScrollRef——區分「使用者手指滑動觸發的捲動」跟「點擊卡片/
  // 時間尺後程式自己呼叫 scrollIntoView 觸發的捲動」：後者不該在捲動
  // 過程中被 onScroll 的置中偵測邏輯反過來又 setSelectedStop 一次（本來
  // 就是同一個 id，但避免捲動期間算出的「目前最接近置中」暫時是別張卡
  // 而短暫觸發錯誤的高亮跳動）。
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  // userDraggingRef——2026-10 新增(使用者明確回報「手動拉動進行中時,
  // 要忽略自動捲動」):原本的自動捲動 effect(見 wasGeneratingRef 的
  // 完整說明)只處理了「selectedStopId 任意變化不該觸發」,但沒處理
  // 「使用者手指還按著拖曳卡片列時,剛好骨架卡轉成正式卡」這種情境——
  // justFinishedGenerating 依然會成立,還是會把使用者正在進行的拖曳
  // 搶走。用 pointerdown~pointerup/cancel 標記「手指是否還按在卡片列
  // 上」,自動捲動 effect 在這段期間整個跳過(見下方 useEffect)。用
  // pointer 事件而非 touch/mouse 分開寫,是因為 .scroller 同時要支援
  // 觸控裝置跟滑鼠拖曳捲動,pointer 事件統一兩者不用各寫一套。 */
  const userDraggingRef = useRef(false)

  // failedPhotoUrls——對齊縱向版 PlanTimelineView 的既有降級模式:某張
  // Google 照片網址載入失敗時記下來,之後渲染一律跳過它,不會卡在一張
  // 破圖上(見縱向版 markPhotoFailed/usablePhotos 的完整說明)。這裡
  // 每張卡只顯示第一張可用照片(橫向卡片空間有限,不像縱向版支援多圖
  // Lightbox 切換入口,但 Lightbox 開啟後仍會把整組 googlePhotoUrls
  // 傳進去,裡面本來就能左右切換瀏覽全部照片)。
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Set<string>>(new Set())
  const markPhotoFailed = useCallback((url: string) => {
    setFailedPhotoUrls((prev) => {
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }, [])

  // openTransitMenuStopId——目前展開交通方式選單的那張卡片所屬的
  // stopId(見 onTransitModeChange prop 的完整說明),null 代表沒有任何
  // 選單展開。對齊縱向版 PlanTimelineView.tsx openTransitMenuStopId 的
  // 同一種「單一值互斥」設計(見該處的完整說明)。
  const [openTransitMenuStopId, setOpenTransitMenuStopId] = useState<string | null>(null)
  useEffect(() => {
    if (openTransitMenuStopId == null) return
    const handleDocClick = () => setOpenTransitMenuStopId(null)
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [openTransitMenuStopId])

  // 2026-10 使用者明確要求「骨架卡當成一般卡片,推論後轉為正式卡時才
  // 把畫面推進,推進的段落點只依是不是邊緣卡有不同」:新增 isEdgeCard
  // 參數——是卷軸列目前最後一張卡片(不論是地點卡還是骨架卡)時,不用
  // scrollIntoView 的標準 inline:'end'(那會讓卡片右邊緣完全貼齊可視
  // 範圍右邊界,使用者回報「貼齊螢幕邊緣不好看,要留一點空間」),改成
  // 手動計算捲動位置:卡片右邊緣對齊可視範圍右邊界之後,再往左偏移
  // EDGE_CARD_RIGHT_GAP 當留白,讓邊緣卡跟中間卡視覺上的留白量接近。
  // 不是最後一張時,維持原本 inline:'center' 置中(對齊設計稿「捲動改變
  // 選取」的既有語意)。
  const scrollToStop = useCallback((stopId: string, behavior: ScrollBehavior = 'smooth', isEdgeCard = false) => {
    const card = cardRefs.current.get(stopId)
    if (!card) return
    programmaticScrollRef.current = true
    if (programmaticScrollTimerRef.current != null) window.clearTimeout(programmaticScrollTimerRef.current)
    // isEdgeCard 用 inline:'end',搭配 .edgeCard 的 scroll-snap-align:end
    // 與 .scroller 的 scroll-padding-right(見兩者的完整說明)——留白量
    // 由 CSS 的 scroll-padding-right 決定,這裡不用手動算 scrollLeft:
    // 手動算過(見本檔案 git 歷史),但 scroll-snap-type:x mandatory 在
    // 捲動動畫結束後一定會重新套用 snap 對齊,把手動算的位置蓋掉,
    // 所以真正該調整留白量的地方是 CSS 的 scroll-padding,不是這裡的
    // JS 計算。
    card.scrollIntoView({ behavior, inline: isEdgeCard ? 'end' : 'center', block: 'nearest' })
    // 捲動動畫(smooth)需要時間完成，這段期間持續忽略 onScroll 的置中
    // 偵測，600ms 足夠涵蓋一般的 smooth scrollIntoView 動畫時長。
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false
    }, 600)
  }, [])

  const handleSelect = useCallback((stopId: string) => {
    onSelectStop(stopId)
    scrollToStop(stopId)
  }, [onSelectStop, scrollToStop])

  // 自動捲動——2026-10 合併成單一 effect(原本是兩個獨立 effect:一個
  // 依 selectedStopId 捲到真實卡片、一個依 isGenerating 捲到骨架卡,
  // 使用者實機回報「按第二下骨架消失,地點沒有出現」,懷疑兩個 effect
  // 在同一個 render 週期各自呼叫 scrollIntoView 互相競爭,導致地點卡
  // 其實已經插入成功、卻被捲動衝突帶出可視範圍。合併成一個 effect、
  // 依 isGenerating 優先權互斥決定要捲到哪裡,不管是不是真正根因,
  // 兩個獨立 effect 同時各自搶著呼叫 scrollIntoView 本來就不該共存,
  // 合併後更安全:
  //   - isGenerating 為 true 時(focusLatest 模式下,骨架卡正顯示),
  //     捲到骨架卡(skeletonCardRef,見該 ref 的完整說明)。
  //   - isGenerating 為 false 時,維持原本「外部選取狀態改變時捲到
  //     對應真實卡片」的既有邏輯(方案二設計稿「雙向連動」地圖→卡片
  //     這一半,見 selectedStopId 的完整說明)。
  // 2026-10(第四輪,使用者明確要求「把骨架卡當成一般卡片,推論後把
  // 骨架轉為正式卡,把往畫面推進,就可以達到正確效果,只有推進的段落
  // 點會依照是不是邊緣卡有不同」):骨架卡出現時(isGenerating 為
  // true)不再有任何特殊捲動邏輯——前兩輪分別試過「完整置中」「貼齊
  // 右邊界」「手動算固定露出比例」,都是把骨架卡當成特殊情況處理。
  // 改成骨架卡完全比照一般卡片:它加進 .scrollerTrack 尾端時,捲動
  // 位置維持原地不動(交給瀏覽器捲動列表的既有排列自然呈現,使用者
  // 目前停留的位置看不看得到它,是正常捲動列表本來就會有的行為)。
  // 只有在 isGenerating 結束(骨架轉成正式地點卡)的那一刻,才真正
  // 觸發一次捲動——推進到這張剛完成的卡片,isEdgeCard 判斷它是不是
  // stops 陣列最後一張(見 scrollToStop 的完整說明:是最後一張就貼齊
  // 右邊界,不是的話維持原本置中)。
  // wasGeneratingRef——2026-10 修正「手動拖曳途中卡片被強制拉走」:
  // 原本這個 effect 的依賴包含 selectedStopId,任何造成 selectedStopId
  // 改變的原因都會觸發自動捲動——但 handleScroll(使用者手動捲動/拖曳
  // 中)本身就會即時更新 selectedStopId(見該函式的完整說明:捲動時
  // 同步選取離中心最近的卡片),於是使用者手指還沒放開,這個 effect
  // 就先因為 selectedStopId 變了而呼叫 scrollToStop,把使用者正在
  // 進行的拖曳搶走。這個 effect 真正該回應的只有一種情境:isGenerating
  // 剛從 true 轉成 false(骨架卡轉成正式卡)的那一刻,不是 selectedStopId
  // 本身的任意變化。用這個 ref 記錄上一次的 isGenerating,只有偵測到
  // 「剛結束生成」這個轉換瞬間才真正推進捲動。
  const wasGeneratingRef = useRef(isGenerating)
  // lastStopIdRef——2026-10 修正「骨架卡轉成地點時沒有拉到中間,要等
  // 下一輪才生效」:原本這個 effect 判斷「該不該捲」(isGenerating 剛
  // 轉 false)跟「該捲去哪」(讀 selectedStopId)分別來自兩個不同步的
  // 來源——selectedStopId 是由上層(plan-ai-sim/Content)另一個 effect
  // 在偵測到新站點後才非同步呼叫 setSelectedStopId 更新,這個更新發生
  // 在「下一次」渲染,不是跟 isGenerating 轉 false 同一個 commit。這個
  // effect 執行當下讀到的 selectedStopId prop 因此還是上一張卡的舊值,
  // 捲去的目標是錯的,等到 selectedStopId 終於追上時,isGenerating 已經
  // 不再轉換,這個 effect 不會重新執行,只好等「下一輪」isGenerating 再
  // 轉一次 false 才連帶捲對。改成直接讀 stops 陣列本身的最後一筆 id
  // (不透過 selectedStopId 這個間接、時機不保證同步的中介),搭配
  // isGenerating 剛轉 false 的時機,兩者都是同一個 commit 內的最新值,
  // 不會有這個時間差。
  const lastStopId = stops.length > 0 ? stops[stops.length - 1].id : null
  useEffect(() => {
    const justFinishedGenerating = wasGeneratingRef.current && !isGenerating
    wasGeneratingRef.current = isGenerating
    if (focusLatest && isGenerating) return
    if (!focusLatest) return
    if (!justFinishedGenerating) return
    // userDraggingRef——見該 ref 的完整說明:使用者手指還按在卡片列上
    // 時,即使這一刻剛好是 justFinishedGenerating,也要整個跳過,不要
    // 把使用者正在進行的拖曳搶走。
    if (userDraggingRef.current) return
    if (lastStopId == null) return
    // 2026-10 新增(使用者明確要求「拉動到其他卡片時,不要自動捲到
    // 最新」):userDraggingRef 只在手指還按著的那段期間為 true,手指
    // 一放開就重設回 false——擋得住「正在拖曳中」的瞬間,擋不住「已經
    // 拉完、放開手指、正停留在某張舊卡片上」這個更長的後續狀態。這裡
    // 額外判斷 selectedStopId 是否還是最新那張卡:使用者手動捲動
    // (handleScroll)或點擊舊卡片(handleSelect)都會把 selectedStopId
    // 改成非最後一張卡片的 id,只要這個狀態還沒變回最後一張,就代表
    // 使用者仍在主動回看先前的站點,自動捲動應該持續讓位,不要把使用者
    // 正在看的畫面搶走——直到使用者自己捲回/點回最新卡片(此時
    // selectedStopId 自然等於 lastStopId),或整段劇本重新開始(見
    // home/plan-ai-sim/Content.tsx reset 分支,時間軸清空後 stops 歸零,
    // lastStopId 變成 null,這個判斷自然不再適用)才恢復自動捲動。
    if (selectedStopId !== lastStopId) return
    const isEdgeCard = true
    scrollToStop(lastStopId, 'smooth', isEdgeCard)
    // lastStopId 放進依賴——這正是這次要修正的時機問題(見上方
    // lastStopIdRef 的完整說明):isGenerating 轉 false 跟 stops 新增
    // 最後一筆節點兩者理應同一個 commit,但 lastStopId 可能因為
    // React 批次處理的細節在下一個 render 才更新,放進依賴能確保
    // lastStopId 真正更新的那次 render,這個 effect 一定會再檢查一次。
    // 不放 stops/scrollToStop:stops 整個陣列每次都是新參照(見原本
    // 這裡的說明),只有 lastStopId(衍生出的穩定字串)才是真正該追蹤
    // 的值;scrollToStop 是空依賴的 useCallback,恆定不變,不需要放。
    // selectedStopId 同樣刻意不放進依賴:這個 effect 真正該回應的觸發
    // 源只有「isGenerating 剛轉 false」這一刻(justFinishedGenerating),
    // selectedStopId 只是這個時刻裡用來判斷「現在要不要捲」的條件值,
    // 不該是另一個獨立觸發源——若放進依賴,使用者手動捲動造成
    // selectedStopId 改變時,這個 effect 會重新執行一次(雖然此時
    // justFinishedGenerating 會是 false 而提早 return,實際不會真的
    // 捲動,但仍是一次不必要的重跑),執行時讀到的是當輪 render 的最新
    // 閉包值,不需要靠依賴陣列確保值是新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLatest, isGenerating, lastStopId])

  // handleScroll——偵測目前最接近「卡片列水平置中」的卡片，同步更新
  // selectedStopId（方案二設計稿「捲動改變選取」的那一半連動）。
  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const scrollerRect = scroller.getBoundingClientRect()
    const scrollerCenter = scrollerRect.left + scrollerRect.width / 2
    let closestId: string | null = null
    let closestDist = Infinity
    for (const stop of stops) {
      const card = cardRefs.current.get(stop.id)
      if (!card) continue
      const rect = card.getBoundingClientRect()
      const cardCenter = rect.left + rect.width / 2
      const dist = Math.abs(cardCenter - scrollerCenter)
      if (dist < closestDist) {
        closestDist = dist
        closestId = stop.id
      }
    }
    if (closestId != null && closestId !== selectedStopId) onSelectStop(closestId)

    // 跨日過渡進度——沿用上面已經量到的捲動中心,不另外再跑一次
    // getBoundingClientRect(見 dayTransition 的完整說明)。
    //
    // 找出捲動中心目前落在哪兩張相鄰卡片之間,若那兩張分屬不同天,
    // 就用中心在這兩張卡之間走了多少比例當作過渡進度。
    //
    // 用「相鄰兩張卡」而不是「當天最後一張與隔天第一張」:那兩者在
    // stops 陣列裡本來就是相鄰的(同一天的站點連續排列),直接看相鄰
    // 對更單純,也自然涵蓋「中間插了骨架卡」之類的情況。
    let transition: { fromDay: number; toDay: number; progress: number } | null = null
    for (let i = 0; i < stops.length - 1; i += 1) {
      const leftDay = stops[i].day ?? 1
      const rightDay = stops[i + 1].day ?? 1
      if (leftDay === rightDay) continue
      const leftCard = cardRefs.current.get(stops[i].id)
      const rightCard = cardRefs.current.get(stops[i + 1].id)
      if (!leftCard || !rightCard) continue
      const leftRect = leftCard.getBoundingClientRect()
      const rightRect = rightCard.getBoundingClientRect()
      const leftCenter = leftRect.left + leftRect.width / 2
      const rightCenter = rightRect.left + rightRect.width / 2
      const span = rightCenter - leftCenter
      if (span <= 0) continue
      const raw = (scrollerCenter - leftCenter) / span
      // 夾在 0~1:捲動中心還沒走到左卡(raw < 0)或已經越過右卡
      // (raw > 1)時,這一對不再是「正在過渡中」,進度分別是兩個
      // 端點值。只有 0 < raw < 1 才真的在過渡區間裡。
      if (raw <= 0 || raw >= 1) continue
      transition = { fromDay: leftDay, toDay: rightDay, progress: raw }
      break
    }
    // 只在真的有變化時才 setState——handleScroll 每次捲動事件都會跑,
    // 無條件 setState 會在不跨日的整段捲動過程中持續觸發重新渲染。
    setDayTransition((prev) => {
      if (prev === transition) return prev
      if (prev == null || transition == null) return transition
      if (
        prev.fromDay === transition.fromDay &&
        prev.toDay === transition.toDay &&
        Math.abs(prev.progress - transition.progress) < 0.005
      ) {
        // 進度變化小於 0.5% 時不更新——捲動事件的觸發頻率遠高於肉眼
        // 能分辨的位移,過濾掉這些微小變化可以省下大量重新渲染。
        return prev
      }
      return transition
    })
  }, [stops, selectedStopId, onSelectStop])

  // handleUserDragStart/End——見 userDraggingRef 的完整說明。pointerup/
  // pointercancel 都要重設,涵蓋「正常放開」跟「捲動中途被其他手勢/
  // 系統手勢中斷」兩種情境,避免 ref 卡在 true 之後自動捲動永遠被跳過。
  const handleUserDragStart = useCallback(() => {
    userDraggingRef.current = true
  }, [])
  const handleUserDragEnd = useCallback(() => {
    userDraggingRef.current = false
  }, [])

  // currentDay——目前選中站點所屬的天數,驅動時間尺要顯示哪一天的範圍
  // (見下方 timelineRange 的完整說明)。選不到(selectedStopId 是
  // null,或對應不到任何現有站點——例如剛清空重播)時退回第一個有
  // segment 的 day,對齊「還沒有明確選取時預設看第一天」的直覺。
  const currentDay = useMemo(() => {
    const selected = segments.find((s) => s.node.id === selectedStopId)
    if (selected) return selected.node.day ?? 1
    return segments[0]?.node.day ?? 1
  }, [segments, selectedStopId])

  // 時間尺區塊定位——2026-10 使用者明確要求「時間軸線是一天」:原本
  // 用整體時間範圍(第一站開始~最後一站結束)當分母,跨天行程會把
  // Day 1 跟 Day 2 的時間壓進同一條軸線,比例嚴重失真(例如 Day 1
  // 只佔軌道一小段、Day 2 佔大半,視覺上無法判斷「這是兩天」)。改成
  // 只取 currentDay 當天的 segments,軸線代表的永遠是「這一天的時間
  // 範圍」,換天時(見下方 JSX 的完整說明)整條軸線連同內容一起換掉,
  // 不是同一條軌道硬塞兩天的資料。
  // segmentsByDay——依天分組,讓過渡中的兩條軸線各自拿自己那天的資料
  // (改動前只算 currentDay 一天的,因為同時只渲染一條)。
  const segmentsByDay = useMemo(() => {
    const map = new Map<number, typeof segments>()
    for (const seg of segments) {
      const day = seg.node.day ?? 1
      const list = map.get(day)
      if (list) list.push(seg)
      else map.set(day, [seg])
    }
    return map
  }, [segments])

  // allDays——使用者明確要求「讓時間尺有 zoom in/zoom out 的切換,zoom
  // out 的時候顯示所有天,推論時用 zoom out」:isGenerating 期間時間尺
  // 整個換成「跨天總覽」渲染(見下方 .ruler JSX 裡 isGenerating 的
  // 條件分支),這裡算出排序後的完整天數清單給那個分支用。currentDay
  // 永遠併入清單(即使它還沒有任何 segment——例如剛跨到新的一天、第
  // 一站還在生成中),否則「正在排的這一天」在總覽裡會完全消失,跟
  // isGenerating 原本想呈現的「還有進度正在進行」的語意矛盾。 */
  const allDays = useMemo(() => {
    const days = new Set(segmentsByDay.keys())
    days.add(currentDay)
    return Array.from(days).sort((a, b) => a - b)
  }, [segmentsByDay, currentDay])

  // hasZoomedOut——使用者明確要求「開始推論時就進入 zoom out,不自動
  // zoom in」:一旦 isGenerating 第一次轉 true,整個元件生命週期內
  // 永久維持 zoom out,即使這次推論結束(isGenerating 轉 false)或之後
  // 又有新的推論週期,都不會自動切回 zoom in(見下方 showZoomOut 的
  // 完整說明)。用獨立的 state 記住這件事,不能直接拿 isGenerating 本身
  // 當總覽模式的開關——isGenerating 是瞬時的、推論結束就變 false,
  // 若直接拿它當條件會在每次推論結束時自動切回單日細節,正是這次要
  // 拿掉的行為。
  const [hasZoomedOut, setHasZoomedOut] = useState(false)
  useEffect(() => {
    if (isGenerating) setHasZoomedOut(true)
  }, [isGenerating])
  // showZoomOut——真正驅動 .ruler 渲染哪個分支的條件:只要曾經進入過
  // zoom out(hasZoomedOut),或者「現在正在推論但這是第一次,
  // hasZoomedOut 的 state 更新還沒反映到這一輪渲染」(isGenerating 剛
  // 轉 true 的那個 commit,useEffect 要等下一輪才會執行,直接讀
  // hasZoomedOut 會慢半拍、第一次推論開始的那一幀還是 zoom in 畫面)
  // 就顯示總覽。兩個條件用 || 合併,涵蓋「state 還沒追上」的那一瞬間。
  // ZOOM_OUT_ENABLED(檔案最上方的模組層級開關)目前是 false,見該常數
  // 的完整說明。
  const showZoomOut = ZOOM_OUT_ENABLED && (hasZoomedOut || isGenerating)

  // visibleDays——目前要渲染哪幾條軸線。
  //
  // 不在跨日過渡中時只有 currentDay 一條(跟改動前相同);過渡中則同時
  // 渲染 fromDay 與 toDay 兩條,各自依 progress 位移,呈現「舊的往一邊
  // 退出、新的從另一邊進來」的連續過程(見 dayTransition 的完整說明)。
  //
  // 位移量的推導:兩條軌道都相對 .ruler 的寬度做 translateX(%)。
  // 往後翻(toDay > fromDay)時,新軸線從右邊進來——
  //   from: 0% → -100%(往左退出)
  //   to: +100% → 0%(從右進來)
  // 往前翻則是鏡像(正負號對調)。forward 這個布林就是判斷方向的依據,
  // 不需要像改動前那樣另外用 ref 記住前一次的 day:過渡的兩端本來就
  // 都在 dayTransition 裡。
  // isTransitioning——是否正在跨日過渡中。過渡中兩條軌道要疊在同一個
  // 定位基準上(.rulerTrackHost + .rulerTrackSliding,見該處的完整
  // 說明);不在過渡中時維持改動前的單一 block 軌道,不套任何定位,
  // 避免為了一個暫時狀態改變平常的版面結構。
  const isTransitioning = dayTransition != null
  const visibleDays = useMemo(() => {
    if (!dayTransition) return [{ day: currentDay, offsetPct: 0 }]
    const { fromDay, toDay, progress } = dayTransition
    const forward = toDay > fromDay
    const sign = forward ? 1 : -1
    return [
      { day: fromDay, offsetPct: -sign * progress * 100 },
      { day: toDay, offsetPct: sign * (1 - progress) * 100 },
    ]
  }, [dayTransition, currentDay])
  // 2026-10(第二輪,使用者實機回報「只有一個點時,時間軸線上的已安排
  // 樣式比例不對」):原本分母是「當天第一站開始~最後一站結束」動態
  // 算出來的範圍,只有一站時 min/max 必然收斂成等於那一站自己的時長,
  // 數學上這一站的寬度永遠算出 100%——不是比例計算錯誤,是分母的設計
  // 本身有問題:使用者確認「軸線分母應該固定代表一整天」,不是跟著
  // 已排站點動態縮放。改成固定 00:00~24:00(1440 分鐘)當分母,不再
  // 依賴 daySegments 的內容計算——這代表只要 currentDay 有解析出任何
  // 一個有效時間的站點,時間尺就會渲染(見下方 hasAnyTime),但區塊
  // 寬度/位置永遠相對一整天計算,不會因為站點數量或時長而讓整條軌道
  // 重新縮放基準。
  // dayHasTime——某一天有沒有任何可解析時間的站點。沒有的話那條軸線
  // 不渲染(改動前是整個 timelineRange 為 null 就不渲染時間尺)。
  // 範圍本身固定是 00:00~24:00,不隨內容變動,所以不需要 per-day 算。
  const dayHasTime = useCallback(
    (day: number) =>
      (segmentsByDay.get(day) ?? []).some((s) => s.startMinutes != null && s.endMinutes != null),
    [segmentsByDay],
  )
  const timelineRange = useMemo(() => {
    // 仍保留這個值給下方「要不要渲染整個 .ruler 區塊」的判斷使用——
    // 只要目前這一天有時間就渲染,跟改動前的條件一致。
    if (!dayHasTime(currentDay)) return null
    return { min: 0, total: 24 * 60 }
  }, [dayHasTime, currentDay])

  // wrapElement/setWrapElement——量測這個元件自己的實際渲染高度(見
  // onHeightChange 參數的完整說明)。這裡刻意不用既有的 useElementHeight
  // hook(見該檔案的完整說明:ResizeObserver 持續監聽)——那支 hook 的
  // useEffect 依賴是 [ref](RefObject 物件本身,不會隨 .current 改變而
  // 觸發 effect 重跑)。這個元件在 stops 為空時會整段 return null(見
  // 下方判斷),初次掛載當下 ref.current 必然是 null,effect 跑過一次
  // 就直接 return、不會掛上 ResizeObserver;之後 stops 真的有內容、
  // .wrap 真正渲染出來時,ref 物件參照沒有變,effect 不會重新執行,
  // ResizeObserver 永遠沒機會掛上去(實機測試發現的真實 bug:大多數
  // 情況下 onHeightChange 一直回報 0,地圖視覺中心偏移完全沒有觸發)。
  // 改用 callback ref(state 存放 DOM 節點本身,節點改變時 state 一定
  // 跟著變、觸發 effect 重新執行)解決這個問題,不去改動 useElementHeight
  // 本身(那是跨元件共用的 hook,其餘既有呼叫端的元素一直都存在、不會
  // 從 null 變成非 null,沒有這個問題,不需要為了這裡的特例影響它們)。
  const [wrapElement, setWrapElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!wrapElement) return
    const report = () => onHeightChange?.(wrapElement.getBoundingClientRect().height)
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(wrapElement)
    return () => observer.disconnect()
  }, [wrapElement, onHeightChange])

  // 2026-10(第四輪):移除「沒有站點又沒在生成就整個不渲染」的早退。
  // 根因(使用者實機回報「播放態的輸入匡位置不對」查證後確認):composer
  // 在第三輪重構後改成 .panel 正常文件流的最後一個子項,排在這個元件
  // 的 .wrap 之後(見 PlanOverlayPanel.tsx children 的渲染順序)——這個
  // 元件 return null 時,.panel 裡就只剩 composer 一個看得見的子項,
  // 沒有任何內容把它推到底部,導致打字動畫階段(此時 stops 為空、
  // isGenerating 也還是 false,因為 usePlanSimSocket 要等 promptTyped
  // 才開始播放)composer 貼在面板頂端,跟其他階段的底部位置不一致。
  // 固定渲染 .wrap 這個外框(内容仍然可以是空的,見下方 .ruler/.scroller
  // 各自的條件渲染),讓 composer 的版面位置不隨這個元件的內容多寡而
  // 跳動,使用者明確要求「從頭到尾都用同一個 UI 佈局外框」。

  return (
    <div
      className={`${styles.wrap} ${effectiveDimmed ? styles.wrapDimmed : ''} ${stackedLayout ? styles.wrapStacked : ''}`}
      ref={setWrapElement}
    >
      {/* selectedNoteBanner——全寬備註區,2026-10 使用者明確要求「移動到
          時間軸的軸線上方」,從原本夾在時間尺(.ruler)跟卡片列
          (.scroller)之間,移到時間尺之前(見 selectedNote/selectedNoteMeta
          的完整說明)。沒有備註時渲染一個等高的透明佔位(維持固定版面
          高度,不讓下方內容隨選中站點有沒有備註而上下跳動——跟卡片固定
          height 的理由一致)。 */}
      <div className={styles.noteBanner}>
        {selectedNote && selectedNoteMeta ? (
          <div className={styles.noteBannerContent} style={{ color: selectedNoteMeta.colorVar }}>
            <span className={styles.noteIcon}><NoteIcon kind={selectedNoteMeta.icon} /></span>
            <span className={styles.noteText}>{selectedNote.text}</span>
          </div>
        ) : null}
      </div>

      {/* 2026-10 使用者明確要求「呼吸點,放在時間軸的軸線上」:原本
          呼吸點放在卷軸列(.scroller)尾端、跟卡片同排,改成插進這條
          時間尺軌道(.rulerTrack)裡,表達「還在排下一段時間」的語意
          比卷軸尾端更直接——時間尺本身就是「已排時間進度」的視覺化,
          呼吸點接在已排進度之後正是「進度條還在前進」的直覺呈現。
          這段渲染條件改成 timelineRange || isGenerating——沒有任何
          已排時間資料(連第一站都還沒生成)時,timelineRange 是 null、
          原本整段 .ruler 不會渲染,但 isGenerating 時仍需要軌道本身
          存在,才有地方放呼吸點(此時軌道是空的,只有呼吸點釦在最左端,
          見下方 tipLeftPct 的完整說明)。
          2026-10(第三輪,使用者明確要求「第二天時,時間軸線往左滑,
          使用一個新的軸線」):.rulerTrack 補上 key={currentDay},
          currentDay 改變(見該變數的完整說明:跟著 selectedStopId 走,
          捲到第二天第一站卡片時翻成 2)時強制 React 卸掉舊的
          .rulerTrack 重新掛一個全新的——這是讓「整條軸線換掉」而不是
          「同一條軌道裡的內容淡入淡出」的關鍵,搭配 .module.css
          滑動進場動畫(見該處的完整說明),呈現「新的一天軸線滑入」
          的視覺轉場。
          只有進場、沒有離場動畫:React 卸載舊節點是同步的,CSS 無法
          對一個已經不在 DOM 裡的元素做過渡。要真的做出「舊的滑出、
          新的滑入」得同時保留兩個節點並自己管理卸載時機(或引入
          轉場函式庫),目前的單一進場動畫在視覺上已經足夠表達「換了
          一條軸線」。
          2026-10(使用者明確要求「換日時軸線抽換要依照往前或往後用
          不同方向」):進場方向依 dayDirection 決定(見該變數的完整
          說明),往後一天從右邊滑入、往前一天從左邊滑入。
          2026-10(第四輪,使用者回報「點任何卡片都會讓時間軸線重整」):
          動畫 class 從 .rulerTrack 基礎樣式拆成獨立的進場 class
          (見該處的完整說明),這裡固定掛上其中一個方向——因為動畫只綁
          key={currentDay} 改變時才真正被掛載的新節點上,不換天時這個
          節點完全不會被重新建立,class 雖然寫在 JSX 裡但不會被瀏覽器
          重新套用,不會重播。 */}
      {(timelineRange || showZoomOut) && (
        <div className={styles.ruler} role="list" aria-label="行程時間尺">
        {showZoomOut ? (
          /* zoomOutTrack——使用者明確要求「讓時間尺有 zoom in/zoom out
             的切換,zoom out 的時候顯示所有天,推論時用 zoom out」,
             後續再要求「開始推論時就進入 zoom out,不自動 zoom in」:
             驅動這個分支的條件是 showZoomOut(見該變數的完整說明),
             不是直接用 isGenerating——一旦進入過 zoom out,即使這次
             推論結束也不會自動切回下面的 zoom in 分支。
             顯示內容本身(總覽軌道)仍然只取決於 allDays/currentDay
             這些資料,跟 isGenerating 本身是否仍為 true 無關。取代
             下面 zoom in 分支的單日 24 小時範圍 + 跨日滑動過渡邏輯——
             兩者是完全不同的尺度(一條代表 1 天、一條代表整趟行程的
             N 天),不是同一條軸線的參數調整,所以用 if/else 分成兩條
             獨立的渲染路徑,不要勉強共用同一套 visibleDays/位移計算。
             推論結束(isGenerating 轉 false)後自動切回下面的 zoom in
             分支,不需要使用者手動切換(使用者明確要求「先不做手動,
             安排中跟安排完成自動切換」)。
             每天等寬均分軸線寬度(使用者明確要求,不依每天安排密度
             調整比例)、不可點擊(使用者明確要求「純簡覽用」,故不是
             <button> 而是 <div>,也不接 onClick/aria-label 導覽語意)。
             呼吸泛光(.rulerTrackGenerating)疊在 currentDay 對應的那
             一段上,延續 zoom in 分支「正在排的那一天在發光」的既有
             語意。 */
          <div className={styles.rulerTrack} role="presentation">
            {allDays.map((day, i) => {
              // overviewDaySegments——這一天的行程點,用來在總覽段落內
              // 畫出小圓點標記(使用者實機回報「zoom out 的時間尺沒有
              // 標行程點」/「時間尺上的行程點都不見了」:這個分支原本
              // 完全沒有渲染任何子元素,只有一塊空的等寬色段)。
              const overviewDaySegments = segmentsByDay.get(day) ?? []
              return (
              <div
                key={day}
                className={`${styles.rulerOverviewSegment}${day === currentDay ? ` ${styles.rulerTrackGenerating}` : ''}`}
                style={{ left: `${(i / allDays.length) * 100}%`, width: `${(1 / allDays.length) * 100}%` }}
                aria-hidden="true"
              >
                {/* rulerOverviewDot——使用者明確要求「改回色塊,跟
                    .rulerSegment 一致」(一開始用小圓點,理由是總覽段落
                    已經被切得很窄,膠囊造型容易擠在一起分不清楚,但
                    使用者選擇優先維持視覺一致性):沿用 .rulerSegment
                    同一套膠囊外觀(border-radius: 999px、同樣的
                    --ios-blue 底色/opacity),只是定位邏輯不同——這裡
                    沒有精確的時間比例可用(zoom out 本來就不依實際時間,
                    見 allDays 均分段落寬度的既有設計),改成把這一天的
                    站點數量等距切分段落內部空間,每站各佔 1/N 寬度,
                    視覺上仍然是「色塊並排」而不是離散的點。 */}
                {overviewDaySegments.map((seg, segIndex) => (
                  <span
                    key={seg.node.id}
                    className={styles.rulerOverviewDot}
                    style={{
                      left: `${(segIndex / overviewDaySegments.length) * 100}%`,
                      width: `${(1 / overviewDaySegments.length) * 100}%`,
                    }}
                  />
                ))}
              </div>
              )
            })}
          </div>
        ) : (
          <>
          {/* 跨日過渡中會同時渲染兩條軌道(fromDay/toDay),各自依
              offsetPct 位移,整個過程跟著卡片列的捲動位置連續變化
              (見 visibleDays 與 dayTransition 的完整說明)。不在過渡
              中時 visibleDays 只有一筆,offsetPct 為 0,跟改動前的
              單一軌道完全一樣。
              key 用 day 而不是索引:過渡結束後陣列從兩筆縮回一筆,
              用索引會讓 React 把留下來的那條當成「第 0 條換了內容」
              而重建 DOM,用 day 才能正確辨識出它就是原本那一條。 */}
          <div className={isTransitioning ? styles.rulerTrackHost : undefined}>
          {visibleDays.map(({ day, offsetPct }) => {
            const daySegments = segmentsByDay.get(day) ?? []
            const hasTime = dayHasTime(day)
            // 這一天沒有任何可解析時間的站點就不渲染——過渡中若其中
            // 一天還沒排出時間(例如剛跨到新的一天、第一站還在生成),
            // 只會看到有內容的那一條在動,不是一條空軌道跟著滑。
            if (!hasTime && !isGenerating) return null
            const range = { min: 0, total: 24 * 60 }
            return (
          <div
            key={day}
            // rulerTrackGenerating——使用者明確要求「安排中的呼吸小點,
            // 改成讓整個時間軸軸線用呼吸燈」:原本獨立的 .tipDot 小圓點
            // 整個移除,改成直接疊加這個 class 讓整條軌道的背景本身
            // 脈動。條件沿用原本 .tipDot 的既有判斷(isGenerating 且是
            // 「最新的那一天」day === currentDay)——呼吸只該出現在正在
            // 排的那一天軌道上,過渡中不該兩條軌道一起脈動。
            className={`${styles.rulerTrack}${isTransitioning ? ` ${styles.rulerTrackSliding}` : ''}${isGenerating && day === currentDay ? ` ${styles.rulerTrackGenerating}` : ''}`}
            style={isTransitioning ? { transform: `translateX(${offsetPct}%)` } : undefined}
          >
            {hasTime && daySegments.map((seg) => {
              if (seg.startMinutes == null || seg.endMinutes == null) return null
              const leftPct = ((seg.startMinutes - range.min) / range.total) * 100
              const widthPct = Math.max(((seg.endMinutes - seg.startMinutes) / range.total) * 100, 2)
              const isSelected = seg.node.id === selectedStopId
              return (
                <Fragment key={seg.node.id}>
                  <button
                    type="button"
                    role="listitem"
                    className={`${styles.rulerSegment} ${isSelected ? styles.rulerSegmentSelected : ''}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    aria-label={`跳到 ${seg.node.name ?? seg.node.id}`}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => handleSelect(seg.node.id)}
                  />
                  {/* rulerSegmentTime——2026-10 使用者明確要求「手機版,
                      時間顯示在軸線上方,只有選到時才顯示」:選中的段落
                      上方浮出這段的起訖時間(用 formatTimeRange,跟卡片
                      上顯示的時間格式一致),沒選中時完全不渲染(不是
                      opacity:0 藏起來,避免軸線在非選中狀態時擠滿一堆
                      看不到卻還佔位的文字節點)。aria-hidden——
                      aria-label 已經在上面的按鈕上完整表達「跳到 X」,
                      這段文字純粹是視覺重複,不需要再被螢幕閱讀器念
                      一次。 */}
                  {isSelected && (
                    <span
                      className={styles.rulerSegmentTime}
                      style={{ left: `${leftPct + widthPct / 2}%` }}
                      aria-hidden="true"
                    >
                      {formatTimeRange(seg)}
                    </span>
                  )}
                </Fragment>
              )
            })}
          </div>
            )
          })}
          </div>
          </>
        )}
        </div>
      )}

      {/* showAskPage——詢問頁/軸線頁互斥顯示(見該 state 的完整說明),
          架構打通階段:詢問頁完成時呼叫 onDone 把這裡切回 false,軌道
          切回下方既有的 .scroller 卡片列,不需要任何過場動畫或額外
          狀態——同一塊版面空間,簡單的條件渲染切換即可。
          2026-10(使用者明確要求「後端的純文字對話也統一在 ask page
          裡面顯示對話氣泡」):原本這裡在 showAskPage 區塊之前還獨立
          渲染一個 agentBubbleRow(對話氣泡,不受 showAskPage 控制,
          跟卡片列/詢問頁同時顯示),現已移除——純文字回覆改成 AskPage
          的第三種 input 形態(見該元件 input 聯集與 onAssistantMessage
          呼叫處的完整說明),氣泡統一由 AskPage 內部渲染,不再有「兩塊
          各自獨立顯示」的情況。 */}
      {showAskPage ? (
        renderAskPage ? (
          renderAskPage()
        ) : (
          <AskPage
            dataSource={askPageDataSource}
            input={askPageInput ?? { candidates: [] }}
            onDone={handleAskPageDone}
            onBack={onAskPageBack}
          />
        )
      ) : (
      <div
        className={styles.scroller}
        ref={scrollerRef}
        onScroll={handleScroll}
        onPointerDown={handleUserDragStart}
        onPointerUp={handleUserDragEnd}
        onPointerCancel={handleUserDragEnd}
      >
        <div className={styles.scrollerTrack}>
          {segments.map((seg, idx) => {
            const node = seg.node
            // status——這一站的執行狀態(查詢中/失敗),來自狀態表,不在節點上。
            const status = nodeStatusOf(nodeStatus, node.id)
            // themeChildren——節點只存 id(attractions/places),名稱、座標、照片是執行時經資料存取層
            // 解析的結果(resolvedRefs,見 plan-core/useResolvedNodeRefs.ts);查詢完成前是只有 id 的最小項目。
            const themeChildren = resolveNodeRefChildren(node, resolvedRefs)
            const isSelected = node.id === selectedStopId
            const transit: TransitInfo | undefined = node.transitFromPrev
            const day = node.day ?? 1
            const prevDay = idx > 0 ? (segments[idx - 1].node.day ?? 1) : null
            const showDayBadge = prevDay == null || prevDay !== day
            // justMounted——2026-10 新增(使用者明確要求「每張新卡片發位
            // 時都要從右側滑到左側」):這個站點 id 是不是第一次出現在
            // 畫面上,對齊縱向版 PlanTimelineView.tsx 的同一個判斷方式
            // (見 mountedIdsRef 的完整說明)。在 render 階段讀取、在 ref
            // callback 裡才真正寫入(見下方) ——讀的時機必須早於寫入,
            // 否則第一次 render 時就已經標記過,justMounted 永遠是
            // false,動畫不會播放。
            const justMounted = !mountedIdsRef.current.has(node.id)
            // isEdgeCard——segments 跟 stops 是 1:1 對應(見 segments 的
            // 完整說明),idx 是最後一筆即代表這是目前卷軸列最後一張卡,
            // 套用 .edgeCard(見該 class 的完整說明:scroll-snap-align
            // 改成 end,讓 scrollToStop 手動算的留白不被 snap 吸附蓋掉)。
            const isEdgeCard = idx === segments.length - 1
            // candidateCards——2026-10 使用者明確要求「製作多個候選點的
            // 圖卡,原本的一個圖卡裡面,放入多個小格,讓使用者選要去
            // 哪裡」「可選的狀態跟地點集合是不一樣的,原本的卡片要換成
            // 是多個小格子的樣子」:這個節點是候選卡時,整張卡片完全不
            // 走下方「單一地點」的渲染路徑(沒有單一地點可以代表這整張
            // 卡,不適用 photoBanner/name/desc/handleSelect 這套「點整張
            // 卡=選中這一站」的既有語意)——獨立成自己的分支,見下方
            // CandidateCardTile 的完整說明。只保留 dayBadge(跨天分隔
            // 標籤,維持使用者在時間軸上辨認第幾天的既有視覺,見該元素
            // 的完整說明)跟卡片固定尺寸外觀(.card 本身的寬高/圓角/
            // 卷軸吸附設定),其餘單一地點卡才有意義的內容
            // (photoBanner/交通資訊/刪除按鈕等)全部不渲染。
            // lodging——住宿卡(見上方 stops 的說明):窄版、虛線邊(同空天佔位卡的「不是要去的地方」語言),
            // 只有 Day 標籤(這天第一張卡時)、🛏️、旅館名稱(placeId 查到的優先,再 name,再「住宿」)與停留區間(「Day 2–4」)。
            // 沒有照片/時間/交通/按鈕;點擊與一般卡片一樣置中並選取。
            const lodging = lodgingById.get(node.id)
            if (lodging) {
              const lodgingName = resolveLodging(lodging, resolvedRefs).name ?? LODGING_FALLBACK_NAME
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(node.id, el)
                      mountedIdsRef.current.add(node.id)
                    } else {
                      cardRefs.current.delete(node.id)
                    }
                  }}
                  className={`${styles.card} ${styles.lodgingCard} ${justMounted ? styles.cardSlideIn : ''} ${isEdgeCard ? styles.edgeCard : ''}`}
                  data-lodging-id={lodging.id}
                  role="button"
                  tabIndex={0}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => handleSelect(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelect(node.id)
                    }
                  }}
                >
                  {showDayBadge && <span className={styles.dayBadge}>Day {day}</span>}
                  <div className={styles.lodgingBody}>
                    <span className={styles.lodgingIcon} aria-hidden="true">🛏️</span>
                    <span className={styles.lodgingName}>{lodgingName}</span>
                    <span className={styles.lodgingSpan}>{lodgingSpanLabel(timeline, lodging)}</span>
                  </div>
                </div>
              )
            }
            // emptyDay——空的一天的佔位卡(見上方 stops 的說明):只有 Day 標籤與一句說明,沒有照片/時間/交通/按鈕。
            if (emptyDayIds.has(node.id)) {
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(node.id, el)
                      mountedIdsRef.current.add(node.id)
                    } else {
                      cardRefs.current.delete(node.id)
                    }
                  }}
                  className={`${styles.card} ${styles.emptyDayCard} ${justMounted ? styles.cardSlideIn : ''} ${isSingleCard ? styles.singleCard : ''} ${isEdgeCard ? styles.edgeCard : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => handleSelect(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelect(node.id)
                    }
                  }}
                >
                  <span className={styles.dayBadge}>Day {day}</span>
                  <div className={styles.emptyDayBody}>
                    <span className={styles.emptyDayTitle}>這一天還沒有行程</span>
                    <span className={styles.emptyDayHint}>跟 AI 說想怎麼排這一天，或回到地圖挑地點加入</span>
                  </div>
                </div>
              )
            }
            if (node.candidateCards) {
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(node.id, el)
                      mountedIdsRef.current.add(node.id)
                    } else {
                      cardRefs.current.delete(node.id)
                    }
                  }}
                  className={`${styles.card} ${styles.candidateCard} ${justMounted ? styles.cardSlideIn : ''} ${isSingleCard ? styles.singleCard : ''} ${isEdgeCard ? styles.edgeCard : ''}`}
                >
                  {showDayBadge && <span className={styles.dayBadge}>Day {day}</span>}
                  <div className={styles.candidateGrid} role="list" aria-label={`${node.name ?? '候選地點'}的候選地點`}>
                    {themeChildren.map((child) => {
                      const childPhoto = child.googlePhotoUrls?.[0]
                      return (
                        <button
                          key={child.id}
                          type="button"
                          role="listitem"
                          className={styles.candidateTile}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectThemeChild?.(node.id, child)
                          }}
                        >
                          {childPhoto ? (
                            <img src={childPhoto} alt="" className={styles.candidateThumb} />
                          ) : (
                            <div className={styles.candidateThumb} style={{ background: child.thumbBg }} aria-hidden="true">
                              {child.thumbIcon}
                            </div>
                          )}
                          {/* farFromNext——2026-10 使用者明確要求「出現
                              選擇時,有比較遠的行程時,要有一個標誌讓
                              使用者知道,可能需要調整後續時間」(見
                              PlanThemeChild.farFromNext 的完整說明)。
                              疊在格子右上角的警示徽章,title 屬性在桌面
                              滑鼠 hover 時提供完整說明文字(手機版沒有
                              hover,但 aria-label 仍讓螢幕閱讀器完整
                              念出,不是純裝飾性圖示)。 */}
                          {child.farFromNext && (
                            <span
                              className={styles.candidateFarBadge}
                              title="這個候選距離下一站較遠，選擇後可能需要調整後續行程時間"
                              aria-label="距離下一站較遠，選擇後可能需要調整後續行程時間"
                            >
                              ⚠️
                            </span>
                          )}
                          <span className={styles.candidateLabel}>{child.name ?? child.id}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }

            return (
              <div
                key={node.id}
                ref={(el) => {
                  if (el) {
                    cardRefs.current.set(node.id, el)
                    mountedIdsRef.current.add(node.id)
                  } else {
                    cardRefs.current.delete(node.id)
                  }
                }}
                // 2026-10 使用者明確要求「手機版的卡片不用選中的邊匡,
                // 中心卡片就是選到的卡」:不再套用 .cardSelected(邊框
                // 顏色/陰影/向上位移,見該 class 的完整說明)——捲動置中
                // 本身就等同選取(見 handleScroll 的既有語意),額外的
                // 選中樣式是多餘的視覺雜訊。isSelected 這個值保留,仍然
                // 驅動 aria-current(可及性,螢幕閱讀器需要知道目前選取
                // 哪一張,跟視覺呈現是獨立的兩件事)。
                className={`${styles.card} ${justMounted ? styles.cardSlideIn : ''} ${isSingleCard ? styles.singleCard : ''} ${isEdgeCard ? styles.edgeCard : ''}`}
                role="button"
                tabIndex={0}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => handleSelect(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleSelect(node.id)
                  }
                }}
              >
                {/* photoBanner——景點照片(見 PlanNodeData.googlePhotoUrls
                    的完整說明:真實 Google Places 查詢回來的照片),對齊
                    縱向版 PlanTimelineView 的既有用法,但這裡改成卡片頂部
                    的橫幅樣式(比照卡片 320px 寬度調整,不是縱向版那種
                    64px 圓形縮圖)——橫向卡片本來就以單一站點為主角展示,
                    橫幅照片比小縮圖更適合這個版面語意。usablePhotos 過濾
                    掉已知載入失敗的網址(見 failedPhotoUrls 的完整說明)。
                    點擊開啟全螢幕 Lightbox(onOpenPhotos),傳入完整
                    googlePhotoUrls 陣列,Lightbox 內部本身就支援多圖
                    左右切換,不需要這裡自己做切換 UI。
                    渲染順序在 dayBadge 之前(而非之後)——實機測試發現的
                    真實 bug:.photoBanner 用負邊距往上貼齊卡片頂端(見
                    該 class 的完整說明),若排在 dayBadge 後面,會直接
                    蓋住徽章的下半部。改成 dayBadge 用 position: absolute
                    疊在照片(或卡片頂端,沒有照片時)上面,兩者各自的
                    渲染順序不再互相影響彼此的視覺位置。
                    2026-10(第二輪,使用者明確要求「一開始就要站位圖」):
                    沒有可用照片時不再整段不渲染,改用 thumbBg/thumbIcon
                    (跟縱向版 PlanTimelineView 同一組既有欄位,見
                    planTimeline.ts PlanNodeData 的完整說明,模擬腳本本來
                    就會帶這兩個值當佔位素材)渲染一個色塊+圖示佔位區塊,
                    維持跟有照片時一致的橫幅高度——這樣卡片列裡「有照片/
                    還在查詢中/查詢失敗」三種狀態的卡片高度一致,不會因為
                    缺少照片橫幅而比其他卡片矮一截、露出一大塊空白(實機
                    測試發現的真實問題:卡片列會把每張卡拉到跟最高的對齊,
                    沒有照片橫幅的卡片因此在底部多出近半張卡的空白)。
                    佔位區塊不可點擊(沒有照片可供 Lightbox 開啟),故用
                    <div> 而非 <button>。
                    2026-10(第三輪,使用者明確要求「規劃中要跟縱向版
                    一樣要有載入站位」):status.loading 為 true 時(這個
                    stop 帶 placeId、正在背景查詢真實地點資料,見
                    PlanNodeData.loading 的完整說明)優先顯示查詢中佔位,
                    不是照片也不是 thumbBg/thumbIcon 佔位——那兩者是
                    「這個地點確定沒有照片」的最終狀態,loading 是「還不
                    知道」的中間狀態。
                    2026-10(第四輪,使用者明確要求「不要用圓圈的圖片
                    載入,用骨架佔位圖」):原本這裡對齊縱向版
                    PlanTimelineView 用轉圈 spinner(.thumbSpinner)表達
                    這個中間狀態,改成跟下方 generatingTip 骨架卡同一套
                    shimmer 色塊語言(見下方渲染邏輯與 .shimmer 的完整
                    說明)。 */}
                {(() => {
                  if (status.loading) {
                    // 2026-10 使用者明確要求「不要用圓圈的圖片載入,用
                    // 骨架佔位圖」:改用跟 generatingTip 骨架卡同一套
                    // shimmer 長條/色塊語言(見 .skeletonThumb/.shimmer
                    // 的完整說明),取代原本的轉圈 spinner
                    // (.thumbSpinner,已移除),讓「這一站還在查詢」跟
                    // 「卷軸尾端還有一站正在生成」用同一種視覺語彙表達,
                    // 不是兩套不同風格的載入提示並存。
                    return (
                      <div
                        className={`${styles.photoBannerPlaceholder} ${styles.shimmer}`}
                        aria-hidden="true"
                      />
                    )
                  }
                  // 照片來自 resolvedRefs(以 placeId 解析的執行時結果),不在節點上。
                  const photoUrls = node.placeId ? resolvedRefs.get(node.placeId)?.googlePhotoUrls : undefined
                  const usablePhotos = photoUrls?.filter((u) => !failedPhotoUrls.has(u)) ?? []
                  if (usablePhotos.length > 0) {
                    return (
                      <button
                        type="button"
                        className={styles.photoBanner}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenPhotos({ photos: usablePhotos, alt: node.name ?? '' })
                        }}
                        aria-label={usablePhotos.length > 1 ? `瀏覽 ${usablePhotos.length} 張照片` : '放大檢視照片'}
                      >
                        <img
                          src={usablePhotos[0]}
                          alt={node.name ?? ''}
                          className={styles.photoBannerImg}
                          onError={() => markPhotoFailed(usablePhotos[0])}
                        />
                        {usablePhotos.length > 1 && (
                          <span className={styles.photoBannerCount}>{usablePhotos.length}</span>
                        )}
                      </button>
                    )
                  }
                  return (
                    <div
                      className={styles.photoBannerPlaceholder}
                      style={{ background: node.thumbBg }}
                      aria-hidden="true"
                    >
                      {node.thumbIcon}
                    </div>
                  )
                })()}

                {showDayBadge && <span className={styles.dayBadge}>Day {day}</span>}

                {/* onRemoveStop——選填,見該 prop 的完整說明。視覺風格
                    對齊縱向版 PlanTimelineView.tsx 的 .stopRemoveBtn
                    (卡片右上角淡化小圓按鈕,hover/focus 時才轉為顯眼的
                    紅色危險操作提示)——這裡疊在 .dayBadge 的對側角落
                    (右上),不會跟它或 .photoBannerCount(右下)互相
                    遮擋。stopPropagation 避免冒泡觸發卡片本身的
                    onClick(handleSelect 會捲動選取,跟刪除是不相關的
                    操作),理由同縱向版同名按鈕的既有說明。 */}
                {onRemoveStop && (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveStop(node.id)
                    }}
                    aria-label={`移除「${node.name ?? '這一站'}」`}
                  >
                    ✕
                  </button>
                )}

                {/* onPanToStop——2026-10 新增(使用者明確要求「選擇圖卡
                    時不要移動地圖中心,標誌地點就好,另外做一個 icon,
                    移動到該點」),見該 prop 的完整說明。疊在卡片左下角
                    (.dayBadge 在左上、.removeBtn 在右上、
                    .photoBannerCount 在照片橫幅右下角,左下角是唯一還
                    空著的角落)。stopPropagation 理由同 .removeBtn——
                    這是獨立於「選取這張卡」之外的另一個動作,點了不該
                    連帶觸發 handleSelect。 */}
                {onPanToStop && (
                  <button
                    type="button"
                    className={styles.panToBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPanToStop(node.id)
                    }}
                    aria-label={`在地圖上移動到「${node.name ?? '這一站'}」`}
                  >
                    📍
                  </button>
                )}

                {transit && (() => {
                  // canPickMode——只有呼叫端提供 onTransitModeChange 且
                  // 這段交通資訊已查詢完成(非 loading)才能點開選單,
                  // 對齊縱向版 PlanTimelineView.tsx canPickMode 的同一個
                  // 判斷(見該處完整說明)。
                  const canPickMode = !!onTransitModeChange && !transit.loading
                  const menuOpen = openTransitMenuStopId === node.id
                  return (
                    <div
                      className={`${styles.transitRow} ${canPickMode ? styles.transitRowClickable : ''}`}
                      role={canPickMode ? 'button' : undefined}
                      tabIndex={canPickMode ? 0 : undefined}
                      aria-haspopup={canPickMode ? 'menu' : undefined}
                      aria-expanded={canPickMode ? menuOpen : undefined}
                      onClick={(e) => {
                        if (!canPickMode) return
                        e.stopPropagation()
                        setOpenTransitMenuStopId((cur) => (cur === node.id ? null : node.id))
                      }}
                      onKeyDown={(e) => {
                        if (!canPickMode) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setOpenTransitMenuStopId((cur) => (cur === node.id ? null : node.id))
                        }
                      }}
                    >
                      {transit.loading ? (
                        <span className={styles.transitLoading}>路程推估中…</span>
                      ) : (
                        <>
                          <span className={styles.transitIcon}><TransitIcon mode={transit.mode} /></span>
                          <span className={styles.transitText}>
                            從上一站{transit.minutes != null ? `${transit.minutes} 分鐘` : ''}抵達
                            {transit.distance ? `・${transit.distance}` : ''}
                          </span>
                        </>
                      )}
                      {/* 交通方式選單——點開後彈出,對齊縱向版
                          PlanTimelineView.tsx 的既有選單設計(見該處
                          transitModeMenu 的完整說明),不照搬 DOM 結構。
                          stopPropagation 避免點選單空白處被外層判定成
                          「再點一次交通列」而關閉選單。 */}
                      {menuOpen && (
                        <div
                          className={styles.transitModeMenu}
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {TRANSIT_MODE_OPTIONS.map(({ mode, label }) => (
                            <button
                              key={mode}
                              type="button"
                              role="menuitemradio"
                              aria-checked={transit.mode === mode}
                              className={`${styles.transitModeOption} ${transit.mode === mode ? styles.transitModeOptionActive : ''}`}
                              onClick={() => {
                                setOpenTransitMenuStopId(null)
                                onTransitModeChange?.(node.id, mode)
                              }}
                            >
                              <TransitIcon mode={mode} />
                              <span>{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* loadingTag——2026-10(第五輪,使用者明確要求「地點
                    推論中的站位卡片加入待辦」):status.loading 為 true
                    時在站名正上方補一行查詢中提示,對齊縱向版
                    PlanTimelineView.tsx p.loading 時顯示
                    styles.loadingTag 的既有語意(見該元件 .loadingTag
                    的完整說明)——避免使用者誤以為「未命名景點」
                    fallback 文案代表查詢失敗或資料缺失,而不是還在
                    補查詳細資料的中間狀態。
                    2026-10(第六輪,使用者明確要求「每一個站點的推論都要
                    推論中的信號」):原本這裡 loading 時仍直接顯示
                    node.name/node.desc(模擬腳本本身已經寫好的假資料,
                    例如「赤崁樓」「荷蘭時期普羅民遮城遺址...」),只有
                    上方照片橫幅走骨架佔位,文字卻立即顯示完整內容,兩者
                    不一致。改成 loading 時站名/描述都換成骨架長條(見
                    .skeletonLine 的完整說明),跟照片橫幅、外層
                    generatingTip 骨架卡用同一套視覺語言,傳達「這一站
                    的所有資訊都還在查詢中」,不是只有圖片不確定、文字卻
                    已經確定。查詢完成(loading 轉 false)後才顯示真實
                    站名/描述,loadingTag 提示文字一併移除——骨架長條本身
                    已經足夠表達「查詢中」,不需要額外文字提示重複同一件
                    事。loadingTag 文字提示保留(對齊縱向版同時顯示文字
                    提示+骨架視覺的既有做法,不是兩者互斥的二選一)。 */}
                {status.loading ? (
                  <>
                    {/* 2026-10 使用者明確要求「載入中不要出現查詢地點中的
                        文字」:loadingTag 整個移除,不分骨架佔位階段
                        (thinking 插入,沒有 placeId)還是正在背景查詢
                        placeId 詳細資料那種(見 PlanNodeData.loading 的
                        完整說明)——骨架長條本身已經足夠表達「查詢中」,
                        使用者不需要額外的文字提示。 */}
                    <div className={`${styles.skeletonLine} ${styles.skeletonLineName} ${styles.shimmer}`} aria-hidden="true" />
                    <div className={`${styles.skeletonLine} ${styles.skeletonLineDesc} ${styles.shimmer}`} aria-hidden="true" />
                  </>
                ) : stopLookupFailed(node, status) ? (
                  /* 地點資料查詢失敗(見 planNodeStatus.ts 的 failed
                     的完整說明)。
                     2026-10（review 發現）：這個分支原本不存在——failed 的
                     節點會掉進下面的 else,顯示 node.name 那個插入當下寫死
                     的佔位字串「查詢中…」(見 attractionTools.ts),既沒有
                     錯誤標示也沒有重試入口,跟縱向版修好之前一模一樣。而
                     failed 欄位的註解卻宣稱「見 PlanTimelineView /
                     HorizontalPlanTimeline 對 failed 的處理」——那是註解
                     與程式碼不符,不是刻意取捨。
                     手機版的 /app 走的正是這條橫向路徑,所以手機使用者
                     實際上拿不到重試入口。 */
                  <>
                    <div className={styles.name}>未能取得地點資料</div>
                    <p className={styles.failedDesc}>
                      地點資料查詢失敗
                      {onRetryStop && (
                        <button
                          type="button"
                          className={styles.retryBtn}
                          onClick={(e) => {
                            // stopPropagation 理由同下方子景點 chip:
                            // 不要冒泡觸發外層卡片的 onClick(選取/捲動
                            // 置中)。
                            e.stopPropagation()
                            onRetryStop(node.id)
                          }}
                        >
                          重試
                        </button>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <div className={styles.name}>{node.name ?? '未命名景點'}</div>
                    {node.desc && <p className={styles.desc}>{node.desc}</p>}
                    {/* 2026-10 使用者明確要求「主題點」概念(「鄰近的
                        景點不用每個都安排時間點,而是集合的概念」):
                        node 有 attractions/places 時(見 PlanNodeData.attractions/
                        PlanThemeChild 的完整說明),這張卡是一個主題
                        卡,底下列出子景點清單——每個子景點只顯示
                        icon+名稱(chip 樣式),不是完整卡片外觀,因為
                        子景點沒有自己的時間/交通資訊可以撐起一張完整
                        卡片。點擊個別子景點觸發 onSelectThemeChild
                        (見該 prop 的完整說明),呼叫端據此決定地圖上
                        要不要顯示這個子景點的小圓點。stopPropagation
                        避免冒泡觸發外層卡片的 onClick(那會變成
                        handleSelect(node.id),選到主題卡本身而不是
                        子景點)。 */}
                    {themeChildren.length > 0 && (
                      <div className={styles.themeChildren} role="list" aria-label={`${node.name ?? '主題點'}包含的景點`}>
                        {themeChildren.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            role="listitem"
                            className={styles.themeChildChip}
                            onClick={(e) => {
                              e.stopPropagation()
                              onSelectThemeChild?.(node.id, child)
                            }}
                          >
                            {child.thumbIcon && <span aria-hidden="true">{child.thumbIcon}</span>}
                            <span>{child.name ?? child.id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {/* 2026-10 使用者明確要求「安排中時就加入一張卡片,只是這張
              卡片沒有資料時就呈現骨架卡」:骨架卡不再是這裡額外獨立
              渲染的一塊(原本的 generatingTip 區塊,靠 isGenerating 旗標
              判斷要不要補一張寫死骨架樣式的卡片)——現在骨架卡就是
              stops 陣列裡的一筆真實節點(home/plan-ai-sim/Content.tsx
              ws.onmessage 在 thinking 階段插入的 loading:true 空白
              佔位節點,見該處的完整說明),上方 .map(segments...) 迴圈
              本身已經處理了它(status.loading 時全部欄位換成 shimmer
              骨架樣式,見上方 photoBanner/timeRange/name 等各處的
              status.loading 渲染分支),不需要在這裡重複渲染第二套骨架
              卡片。這個改動同時修正了先前因為骨架卡獨立於 stops 之外
              造成的一整串時機問題(selectedStopId 不同步、單卡滿版被
              撐歪、捲動慢一拍等)——骨架卡現在跟其他卡片走完全相同的
              資料流,不需要任何特殊分支。 */}
          {/* .trailingSpacer——2026-10 新增(見該 class 的完整說明):
              沒有這塊,軌道的 scrollWidth 本身就只到最後一張卡右邊緣
              為止,.edgeCard 的 scroll-snap-align:end 再怎麼調整都沒有
              實體空間可以捲入,使用者手動捲動會發現「拉不過去」。
              isSingleCard 時不渲染——使用者回報「拉動的距離算錯了」:
              單卡時卡片本身已經 width:100% 滿版(見 .singleCard 的完整
              說明),.scrollerTrack 又有 min-width:100%,這塊 spacer
              額外撐出的寬度會讓軌道內容寬度超過可視範圍,使原本該固定
              不動、滿版置中的單卡被捲動邏輯往左推出一截,右側反而多出
              不該有的留白。單卡情境下沒有「邊緣卡要留白」的需求(根本
              不需要捲動),不需要這塊 spacer。 */}
          {!isSingleCard && <div className={styles.trailingSpacer} aria-hidden="true" />}
        </div>
      </div>
      )}
    </div>
  )
}
