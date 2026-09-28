// useGeoOutlineMapState 的目前位置定位 fallback——2026-09 新增:旅程查無
// 任何帶座標的 entry(!tripID,或 fetchEntries 回傳的 entries 都沒有
// lat/lng)時,額外試著問一次瀏覽器目前位置,問得到就透過 panTarget 把
// 地圖平移過去、並提供 currentPosition 供畫藍點,問不到就維持原樣(見
// tryGetCurrentPosition 的完整說明)。
//
// initialCenter 本身永遠立即同步決議成 null(不等定位結果)——這是
// 2026-09 一次 code review 抓到的真實 bug 修正:初版曾經讓 initialCenter
// 直接等定位結果,但 <ExploreMap> 的建圖 effect 有
// `if (initialCenter === undefined) return`,等於讓地圖何時能建立被綁在
// 瀏覽器定位何時回應上,最長可能卡住地圖 5 秒以上(逾時)或更久(使用者
// 不理會授權彈窗)。改回 initialCenter 立刻決議、定位結果改用不阻塞的
// panTarget 平移,才不會拖慢地圖出現的時間。
//
// mock navigator.geolocation——jsdom 環境本身沒有實作這個 API('geolocation'
// in navigator 恆為 false),若不主動 mock,這裡永遠只測得到「不支援」
// 這一種分支,測不到「使用者同意/拒絕」這兩種真正想驗證的行為。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGeoOutlineMapState } from './useGeoOutlineMapState'
import type { ClientConfig } from '../api'

const fetchEntriesMock = vi.fn(() => Promise.resolve([]))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchEntries: (...args: unknown[]) => fetchEntriesMock(...(args as [])),
  }
})

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: 'tok_1' }

function renderMapState(tripID: string | null) {
  return renderHook(() =>
    useGeoOutlineMapState({
      cfg,
      tripID,
      city: '',
      geocodeCandidates: [],
      setGeocodeCandidates: () => {},
      selectedCandidate: null,
      setSelectedCandidate: () => {},
    }),
  )
}

describe('useGeoOutlineMapState：initialCenter 永遠立即決議，不等定位結果', () => {
  beforeEach(() => {
    fetchEntriesMock.mockReset()
    fetchEntriesMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('查無旅程既有座標時，initialCenter 立刻是 null——不因為定位還在進行中而卡在 undefined', async () => {
    // 故意讓 getCurrentPosition 永遠不 resolve/reject,模擬使用者遲遲不
    // 理會授權彈窗——若 initialCenter 錯誤地等待定位結果,這個測試會
    // timeout 失敗;若行為正確(立即決議),initialCenter 應該馬上就是
    // null,不需要等待這個永遠不會完成的 promise。
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: () => {} },
    })

    const { result } = renderMapState(null)
    await waitFor(() => expect(result.current.initialCenter).toBeNull())
  })

  it('旅程有帶座標的 entry 時，initialCenter 立刻是 entry 平均座標，不觸發定位', async () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition },
    })
    fetchEntriesMock.mockResolvedValue([
      { id: 'ent_1', title: '清水寺', lat: 34.9949, lng: 135.785, kind: 'activity' },
    ] as never)

    const { result } = renderMapState('trip_1')
    await waitFor(() => expect(result.current.initialCenter).toEqual({ lat: 34.9949, lng: 135.785 }))
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(result.current.currentPosition).toBeNull()
  })
})

describe('useGeoOutlineMapState：定位成功/失敗時的 panTarget/currentPosition', () => {
  beforeEach(() => {
    fetchEntriesMock.mockReset()
    fetchEntriesMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('瀏覽器不支援 geolocation——不觸發平移、不設定 currentPosition', async () => {
    // 不 stub navigator.geolocation,jsdom 預設就是沒有這個屬性。
    const { result } = renderMapState(null)
    await waitFor(() => expect(result.current.initialCenter).toBeNull())
    expect(result.current.panTarget).toBeNull()
    expect(result.current.currentPosition).toBeNull()
  })

  it('使用者同意授權——定位成功後透過 panTarget 平移過去，並提供 currentPosition 畫藍點', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({
            coords: { latitude: 25.033, longitude: 121.5654 },
          } as GeolocationPosition)
        },
      },
    })

    const { result } = renderMapState(null)
    await waitFor(() => expect(result.current.currentPosition).toEqual({ lat: 25.033, lng: 121.5654 }))
    expect(result.current.panTarget).toMatchObject({ lat: 25.033, lng: 121.5654, suppressQuery: true })
    // initialCenter 不受定位結果影響，維持原本立即決議的 null。
    expect(result.current.initialCenter).toBeNull()
  })

  it('使用者拒絕授權——不觸發平移、不設定 currentPosition，不拋出例外', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)
        },
      },
    })

    const { result } = renderMapState(null)
    await waitFor(() => expect(result.current.initialCenter).toBeNull())
    expect(result.current.panTarget).toBeNull()
    expect(result.current.currentPosition).toBeNull()
  })
})
