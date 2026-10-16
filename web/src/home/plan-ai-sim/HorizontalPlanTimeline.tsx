import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type PlanNode, type NoteInfo, type PlanThemeChild, type TransitInfo } from '../../plan-core/planTimeline'
import styles from './HorizontalPlanTimeline.module.css'

// 2026-10(手機版共用時間軸重構):這個元件原本只給「模擬層」用,現在
// 同時也是「交接後真實層」(LivePlanLayer 內部的 TripPlanPage,手機版時
// 傳 horizontalTimeline)手機版的渲染元件——使用者明確要求「兩個不同的
// 層,時間軸要共用相同的,只有資料層不一樣」。這裡新增的進階互動 props
// (onRemoveStop/onTransitModeChange)全部選填,型別直接對齊
// plan-core/PlanTimelineView.tsx 同名 prop 的用法,理由同該檔案對應
// prop 的既有說明:模擬層(AIPlanTimelinePage.tsx 的 handedOver === false
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
// AIPlanTimelinePage.tsx 呼叫處的完整說明。
//
// 只畫 stop 節點:跟縱向 PlanTimelineView 不同,這個元件刻意不處理
// section(Day 分隔)/message(對話訊息)這些節點類型本身的卡片——方案二
// 設計稿本來就只聚焦在「站點卡片橫向滑動+時間尺」這個核心互動,訊息
// 氣泡/分段標題硬塞進同一條橫向列只會讓時間尺的時間軸語意變得混亂
// (這兩種節點沒有「停留時長」的概念)。Day 分界改成每張卡片自己帶一個
// 「Day N」徽章(對齊設計稿「分天顯示」的需求),不需要為分隔線另外佔用
// 一個橫向卡位。

export interface HorizontalPlanTimelineProps {
  // steps——跟 AIPlanTimelinePage.tsx 的 PlanStep[]（toRenderList 產出的
  // 扁平陣列）同一份資料,未經過濾/排序，這個元件自己只挑出 type ===
  // 'stop' 的節點處理，其餘類型直接忽略（見上方檔頭說明）。
  steps: PlanNode[]
  selectedStopId: string | null
  // onSelectStop——點卡片/時間尺、或橫向捲動偵測到新的置中卡片時觸發。
  // 取代縱向版本 onPanToStop/onHoverStop 的角色：呼叫端(AIPlanTimelinePage.tsx)
  // 接到這個回調後要同時更新 selectedStopId 跟 hoverStopId（兩者都指向
  // 同一顆地圖圓點），確保 usePlanStopMarkers 的地圖連動行為跟改動前一致
  // ——這裡不自己分「選取」跟「hover」兩種語意，手機版橫向卡片列本來就
  // 沒有滑鼠 hover 這件事，「捲到哪張卡」本身就等同「選取哪一站」。
  onSelectStop: (stopId: string) => void
  // onSelectThemeChild——2026-10 新增(使用者明確要求「主題點」概念:
  // 「點下點的時候在地圖上出現小圓點」)。點擊主題卡(node.children 有
  // 內容時,見該欄位的完整說明)底下某個子景點 chip 時觸發,帶上主題
  // 節點 id 與被點的子景點資料,讓呼叫端(AIPlanTimelinePage.tsx)決定
  // 要不要在地圖上額外顯示這個子景點的小圓點(見該頁 expandedThemeId
  // 的完整說明)。選填——不傳時子景點 chip 仍會渲染,只是點擊沒有任何
  // 效果(對齊其餘選填互動 prop 的既有模式,例如 onRemoveStop)。
  onSelectThemeChild?: (parentId: string, child: PlanThemeChild) => void
  // onOpenPhotos——點擊卡片照片時開啟全螢幕 Lightbox 放大瀏覽,對齊
  // 縱向版 PlanTimelineView 同名 prop 的既有用法(見該元件呼叫處
  // stopThumbPhotoBtn 的完整說明)——這裡不自己管理 Lightbox 的開關
  // 狀態,外層 AIPlanTimelinePage.tsx 已經有現成的 lightboxPhotos
  // state/setLightboxPhotos,兩個時間軸元件共用同一個 Lightbox 覆蓋層。
  onOpenPhotos: (photos: { photos: string[]; alt: string }) => void
  // onHeightChange——這個元件自己(.wrap,含時間尺+卡片列+底部留白)的
  // 實際渲染高度,每次真的改變就回報一次(例如照片陸續載入進來讓卡片
  // 變高)。供外層 AIPlanTimelinePage.tsx 用來計算地圖視覺中心該往上
  // 偏移多少(使用者明確要求「讓地圖中心在上半部分的中心」——扣掉這塊
  // 高度之後,剩餘可視區域的正中心),不是這個元件自己需要知道的資訊,
  // 純粹上報用。 */
  onHeightChange?: (height: number) => void
  // onRemoveStop——選填:卡片右上角顯示一顆刪除按鈕,點擊時呼叫並傳入
  // 這個節點的 id。語意與選填理由完全對齊 PlanTimelineView.tsx 同名
  // prop(見該檔案的完整說明)——模擬層不傳就不會出現刪除按鈕。
  // onLatestMessageChange——把目前要顯示的 AI 回覆文字回報給呼叫端,
  // 由呼叫端決定渲染在哪裡(見 latestMessage 的完整說明:泡泡要貼著
  // 輸入框,那不在這個元件的 DOM 子樹內)。選填,對齊其餘選填 prop 的
  // 既有慣例——/ai-plan 展示頁的模擬層不傳(劇本沒有 message 節點)。
  onLatestMessageChange?: (message: { text: string; stale: boolean } | null) => void
  onRemoveStop?: (stopId: string) => void
  // onPanToStop——選填:卡片左下角顯示一顆「移動到此」按鈕,點擊時呼叫
  // 並傳入這個節點的 id。2026-10 新增(使用者明確要求「選擇圖卡時不要
  // 移動地圖中心,標誌地點就好,另外做一個 icon,移動到該點」)——取代
  // 原本「選中卡片就自動 panTo」的做法(見 AIPlanTimelinePage.tsx
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
  // node.loading(單一已存在站點正在查詢詳細資料)更前面的狀態——
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
const NOTE_CATEGORY_META: Record<string, { colorVar: string; icon: 'star' | 'info' | 'cost' | 'weather' }> = {
  consideration: { colorVar: 'var(--ios-gray)', icon: 'star' },
  info: { colorVar: 'var(--ios-sand)', icon: 'info' },
  cost: { colorVar: 'var(--ios-green)', icon: 'cost' },
  weather: { colorVar: 'var(--ios-blue)', icon: 'weather' },
}
const DEFAULT_NOTE_CATEGORY = 'info'

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

// TRANSIT_MODE_OPTIONS——交通方式選單選項,2026-10 新增(見
// onTransitModeChange prop 的完整說明)。字串值直接對齊
// plan-core/PlanTimelineView.tsx 的 TRANSIT_MODE_OPTIONS/後端
// geo_plan_ai.go estimateTransitMode/iconForTransitMode 認得的同一組中文
// 字串('步行'|'公車'|'捷運'|'開車')——不是重新發明一組新字串,也不是
// 照抄模擬資料來源的英文 mode 值:這個選單的呼叫端(TripPlanPage.tsx
// 透過 onTransitModeChange 接 refreshTransitForStop)最終會把選定的 mode
// 原樣送給真實後端查詢,送一個後端不認得的字串只會讓後端 fallback 成
// 步行(見 geo_plan_ai.go metersPerMinuteFor 的 default case),不是使用者
// 選的那個方式。不從 PlanTimelineView.tsx import 這份清單——那個檔案
// 本次改動範圍明確排除(見該檔案這次重構的檔頭說明),且它目前沒有
// export 這個常數,這裡用同樣的字串值各自宣告一份更安全,不是「容易脫鉤
// 的手動重新宣告型別」(字串值本身就是跟後端字典對齊的常數,沒有型別可以
// import)。
const TRANSIT_MODE_OPTIONS: { mode: string; label: string }[] = [
  { mode: '步行', label: '步行' },
  { mode: '公車', label: '公車' },
  { mode: '捷運', label: '捷運' },
  { mode: '開車', label: '開車' },
]

export function HorizontalPlanTimeline({
  steps,
  selectedStopId,
  onSelectStop,
  onSelectThemeChild,
  onOpenPhotos,
  onHeightChange,
  onLatestMessageChange,
  onRemoveStop,
  onPanToStop,
  onTransitModeChange,
  isGenerating = false,
  focusLatest = false,
}: HorizontalPlanTimelineProps) {
  // stops——只取 type === 'stop' 的節點，見檔頭說明。section/message
  // 節點在這個元件裡完全不渲染。
  const stops = useMemo(() => steps.filter((s): s is PlanNode & { type: 'stop' } => s.type === 'stop'), [steps])
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
  // 真實節點(loading:true、沒有資料,見 AIPlanTimelinePage.tsx
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

  // latestMessage——AI 推論的回覆文字,透過 onLatestMessageChange 交給
  // 呼叫端渲染成對話泡泡(2026-10 使用者明確要求「展示進到真的推論後,
  // 用目前的對話泡泡顯示推論的文字」,後續再要求「要出現在輸入框上方」)。
  //
  // 為什麼不是這個元件自己渲染:泡泡要緊貼輸入框,而輸入框在交接後是
  // 透過 ComposerPortal 傳送到版面外殼的插槽裡(見 TripPlanPage.tsx
  // composerSlot 的完整說明),不在這個元件的 DOM 子樹內。這裡渲染的話
  // 泡泡會卡在時間尺上方、跟輸入框隔著整個卡片列。
  //
  // 在這之前橫向版完全不渲染 message 節點(只取 type === 'stop',見上方
  // stops 的說明)——那在模擬展示階段沒問題,劇本本來就沒有 message;
  // 但交接到真實 AI 之後(LivePlanLayer → TripPlanPage,手機版走
  // horizontalTimeline),onagent 回覆的文字就這樣消失了,使用者只看到
  // 卡片一張張冒出來,不知道 AI 在說什麼。
  //
  // 只顯示最新一則而不是全部:橫向版沒有縱向版那種可捲動的訊息列
  // (縱向版 PlanTimelineView 每則 message 是時間軸上獨立的一列),
  // 這裡是固定高度的橫幅,塞不下多則。取最新的那則——舊訊息在
  // staleOtherAgentMessages 標記下本來就會淡化收合(見 planTimeline.ts
  // 該函式的完整說明),語意上「最新那則才是現在要看的」。
  //
  // 不排除 stale(2026-10 修正,使用者實機回報「有回應了,可是沒有顯示
  // 對話泡泡」):第一版篩掉 stale 的訊息,理由是「已被後續動作取代」。
  // 但 staleOtherAgentMessages 的規則是「只要插入任何新的 stop,就把
  // 所有 message 標記 stale」(見 planTimeline.ts 該函式)——AI 回一句話
  // 再排一個景點,那句話立刻變 stale,泡泡等於只閃一下就消失。
  //
  // 縱向版可以排除是因為它把 stale 訊息收合成一行淡化小字保留著
  // (見 PlanTimelineView.tsx 的 messageBubbleStale),不是真的不顯示;
  // 橫向版沒有那個收合態,排除就等於整個不見。改成照樣顯示最新一則,
  // stale 與否只影響透明度(見 .messageBubbleStale)。
  const latestMessage = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const node = steps[i]
      if (node.type === 'message' && node.text) return node
    }
    return null
  }, [steps])

  // 把最新訊息回報給呼叫端渲染(見 latestMessage 與 onLatestMessageChange
  // 的完整說明)。用 effect 而不是在 render 期間直接呼叫——後者會在父層
  // 渲染中途觸發它的 setState,React 會警告。
  useEffect(() => {
    onLatestMessageChange?.(
      latestMessage ? { text: latestMessage.text ?? '', stale: latestMessage.stale === true } : null,
    )
  }, [latestMessage, onLatestMessageChange])

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
  // 來源——selectedStopId 是由上層(AIPlanTimelinePage)另一個 effect
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
    // AIPlanTimelinePage.tsx reset 分支,時間軸清空後 stops 歸零,
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

  // 2026-10:stops 為空時不再無條件 return null——isGenerating 為 true
  // 時(第一站還沒生成出來,見下方骨架卡渲染邏輯)仍要顯示呼吸點本身,
  // 讓使用者在「完全沒有任何內容」的那段等待期也能看到「AI 正在做事」
  // 的訊號,不是進頁後有一段空白期才突然冒出第一張卡片。
  // 泡泡改由呼叫端渲染(見 onLatestMessageChange 的完整說明)之後,這裡
  // 恢復原本的條件:沒有站點又沒在生成就整個不渲染。上面那個通知用的
  // effect 在 return null 之前就已經執行過,呼叫端照樣收得到訊息。
  if (stops.length === 0 && !isGenerating) return null

  return (
    <div className={styles.wrap} ref={setWrapElement}>
      {/* selectedNoteBanner——全寬備註區,2026-10 使用者明確要求「移動到
          時間軸的軸線上方」,從原本夾在時間尺(.ruler)跟卡片列
          (.scroller)之間,移到時間尺之前(見 selectedNote/selectedNoteMeta
          的完整說明)。沒有備註時渲染一個等高的透明佔位(維持固定版面
          高度,不讓下方內容隨選中站點有沒有備註而上下跳動——跟卡片固定
          height 的理由一致)。 */}
      {/* messageBubble——AI 推論回覆的對話泡泡(見 latestMessage 的完整
          說明)。視覺語言對齊縱向版 PlanTimelineView.module.css 的
          .messageBubble(同一組 --ios-ai-message-* 變數、同樣的左上角
          收尖圓角),但這裡是固定在時間軸上方的單則橫幅,不是時間軸上
          可捲動的一列。
          沒有訊息時整個不渲染(不留佔位):模擬展示階段劇本沒有
          message,留一塊空白會讓時間軸無故往下壓。 */}
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
      {(timelineRange || isGenerating) && (
        <div className={styles.ruler} role="list" aria-label="行程時間尺">
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
            className={`${styles.rulerTrack}${isTransitioning ? ` ${styles.rulerTrackSliding}` : ''}`}
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
            {/* tipDot——呼吸點本身,接在已排時間進度之後。tipLeftPct:
                有 timelineRange 時,取最後一段 segment 的結尾位置
                (用該段真實的 endMinutes,不是整個 range 的 max——
                range.max 恆等於最後一段的 endMinutes,兩者算出來的
                結果相同,這裡直接重用 timelineRange.total 當分母避免
                重複計算);完全沒有已排時間時(timelineRange 為 null)
                固定在最左端(0%),對齊「連第一站都還沒排出來」這個
                起始狀態。 */}
            {/* 呼吸點只掛在「最新的那一天」那條軌道上——它表達的是
                「正在排下一段」,過渡中不該兩條軌道各冒一個。 */}
            {isGenerating && day === currentDay && (() => {
              const tipLeftPct = hasTime ? 100 : 0
              return (
                <span
                  key={`ruler-tip-${stops.length > 0 ? stops[stops.length - 1].id : 'empty'}`}
                  className={styles.tipDot}
                  style={{ left: `${tipLeftPct}%` }}
                  aria-hidden="true"
                />
              )
            })()}
          </div>
            )
          })}
          </div>
        </div>
      )}

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
                    {(node.children ?? []).map((child) => {
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
                    一樣要有載入站位」):node.loading 為 true 時(這個
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
                  if (node.loading) {
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
                  const usablePhotos = node.googlePhotoUrls?.filter((u) => !failedPhotoUrls.has(u)) ?? []
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
                    推論中的站位卡片加入待辦」):node.loading 為 true
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
                {node.loading ? (
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
                ) : (
                  <>
                    <div className={styles.name}>{node.name ?? node.label ?? '未命名景點'}</div>
                    {node.desc && <p className={styles.desc}>{node.desc}</p>}
                    {/* 2026-10 使用者明確要求「主題點」概念(「鄰近的
                        景點不用每個都安排時間點,而是集合的概念」):
                        node.children 存在時(見 PlanNodeData.children/
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
                    {node.children && node.children.length > 0 && (
                      <div className={styles.themeChildren} role="list" aria-label={`${node.name ?? '主題點'}包含的景點`}>
                        {node.children.map((child) => (
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
              stops 陣列裡的一筆真實節點(AIPlanTimelinePage.tsx
              ws.onmessage 在 thinking 階段插入的 loading:true 空白
              佔位節點,見該處的完整說明),上方 .map(segments...) 迴圈
              本身已經處理了它(node.loading 時全部欄位換成 shimmer
              骨架樣式,見上方 photoBanner/timeRange/name 等各處的
              node.loading 渲染分支),不需要在這裡重複渲染第二套骨架
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
    </div>
  )
}
