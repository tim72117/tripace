import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanTimeline } from '../timeline/model'
import { PLAN_TIMELINE_STORAGE_KEY, saveTimelineForKey, loadTimelineWithRevForKey } from '../timeline/storage'
import { DRAFTS_INDEX_KEY, draftTimelineKey } from '../timeline/drafts'
import {
  LEGACY_TRIP_ID,
  TRIPS_CHANGED_EVENT,
  TOUCH_INTERVAL_MS,
  TRIPS_INDEX_KEY,
  createTrip,
  createTripTimelineStore,
  deleteTrip,
  getActiveTripId,
  getTrip,
  listTrips,
  renameTrip,
  setActiveTrip,
  touchTrip,
  tripDisplayName,
  tripTimelineKey,
} from './trips'

function timelineOf(names: string[]): PlanTimeline {
  return { days: [{ id: 'd1', nodes: names.map((name, i) => ({ id: `n${i}`, type: 'stop' as const, name })) }] }
}

beforeEach(() => {
  localStorage.clear()
})

describe('播種(第一次沒有索引)', () => {
  it('什麼舊資料都沒有:沒有任何行程、沒有使用中', () => {
    expect(listTrips()).toEqual([])
    expect(getActiveTripId()).toBeNull()
  })

  it('固定 key 那份行程有內容:變成 legacy Trip,時間軸 key 不變、舊資料不動', () => {
    saveTimelineForKey(PLAN_TIMELINE_STORAGE_KEY, timelineOf(['赤崁樓', '安平古堡', '孔廟']), 0)
    const trips = listTrips()
    expect(trips).toHaveLength(1)
    expect(trips[0]).toMatchObject({ id: LEGACY_TRIP_ID, title: '赤崁樓、安平古堡⋯等' })
    expect(tripTimelineKey(LEGACY_TRIP_ID)).toBe(PLAN_TIMELINE_STORAGE_KEY)
    expect(loadTimelineWithRevForKey(PLAN_TIMELINE_STORAGE_KEY).timeline.days[0].nodes).toHaveLength(3)
    expect(getActiveTripId()).toBe(LEGACY_TRIP_ID)
  })

  it('既有草稿索引:每份草稿變成 Trip,時間軸沿用草稿的 key;使用中的是最近編輯的', () => {
    localStorage.setItem(
      DRAFTS_INDEX_KEY,
      JSON.stringify({
        version: 1,
        drafts: [
          { id: 'old', createdAt: 1, updatedAt: 10, title: '舊的' },
          { id: 'new', createdAt: 2, updatedAt: 20, title: '新的' },
        ],
      }),
    )
    expect(listTrips().map((t) => t.id)).toEqual(['new', 'old'])
    expect(tripTimelineKey('new')).toBe(draftTimelineKey('new'))
    expect(getActiveTripId()).toBe('new')
  })

  it('播種只做一次:之後新增的草稿不會再被併進來', () => {
    listTrips()
    localStorage.setItem(DRAFTS_INDEX_KEY, JSON.stringify({ version: 1, drafts: [{ id: 'x', createdAt: 1, updatedAt: 1, title: 'x' }] }))
    expect(listTrips()).toEqual([])
  })
})

describe('建立、改名、切換、刪除', () => {
  it('createTrip:空白行程立刻進索引並成為使用中,通知訂閱者', () => {
    const onChange = vi.fn()
    window.addEventListener(TRIPS_CHANGED_EVENT, onChange)
    const trip = createTrip('日本賞楓')
    window.removeEventListener(TRIPS_CHANGED_EVENT, onChange)
    expect(onChange).toHaveBeenCalled()
    expect(getTrip(trip.id)).toMatchObject({ name: '日本賞楓', title: '新行程' })
    expect(getActiveTripId()).toBe(trip.id)
    expect(tripDisplayName(trip)).toBe('日本賞楓')
  })

  it('renameTrip:改名;空字串退回自動標題;找不到回 false', () => {
    const trip = createTrip()
    expect(tripDisplayName(trip)).toBe('新行程')
    expect(renameTrip(trip.id, '  台南三日  ')).toBe(true)
    expect(tripDisplayName(getTrip(trip.id)!)).toBe('台南三日')
    expect(renameTrip(trip.id, '   ')).toBe(true)
    expect(getTrip(trip.id)!.name).toBeUndefined()
    expect(renameTrip('nope', 'x')).toBe(false)
  })

  it('setActiveTrip:切換使用中;不存在的 id 回 false 且不改動', () => {
    const a = createTrip('A')
    const b = createTrip('B')
    expect(getActiveTripId()).toBe(b.id)
    expect(setActiveTrip(a.id)).toBe(true)
    expect(getActiveTripId()).toBe(a.id)
    expect(setActiveTrip('nope')).toBe(false)
    expect(getActiveTripId()).toBe(a.id)
  })

  it('deleteTrip:移除索引與時間軸資料;刪的是使用中的就改選最近編輯的;刪光後沒有使用中', () => {
    const a = createTrip('A')
    const b = createTrip('B')
    const storeB = createTripTimelineStore(b.id)
    storeB.saveTimeline(timelineOf(['赤崁樓']), 0)
    expect(localStorage.getItem(tripTimelineKey(b.id))).not.toBeNull()
    expect(deleteTrip(b.id)).toBe(true)
    expect(localStorage.getItem(tripTimelineKey(b.id))).toBeNull()
    expect(getActiveTripId()).toBe(a.id)
    expect(deleteTrip(a.id)).toBe(true)
    expect(getActiveTripId()).toBeNull()
    expect(deleteTrip('nope')).toBe(false)
  })
})

describe('createTripTimelineStore / touchTrip', () => {
  it('存檔成功後更新該行程的自動標題與最後編輯時間', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const trip = createTrip()
    vi.setSystemTime(5000)
    const store = createTripTimelineStore(trip.id)
    const rev = store.saveTimeline(timelineOf(['赤崁樓', '孔廟']), 0)
    expect(rev).not.toBeNull()
    expect(getTrip(trip.id)).toMatchObject({ title: '赤崁樓、孔廟', updatedAt: 5000, createdAt: 1000 })
    expect(store.loadTimelineWithRev().timeline.days[0].nodes).toHaveLength(2)
    vi.useRealTimers()
  })

  it('節流:標題沒變且在區間內不寫索引、不通知;超過區間才更新最後編輯時間;標題變了立刻更新', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const trip = createTrip()
    const store = createTripTimelineStore(trip.id)
    vi.setSystemTime(2000)
    let rev = store.saveTimeline(timelineOf(['赤崁樓']), 0)! // 標題從「新行程」變成「赤崁樓」:立刻寫
    expect(getTrip(trip.id)!.updatedAt).toBe(2000)
    const onChange = vi.fn()
    window.addEventListener(TRIPS_CHANGED_EVENT, onChange)
    vi.setSystemTime(2000 + TOUCH_INTERVAL_MS - 1)
    rev = store.saveTimeline(timelineOf(['赤崁樓']), rev)! // 標題沒變、區間內:不寫
    expect(getTrip(trip.id)!.updatedAt).toBe(2000)
    expect(onChange).not.toHaveBeenCalled()
    vi.setSystemTime(2000 + TOUCH_INTERVAL_MS)
    rev = store.saveTimeline(timelineOf(['赤崁樓']), rev)! // 超過區間:更新
    expect(getTrip(trip.id)!.updatedAt).toBe(2000 + TOUCH_INTERVAL_MS)
    expect(onChange).toHaveBeenCalledTimes(1)
    vi.setSystemTime(2000 + TOUCH_INTERVAL_MS + 5)
    store.saveTimeline(timelineOf(['赤崁樓', '孔廟']), rev) // 標題變了:區間內也立刻寫
    expect(getTrip(trip.id)!.title).toBe('赤崁樓、孔廟')
    window.removeEventListener(TRIPS_CHANGED_EVENT, onChange)
    vi.useRealTimers()
  })

  it('解析快取:索引字串沒變時重複讀取回傳同一份;被改寫後讀到新內容', () => {
    createTrip('A')
    const first = listTrips()
    expect(listTrips()[0]).toBe(first[0]) // 同一份索引內的物件身分穩定
    localStorage.setItem(TRIPS_INDEX_KEY, JSON.stringify({ version: 1, activeTripId: null, trips: [] }))
    expect(listTrips()).toEqual([])
  })

  it('不同行程的時間軸互相獨立', () => {
    const a = createTrip()
    const b = createTrip()
    createTripTimelineStore(a.id).saveTimeline(timelineOf(['A 的站']), 0)
    expect(createTripTimelineStore(b.id).loadTimelineWithRev().timeline.days.flatMap((d) => d.nodes)).toHaveLength(0)
  })

  it('touchTrip:索引沒有這一筆且時間軸為空不補;有內容才補;已有的空時間軸只更新時間、保留標題', () => {
    touchTrip('ghost', { days: [] })
    expect(getTrip('ghost')).toBeUndefined()
    touchTrip('ghost', timelineOf(['赤崁樓']))
    expect(getTrip('ghost')?.title).toBe('赤崁樓')
    touchTrip('ghost', { days: [] })
    expect(getTrip('ghost')?.title).toBe('赤崁樓')
  })

  it('壞掉的索引內容:當作沒有索引重新播種,不丟錯', () => {
    localStorage.setItem(TRIPS_INDEX_KEY, '{壞掉')
    expect(listTrips()).toEqual([])
  })
})
