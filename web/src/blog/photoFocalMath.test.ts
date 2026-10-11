import { describe, it, expect } from 'vitest'
import {
  clamp01,
  pointFromPointerEvent,
  objectPositionFor,
  photoDisplayStatus,
  canEditFocal,
} from './photoFocalMath'

// 這份測試只涵蓋純計算邏輯(座標換算、狀態判斷),不測試
// PhotoManagerPage.tsx/PhotoFocalEditor.tsx 的 JSX 渲染——對齊
// scrollTimelineGrouping.test.ts 「只測純函式」的既有做法。

describe('clamp01', () => {
  it('範圍內的值原封不動回傳', () => {
    expect(clamp01(0.42)).toBe(0.42)
  })
  it('小於 0 時夾到 0', () => {
    expect(clamp01(-0.1)).toBe(0)
  })
  it('大於 1 時夾到 1', () => {
    expect(clamp01(1.3)).toBe(1)
  })
  it('NaN 視為 0', () => {
    expect(clamp01(NaN)).toBe(0)
  })
})

describe('pointFromPointerEvent', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('容器左上角對應 (0, 0)', () => {
    expect(pointFromPointerEvent(100, 50, rect)).toEqual({ x: 0, y: 0 })
  })

  it('容器正中央對應 (0.5, 0.5)', () => {
    expect(pointFromPointerEvent(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('容器右下角對應 (1, 1)', () => {
    expect(pointFromPointerEvent(300, 150, rect)).toEqual({ x: 1, y: 1 })
  })

  it('拖曳超出容器邊界時 clamp 在 0~1 之間', () => {
    expect(pointFromPointerEvent(-50, -50, rect)).toEqual({ x: 0, y: 0 })
    expect(pointFromPointerEvent(1000, 1000, rect)).toEqual({ x: 1, y: 1 })
  })

  it('容器尺寸為 0 時退回置中,避免除以 0', () => {
    expect(pointFromPointerEvent(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })
})

describe('objectPositionFor', () => {
  it('沒有焦點時回傳 undefined', () => {
    expect(objectPositionFor(undefined)).toBeUndefined()
  })
  it('依公式轉成百分比字串', () => {
    expect(objectPositionFor({ x: 0.25, y: 0.75 })).toBe('25% 75%')
  })
  it('置中焦點轉成 50% 50%', () => {
    expect(objectPositionFor({ x: 0.5, y: 0.5 })).toBe('50% 50%')
  })
})

describe('photoDisplayStatus', () => {
  it('ready 原樣回傳', () => {
    expect(photoDisplayStatus('ready')).toBe('ready')
  })
  it('failed 原樣回傳', () => {
    expect(photoDisplayStatus('failed')).toBe('failed')
  })
  it('pending 原樣回傳', () => {
    expect(photoDisplayStatus('pending')).toBe('pending')
  })
  it('未知字串保守視為 pending', () => {
    expect(photoDisplayStatus('whatever')).toBe('pending')
  })
})

describe('canEditFocal', () => {
  it('只有 ready 狀態允許編輯焦點', () => {
    expect(canEditFocal('ready')).toBe(true)
    expect(canEditFocal('pending')).toBe(false)
    expect(canEditFocal('failed')).toBe(false)
    expect(canEditFocal('unknown')).toBe(false)
  })
})
