// currentLocationLayer 測試:純函式部分(資料轉換)與放進 useMapDrawLayer 後的整合行為。
// 整合部分的斷言對應 currentLocationLayer,確認換成功能層後可見結果一致。
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMapDrawLayer } from '../index'
import { GROUP_Z } from '../zOrder'
import type { MarkerDrawable } from '../types'
import { currentLocationLayer } from './currentLocationLayer'

class FakeMarker {
  static all: FakeMarker[] = []
  map: unknown
  position: unknown
  title?: string
  zIndex?: number
  content: unknown
  gmpClickable?: boolean
  constructor(opts: Record<string, unknown>) {
    Object.assign(this, opts)
    FakeMarker.all.push(this)
  }
  addListener() {
    return { remove: () => {} }
  }
}

;(globalThis as { google?: unknown }).google = {
  maps: {
    marker: { AdvancedMarkerElement: FakeMarker },
    event: { clearInstanceListeners: () => {} },
  },
}

const visible = () => FakeMarker.all.filter((m) => m.map != null)

beforeEach(() => {
  FakeMarker.all = []
})

describe('currentLocationLayer(純函式)', () => {
  it('有座標:一個不可點的 currentLocation marker', () => {
    const layer = currentLocationLayer({ position: { lat: 35, lng: 135.76 } })
    expect(layer.drawables).toHaveLength(1)
    const d = layer.drawables[0] as MarkerDrawable
    expect(d.kind).toBe('marker')
    expect(d.group).toBe('currentLocation')
    expect(d.title).toBe('目前位置')
    expect(d.position).toEqual({ lat: 35, lng: 135.76 })
    expect(d.clickable).not.toBe(true)
    expect(d.createContent()).toBeInstanceOf(Element)
  })

  it('沒有座標:空陣列', () => {
    expect(currentLocationLayer({ position: null }).drawables).toEqual([])
  })

  it('座標改變:位置跟著變,id 與 contentKey 不變', () => {
    const a = currentLocationLayer({ position: { lat: 35, lng: 135.76 } }).drawables[0] as MarkerDrawable
    const b = currentLocationLayer({ position: { lat: 24.1, lng: 120.9 } }).drawables[0] as MarkerDrawable
    expect(b.position).toEqual({ lat: 24.1, lng: 120.9 })
    expect(b.id).toBe(a.id)
    expect(b.contentKey).toBe(a.contentKey)
  })

  it('功能層 id 固定', () => {
    expect(currentLocationLayer({ position: null }).id).toBe('currentLocation')
    expect(currentLocationLayer({ position: { lat: 1, lng: 2 } }).id).toBe('currentLocation')
  })
})

describe('currentLocationLayer 放進 useMapDrawLayer', () => {
  type Props = { position: { lat: number; lng: number } | null; mapReady?: boolean }
  const setup = (position: Props['position'], mapReady = true) => {
    const map = { tag: 'map' } as unknown as google.maps.Map
    const hook = renderHook(
      (p: Props) => useMapDrawLayer({ mapRef: { current: map }, mapReady: p.mapReady ?? true, layers: [currentLocationLayer({ position: p.position })] }),
      { initialProps: { position, mapReady } as Props },
    )
    return { hook, map }
  }

  it('有座標:畫一顆藍點(標題、zIndex、不可點)', () => {
    const { map } = setup({ lat: 35, lng: 135.76 })
    const v = visible()
    expect(v).toHaveLength(1)
    expect(v[0].position).toEqual({ lat: 35, lng: 135.76 })
    expect(v[0].map).toBe(map)
    expect(v[0].title).toBe('目前位置')
    expect(v[0].zIndex).toBe(GROUP_Z.currentLocation)
    expect(v[0].gmpClickable).not.toBe(true)
    expect(v[0].content).toBeInstanceOf(Element)
  })

  it('沒有座標:什麼都不畫', () => {
    setup(null)
    expect(visible()).toHaveLength(0)
  })

  it('地圖還沒好:不畫;好了才畫', () => {
    const { hook } = setup({ lat: 35, lng: 135.76 }, false)
    expect(visible()).toHaveLength(0)
    hook.rerender({ position: { lat: 35, lng: 135.76 }, mapReady: true })
    expect(visible()).toHaveLength(1)
  })

  it('座標改變:只剩一顆,位置是最新的', () => {
    const { hook } = setup({ lat: 35, lng: 135.76 })
    hook.rerender({ position: { lat: 24.1, lng: 120.9 } })
    const v = visible()
    expect(v).toHaveLength(1)
    expect(v[0].position).toEqual({ lat: 24.1, lng: 120.9 })
  })

  it('座標沒變的重新渲染:不會多出第二顆', () => {
    const { hook } = setup({ lat: 35, lng: 135.76 })
    hook.rerender({ position: { lat: 35, lng: 135.76 } })
    expect(visible()).toHaveLength(1)
  })

  it('座標變 null:移除', () => {
    const { hook } = setup({ lat: 35, lng: 135.76 })
    hook.rerender({ position: null })
    expect(visible()).toHaveLength(0)
  })

  it('卸載:移除', () => {
    const { hook } = setup({ lat: 35, lng: 135.76 })
    hook.unmount()
    expect(visible()).toHaveLength(0)
  })
})
