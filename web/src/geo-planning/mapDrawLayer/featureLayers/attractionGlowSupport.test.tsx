// attractionGlowSupport 測試:光暈實例登記(registry)、照片查詢、標籤避讓。
// 實例與地圖都用假的;scheduleOverlayPhotos mock 掉(只看收到的 targets,並可手動觸發 setPhotoUrls);
// requestAnimationFrame 以手動佇列取代,讓「合併」「取消」可精確斷言。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAttractionGlowRegistry, useAttractionGlowEffects } from './attractionGlowSupport'
import { geoItemKey } from '../../geoSelectedKey'
import type { GeoAttraction } from '../../../api'
import type { AttractionOverlayInstance } from '../../geoAttractionOverlay'

const scheduleMock = vi.hoisted(() => vi.fn())
vi.mock('../../scheduleOverlayPhotos', () => ({ scheduleOverlayPhotos: scheduleMock }))

type Rect = { left: number; top: number; right: number; bottom: number }
function el(r: Rect | null): HTMLElement {
  const rect = r ? { ...r, width: r.right - r.left, height: r.bottom - r.top } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  return { getBoundingClientRect: () => rect } as unknown as HTMLElement
}

function fakeOverlay(o: { priority?: number; visual?: Rect | null; label?: Rect | null; hidden?: boolean } = {}) {
  return {
    setPhotoUrls: vi.fn(),
    getLabelPriority: () => o.priority ?? 0,
    getVisualEl: () => (o.visual === undefined ? null : el(o.visual)),
    getLabelEl: () => (o.label === undefined ? null : el(o.label)),
    isHidden: () => o.hidden ?? false,
    setLabelHidden: vi.fn(),
  }
}
type Fake = ReturnType<typeof fakeOverlay>

function att(name: string, placeId?: string, lat = 25, lng = 121): GeoAttraction {
  return { name, lat, lng, placeId } as GeoAttraction
}

function fakeMap() {
  const handlers = new Map<string, () => void>()
  const removes: ReturnType<typeof vi.fn>[] = []
  const map = {
    addListener: vi.fn((ev: string, h: () => void) => {
      handlers.set(ev, h)
      const remove = vi.fn()
      removes.push(remove)
      return { remove }
    }),
  }
  return { map: map as unknown as google.maps.Map, addListener: map.addListener, handlers, removes }
}

let rafQueue: Map<number, FrameRequestCallback>
let rafId: number
let cancelSpy: ReturnType<typeof vi.fn>
function flushRaf() {
  const q = [...rafQueue.values()]
  rafQueue.clear()
  q.forEach((cb) => cb(0))
}

beforeEach(() => {
  scheduleMock.mockReset()
  scheduleMock.mockReturnValue(() => {})
  rafQueue = new Map()
  rafId = 0
  cancelSpy = vi.fn((id: number) => void rafQueue.delete(id))
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', cancelSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('useAttractionGlowRegistry', () => {
  it('onCreate 登記、onDispose 清除', () => {
    const { result } = renderHook(() => useAttractionGlowRegistry())
    const a = att('A')
    const ov = fakeOverlay() as unknown as AttractionOverlayInstance
    result.current.onCreate('k', a, ov)
    expect(result.current.registry.current.get('k')).toEqual({ attraction: a, overlay: ov })
    result.current.onDispose('k', ov)
    expect(result.current.registry.current.has('k')).toBe(false)
  })

  it('同 key 已被新實例取代:舊實例 dispose 不會清掉新的', () => {
    const { result } = renderHook(() => useAttractionGlowRegistry())
    const oldOv = fakeOverlay() as unknown as AttractionOverlayInstance
    const newOv = fakeOverlay() as unknown as AttractionOverlayInstance
    result.current.onCreate('k', att('A'), oldOv)
    result.current.onCreate('k', att('A'), newOv)
    result.current.onDispose('k', oldOv)
    expect(result.current.registry.current.get('k')?.overlay).toBe(newOv)
    result.current.onDispose('k', newOv)
    expect(result.current.registry.current.has('k')).toBe(false)
  })

  it('回呼參照穩定', () => {
    const { result, rerender } = renderHook(() => useAttractionGlowRegistry())
    const first = result.current
    rerender()
    expect(result.current.onCreate).toBe(first.onCreate)
    expect(result.current.onDispose).toBe(first.onDispose)
    expect(result.current.registry).toBe(first.registry)
  })
})

type Props = Parameters<typeof useAttractionGlowEffects>[0]
function setup(attractions: GeoAttraction[], overlays: Fake[], extra: Partial<Props> = {}) {
  const registry = { current: new Map<string, { attraction: GeoAttraction; overlay: AttractionOverlayInstance }>() }
  attractions.forEach((a, i) => {
    if (overlays[i]) registry.current.set(geoItemKey('attraction', a), { attraction: a, overlay: overlays[i] as unknown as AttractionOverlayInstance })
  })
  const m = fakeMap()
  const base: Props = {
    mapRef: { current: m.map },
    mapReady: true,
    mapVersion: 0,
    registry,
    attractions,
    ...extra,
  }
  const hook = renderHook((p: Props) => useAttractionGlowEffects(p), { initialProps: base })
  return { ...hook, m, registry, base }
}

describe('useAttractionGlowEffects 照片查詢', () => {
  const details = vi.fn()

  it('沒傳 placeDetails:完全不查', () => {
    setup([att('A', 'p1')], [fakeOverlay()])
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  it('景點沒有 placeId:不進 targets', () => {
    setup([att('A'), att('B', 'p2')], [fakeOverlay(), fakeOverlay()], { placeDetails: details })
    const targets = scheduleMock.mock.calls[0][0]
    expect(targets.map((t: { placeId: string }) => t.placeId)).toEqual(['p2'])
  })

  it('有 placeId:呼叫實例的 setPhotoUrls', () => {
    const ov = fakeOverlay()
    setup([att('A', 'p1')], [ov], { placeDetails: details })
    const targets = scheduleMock.mock.calls[0][0]
    targets[0].setPhotoUrls(['u1'])
    expect(ov.setPhotoUrls).toHaveBeenCalledWith(['u1'])
  })

  it('多個景點各查自己的 placeId,對應各自實例', () => {
    const o1 = fakeOverlay()
    const o2 = fakeOverlay()
    setup([att('A', 'p1', 1, 1), att('B', 'p2', 2, 2)], [o1, o2], { placeDetails: details })
    const targets = scheduleMock.mock.calls[0][0]
    expect(targets.map((t: { placeId: string }) => t.placeId)).toEqual(['p1', 'p2'])
    targets[1].setPhotoUrls(['x'])
    expect(o1.setPhotoUrls).not.toHaveBeenCalled()
    expect(o2.setPhotoUrls).toHaveBeenCalledWith(['x'])
  })

  it('registry 裡尚無實例的景點跳過', () => {
    setup([att('A', 'p1'), att('B', 'p2')], [fakeOverlay()], { placeDetails: details })
    expect(scheduleMock.mock.calls[0][0].map((t: { placeId: string }) => t.placeId)).toEqual(['p1'])
  })

  it('fetchDetails 轉到最新的 placeDetails,photoAssets 一併傳入', () => {
    const photoAssets = vi.fn()
    setup([att('A', 'p1')], [fakeOverlay()], { placeDetails: details, photoAssets })
    const [, fetchDetails, assets] = scheduleMock.mock.calls[0]
    fetchDetails('pz')
    expect(details).toHaveBeenCalledWith('pz')
    expect(assets).toBe(photoAssets)
  })

  it('mapVersion 變動(重建)會補查;卸載時呼叫取消函式', () => {
    const cancel = vi.fn()
    scheduleMock.mockReturnValue(cancel)
    const { rerender, base, unmount } = setup([att('A', 'p1')], [fakeOverlay()], { placeDetails: details })
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    rerender({ ...base, mapVersion: 1, placeDetails: details })
    expect(scheduleMock).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledTimes(1)
    unmount()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
})

describe('useAttractionGlowEffects 標籤避讓', () => {
  const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })

  it('標籤與較高優先的圖形重疊:隱藏;不重疊:顯示', () => {
    const hi = fakeOverlay({ priority: 10, visual: R(0, 0, 50, 50), label: null })
    const loOverlap = fakeOverlay({ priority: 1, visual: R(200, 200, 220, 220), label: R(40, 40, 90, 60) })
    const loFree = fakeOverlay({ priority: 0, visual: R(300, 300, 320, 320), label: R(400, 400, 450, 420) })
    setup([att('H', undefined, 1, 1), att('O', undefined, 2, 2), att('F', undefined, 3, 3)], [hi, loOverlap, loFree])
    flushRaf()
    expect(loOverlap.setLabelHidden).toHaveBeenCalledWith(true)
    expect(loFree.setLabelHidden).toHaveBeenCalledWith(false)
  })

  it('自己的圖形不算障礙物', () => {
    const self = fakeOverlay({ visual: R(0, 0, 50, 50), label: R(10, 10, 40, 40) })
    setup([att('A')], [self])
    flushRaf()
    expect(self.setLabelHidden).toHaveBeenCalledWith(false)
  })

  it('依優先度而非 registry 順序:高優先的標籤先佔位,低優先的與其重疊被隱藏', () => {
    const lo = fakeOverlay({ priority: 1, label: R(0, 0, 50, 50) })
    const hi = fakeOverlay({ priority: 9, label: R(25, 25, 80, 80) })
    setup([att('L', undefined, 1, 1), att('H', undefined, 2, 2)], [lo, hi])
    flushRaf()
    expect(hi.setLabelHidden).toHaveBeenCalledWith(false)
    expect(lo.setLabelHidden).toHaveBeenCalledWith(true)
  })

  it('被隱藏的標籤不當障礙物:第三個只與被隱藏者重疊時仍顯示', () => {
    const a = fakeOverlay({ priority: 9, label: R(0, 0, 50, 50) })
    const b = fakeOverlay({ priority: 5, label: R(40, 0, 90, 50) }) // 與 a 重疊,被隱藏
    const c = fakeOverlay({ priority: 1, label: R(80, 0, 130, 50) }) // 只與 b 重疊
    setup([att('A', undefined, 1, 1), att('B', undefined, 2, 2), att('C', undefined, 3, 3)], [a, b, c])
    flushRaf()
    expect(b.setLabelHidden).toHaveBeenCalledWith(true)
    expect(c.setLabelHidden).toHaveBeenCalledWith(false)
  })

  it('isHidden 的實例不當障礙物,自己的標籤也不處理', () => {
    const hiddenOv = fakeOverlay({ priority: 9, hidden: true, visual: R(0, 0, 100, 100), label: R(0, 0, 100, 100) })
    const other = fakeOverlay({ priority: 1, label: R(10, 10, 60, 60) })
    setup([att('H', undefined, 1, 1), att('O', undefined, 2, 2)], [hiddenOv, other])
    flushRaf()
    expect(other.setLabelHidden).toHaveBeenCalledWith(false)
    expect(hiddenOv.setLabelHidden).not.toHaveBeenCalled()
  })

  it('寬或高為 0 的標籤視為不存在,不處理', () => {
    const ov = fakeOverlay({ label: R(10, 10, 10, 30) })
    setup([att('A')], [ov])
    flushRaf()
    expect(ov.setLabelHidden).not.toHaveBeenCalled()
  })

  it('rAF 合併:多個事件只排一次,flush 後可再排', () => {
    const { m } = setup([att('A')], [fakeOverlay()])
    expect(rafQueue.size).toBe(1)
    m.handlers.get('idle')!()
    m.handlers.get('bounds_changed')!()
    m.handlers.get('zoom_changed')!()
    expect(rafQueue.size).toBe(1)
    flushRaf()
    m.handlers.get('idle')!()
    expect(rafQueue.size).toBe(1)
  })

  it('idle / bounds_changed / zoom_changed 觸發重算', () => {
    const ov = fakeOverlay({ label: R(0, 0, 10, 10) })
    const { m } = setup([att('A')], [ov])
    flushRaf()
    expect(ov.setLabelHidden).toHaveBeenCalledTimes(1)
    for (const ev of ['idle', 'bounds_changed', 'zoom_changed']) {
      expect(m.handlers.has(ev)).toBe(true)
      m.handlers.get(ev)!()
      flushRaf()
    }
    expect(ov.setLabelHidden).toHaveBeenCalledTimes(4)
  })

  it('卸載:移除三個監聽並取消待處理的 rAF', () => {
    const { m, unmount } = setup([att('A')], [fakeOverlay()])
    expect(rafQueue.size).toBe(1)
    unmount()
    expect(m.removes).toHaveLength(3)
    m.removes.forEach((r) => expect(r).toHaveBeenCalledTimes(1))
    expect(cancelSpy).toHaveBeenCalled()
    expect(rafQueue.size).toBe(0)
  })

  it('沒有景點:不掛監聽、不排 rAF', () => {
    const { m } = setup([], [])
    expect(m.addListener).not.toHaveBeenCalled()
    expect(rafQueue.size).toBe(0)
  })

  it('mapReady 為 false:不掛監聽', () => {
    const { m } = setup([att('A')], [fakeOverlay()], { mapReady: false })
    expect(m.addListener).not.toHaveBeenCalled()
  })

  it('selectedKey 變動:舊監聽移除、重新掛並重算', () => {
    const { m, rerender, base } = setup([att('A')], [fakeOverlay()])
    rerender({ ...base, selectedKey: 'x' })
    expect(m.removes.slice(0, 3).every((r) => r.mock.calls.length === 1)).toBe(true)
    expect(m.addListener).toHaveBeenCalledTimes(6)
  })
})
