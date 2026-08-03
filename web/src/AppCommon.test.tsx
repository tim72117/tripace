// useTripsState 是每個使用者打開 App 第一件會碰到的邏輯:列出行程、建立
// 行程、選擇行程、自動導向使用者先前設定的預設行程。這裡直接 mock 掉
// ./api 模組(而非像 api.test.ts 那樣 mock fetch),因為要測的是這個 hook
// 本身的狀態機邏輯,不是它底下呼叫 api 的實作細節。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Trip } from './types'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchTrips: vi.fn(),
    createTrip: vi.fn(),
  }
})

import * as api from './api'
import { useTripsState, LS_DEFAULT_TRIP } from './AppCommon'

const cfg = { baseURL: 'http://localhost:8080', token: null }

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'tr_1',
    name: '花蓮三日',
    ownerID: 'usr_me',
    memberCount: 1,
    lastMessagePreview: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('useTripsState', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(api.fetchTrips).mockReset()
    vi.mocked(api.createTrip).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('掛載時呼叫 fetchTrips,成功後把結果放進 trips', async () => {
    const trips = [makeTrip()]
    vi.mocked(api.fetchTrips).mockResolvedValue(trips)
    const onOpen = vi.fn()

    const { result } = renderHook(() => useTripsState(cfg, onOpen))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(api.fetchTrips).toHaveBeenCalledTimes(1)
    expect(result.current.trips).toEqual(trips)
    expect(result.current.err).toBeNull()
  })

  it('fetchTrips 失敗時 err 有值、trips 維持空陣列', async () => {
    vi.mocked(api.fetchTrips).mockRejectedValue(new Error('連線失敗'))
    const onOpen = vi.fn()

    const { result } = renderHook(() => useTripsState(cfg, onOpen))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.trips).toEqual([])
    expect(result.current.err).toBe('連線失敗')
  })

  it('localStorage 記錄的預設行程存在於清單中時,自動呼叫 onOpen', async () => {
    const target = makeTrip({ id: 'tr_target' })
    const other = makeTrip({ id: 'tr_other' })
    localStorage.setItem(LS_DEFAULT_TRIP, 'tr_target')
    vi.mocked(api.fetchTrips).mockResolvedValue([other, target])
    const onOpen = vi.fn()

    renderHook(() => useTripsState(cfg, onOpen))

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen).toHaveBeenCalledWith(target)
  })

  it('localStorage 沒有記錄預設行程時,不會呼叫 onOpen', async () => {
    vi.mocked(api.fetchTrips).mockResolvedValue([makeTrip()])
    const onOpen = vi.fn()

    const { result } = renderHook(() => useTripsState(cfg, onOpen))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('localStorage 記錄的預設行程 ID 不在目前清單中時,不會誤觸發 onOpen', async () => {
    localStorage.setItem(LS_DEFAULT_TRIP, 'tr_不存在的id')
    vi.mocked(api.fetchTrips).mockResolvedValue([makeTrip({ id: 'tr_1' })])
    const onOpen = vi.fn()

    const { result } = renderHook(() => useTripsState(cfg, onOpen))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('submitCreate 呼叫 api.createTrip 並重新載入清單,清空 newName', async () => {
    vi.mocked(api.fetchTrips).mockResolvedValue([])
    vi.mocked(api.createTrip).mockResolvedValue(makeTrip({ id: 'tr_new' }))
    const onOpen = vi.fn()

    const { result } = renderHook(() => useTripsState(cfg, onOpen))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setNewName('新的花蓮行程'))
    expect(result.current.newName).toBe('新的花蓮行程')

    await act(async () => {
      await result.current.submitCreate()
    })

    expect(api.createTrip).toHaveBeenCalledWith(cfg, '新的花蓮行程')
    // 建立成功後重新呼叫 fetchTrips 刷新清單(掛載時 1 次 + submitCreate 後 1 次)。
    expect(api.fetchTrips).toHaveBeenCalledTimes(2)
    expect(result.current.newName).toBe('')
    expect(result.current.creating).toBe(false)
  })

  it('submitCreate 名稱只有空白字元時不呼叫 createTrip', async () => {
    vi.mocked(api.fetchTrips).mockResolvedValue([])
    const onOpen = vi.fn()

    const { result } = renderHook(() => useTripsState(cfg, onOpen))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setNewName('   '))
    await act(async () => {
      await result.current.submitCreate()
    })

    expect(api.createTrip).not.toHaveBeenCalled()
  })

  it('重新掛載(模擬元件卸載重掛)會重置 trips 並重新呼叫 fetchTrips', async () => {
    vi.mocked(api.fetchTrips).mockResolvedValue([makeTrip()])
    const onOpen = vi.fn()

    const { result, unmount } = renderHook(() => useTripsState(cfg, onOpen))
    await waitFor(() => expect(result.current.trips).toHaveLength(1))
    unmount()

    vi.mocked(api.fetchTrips).mockClear()
    vi.mocked(api.fetchTrips).mockResolvedValue([makeTrip(), makeTrip({ id: 'tr_2' })])

    const { result: result2 } = renderHook(() => useTripsState(cfg, onOpen))
    // 重新掛載瞬間,新的一份 state 應該從初始值開始(不是延續前一份實例的資料),
    // 這正是先前那個「側欄被 JSX 條件渲染卸載重掛」bug 的根源行為——
    // 這支測試記錄這個行為現況,而非阻止它發生(修法在渲染層,不在這個 hook)。
    await waitFor(() => expect(result2.current.trips).toHaveLength(2))
    expect(api.fetchTrips).toHaveBeenCalledTimes(1)
  })
})
