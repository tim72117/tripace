// crud.test.tsx——跨日時間軸「從元件介面做 CRUD」的整合測試。
//
// 現有測試分別測領域函式(model.test.ts)、核心 hook(usePlanTimelineCore.test.tsx,renderHook)與視圖(給資料看畫面);
// 這份把三者接在同一個宿主元件裡(見 crud.testutils.tsx 的 CrudHost):從畫面操作(點刪除、拖時間、點重試、換交通方式)
// 或從核心 hook 呼叫(畫面上沒有按鈕的新增天/站/住宿),斷言「畫面、核心 state、存檔」三方一致。
// 同一套情境以 describe.each 跑在直向 PlanTimelineView 與橫向 HorizontalPlanTimeline 上。
// 範圍:驗的是「核心 + 視圖」的接線;宿主無條件接上改時間/換交通方式的回呼,TripPlanPage 依功能旗標
// (TIME_DRAG_ENABLED / TRANSIT_MODE_SELECT_ENABLED,預設關閉)接線是否正確不在這裡驗(見 crud.testutils.tsx 檔頭)。
// 每個測試都以 expect.hasAssertions() 開頭(beforeEach),避免某個視圖的分支整段被 if 跳過卻仍顯示通過。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { CrudHost, horizontalAdapter, memoryStore, verticalAdapter, verticalDragTime, type ViewAdapter } from './crud.testutils'
import { REMOVE_FADE_MS, SAVE_FAILED_CODE, type PlanTimelineCore, type PlanTimelineCoreDataSource } from './usePlanTimelineCore'
import { getNode, type PlanNode, type PlanTimeline } from './model'
import { loadTimeline, localStoragePlanTimelineStore, PLAN_TIMELINE_STORAGE_KEY, saveTimeline, type PlanTimelineStore } from './storage'

// ───────── 假資料 ─────────

function stop(id: string, name: string, time: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, type: 'stop', name, time, kind: '景點', desc: `${name}介紹`, lat: 35.7, lng: 139.8, ...over }
}

// seed——三天、含住宿:Day 1 兩站、Day 2 三站(竹下通帶交通資訊)、Day 3 空的;上野飯店住 Day 1–2。
// 站點沒有 duration(橫向卡片因此只顯示開始時間),也沒有 placeId(視圖不必解析)。
function seed(): PlanTimeline {
  return {
    days: [
      { id: 'd1', nodes: [stop('a1', '淺草寺', '09:00'), stop('a2', '晴空塔', '11:00')] },
      {
        id: 'd2',
        nodes: [
          stop('b1', '明治神宮', '09:00'),
          stop('b2', '竹下通', '11:00', { transitFromPrev: { mode: '步行', minutes: 10, distance: '800 m' } }),
          stop('b3', '澀谷', '14:00'),
        ],
      },
      { id: 'd3', nodes: [] },
    ],
    lodgings: [{ id: 'L1', name: '上野飯店', dayIds: ['d1', 'd2'] }],
  }
}

const SEED_CARDS = [['淺草寺', '晴空塔'], ['明治神宮', '竹下通', '澀谷'], []]

const namesByDay = (t: PlanTimeline) => t.days.map((d) => d.nodes.map((n) => n.name ?? ''))
const dayLabelsOf = (t: PlanTimeline) => t.days.map((_, i) => `Day ${i + 1}`)

function seedLocalStorage(t: PlanTimeline = seed()) {
  saveTimeline(t, 0)
}

// mount——掛上宿主,回傳核心的即時參照(core())與 render 結果。
function mount(adapter: ViewAdapter, opts: { store?: PlanTimelineStore; coreDataSource?: PlanTimelineCoreDataSource } = {}) {
  const coreRef: { current: PlanTimelineCore | null } = { current: null }
  const utils = render(<CrudHost variant={adapter.variant} coreRef={coreRef} {...opts} />)
  return { ...utils, core: () => coreRef.current! }
}

// expectTriad——畫面(每天的卡片與 Day 標題)、核心 state、存檔(有給才比)三方一致。
function expectTriad(adapter: ViewAdapter, c: HTMLElement, core: PlanTimelineCore, persisted?: PlanTimeline) {
  const expected = namesByDay(core.timeline)
  expect(adapter.cardsByDay(c)).toEqual(expected)
  expect(adapter.dayLabels(c)).toEqual(dayLabelsOf(core.timeline))
  if (persisted) {
    expect(namesByDay(persisted)).toEqual(expected)
    expect(persisted.days.map((d) => d.id)).toEqual(core.timeline.days.map((d) => d.id))
    expect(persisted.lodgings ?? []).toEqual(core.timeline.lodgings ?? [])
  }
}

// placeDs——核心用的假資料來源:地點詳情與交通估算都可以逐案替換。
function placeDs(over: Partial<{ placeDetails: PlanTimelineCoreDataSource['placeDetails']; transitEstimate: PlanTimelineCoreDataSource['transitEstimate'] }> = {}) {
  return {
    placeDetails: vi.fn(over.placeDetails ?? (async () => ({ found: false }))),
    transitEstimate: vi.fn(
      over.transitEstimate ??
        (async (_from: unknown, _to: unknown, mode?: string) => ({ mode: mode ?? '步行', icon: '', minutes: mode === '捷運' ? 7 : 10, distance: '1.2 km' })),
    ),
  } as unknown as PlanTimelineCoreDataSource & { placeDetails: ReturnType<typeof vi.fn>; transitEstimate: ReturnType<typeof vi.fn> }
}

beforeAll(() => {
  // jsdom 沒有 scrollIntoView,橫向視圖點卡片/選取時會呼叫它。
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  localStorage.clear()
  expect.hasAssertions()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe.each([verticalAdapter, horizontalAdapter])('時間軸 CRUD 整合($label)', (adapter) => {
  // ───────── R ─────────
  describe('讀(R)', () => {
    it('三天含住宿的存檔:畫面依天畫出 Day 標題與各天卡片、住宿只在入住日出現一次,空的天只有標題', () => {
      seedLocalStorage()
      const { container, core } = mount(adapter, { store: localStoragePlanTimelineStore })
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2', 'Day 3'])
      expect(adapter.cardsByDay(container)).toEqual(SEED_CARDS)
      // 住宿橫幅/住宿卡:只畫一次,顯示名稱與停留區間
      const lodging = container.querySelectorAll('[data-lodging-id="L1"]')
      expect(lodging).toHaveLength(1)
      expect(within(lodging[0] as HTMLElement).getByText('上野飯店')).toBeTruthy()
      expect(within(lodging[0] as HTMLElement).getByText('Day 1–2')).toBeTruthy()
      // 空的天:直向只有標題;橫向是一張「這一天還沒有行程」佔位卡,兩者都沒有站點卡
      expect(adapter.emptyDayPlaceholders(container)).toBe(adapter.variant === 'horizontal' ? 1 : 0)
      expectTriad(adapter, container, core(), loadTimeline())
    })
  })

  // ───────── D ─────────
  describe('刪(D)', () => {
    it('點第二天「竹下通」的刪除:先淡出、計時到才摘除;同天其他卡片與順序不變;state 與 localStorage 同步移除、重新讀存檔與重新掛載都不復活', () => {
      vi.useFakeTimers()
      seedLocalStorage()
      const { container, core, unmount } = mount(adapter, { store: localStoragePlanTimelineStore })

      act(() => {
        fireEvent.click(adapter.removeButton(container, '竹下通'))
      })
      // 第一階段:只在狀態表標 removing,卡片與資料都還在
      expect(core().nodeStatus.get('b2')?.removing).toBe(true)
      expect(adapter.cardsByDay(container)[1]).toEqual(['明治神宮', '竹下通', '澀谷'])
      expect(getNode(loadTimeline(), 'b2')).toBeDefined()
      if (adapter.variant === 'vertical') {
        // 直向:卡片列套淡出樣式
        expect(adapter.isRemovingFade(container, '竹下通')).toBe(true)
      } else {
        // 橫向沒有淡出樣式(isRemovingFade 回 null,見 REMOVE_FADE_MS 的說明):改斷言淡出期間卡片仍在、state 標 removing
        expect(adapter.isRemovingFade(container, '竹下通')).toBeNull()
      }

      act(() => {
        vi.advanceTimersByTime(REMOVE_FADE_MS - 1)
      })
      // 計時器到點前一刻:卡片仍在畫面上、state 仍標 removing、資料與存檔都還在
      expect(adapter.cardsByDay(container)[1]).toEqual(['明治神宮', '竹下通', '澀谷'])
      expect(core().nodeStatus.get('b2')?.removing).toBe(true)
      expect(getNode(core().timeline, 'b2')).toBeDefined()
      expect(getNode(loadTimeline(), 'b2')).toBeDefined()
      if (adapter.variant === 'vertical') expect(adapter.isRemovingFade(container, '竹下通')).toBe(true)
      act(() => {
        vi.advanceTimersByTime(1)
      })

      // 第二階段:摘除
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺', '晴空塔'], ['明治神宮', '澀谷'], []])
      expect(core().nodeStatus.has('b2')).toBe(false)
      expectTriad(adapter, container, core(), loadTimeline())
      expect(getNode(loadTimeline(), 'b2')).toBeUndefined()
      // 被刪站的下一站(澀谷)上一站變了,舊交通資訊不能殘留(竹下通本身的交通資訊隨它一起消失)
      expect(getNode(loadTimeline(), 'b3')?.transitFromPrev).toBeUndefined()

      unmount()
      const again = mount(adapter, { store: localStoragePlanTimelineStore })
      expect(adapter.cardsByDay(again.container)).toEqual([['淺草寺', '晴空塔'], ['明治神宮', '澀谷'], []])
    })

    it('移除某天最後一站(依 removeNode 規則):中間的天保留為空天;最後一天因這次移除變空就整天去掉;最後一天若有住宿停留則保留', () => {
      vi.useFakeTimers()
      const t: PlanTimeline = {
        days: [
          { id: 'd1', nodes: [stop('a1', '淺草寺', '09:00')] },
          { id: 'd2', nodes: [stop('b1', '明治神宮', '09:00')] },
          { id: 'd3', nodes: [stop('c1', '築地', '08:00')] },
          { id: 'd4', nodes: [stop('e1', '羽田機場', '15:00')] },
        ],
        lodgings: [{ id: 'L4', name: '機場飯店', dayIds: ['d4'] }],
      }
      const ms = memoryStore(t)
      const { container, core } = mount(adapter, { store: ms.store })
      const removeNow = (name: string) => {
        act(() => {
          fireEvent.click(adapter.removeButton(container, name))
        })
        act(() => {
          vi.advanceTimersByTime(REMOVE_FADE_MS)
        })
      }

      // 中間的天(Day 2)的唯一一站:天保留成空天
      removeNow('明治神宮')
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4'])
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺'], [], ['築地'], ['羽田機場']])
      expectTriad(adapter, container, core(), ms.read())

      // 最後一天(Day 4)有住宿停留:移除唯一一站後仍保留這一天(否則旅館會指向不存在的天)
      removeNow('羽田機場')
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4'])
      expect(container.querySelectorAll('[data-lodging-id="L4"]')).toHaveLength(1)
      expectTriad(adapter, container, core(), ms.read())

      // 第 3 天不是最後一天:移除唯一一站後保留為空天
      removeNow('築地')
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺'], [], [], []])
      expectTriad(adapter, container, core(), ms.read())

      // 最後一天沒有住宿時:移除最後一天的唯一一站 → 該天消失
      act(() => {
        expect(core().removeLodging('L4').ok).toBe(true)
        expect(core().addStop(null, 'e2', { type: 'stop', name: '成田機場', time: '16:00', day: 4 }).ok).toBe(true)
      })
      removeNow('成田機場')
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2', 'Day 3'])
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺'], [], []])
      expectTriad(adapter, container, core(), ms.read())
    })
  })

  // ───────── U ─────────
  describe('改(U)', () => {
    if (adapter.variant === 'vertical') {
      it('拖拉時間軸小圓點改時間:往下一格 = 晚 30 分、存檔同步;拖過下一站時被夾在下一站的時間,同天順序不變', () => {
        seedLocalStorage()
        const { container, core } = mount(adapter, { store: localStoragePlanTimelineStore })

        act(() => verticalDragTime(container, '竹下通', 1))
        adapter.revealStop(container, '竹下通')
        expect(adapter.shownTime(container, '竹下通')).toBe('11:30')
        expect(getNode(core().timeline, 'b2')?.time).toBe('11:30')
        expect(getNode(loadTimeline(), 'b2')?.time).toBe('11:30')

        // 往下拖 20 格(+10 小時):被夾在下一站澀谷 14:00,不會越過它
        act(() => verticalDragTime(container, '竹下通', 20))
        expect(adapter.shownTime(container, '竹下通')).toBe('14:00')
        expect(getNode(loadTimeline(), 'b2')?.time).toBe('14:00')
        // 往上拖 20 格:被夾在上一站明治神宮 09:00
        act(() => verticalDragTime(container, '竹下通', -20))
        expect(adapter.shownTime(container, '竹下通')).toBe('09:00')
        expect(adapter.cardsByDay(container)[1]).toEqual(['明治神宮', '竹下通', '澀谷'])
        expectTriad(adapter, container, core(), loadTimeline())
      })
    } else {
      it('改時間(橫向視圖沒有拖拉手勢,由宿主呼叫核心 setStopTime):選取卡片後時間尺顯示新時間、存檔同步;格式不合回 false 且不變', () => {
        seedLocalStorage()
        const { container, core } = mount(adapter, { store: localStoragePlanTimelineStore })
        // 橫向只對選中那一站顯示時間:先明確選取(讀值本身不點任何東西)
        act(() => adapter.revealStop(container, '竹下通'))
        expect(adapter.shownTime(container, '竹下通')).toBe('11:00')

        let ok = false
        act(() => {
          ok = core().setStopTime('b2', '11:30')
        })
        expect(ok).toBe(true)
        expect(adapter.shownTime(container, '竹下通')).toBe('11:30')
        expect(getNode(loadTimeline(), 'b2')?.time).toBe('11:30')

        act(() => {
          ok = core().setStopTime('b2', '25:00')
        })
        expect(ok).toBe(false)
        expect(adapter.shownTime(container, '竹下通')).toBe('11:30')
        expect(adapter.cardsByDay(container)[1]).toEqual(['明治神宮', '竹下通', '澀谷'])
        expectTriad(adapter, container, core(), loadTimeline())
      })
    }

    it('備註(setStopNote):寫在既有站點上,畫面顯示、state 與存檔同步;改寫會覆蓋同一則', () => {
      const ms = memoryStore(seed())
      const { container, core } = mount(adapter, { store: ms.store })
      act(() => {
        expect(core().setStopNote('b1', '記得帶傘', 'weather').ok).toBe(true)
      })
      act(() => adapter.revealStop(container, '明治神宮'))
      expect(adapter.shownNote(container, '明治神宮')).toContain('記得帶傘')
      expect(getNode(ms.read(), 'b1')?.note).toEqual({ text: '記得帶傘', category: 'weather' })

      act(() => {
        expect(core().setStopNote('b1', '早上人少', undefined).ok).toBe(true)
      })
      expect(adapter.shownNote(container, '明治神宮')).toContain('早上人少')
      expect(adapter.shownNote(container, '明治神宮')).not.toContain('記得帶傘')
      expect(getNode(core().timeline, 'b1')?.note?.text).toBe('早上人少')
      expect(getNode(ms.read(), 'b1')?.note?.text).toBe('早上人少')
      expectTriad(adapter, container, core(), ms.read())
    })

    it('交通方式切換:點開交通膠囊選「捷運」→ 以 forceMode 重新估算,結果寫回 state 與存檔、畫面顯示新分鐘數', async () => {
      const ms = memoryStore(seed())
      const ds = placeDs()
      const { container, core } = mount(adapter, { store: ms.store, coreDataSource: ds })
      expect(adapter.shownTransit(container, '竹下通')).toBe(adapter.variant === 'vertical' ? '步行 10 分 · 800 m' : '從上一站10 分鐘抵達・800 m')
      const menu = adapter.openTransitMenu(container, '竹下通')
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: /捷運/ }))

      expect(ds.transitEstimate).toHaveBeenCalledTimes(1)
      expect(ds.transitEstimate.mock.calls[0][2]).toBe('捷運')
      await waitFor(() => expect(getNode(core().timeline, 'b2')?.transitFromPrev?.mode).toBe('捷運'))
      expect(getNode(core().timeline, 'b2')?.transitFromPrev).toMatchObject({ loading: false, minutes: 7 })
      expect(getNode(ms.read(), 'b2')?.transitFromPrev).toMatchObject({ mode: '捷運', minutes: 7, loading: false })
      // 限定在竹下通自己的交通元素內比對完整字串(不用整頁 toContain('7 分'),那會誤中「17 分」之類的文字)
      expect(adapter.shownTransit(container, '竹下通')).toBe(adapter.variant === 'vertical' ? '捷運 7 分 · 1.2 km' : '從上一站7 分鐘抵達・1.2 km')
      expectTriad(adapter, container, core(), ms.read())
    })
  })

  // ───────── C ─────────
  describe('增(C)', () => {
    it('純記憶體宿主(不傳 store):從 hook 新增站點、天、住宿,視圖即時出現,且完全不碰 localStorage', () => {
      const { container, core } = mount(adapter)
      expect(adapter.dayLabels(container)).toEqual([])

      act(() => {
        expect(core().addStop(null, 'a1', { type: 'stop', name: '淺草寺', time: '09:00', day: 1 }).ok).toBe(true)
      })
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺']])

      act(() => {
        expect(core().addDay(undefined)).toEqual({ ok: true, day: 2, dayCount: 2 })
      })
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2'])
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺'], []])
      expect(adapter.emptyDayPlaceholders(container)).toBe(adapter.variant === 'horizontal' ? 1 : 0)

      // 跨天新增:錨點在第 1 天、指定 day 2 → 放在第 2 天最前面
      act(() => {
        expect(core().addStop('a1', 'b1', { type: 'stop', name: '明治神宮', time: '10:00', day: 2 }).ok).toBe(true)
      })
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺'], ['明治神宮']])
      expect(adapter.emptyDayPlaceholders(container)).toBe(0)

      let lodgingId = ''
      act(() => {
        const r = core().setLodging({ placeId: 'pl-ueno', name: '上野飯店', days: [1, 2] })
        expect(r.ok).toBe(true)
        if (r.ok) lodgingId = r.lodgingId
      })
      const banner = container.querySelector(`[data-lodging-id="${lodgingId}"]`) as HTMLElement
      expect(banner).toBeTruthy()
      expect(within(banner).getByText('上野飯店')).toBeTruthy()
      expect(within(banner).getByText('Day 1–2')).toBeTruthy()
      expectTriad(adapter, container, core())
      expect(localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY)).toBeNull()
    })

    it('跨天新增與插入天:錨點在第 1 天、指定第 2 天 → 放在第 2 天最前面;在第 2 天插入新天 → 後面的天順延、住宿區間跟著重算,存檔同步', () => {
      seedLocalStorage()
      const { container, core } = mount(adapter, { store: localStoragePlanTimelineStore })

      act(() => {
        const r = core().addStop('a2', 'x1', { type: 'stop', name: '代代木公園', time: '08:00', day: 2 })
        expect(r.ok).toBe(true)
      })
      expect(adapter.cardsByDay(container)[1]).toEqual(['代代木公園', '明治神宮', '竹下通', '澀谷'])
      expectTriad(adapter, container, core(), loadTimeline())

      act(() => {
        expect(core().addDay(2)).toEqual({ ok: true, day: 2, dayCount: 4 })
      })
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4'])
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺', '晴空塔'], [], ['代代木公園', '明治神宮', '竹下通', '澀谷'], []])
      // 住宿記的是天 id(d1、d2),插入新天後 d2 變成第 3 天,區間文字依位置重算
      const banner = container.querySelector('[data-lodging-id="L1"]') as HTMLElement
      expect(within(banner).getByText('Day 1, 3')).toBeTruthy()
      expect(loadTimeline().lodgings?.[0].dayIds).toEqual(['d1', 'd2'])
      expectTriad(adapter, container, core(), loadTimeline())

      // atDay 超過「天數 + 1」不是錯誤:視為加在最後面,回傳實際位置(目前沒有天數上限)
      act(() => {
        expect(core().addDay(99)).toEqual({ ok: true, day: 5, dayCount: 5 })
      })
      expect(adapter.dayLabels(container)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'])
      expectTriad(adapter, container, core(), loadTimeline())
    })

    it('失敗路徑:時間超出同天範圍、天數不合法、錨點不存在、住宿天數超出範圍等都回 ok:false,state 參照、畫面與存檔都不變', () => {
      const ms = memoryStore(seed())
      const { container, core } = mount(adapter, { store: ms.store })
      const before = core().timeline
      const savesBefore = ms.state.saves
      const cardsBefore = adapter.cardsByDay(container)
      const labelsBefore = adapter.dayLabels(container)

      const results: { ok: boolean; error?: { code?: string } }[] = []
      act(() => {
        // 插在明治神宮(09:00)之後、竹下通(11:00)之前,卻給 12:00
        results.push(core().addStop('b1', 'x', { type: 'stop', name: 'X', time: '12:00' }))
        results.push(core().addStop(null, 'x', { type: 'stop', name: 'X', day: 0 }))
        results.push(core().addStop('不存在', 'x', { type: 'stop', name: 'X' }))
        results.push(core().addStop('a1', 'x', { type: 'stop', name: 'X', time: '9點' }))
        results.push(core().addDay(0) as { ok: boolean; error?: { code?: string } })
        results.push(core().setLodging({ placeId: 'p', days: [9] }))
        results.push(core().setStopNote('不存在', '備註', undefined))
        results.push(core().moveDay(1, 9) as { ok: boolean; error?: { code?: string } })
      })
      expect(results.map((r) => r.ok)).toEqual([false, false, false, false, false, false, false, false])
      expect(results.map((r) => r.error?.code)).toEqual([
        'time_out_of_range',
        'invalid_day',
        'anchor_not_found',
        'invalid_time_format',
        'invalid_day',
        'day_not_found',
        'anchor_not_found',
        // moveDay 的錯誤目前沒有 code(model.ts moveDay 只回 message,與其他操作不一致,已列入回報);
        // 鎖住現況並另外驗 message,日後補上 code(例如 'invalid_day')時這裡會失敗提醒同步。
        undefined,
      ])
      expect((results[7].error as { message?: string }).message).toMatch(/fromDay=1、toDay=9 超出範圍,目前時間軸有 3 天/)
      let timeOk = true
      act(() => {
        timeOk = core().setStopTime('b2', '25:00')
      })
      expect(timeOk).toBe(false)

      expect(core().timeline).toBe(before)
      expect(ms.state.saves).toBe(savesBefore)
      // 不要求「完全沒有重繪」(innerHTML 全等太脆弱),只要求畫面上的天與卡片不變
      expect(adapter.cardsByDay(container)).toEqual(cardsBefore)
      expect(adapter.dayLabels(container)).toEqual(labelsBefore)
      expect(adapter.cardsByDay(container)).toEqual(SEED_CARDS)
      expectTriad(adapter, container, core(), ms.read())
    })
  })

  // ───────── 存檔失敗 ─────────
  describe('存檔失敗(注入 saveTimeline 回 null 的 store)', () => {
    it('刪除兩階段:摘除時存檔失敗 → 卡片還原、removing 清掉、存檔不變;恢復後能再刪一次並成功', () => {
      vi.useFakeTimers()
      const ms = memoryStore(seed())
      const { container, core } = mount(adapter, { store: ms.store })
      ms.state.failing = true

      act(() => {
        fireEvent.click(adapter.removeButton(container, '竹下通'))
      })
      expect(core().nodeStatus.get('b2')?.removing).toBe(true)
      act(() => {
        vi.advanceTimersByTime(REMOVE_FADE_MS)
      })
      expect(core().nodeStatus.get('b2')?.removing).toBeFalsy()
      expect(adapter.cardsByDay(container)).toEqual(SEED_CARDS)
      // 淡出還原:直向拿掉淡出樣式;橫向沒有淡出樣式(回 null),上面的 removing 已清掉、卡片仍在即為還原
      expect(adapter.isRemovingFade(container, '竹下通')).toBe(adapter.variant === 'vertical' ? false : null)
      expect(getNode(ms.read(), 'b2')).toBeDefined()
      expectTriad(adapter, container, core(), ms.read())

      ms.state.failing = false
      act(() => {
        fireEvent.click(adapter.removeButton(container, '竹下通'))
      })
      expect(core().nodeStatus.get('b2')?.removing).toBe(true)
      act(() => {
        vi.advanceTimersByTime(REMOVE_FADE_MS)
      })
      expect(adapter.cardsByDay(container)[1]).toEqual(['明治神宮', '澀谷'])
      expect(getNode(ms.read(), 'b2')).toBeUndefined()
      expectTriad(adapter, container, core(), ms.read())
    })

    it('新增/改動:addStop、addDay、setLodging、setStopNote 回 ok:false(save_failed),改時間回 false;state 參照與畫面不變', () => {
      const ms = memoryStore(seed())
      const { container, core } = mount(adapter, { store: ms.store })
      ms.state.failing = true
      const before = core().timeline
      const cardsBefore = adapter.cardsByDay(container)
      const labelsBefore = adapter.dayLabels(container)

      const codes: (string | undefined)[] = []
      act(() => {
        for (const r of [
          core().addStop('b3', 'x', { type: 'stop', name: '新宿', time: '18:00' }),
          core().addDay(undefined),
          core().setLodging({ placeId: 'pl-x', name: '新飯店', days: [3] }),
          core().setStopNote('b1', '備註', undefined),
        ]) {
          expect(r.ok).toBe(false)
          if (!r.ok) codes.push((r.error as { code?: string }).code)
        }
      })
      expect(codes).toEqual([SAVE_FAILED_CODE, SAVE_FAILED_CODE, SAVE_FAILED_CODE, SAVE_FAILED_CODE])
      expect(core().timeline).toBe(before)
      expect(adapter.cardsByDay(container)).toEqual(cardsBefore)
      expect(adapter.dayLabels(container)).toEqual(labelsBefore)
      expect(Array.from(container.querySelectorAll('[data-lodging-id]')).map((e) => e.getAttribute('data-lodging-id'))).toEqual(['L1'])

      if (adapter.variant === 'vertical') {
        // 從畫面拖時間:提交失敗,放開後顯示回到原本的時間
        act(() => verticalDragTime(container, '竹下通', 1))
        expect(adapter.shownTime(container, '竹下通')).toBe('11:00')
      } else {
        let ok = true
        act(() => {
          ok = core().setStopTime('b2', '11:30')
        })
        expect(ok).toBe(false)
        act(() => adapter.revealStop(container, '竹下通'))
        expect(adapter.shownTime(container, '竹下通')).toBe('11:00')
      }
      expect(getNode(core().timeline, 'b2')?.time).toBe('11:00')
      expect(container.querySelector('[data-lodging-id]')?.getAttribute('data-lodging-id')).toBe('L1')
      expect(adapter.cardsByDay(container)).toEqual(SEED_CARDS)
      expectTriad(adapter, container, core(), ms.read())
    })
  })

  // ───────── 重試 ─────────
  describe('重試(retryStop)', () => {
    // 查詢失敗的站:有 placeId、沒座標(重整後的「失敗」由資料本身判斷),名稱還是插入當下的佔位字串。
    const failedSeed = (): PlanTimeline => ({
      days: [{ id: 'd1', nodes: [stop('a1', '淺草寺', '09:00'), { id: 'k1', type: 'stop', name: '查詢中…', time: '10:00', placeId: 'p-kaminarimon' }] }],
    })

    it('失敗站點顯示重試入口;點了走核心的查詢路徑(先轉查詢中),成功後顯示名稱、清掉 failed,座標與名稱寫進存檔', async () => {
      seedLocalStorage(failedSeed())
      let resolveDetails: (v: unknown) => void = () => {}
      const ds = placeDs({ placeDetails: () => new Promise((r) => { resolveDetails = r }) as never })
      const { container, core, getByText, queryByText } = mount(adapter, { store: localStoragePlanTimelineStore, coreDataSource: ds })

      expect(getByText('未能取得地點資料')).toBeTruthy()
      fireEvent.click(getByText('重試'))
      expect(ds.placeDetails).toHaveBeenCalledWith('p-kaminarimon')
      expect(core().nodeStatus.get('k1')).toMatchObject({ loading: true })
      expect(core().nodeStatus.get('k1')?.failed).toBeFalsy()
      expect(queryByText('重試')).toBeNull()
      expect(queryByText('未能取得地點資料')).toBeNull()

      await act(async () => {
        resolveDetails({ found: true, name: '雷門', summary: '淺草地標', lat: 35.711, lng: 139.796 })
      })
      await waitFor(() => expect(container.textContent).toContain('雷門'))
      expect(queryByText('未能取得地點資料')).toBeNull()
      expect(core().nodeStatus.get('k1')?.failed).toBeFalsy()
      expect(core().nodeStatus.get('k1')?.loading).toBeFalsy()
      expect(getNode(loadTimeline(), 'k1')).toMatchObject({ name: '雷門', lat: 35.711, lng: 139.796 })
      expect(adapter.cardsByDay(container)).toEqual([['淺草寺', '雷門']])
      expectTriad(adapter, container, core(), loadTimeline())
    })

    it('重試仍失敗:狀態表標 failed、畫面維持重試入口;failed 不寫進存檔,重新掛載後仍由資料判斷為失敗', async () => {
      seedLocalStorage(failedSeed())
      const ds = placeDs({ placeDetails: async () => ({ found: false }) })
      const first = mount(adapter, { store: localStoragePlanTimelineStore, coreDataSource: ds })
      fireEvent.click(first.getByText('重試'))
      await waitFor(() => expect(first.core().nodeStatus.get('k1')).toMatchObject({ failed: true }))
      expect(first.getByText('未能取得地點資料')).toBeTruthy()
      expect(first.getByText('重試')).toBeTruthy()

      const raw = localStorage.getItem(PLAN_TIMELINE_STORAGE_KEY) ?? ''
      expect(raw).not.toContain('"failed"')
      expect(raw).not.toContain('"loading"')
      first.unmount()

      const second = mount(adapter, { store: localStoragePlanTimelineStore, coreDataSource: placeDs() })
      expect(second.core().nodeStatus.has('k1')).toBe(false)
      expect(second.getByText('未能取得地點資料')).toBeTruthy()
      expect(second.getByText('重試')).toBeTruthy()
    })
  })

  // ───────── 重新掛載 ─────────
  describe('重新掛載', () => {
    it('經畫面與 hook 改動後,以同一個 store 重新掛載宿主:天、卡片、住宿、時間與備註都與卸載前一致', () => {
      vi.useFakeTimers()
      const ms = memoryStore(seed())
      const first = mount(adapter, { store: ms.store })
      act(() => {
        fireEvent.click(adapter.removeButton(first.container, '晴空塔'))
      })
      act(() => {
        vi.advanceTimersByTime(REMOVE_FADE_MS)
      })
      act(() => {
        expect(first.core().addDay(2).ok).toBe(true)
        expect(first.core().addStop(null, 'n1', { type: 'stop', name: '上野公園', time: '10:00', day: 2 }).ok).toBe(true)
        expect(first.core().setLodging({ placeId: 'pl-shinjuku', name: '新宿飯店', days: [3, 4] }).ok).toBe(true)
        expect(first.core().setStopNote('b3', '晚餐', 'info').ok).toBe(true)
        expect(first.core().setStopTime('b1', '09:30')).toBe(true)
      })
      const timelineBefore = first.core().timeline
      const labelsBefore = adapter.dayLabels(first.container)
      const cardsBefore = adapter.cardsByDay(first.container)
      const lodgingIdsBefore = Array.from(first.container.querySelectorAll('[data-lodging-id]')).map((e) => e.getAttribute('data-lodging-id'))
      expect(cardsBefore).toEqual([['淺草寺'], ['上野公園'], ['明治神宮', '竹下通', '澀谷'], []])
      first.unmount()

      const second = mount(adapter, { store: ms.store })
      expect(second.core().timeline).toEqual(timelineBefore)
      expect(adapter.dayLabels(second.container)).toEqual(labelsBefore)
      expect(adapter.cardsByDay(second.container)).toEqual(cardsBefore)
      expect(Array.from(second.container.querySelectorAll('[data-lodging-id]')).map((e) => e.getAttribute('data-lodging-id'))).toEqual(lodgingIdsBefore)
      act(() => adapter.revealStop(second.container, '明治神宮'))
      expect(adapter.shownTime(second.container, '明治神宮')).toBe('09:30')
      act(() => adapter.revealStop(second.container, '澀谷'))
      expect(adapter.shownNote(second.container, '澀谷')).toContain('晚餐')
      expectTriad(adapter, second.container, second.core(), ms.read())
    })
  })
})
