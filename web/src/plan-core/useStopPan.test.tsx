// useStopPan:卡片「移動到此」的平移,只分手機與桌面(/ai-plan 手機與登入桌面使用);首站自動平移見 useFirstStopAutoPan.test.tsx。
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { resolveStopPanTarget, usePhoneStopPan, useDesktopStopPan, useStopCardClick } from './useStopPan'

const stops = [
  { id: 'a', lat: 1, lng: 2 },
  { id: 'b', lat: 3, lng: 4 },
]
const mapRef = { current: {} as google.maps.Map }

describe('resolveStopPanTarget', () => {
  it('先查站點', () => {
    expect(resolveStopPanTarget('b', stops, undefined)).toEqual({ lat: 3, lng: 4 })
  })
  it('查不到再查展開主題點的子景點', () => {
    expect(resolveStopPanTarget('c1', stops, [{ id: 'c1', lat: 5, lng: 6 }])).toEqual({ lat: 5, lng: 6 })
  })
  it('子景點沒座標或找不到:null', () => {
    expect(resolveStopPanTarget('c1', stops, [{ id: 'c1' }])).toBeNull()
    expect(resolveStopPanTarget('zz', stops, undefined)).toBeNull()
  })
})

describe('usePhoneStopPan', () => {
  it('panToStop:啟用且地圖就緒才平移', () => {
    const pan = vi.fn()
    const { result } = renderHook(() =>
      usePhoneStopPan({ mapRef, mapReady: true, stops, enabled: true, panToWithinSafeArea: pan }),
    )
    result.current.panToStop('b')
    expect(pan).toHaveBeenCalledWith({ lat: 3, lng: 4 })
  })
  it('停用(推論態)或地圖未就緒:不平移', () => {
    const pan = vi.fn()
    const off = renderHook(() => usePhoneStopPan({ mapRef, mapReady: true, stops, enabled: false, panToWithinSafeArea: pan }))
    off.result.current.panToStop('b')
    const notReady = renderHook(() => usePhoneStopPan({ mapRef, mapReady: false, stops, enabled: true, panToWithinSafeArea: pan }))
    notReady.result.current.panToStop('b')
    expect(pan).not.toHaveBeenCalled()
  })
  it('不會自動平移首站(那是 useFirstStopAutoPan 的事)', () => {
    const pan = vi.fn()
    renderHook(() => usePhoneStopPan({ mapRef, mapReady: true, stops, enabled: true, panToWithinSafeArea: pan }))
    expect(pan).not.toHaveBeenCalled()
  })
})

describe('useDesktopStopPan', () => {
  it('panToStop:把站點座標交給注入的 pan', () => {
    const pan = vi.fn()
    const { result } = renderHook(() => useDesktopStopPan({ enabled: true, pan }))
    result.current.panToStop({ lat: 7, lng: 8 })
    expect(pan).toHaveBeenCalledWith({ lat: 7, lng: 8 })
  })
  it('停用時不平移', () => {
    const pan = vi.fn()
    const { result } = renderHook(() => useDesktopStopPan({ enabled: false, pan }))
    result.current.panToStop({ lat: 7, lng: 8 })
    expect(pan).not.toHaveBeenCalled()
  })
})

describe('useStopCardClick', () => {
  it('有座標:先選取該站,再把座標交給 pan', () => {
    const select = vi.fn()
    const pan = vi.fn()
    const { result } = renderHook(() => useStopCardClick({ select, pan }))
    result.current({ id: 'a', lat: 1, lng: 2 })
    expect(select).toHaveBeenCalledWith('a')
    expect(pan).toHaveBeenCalledWith({ lat: 1, lng: 2 })
  })

  it('沒有座標(查詢中的佔位卡):連選取都不做', () => {
    const select = vi.fn()
    const pan = vi.fn()
    const { result } = renderHook(() => useStopCardClick({ select, pan }))
    result.current({ id: 'x', lat: null, lng: 2 })
    result.current({ id: 'y' })
    expect(select).not.toHaveBeenCalled()
    expect(pan).not.toHaveBeenCalled()
  })

  it('沒有注入 pan:只選取、不平移', () => {
    const select = vi.fn()
    const { result } = renderHook(() => useStopCardClick({ select }))
    result.current({ id: 'a', lat: 1, lng: 2 })
    expect(select).toHaveBeenCalledWith('a')
  })
})
