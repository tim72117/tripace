// useMapState 的 locationWanted——旅程查無任何帶座標的 entry(!tripID,或 fetchEntries 回傳的 entries 都沒有
// lat/lng,或查詢失敗)時為 true,表示「沒有旅程中心,可以試著取目前位置」。這個 hook 只判斷「要不要」,不碰瀏覽器定位:
// 怎麼取、要不要跳授權、取到後的藍點與平移是入口自己的 useCurrentLocation(phone/、desktop/,見各自的測試)。
//
// initialCenter 本身永遠立即同步決議成 null(不等定位)——2026-09 一次 code review 抓到的真實 bug 修正:初版曾經讓
// initialCenter 直接等定位結果,但 <PlanMap> 的建圖 effect 有 `if (initialCenter === undefined) return`,等於讓地圖何時
// 能建立被綁在瀏覽器定位何時回應上,最長可能卡住地圖 5 秒以上。現在這個 hook 完全不呼叫定位,更不可能卡住;
// 這裡仍保留「initialCenter 立刻決議」的斷言守住這個前提。
import { createPlanAiApiDataSource } from '../data/api'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMapState } from './useMapState'
import type { ClientConfig } from '../../api'

const fetchEntriesMock = vi.fn(() => Promise.resolve([]))

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return {
    ...actual,
    fetchEntries: (...args: unknown[]) => fetchEntriesMock(...(args as [])),
  }
})

const cfg: ClientConfig = { baseURL: 'http://localhost:8080', token: 'tok_1' }
const dataSource = createPlanAiApiDataSource(cfg)

function renderMapState(tripID: string | null) {
  return renderHook(() =>
    useMapState({
      cfg,
      dataSource,
      tripID,
      city: '',
      geocodeCandidates: [],
      setGeocodeCandidates: () => {},
      selectedCandidate: null,
      setSelectedCandidate: () => {},
    }),
  )
}

describe('useMapState：initialCenter 永遠立即決議，locationWanted 表示要不要試著取目前位置', () => {
  beforeEach(() => {
    fetchEntriesMock.mockReset()
    fetchEntriesMock.mockResolvedValue([])
  })

  it('沒有旅程：initialCenter 立刻是 null，locationWanted 為 true', async () => {
    const { result } = renderMapState(null)
    await waitFor(() => expect(result.current.initialCenter).toBeNull())
    expect(result.current.locationWanted).toBe(true)
  })

  it('旅程沒有任何帶座標的 entry：initialCenter 是 null，locationWanted 為 true', async () => {
    const { result } = renderMapState('trip_1')
    await waitFor(() => expect(result.current.locationWanted).toBe(true))
    expect(result.current.initialCenter).toBeNull()
  })

  it('查詢旅程 entry 失敗：視同沒有座標，locationWanted 為 true', async () => {
    fetchEntriesMock.mockRejectedValue(new Error('boom'))
    const { result } = renderMapState('trip_1')
    await waitFor(() => expect(result.current.locationWanted).toBe(true))
    expect(result.current.initialCenter).toBeNull()
  })

  it('旅程有帶座標的 entry：initialCenter 是 entry 平均座標，locationWanted 維持 false', async () => {
    fetchEntriesMock.mockResolvedValue([
      { id: 'ent_1', title: '清水寺', lat: 34.9949, lng: 135.785, kind: 'activity' },
    ] as never)
    const { result } = renderMapState('trip_1')
    await waitFor(() => expect(result.current.initialCenter).toEqual({ lat: 34.9949, lng: 135.785 }))
    expect(result.current.locationWanted).toBe(false)
    expect(result.current.panTarget).toBeNull()
  })
})
