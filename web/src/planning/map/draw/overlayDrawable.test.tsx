// overlay 類繪製項目(2026-10):功能層自己建立 google.maps.OverlayView 實例(例如景點光暈),
// 引擎負責依 id 比對、狀態變了通知更新、地圖重建後重掛、移除時清理。
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMapDrawLayer } from './index'
import { composeLayers } from './compose'
import { diffDrawables, signatureOf, type Entry } from './diff'
import type { Drawable, OverlayDrawable } from './types'

class FakeOverlay {
  map: unknown = undefined
  setMap(m: unknown) {
    this.map = m
  }
}

function overlay(id: string, extra: Partial<OverlayDrawable<FakeOverlay>> = {}): OverlayDrawable<FakeOverlay> {
  return { id, group: 'attractionGlow', kind: 'overlay', stateKey: 's1', create: () => new FakeOverlay(), ...extra }
}

type Props = Parameters<typeof useMapDrawLayer>[0]
function setup(drawables: Drawable[], over: Partial<Props> = {}) {
  const map = { tag: 'map' } as unknown as google.maps.Map
  const ref = { current: map as google.maps.Map | null }
  const props: Props = { mapRef: ref, mapReady: true, layers: [{ id: 'g', drawables }], ...over }
  const hook = renderHook((p: Props) => useMapDrawLayer(p), { initialProps: props })
  return { hook, props, map }
}

describe('overlay 繪製項目', () => {
  it('建立實例、掛到地圖、通知 onCreate', () => {
    const created: FakeOverlay[] = []
    const { map } = setup([overlay('a', { onCreate: (o) => created.push(o) })])
    expect(created).toHaveLength(1)
    expect(created[0].map).toBe(map)
  })

  it('mapReady 為 false 時不建立', () => {
    const create = vi.fn(() => new FakeOverlay())
    setup([overlay('a', { create })], { mapReady: false })
    expect(create).not.toHaveBeenCalled()
  })

  it('stateKey 改變:對同一個實例呼叫 update,不重建', () => {
    const create = vi.fn(() => new FakeOverlay())
    const update = vi.fn()
    const { hook, props } = setup([overlay('a', { create, update })])
    expect(update).not.toHaveBeenCalled()
    hook.rerender({ ...props, layers: [{ id: 'g', drawables: [overlay('a', { create, update, stateKey: 's2' })] }] })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toBe(create.mock.results[0].value)
  })

  it('stateKey 沒變:不更新', () => {
    const update = vi.fn()
    const { hook, props } = setup([overlay('a', { update })])
    hook.rerender({ ...props, layers: [{ id: 'g', drawables: [overlay('a', { update })] }] })
    expect(update).not.toHaveBeenCalled()
  })

  it('從清單消失:setMap(null) 並通知 onDispose', () => {
    const disposed: FakeOverlay[] = []
    const created: FakeOverlay[] = []
    const { hook, props } = setup([overlay('a', { onCreate: (o) => created.push(o), onDispose: (o) => disposed.push(o) })])
    hook.rerender({ ...props, layers: [{ id: 'g', drawables: [] }] })
    expect(created[0].map).toBeNull()
    expect(disposed).toEqual(created)
  })

  it('mapVersion 改變(地圖重建):舊實例清掉、重新建立並掛上', () => {
    const created: FakeOverlay[] = []
    const d = overlay('a', { onCreate: (o) => created.push(o) })
    const { hook, props } = setup([d])
    hook.rerender({ ...props, mapVersion: 1 })
    expect(created).toHaveLength(2)
    expect(created[0].map).toBeNull()
    expect(created[1].map).not.toBeNull()
  })

  it('卸載:全部清掉', () => {
    const created: FakeOverlay[] = []
    const { hook } = setup([overlay('a', { onCreate: (o) => created.push(o) })])
    hook.unmount()
    expect(created[0].map).toBeNull()
  })
})

describe('overlay 的 compose 與 diff', () => {
  it('compose 加功能層前綴', () => {
    expect(composeLayers([{ id: 'g', drawables: [overlay('a')] }])[0].id).toBe('g:a')
  })
  it('signature:stateKey 變才算 data 變', () => {
    const entries = new Map<string, Entry>([['a', { kind: 'overlay', ...signatureOf(overlay('a')) }]])
    expect(diffDrawables(entries, [overlay('a')])).toEqual({ add: [], update: [], remove: [] })
    expect(diffDrawables(entries, [overlay('a', { stateKey: 's2' })]).update).toHaveLength(1)
  })
})
