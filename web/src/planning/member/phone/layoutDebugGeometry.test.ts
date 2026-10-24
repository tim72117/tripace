// layoutDebugGeometry 契約測試——規則見 layoutDebugGeometry.ts 檔頭。
import { describe, it, expect } from 'vitest'
import { solvePhoneLayoutDebug, type Rect } from './layoutDebugGeometry'

const origin: Rect = { top: 100, left: 0, width: 400, height: 600 } // overlay 在視窗中的位置

describe('solvePhoneLayoutDebug', () => {
  it('地圖中心 = 地圖容器的中心點(換算成相對 overlay 的座標)', () => {
    // 地圖容器比 overlay 大:從 y=100 到 y=700(含 tab bar 那一段)
    const r = solvePhoneLayoutDebug({
      origin,
      mapRect: { top: 100, left: 0, width: 400, height: 700 },
      timelineChildRects: [],
      composerRect: null,
    })
    expect(r.mapCenter).toEqual({ x: 200, y: 350 })
  })

  it('沒有時間軸時,安全區 = 整個 overlay,中心就是 overlay 中心', () => {
    const r = solvePhoneLayoutDebug({
      origin,
      mapRect: { top: 100, left: 0, width: 400, height: 600 },
      timelineChildRects: [],
      composerRect: null,
    })
    expect(r.timeline).toBeNull()
    expect(r.safeRect).toEqual({ top: 0, left: 0, width: 400, height: 600 })
    expect(r.safeCenter).toEqual({ x: 200, y: 300 })
  })

  it('時間軸 = 面板內容子元素的聯集,安全區 = overlay 頂端到時間軸上緣', () => {
    const r = solvePhoneLayoutDebug({
      origin,
      mapRect: { top: 100, left: 0, width: 400, height: 600 },
      // 兩個子元素:時間軸卡片列(y 350~480)、它上方一顆按鈕(y 320~350),高度 0 的忽略
      timelineChildRects: [
        { top: 450, left: 0, width: 400, height: 130 },
        { top: 420, left: 0, width: 400, height: 30 },
        { top: 700, left: 0, width: 400, height: 0 },
      ],
      composerRect: null,
    })
    expect(r.timeline).toEqual({ top: 320, left: 0, width: 400, height: 130 + 30 })
    expect(r.safeRect).toEqual({ top: 0, left: 0, width: 400, height: 320 })
    expect(r.safeCenter).toEqual({ x: 200, y: 160 })
  })

  it('composer 比時間軸更高時,安全區以較高者為準(取較小的 top)', () => {
    const r = solvePhoneLayoutDebug({
      origin,
      mapRect: { top: 100, left: 0, width: 400, height: 600 },
      timelineChildRects: [{ top: 500, left: 0, width: 400, height: 100 }],
      composerRect: { top: 380, left: 16, width: 368, height: 60 }, // 相對視窗,換算後 y=280
    })
    expect(r.safeRect.height).toBe(280)
  })

  it('delta = 安全區中心 - 地圖中心(要把地圖內容移過去的位移)', () => {
    const r = solvePhoneLayoutDebug({
      origin,
      mapRect: { top: 100, left: 0, width: 400, height: 600 },
      timelineChildRects: [{ top: 500, left: 0, width: 400, height: 100 }],
      composerRect: null,
    })
    // 時間軸上緣 y=400(相對 overlay),安全區 0~400,中心 200;地圖中心 300
    expect(r.safeCenter.y).toBe(200)
    expect(r.delta).toEqual({ x: 0, y: -100 })
  })

  it('找不到地圖容器(mapRect 為 null)時,地圖中心與 delta 為 null,其餘照算', () => {
    const r = solvePhoneLayoutDebug({
      origin,
      mapRect: null,
      timelineChildRects: [],
      composerRect: null,
    })
    expect(r.mapCenter).toBeNull()
    expect(r.delta).toBeNull()
    expect(r.safeCenter).toEqual({ x: 200, y: 300 })
  })
})
