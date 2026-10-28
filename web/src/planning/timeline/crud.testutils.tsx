// crud.testutils.tsx——crud.test.tsx(時間軸「從元件介面做 CRUD」整合測試)的 harness。
//
// CrudHost 是一個最小宿主:同時持有 usePlanTimelineCore(可注入 store;不傳 = 純記憶體)與一個時間軸視圖
// (直向 PlanTimelineView 或橫向 HorizontalPlanTimeline),視圖的回呼直接接核心操作——
// onRemoveStop→removeStop、onSetStopTime→setStopTime、onRetryStop→retryStop;onSetStopTransitMode 比照 TripPlanPage
// 以 refreshTransitForStop(forceMode)包一層(它不在 PlanOperations 契約內)。整個宿主包在 PlanDataProvider 底下。
//
// ⚠ 測試範圍:這裡驗的是「核心 + 視圖」的接線,不是 TripPlanPage 的接線。正式環境的 TripPlanPage 只在功能旗標
// TIME_DRAG_ENABLED(onSetStopTime/getStopTimeDragBounds)與 TRANSIT_MODE_SELECT_ENABLED(onSetStopTransitMode)
// 打開時才把這些回呼交給視圖,而兩個旗標目前預設關閉;這個 harness 則無條件接上(onSetStopTransitMode 只看有沒有
// coreDataSource)。所以 TripPlanPage 若把旗標接錯(例如旗標關了還傳、或開了卻沒傳),這份測試抓不到——那要在
// TripPlanPage 自己的測試裡驗。
//
// 視圖差異收在 ViewAdapter:兩個視圖的 DOM 結構不同,測試情境只透過 adapter 讀「每一天有哪些卡片」「Day 標題」
// 「住宿橫幅」「某站顯示的時間/備註/交通」等,同一套情境就能跑在直向與橫向兩個視圖上。
// adapter 的讀值函式一律沒有副作用;橫向視圖只對「選中那一站」顯示時間與備註,讀之前要由測試明確呼叫 revealStop 選取
// (那是會改變選取狀態的操作,刻意與讀值分開)。
// class 選擇器一律用 import 的 CSS module styles 精確比對,不用 [class*="..."] 子字串比對。
import { useState, type MutableRefObject } from 'react'
import { fireEvent } from '@testing-library/react'
import { PlanTimelineView } from './PlanTimelineView'
import { HorizontalPlanTimeline } from './phone/HorizontalPlanTimeline'
import { usePlanTimelineCore, type PlanTimelineCore, type PlanTimelineCoreDataSource } from './usePlanTimelineCore'
import { getTimeDragBounds, type PlanTimeline } from './model'
import { refreshTransitForStop } from './transit'
import type { PlanTimelineStore } from './storage'
import { PlanDataProvider } from '../data/PlanDataProvider'
import { makeNullDataSource } from '../data/fixtures'
import type { PlanAiDataSource } from '../data/source'
import vStyles from './PlanTimelineView.module.css'
import hStyles from './phone/HorizontalPlanTimeline.module.css'

export type Variant = 'vertical' | 'horizontal'

export interface CrudHostProps {
  variant: Variant
  // coreRef——測試從這裡拿到核心的回傳值(讀 timeline/nodeStatus、呼叫畫面上沒有按鈕的 addStop/addDay/setLodging…)。
  coreRef: MutableRefObject<PlanTimelineCore | null>
  store?: PlanTimelineStore
  // coreDataSource——給核心的地點詳情/交通估算(重試、換交通方式走這裡)。省略 = 核心不做背景查詢。
  coreDataSource?: PlanTimelineCoreDataSource
  // viewDataSource——PlanDataProvider 的資料來源(視圖解析照片/旅館名稱用)。預設什麼都查不到,
  // 與 coreDataSource 分開,測試才能精準斷言「重試走的是核心的查詢路徑」而不被視圖的解析請求干擾。
  viewDataSource?: PlanAiDataSource
}

export function CrudHost({ variant, coreRef, store, coreDataSource, viewDataSource }: CrudHostProps) {
  // viewDataSource 預設值固定在第一次 render,避免每次 render 換新物件讓 PlanDataProvider 換 store。
  const [nullDs] = useState(() => makeNullDataSource())
  return (
    <PlanDataProvider dataSource={viewDataSource ?? nullDs}>
      <CrudHostInner variant={variant} coreRef={coreRef} store={store} coreDataSource={coreDataSource} />
    </PlanDataProvider>
  )
}

function CrudHostInner({ variant, coreRef, store, coreDataSource }: Omit<CrudHostProps, 'viewDataSource'>) {
  const core = usePlanTimelineCore({ store, dataSource: coreDataSource })
  coreRef.current = core
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [mountedIdsRef] = useState(() => ({ current: new Set<string>() }))

  const onSetStopTransitMode = coreDataSource
    ? (stopId: string, mode: string) =>
        refreshTransitForStop({
          stopId,
          dataSource: coreDataSource as PlanAiDataSource,
          setTimeline: core.setTimeline,
          getTimeline: () => core.timelineRef.current,
          forceMode: mode,
        })
    : undefined

  if (variant === 'vertical') {
    return (
      <PlanTimelineView
        timeline={core.timeline}
        nodeStatus={core.nodeStatus}
        isThinking={false}
        emptyStateMessage="還沒有行程"
        selectedStopId={selectedStopId}
        showJumpPill={false}
        onJumpToLatest={() => {}}
        onPanToStop={(p) => setSelectedStopId(p.id)}
        onOpenPhotos={() => {}}
        mountedIdsRef={mountedIdsRef}
        onRemoveStop={core.removeStop}
        onRetryStop={core.retryStop}
        // 無條件接上(正式環境由 TIME_DRAG_ENABLED / TRANSIT_MODE_SELECT_ENABLED 旗標控制,見檔頭「測試範圍」)
        getStopTimeDragBounds={(id) => getTimeDragBounds(core.timelineRef.current, id)}
        onSetStopTime={core.setStopTime}
        onSetStopTransitMode={onSetStopTransitMode}
      />
    )
  }
  return (
    <HorizontalPlanTimeline
      timeline={core.timeline}
      nodeStatus={core.nodeStatus}
      selectedStopId={selectedStopId}
      onSelectStop={setSelectedStopId}
      onOpenPhotos={() => {}}
      onRemoveStop={core.removeStop}
      onRetryStop={core.retryStop}
      onSetStopTransitMode={onSetStopTransitMode}
    />
  )
}

// ───────── 假 store ─────────

// memoryStore——可注入的假 PlanTimelineStore:內容以 JSON 序列化保存(模擬真的寫到某處、讀回來是新物件),
// failing 打開時 saveTimeline 回 null(存檔失敗)。saves 記錄成功寫入次數。
export function memoryStore(initial?: PlanTimeline) {
  const state = {
    raw: initial ? JSON.stringify(initial) : null as string | null,
    rev: initial ? 1 : 0,
    failing: false,
    saves: 0,
  }
  const store: PlanTimelineStore = {
    readRev: () => state.rev,
    loadTimelineWithRev: () => ({ timeline: state.raw ? (JSON.parse(state.raw) as PlanTimeline) : { days: [] }, rev: state.rev }),
    saveTimeline: (timeline, baseRev) => {
      if (state.failing) return null
      state.raw = JSON.stringify(timeline)
      state.rev = baseRev + 1
      state.saves += 1
      return state.rev
    },
  }
  return {
    store,
    state,
    // read——「重新讀存檔」:回傳存檔裡的時間軸(新物件)。
    read: () => store.loadTimelineWithRev().timeline,
  }
}

// ───────── 視圖 adapter ─────────

export interface ViewAdapter {
  variant: Variant
  label: string
  // dayLabels——畫面上的「Day N」標題(依 DOM 順序)。
  dayLabels: (c: HTMLElement) => string[]
  // cardsByDay——每一天(依 Day 標題分組)的站點卡片名稱,依畫面順序。卡片以刪除按鈕的 aria-label「移除「名稱」」辨認,
  // 兩個視圖都有這顆按鈕(住宿卡、空天佔位卡沒有),所以只算真正的站點。
  cardsByDay: (c: HTMLElement) => string[][]
  // removeButton——某一站的刪除按鈕。
  removeButton: (c: HTMLElement, name: string) => HTMLElement
  // isRemovingFade——卡片是否套著淡出樣式;橫向視圖沒有淡出樣式(見 REMOVE_FADE_MS 的說明),回 null 代表「這個視圖不表達」。
  isRemovingFade: (c: HTMLElement, name: string) => boolean | null
  // revealStop——讓某一站的時間/備註顯示出來(有副作用)。直向每站都顯示,什麼都不做;橫向只顯示選中那一站,
  // 所以會點那張卡片選取它(改變選取狀態)。讀 shownTime/shownNote 之前要先呼叫。
  revealStop: (c: HTMLElement, name: string) => void
  // shownTime——某一站畫面上顯示的時間(純讀值,不點任何東西)。橫向若該站沒被選取(沒先 revealStop)會丟錯。
  shownTime: (c: HTMLElement, name: string) => string | null
  // shownNote——某一站畫面上顯示的備註文字(純讀值)。橫向若該站沒被選取會丟錯。
  shownNote: (c: HTMLElement, name: string) => string | null
  // shownTransit——某一站(到達站)的交通列/膠囊文字,限定在那一站自己的交通元素內(純讀值)。沒有交通元素回 null。
  shownTransit: (c: HTMLElement, name: string) => string | null
  // openTransitMenu——點開到達站(name)上方的交通膠囊/交通列,回傳選單。
  openTransitMenu: (c: HTMLElement, name: string) => HTMLElement
  // emptyDayPlaceholders——空天的佔位(直向沒有佔位卡,只有標題,回 0;橫向是「這一天還沒有行程」卡)。
  emptyDayPlaceholders: (c: HTMLElement) => number
}

const REMOVE_PREFIX = '移除「'
const nameOfRemoveBtn = (el: Element) => (el.getAttribute('aria-label') ?? '').slice(REMOVE_PREFIX.length, -1)

function groupByDay(c: HTMLElement, labelSelector: string): string[][] {
  const out: string[][] = []
  // jsdom 的逗號選擇器結果不保證依文件順序(會依選擇器分組),自己依 DOM 位置排序。
  const els = [...Array.from(c.querySelectorAll(labelSelector)), ...Array.from(c.querySelectorAll(`button[aria-label^="${REMOVE_PREFIX}"]`))].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )
  for (const el of els) {
    if (el.matches(labelSelector)) {
      const n = Number((el.textContent ?? '').replace(/\D+/g, ''))
      while (out.length < n) out.push([])
    } else {
      if (out.length === 0) out.push([])
      out[out.length - 1].push(nameOfRemoveBtn(el))
    }
  }
  return out
}

function findRemoveButton(c: HTMLElement, name: string): HTMLElement {
  const el = c.querySelector<HTMLElement>(`button[aria-label="${REMOVE_PREFIX}${name}」"]`)
  if (!el) throw new Error(`畫面上找不到「${name}」的卡片`)
  return el
}

const cls = (name: string) => `.${name}`

// 橫向卡片:刪除按鈕所在的那張 .card。
function horizontalCard(c: HTMLElement, name: string): HTMLElement {
  const card = findRemoveButton(c, name).closest<HTMLElement>(cls(hStyles.card))
  if (!card) throw new Error(`找不到「${name}」的橫向卡片`)
  return card
}

// 橫向:讀值前確認該站是選中狀態(aria-current),否則代表測試忘了先 revealStop——讀到的會是別站的時間/備註。
function assertHorizontalSelected(c: HTMLElement, name: string) {
  if (horizontalCard(c, name).getAttribute('aria-current') !== 'true') {
    throw new Error(`橫向視圖只顯示選中那一站的時間/備註:「${name}」沒有被選取,讀值前先呼叫 revealStop`)
  }
}

const verticalRow = (c: HTMLElement, name: string) => findRemoveButton(c, name).closest<HTMLElement>('[data-tl-node]')!

// 直向:到達站卡片列之前的交通列(同一個 Fragment 內緊鄰的上一列);遇到上一站的卡片列就停。
function verticalTransitRow(c: HTMLElement, name: string): HTMLElement | null {
  let el = verticalRow(c, name).previousElementSibling
  while (el && !el.hasAttribute('data-tl-node') && !el.classList.contains(vStyles.transitRow)) el = el.previousElementSibling
  return el && el.classList.contains(vStyles.transitRow) ? (el as HTMLElement) : null
}

export const verticalAdapter: ViewAdapter = {
  variant: 'vertical',
  label: '直向 PlanTimelineView',
  dayLabels: (c) => Array.from(c.querySelectorAll(cls(vStyles.sectionLabel))).map((e) => e.textContent ?? ''),
  cardsByDay: (c) => groupByDay(c, cls(vStyles.sectionLabel)),
  removeButton: findRemoveButton,
  isRemovingFade: (c, name) => verticalRow(c, name).classList.contains(vStyles.removingFade),
  revealStop: () => {},
  shownTime: (c, name) => verticalRow(c, name).querySelector(cls(vStyles.stopTimeText))?.textContent ?? null,
  shownNote: (c, name) => {
    // 備註畫在卡片內部下方的固定高度橫列(.stopNoteText,見
    // PlanTimelineView.tsx renderStopNote 的完整說明)。
    const note = verticalRow(c, name).querySelector(cls(vStyles.stopNoteText))
    return note ? (note.textContent ?? '').trim() : null
  },
  shownTransit: (c, name) => verticalTransitRow(c, name)?.querySelector(cls(vStyles.transitPill))?.textContent ?? null,
  openTransitMenu: (c, name) => {
    // 交通膠囊畫在到達站卡片列之前。
    const row = verticalTransitRow(c, name)
    const pill = row?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
    if (!pill) throw new Error(`「${name}」上方沒有可點的交通膠囊`)
    fireEvent.click(pill)
    return row!.querySelector<HTMLElement>('[role="menu"]')!
  },
  emptyDayPlaceholders: () => 0,
}

export const horizontalAdapter: ViewAdapter = {
  variant: 'horizontal',
  label: '橫向 HorizontalPlanTimeline',
  // 每天只有第一張卡畫 Day 標籤(入住日剛好是空天時也只畫一次,見 HorizontalPlanTimeline.emptyDay.test.tsx),不需要再合併重複標籤。
  dayLabels: (c) => Array.from(c.querySelectorAll(cls(hStyles.dayBadge))).map((e) => (e.textContent ?? '').trim()),
  cardsByDay: (c) => groupByDay(c, cls(hStyles.dayBadge)),
  removeButton: findRemoveButton,
  isRemovingFade: () => null,
  revealStop: (c, name) => {
    fireEvent.click(horizontalCard(c, name))
  },
  shownTime: (c, name) => {
    assertHorizontalSelected(c, name)
    return c.querySelector(cls(hStyles.rulerSegmentTime))?.textContent ?? null
  },
  shownNote: (c, name) => {
    // 備註畫在這張卡片內部下方的固定高度橫列(.cardNoteRow,見
    // HorizontalPlanTimeline.tsx 的完整說明),不再是整個元件外層只
    // 顯示目前選中站點的全域 .noteBanner,改讀這張卡片自己底下的
    // .noteText,不需要先確認它是不是目前選中的卡片。
    return horizontalCard(c, name).querySelector(cls(hStyles.noteText))?.textContent ?? null
  },
  shownTransit: (c, name) => horizontalCard(c, name).querySelector(cls(hStyles.transitRow))?.textContent ?? null,
  openTransitMenu: (c, name) => {
    const row = horizontalCard(c, name).querySelector<HTMLElement>('[aria-haspopup="menu"]')
    if (!row) throw new Error(`「${name}」沒有可點的交通列`)
    fireEvent.click(row)
    return row.querySelector<HTMLElement>('[role="menu"]')!
  },
  emptyDayPlaceholders: (c) => c.querySelectorAll(cls(hStyles.emptyDayCard)).length,
}

// verticalDragTime——直向視圖的時間拖拉手勢:在某站的時間軸小圓點按下、往下拖 steps 格(每格 18px = 30 分)、放開。
// 手勢掛在 document 的 pointermove/pointerup 上(見 PlanTimelineView 的 handlePointerDown)。
export function verticalDragTime(c: HTMLElement, name: string, steps: number) {
  const dot = verticalRow(c, name).querySelector<HTMLElement>(cls(vStyles.anchorDot))
  if (!dot) throw new Error(`「${name}」沒有時間軸小圓點`)
  fireEvent.pointerDown(dot, { pointerId: 7, clientY: 100 })
  fireEvent.pointerMove(document, { pointerId: 7, clientY: 100 + steps * 18 })
  fireEvent.pointerUp(document, { pointerId: 7, clientY: 100 + steps * 18 })
}
