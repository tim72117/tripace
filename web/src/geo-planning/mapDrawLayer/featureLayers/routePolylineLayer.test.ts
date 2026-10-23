// routePolylineLayer 測試:itineraries 頁手繪路線功能層(2026-10)。
// 單元測試看純函式輸出;整合測試放進 useMapDrawLayer,驗證實際畫到(假的)地圖上的結果。
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { routePolylineLayer, type RoutePolylineSegment } from './routePolylineLayer'
import { useMapDrawLayer } from '../index'
import { composeLayers } from '../compose'
import { signatureOf } from '../diff'
import { GROUP_Z } from '../zOrder'
import type { PolylineDrawable } from '../types'

const seg = (dayIndex: number, n = 2, base = 0): RoutePolylineSegment => ({
  dayIndex,
  path: Array.from({ length: n }, (_, i) => ({ lat: base + i, lng: base + i + 0.5 })),
})
const polys = (segments: RoutePolylineSegment[]) => routePolylineLayer({ segments }).drawables as PolylineDrawable[]

describe('routePolylineLayer 純函式', () => {
  it('segment 帶 id 時用它當 drawable id,同一天可以有多段;沒給時用 dayIndex', () => {
    const ids = polys([{ ...seg(0), id: 'seg-a' }, { ...seg(0), id: 'seg-b' }, seg(1)]).map((p) => p.id)
    expect(ids).toEqual(['seg-a', 'seg-b', 'day-1'])
  })

  it('id 固定為 routePolyline;空 segments 回傳空陣列', () => {
    const layer = routePolylineLayer({ segments: [] })
    expect(layer.id).toBe('routePolyline')
    expect(layer.drawables).toEqual([])
  })

  it('單一 segment:路徑、群組與樣式(含方向箭頭)對照舊 hook', () => {
    const s = seg(0, 3)
    const [d] = polys([s])
    expect(d.kind).toBe('polyline')
    expect(d.group).toBe('routePolyline')
    expect(d.path).toEqual(s.path)
    expect(d.options).toMatchObject({ strokeColor: '#d88f45', strokeOpacity: 0.85, strokeWeight: 4 })
    expect(d.options?.icons).toEqual([
      { icon: { path: 1, scale: 2.6, strokeColor: '#fff', strokeWeight: 1.2 }, offset: '50%', repeat: '120px' },
    ])
  })

  it('顏色依 dayIndex 輪替,超過陣列長度回頭', () => {
    const colors = polys([seg(0), seg(1), seg(2), seg(3)]).map((d) => d.options?.strokeColor)
    expect(colors).toEqual(['#d88f45', '#4a7fb5', '#d88f45', '#4a7fb5'])
  })

  it('不足兩點的 segment 不產生 drawable(同舊 hook 直接略過)', () => {
    const out = polys([seg(0, 0), seg(1, 1), seg(2, 2)])
    expect(out.map((d) => d.id)).toEqual(['day-2'])
  })

  it('id 穩定:資料不變時 id 與簽章不變;一天改變只影響該天', () => {
    const a = polys([seg(0, 2, 0), seg(1, 2, 10)])
    const b = polys([seg(0, 2, 0), seg(1, 2, 10)])
    expect(b.map((d) => d.id)).toEqual(a.map((d) => d.id))
    expect(b.map((d) => signatureOf(d).data)).toEqual(a.map((d) => signatureOf(d).data))
    const c = polys([seg(0, 2, 0), seg(1, 3, 10)])
    expect(c.map((d) => d.id)).toEqual(a.map((d) => d.id))
    expect(signatureOf(c[0]).data).toBe(signatureOf(a[0]).data)
    expect(signatureOf(c[1]).data).not.toBe(signatureOf(a[1]).data)
  })

  it('composeLayers 後 id 帶功能層前綴', () => {
    expect(composeLayers([routePolylineLayer({ segments: [seg(0)] })])[0].id).toBe('routePolyline:day-0')
  })
})

class FakePolyline {
  static all: FakePolyline[] = []
  options: Record<string, unknown>
  map: unknown
  updates = 0
  constructor(opts: Record<string, unknown>) {
    this.options = { ...opts }
    this.map = opts.map
    FakePolyline.all.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.options, o)
    this.updates++
  }
  setMap(m: unknown) {
    this.map = m
  }
}
;(globalThis as { google?: unknown }).google = {
  maps: { Polyline: FakePolyline, event: { clearInstanceListeners: () => {} } },
}
const visible = () => FakePolyline.all.filter((p) => p.map != null)

describe('routePolylineLayer 整合(useMapDrawLayer)', () => {
  beforeEach(() => {
    FakePolyline.all = []
  })
  type P = { segments: RoutePolylineSegment[] }
  function setup(segments: RoutePolylineSegment[]) {
    const ref = { current: { tag: 'map' } as unknown as google.maps.Map | null }
    return renderHook(
      ({ segments }: P) => useMapDrawLayer({ mapRef: ref, mapReady: true, layers: [routePolylineLayer({ segments })] }),
      { initialProps: { segments } },
    )
  }

  it('畫出對應數量、zIndex 查表、一天改變只更新該條、清空全部移除', () => {
    const hook = setup([seg(0, 2, 0), seg(1, 2, 10), seg(2, 1)])
    expect(visible()).toHaveLength(2)
    expect(visible().every((p) => p.options.zIndex === GROUP_Z.routePolyline)).toBe(true)
    expect(visible().every((p) => p.options.clickable === false)).toBe(true)

    hook.rerender({ segments: [seg(0, 2, 0), seg(1, 3, 10), seg(2, 1)] })
    expect(FakePolyline.all).toHaveLength(2)
    expect(FakePolyline.all[0].updates).toBe(0)
    expect(FakePolyline.all[1].updates).toBe(1)
    expect((FakePolyline.all[1].options.path as unknown[]).length).toBe(3)

    hook.rerender({ segments: [] })
    expect(visible()).toHaveLength(0)
  })
})
