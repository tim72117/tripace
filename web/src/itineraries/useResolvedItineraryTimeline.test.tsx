// useResolvedItineraryTimeline——行程站點經資料存取層(placeDetails)解析座標與照片,名稱與說明維持行程作者寫的。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { SampleItinerary, SampleStop } from './types'

const placeDetails = vi.fn()
vi.mock('../home/plan-ai-sim/planAiPublicDataSource', () => ({
  getPlanAiPublicDataSource: () => ({ placeDetails: (id: string) => placeDetails(id) }),
}))

import { useResolvedItineraryTimeline } from './useResolvedItineraryTimeline'

function stop(over: Partial<SampleStop> & { name: string }): SampleStop {
  return { time: '09:00', kind: '景點', duration: '1h', desc: `${over.name}說明`, ...over }
}
function make(stops: SampleStop[]): SampleItinerary {
  return { id: 'x', title: 'x', region: 'r', days: 1, categories: [], summary: 's', addedAt: '2026-10-01', stops }
}

beforeEach(() => {
  placeDetails.mockReset()
})

const stopsOf = (steps: ReturnType<typeof useResolvedItineraryTimeline>) => steps.filter((n) => n.type === 'stop')

describe('useResolvedItineraryTimeline', () => {
  it('起點是行程檔案的座標;帶 placeId 的站查到後座標與照片以資料存取層為準,名稱與說明不變', async () => {
    placeDetails.mockResolvedValue({
      found: true, name: 'Google 上的名字', summary: 'Google 摘要', lat: 10, lng: 20, googlePhotoUrls: ['https://x/p.jpg'],
    })
    const it = make([stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2 }), stop({ time: '10:00', name: 'B', lat: 3, lng: 4 })])
    const { result } = renderHook(() => useResolvedItineraryTimeline(it))
    expect(stopsOf(result.current)[0]).toMatchObject({ lat: 1, lng: 2 })
    await waitFor(() => expect(stopsOf(result.current)[0]).toMatchObject({ lat: 10, lng: 20, googlePhotoUrls: ['https://x/p.jpg'] }))
    expect(stopsOf(result.current)[0]).toMatchObject({ name: 'A', desc: 'A說明', placeId: 'pid_a' })
    expect(stopsOf(result.current)[1]).toMatchObject({ name: 'B', lat: 3, lng: 4 })
    expect(placeDetails).toHaveBeenCalledTimes(1)
    expect(placeDetails).toHaveBeenCalledWith('pid_a')
  })

  it('查不到(found: false)或查詢丟例外:維持行程檔案的內容,不標 failed(否則卡片名稱會被換成「未能取得地點資料」)', async () => {
    placeDetails.mockResolvedValueOnce({ found: false }).mockRejectedValueOnce(new Error('boom'))
    const it = make([
      stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2 }),
      stop({ time: '10:00', name: 'B', placeId: 'pid_b', lat: 3, lng: 4 }),
    ])
    const { result } = renderHook(() => useResolvedItineraryTimeline(it))
    await waitFor(() => expect(placeDetails).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 20))
    const s = stopsOf(result.current)
    expect(s[0]).toMatchObject({ name: 'A', lat: 1, lng: 2 })
    expect(s[1]).toMatchObject({ name: 'B', lat: 3, lng: 4 })
    expect(s[0].failed).toBeFalsy()
    expect(s[1].failed).toBeFalsy()
  })

  it('查到但沒有照片:不覆蓋行程原本寫的靜態 photos,座標仍更新', async () => {
    placeDetails.mockResolvedValue({ found: true, name: 'X', lat: 10, lng: 20, googlePhotoUrls: [] })
    const it = make([stop({ name: 'A', placeId: 'pid_a', lat: 1, lng: 2, photos: ['https://x/static.jpg'] })])
    const { result } = renderHook(() => useResolvedItineraryTimeline(it))
    await waitFor(() => expect(stopsOf(result.current)[0]).toMatchObject({ lat: 10, lng: 20 }))
    expect(stopsOf(result.current)[0].googlePhotoUrls).toEqual(['https://x/static.jpg'])
  })

  it('同 id 的內容換版(靜態版換成資料庫版):時間軸跟著換,重新解析', async () => {
    placeDetails.mockResolvedValue({ found: true, name: 'X', lat: 10, lng: 20, googlePhotoUrls: [] })
    const v1 = make([stop({ name: 'A', lat: 1, lng: 2 })])
    const v2 = make([stop({ name: 'A2', placeId: 'pid_new', lat: 3, lng: 4 })])
    const { result, rerender } = renderHook(({ it }) => useResolvedItineraryTimeline(it), { initialProps: { it: v1 } })
    expect(stopsOf(result.current)[0]).toMatchObject({ name: 'A', lat: 1, lng: 2 })
    rerender({ it: v2 })
    await waitFor(() => expect(stopsOf(result.current)[0]).toMatchObject({ name: 'A2', lat: 10, lng: 20 }))
    expect(placeDetails).toHaveBeenCalledWith('pid_new')
  })

  it('內容換版時,舊內容還沒回來的解析結果不會寫進新內容', async () => {
    let resolveOld: (v: unknown) => void = () => {}
    placeDetails.mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
    const v1 = make([stop({ name: 'A', placeId: 'pid_old', lat: 1, lng: 2 })])
    const v2 = make([stop({ name: 'A', lat: 3, lng: 4 })])
    const { result, rerender } = renderHook(({ it }) => useResolvedItineraryTimeline(it), { initialProps: { it: v1 } })
    rerender({ it: v2 })
    resolveOld({ found: true, name: 'OLD', lat: 99, lng: 99, googlePhotoUrls: ['https://x/old.jpg'] })
    await new Promise((r) => setTimeout(r, 20))
    expect(stopsOf(result.current)[0]).toMatchObject({ lat: 3, lng: 4 })
    expect(stopsOf(result.current)[0].googlePhotoUrls).toBeUndefined()
  })
})
